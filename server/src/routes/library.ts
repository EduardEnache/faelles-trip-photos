import type { FastifyInstance } from 'fastify';
import type { LibraryDTO } from '@shared/api';
import type { AppCtx } from '../context';
import { listActiveItems, listCaptions } from '../db';

export function registerLibraryRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/library', async (): Promise<LibraryDTO> => ({
    items: listActiveItems(ctx.db),
    captions: listCaptions(ctx.db),
    disk: ctx.diskGuard.get(),
    serverTime: new Date().toISOString(),
  }));
}
