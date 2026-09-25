/**
 * fælles. server entry — SCAFFOLD STUB (package A replaces this).
 *
 * Shows the two non-negotiables every later version must keep:
 *  1. rewriteUrl: '/photos/x' and '/x' hit the same route (Funnel strips the prefix, local keeps it).
 *  2. Everything the API returns follows @shared/api.
 */
import Fastify from 'fastify';
import { API_PATHS, type HealthDTO } from '@shared/api';
import { TRIP } from '@shared/trip';

const PORT = Number(process.env.PORT ?? 8497);
const HOST = process.env.HOST ?? '0.0.0.0';
const BASE_PREFIX = '/photos';

export function stripBase(url: string): string {
  if (url === BASE_PREFIX) return '/';
  if (url.startsWith(`${BASE_PREFIX}/`) || url.startsWith(`${BASE_PREFIX}?`)) {
    const rest = url.slice(BASE_PREFIX.length);
    return rest.startsWith('?') ? `/${rest}` : rest;
  }
  return url;
}

const app = Fastify({
  logger: true,
  trustProxy: false,
  rewriteUrl: (req) => stripBase(req.url ?? '/'),
});

app.get(`/${API_PATHS.health}`, async (): Promise<HealthDTO> => ({
  ok: true,
  version: '0.0.0-scaffold',
  tools: { vips: false, heif: false, ffmpeg: false, exiftool: false },
}));

app.get('/', async () => `${TRIP.title}: scaffold`);

if (process.env.VITEST !== 'true') {
  app.listen({ port: PORT, host: HOST }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

export { app };
