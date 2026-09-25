import type { FastifyInstance } from 'fastify';
import type { ServerEvent } from '@shared/api';
import type { AppCtx } from '../context';

const PING_MS = 25_000;

export function registerEventsRoute(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: ServerEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: 'hello', serverTime: new Date().toISOString(), version: ctx.config.buildVersion });

    const unsubscribe = ctx.hub.subscribe(send);
    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, PING_MS);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    res.on('close', cleanup);
  });
}
