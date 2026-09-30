/**
 * fælles. server — assembles the Fastify app from config (PLAN.md §1).
 * Exported as buildApp() so both index.ts (production boot) and the test
 * suite (with a tmp storageDir) can construct it.
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadConfig, storagePaths, type Config, type ConfigOverrides } from './config';
import type { AppCtx, StoragePaths } from './context';
import { openDb } from './db';
import { EventHub } from './events';
import { DiskGuard } from './disk';
import { DerivationQueue } from './media/queue';
import { PinThrottle } from './auth/throttle';
import { detectTools } from './media/tools';
import { loadOrCreateSecret, pinVersion } from './auth/session';
import { registerAuth } from './auth/plugin';
import { registerHealthRoute } from './routes/health';
import { registerSessionRoutes } from './routes/session';
import { registerLibraryRoutes } from './routes/library';
import { registerItemRoutes } from './routes/items';
import { registerCaptionRoutes } from './routes/captions';
import { registerUploadResultRoutes } from './routes/uploadResults';
import { registerMediaRoutes } from './routes/media';
import { registerZipRoutes } from './routes/zip';
import { registerEventsRoute } from './routes/events';
import { createTusServer, TUS_PATH } from './upload/tus';
import { ZipTicketStore } from './zip';
import { startSweeps } from './trash';

const BASE_PREFIX = '/photos';

export function stripBase(url: string): string {
  if (url === BASE_PREFIX) return '/';
  if (url.startsWith(`${BASE_PREFIX}/`) || url.startsWith(`${BASE_PREFIX}?`)) {
    const rest = url.slice(BASE_PREFIX.length);
    return rest.startsWith('?') ? `/${rest}` : rest;
  }
  return url;
}

const CSP =
  "default-src 'self'; img-src 'self' blob: data: https://tiles.openfreemap.org; media-src 'self' blob:; " +
  "connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; frame-ancestors 'none'";

function ensureStorageDirs(paths: StoragePaths): void {
  for (const dir of [paths.root, paths.originals, paths.derived, paths.incoming, paths.trash, paths.db]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Øresund</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#F4F2EE;color:#1D2125;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}
main{max-width:28rem}h1{font-weight:500}</style></head>
<body><main><h1>øresund.</h1><p>The app is building. The API is up — check back shortly.</p></main></body></html>`;

export interface BuiltApp {
  app: FastifyInstance;
  config: Config;
  ctx: AppCtx;
  close: () => Promise<void>;
}

export async function buildApp(overrides: ConfigOverrides = {}): Promise<BuiltApp> {
  const config = loadConfig(overrides);
  const paths = storagePaths(config.storageDir);
  ensureStorageDirs(paths);

  const db = openDb(paths.dbFile);
  const secret = loadOrCreateSecret(paths.secretFile);
  const pv = pinVersion(config.pin, secret);
  const hub = new EventHub();
  const diskGuard = new DiskGuard(paths.root, hub);
  const throttle = new PinThrottle();
  const tools = await detectTools();
  const queue = new DerivationQueue(
    db,
    { photoConcurrency: config.photoConcurrency, videoConcurrency: config.videoConcurrency, derivedDir: paths.derived },
    hub,
    tools,
  );

  const ctx: AppCtx = { config, paths, db, hub, diskGuard, queue, throttle, secret, pinVersion: pv, tools, startedAt: Date.now() };

  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: false,
    bodyLimit: 2 * 1024 * 1024, // JSON bodies only; uploads go through tus
    // Drop sockets idle for 60 s, so a stalled upload PATCH (phone asleep,
    // dead proxy connection) is closed and its tus lock freed instead of
    // hanging forever. SSE pings every 25 s, so /api/events stays open.
    connectionTimeout: 60_000,
    routerOptions: { ignoreTrailingSlash: true },
    rewriteUrl: (req) => stripBase(req.url ?? '/'),
  });

  await app.register(fastifyCookie);

  // Security headers on every response, set early so they survive hijacked
  // (tus / SSE / zip streaming) responses too (Node merges setHeader() with
  // any later writeHead()).
  app.addHook('onRequest', async (_request, reply) => {
    const res = reply.raw;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Content-Security-Policy', CSP);
  });

  registerAuth(app, ctx);

  registerHealthRoute(app, ctx);
  registerSessionRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerItemRoutes(app, ctx);
  registerCaptionRoutes(app, ctx);
  registerUploadResultRoutes(app, ctx);
  registerMediaRoutes(app, ctx);
  const zipTickets = new ZipTicketStore();
  registerZipRoutes(app, ctx, zipTickets);
  registerEventsRoute(app, ctx);

  // tus resumable uploads
  const tusServer = createTusServer({
    db,
    incomingDir: paths.incoming,
    originalsDir: paths.originals,
    secret,
    pinVersion: pv,
    hub,
    diskGuard,
    queue,
  });
  app.addContentTypeParser('application/offset+octet-stream', (_req, _payload, done) => done(null));
  app.all(TUS_PATH, (request, reply) => {
    reply.hijack();
    void tusServer.handle(request.raw, reply.raw);
  });
  app.all(`${TUS_PATH}/*`, (request, reply) => {
    reply.hijack();
    // Background Fetch (phones uploading with the browser minimised) sends
    // its PATCH as POST + X-HTTP-Method-Override; @tus/server doesn't map it.
    const override = request.headers['x-http-method-override'];
    if (request.raw.method === 'POST' && typeof override === 'string' && override.toUpperCase() === 'PATCH') {
      request.raw.method = 'PATCH';
    }
    void tusServer.handle(request.raw, reply.raw);
  });

  // static SPA (web/dist copied to STATIC_DIR at build time) + index.html fallback,
  // never for /api/* or /api/uploads/*.
  const staticDir = path.resolve(process.env.STATIC_DIR ?? path.join(process.cwd(), 'public'));
  const indexPath = path.join(staticDir, 'index.html');
  const hasBuild = fs.existsSync(indexPath);
  let indexHtml = PLACEHOLDER_HTML;
  if (hasBuild) {
    indexHtml = fs.readFileSync(indexPath, 'utf8');
    const fastifyStatic = await import('@fastify/static');
    await app.register(fastifyStatic.default, {
      root: staticDir,
      prefix: '/',
      wildcard: false,
      index: false,
      cacheControl: true,
      immutable: false,
    });
  }
  app.get('/*', async (request, reply) => {
    const url = request.raw.url ?? '';
    if (url.startsWith('/api/')) {
      reply.code(404).send({ error: 'not_found', message: 'Not found.' });
      return;
    }
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.send(indexHtml);
  });

  // background: resume any items still 'processing' from a previous run, disk poll, trash/incoming sweeps
  queue.resumeFromDb();
  diskGuard.start();
  const stopSweeps = startSweeps(db, paths.incoming);

  const close = async () => {
    stopSweeps();
    diskGuard.stop();
    await app.close();
    db.close();
  };

  return { app, config, ctx, close };
}
