#!/usr/bin/env node
/**
 * Dev-only proxy that mimics Tailscale Funnel's `--set-path=/photos`
 * behaviour: it strips a leading /photos before forwarding to the backend,
 * exactly like the production Funnel does. Used to prove the app works when
 * the server only ever sees stripped URLs while the browser still thinks
 * it's talking to /photos/ (this is what breaks tus's relative Location
 * resolution if it's ever wrong).
 *
 * Usage: node scripts/strip-proxy.mjs <listenPort> <upstreamPort>
 *   node scripts/strip-proxy.mjs 8499 8498
 *   then browse/curl http://127.0.0.1:8499/photos/
 */
import http from 'node:http';

const listenPort = Number(process.argv[2] ?? 8499);
const upstreamPort = Number(process.argv[3] ?? 8498);
const upstreamHost = '127.0.0.1';

function stripPhotos(url) {
  if (url === '/photos') return '/';
  if (url.startsWith('/photos/') || url.startsWith('/photos?')) {
    const rest = url.slice('/photos'.length);
    return rest.startsWith('?') ? `/${rest}` : rest;
  }
  return url;
}

const server = http.createServer((clientReq, clientRes) => {
  const forwardedUrl = stripPhotos(clientReq.url ?? '/');
  const upstreamReq = http.request(
    {
      host: upstreamHost,
      port: upstreamPort,
      method: clientReq.method,
      path: forwardedUrl,
      headers: { ...clientReq.headers, host: `${upstreamHost}:${upstreamPort}` },
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );
  upstreamReq.on('error', (err) => {
    if (!clientRes.headersSent) clientRes.writeHead(502);
    clientRes.end(`strip-proxy: upstream error: ${err.message}`);
  });
  clientReq.pipe(upstreamReq);
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(
    `strip-proxy: http://127.0.0.1:${listenPort}/photos/... → (strips /photos) → http://127.0.0.1:${upstreamPort}/...`,
  );
});
