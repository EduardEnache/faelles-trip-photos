import path from 'node:path';
import fsp from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { ApiError, UploadResultDTO } from '@shared/api';
import type { AppCtx } from '../context';
import { getItem, getUploadResult } from '../db';

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export function registerUploadResultRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get<{ Params: { uploadId: string } }>('/api/upload-results/:uploadId', async (request, reply) => {
    const uploadId = request.params.uploadId;
    const done = getUploadResult(ctx.db, uploadId);
    if (done) {
      const item = getItem(ctx.db, done.itemId);
      if (item) {
        const res: UploadResultDTO = { item, duplicate: done.duplicate };
        return reply.send(res);
      }
    }
    // Still finalising (or in flight) if tus still has bookkeeping for it.
    const configPath = path.join(ctx.paths.incoming, `${uploadId}.json`);
    if (await exists(configPath)) {
      return reply.code(202).send({ pending: true });
    }
    const body: ApiError = { error: 'not_found', message: 'Unknown upload.' };
    return reply.code(404).send(body);
  });
}
