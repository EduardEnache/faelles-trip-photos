import path from 'node:path';
import fsp from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError, ItemDTO } from '@shared/api';
import type { AppCtx } from '../context';
import { requirePerson } from '../auth/plugin';
import {
  findByIdIncludingDeleted,
  getItem,
  moveToTrash,
  restoreFromTrash,
  rowToItem,
  setHeart,
  setHighlight,
} from '../db';
import { moveDirIfExists, moveFile } from '../util/fsmove';

export function registerItemRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    const row = findByIdIncludingDeleted(ctx.db, request.params.id);
    if (!row || row.purged_at) {
      const body: ApiError = { error: 'not_found', message: 'That item is gone.' };
      return reply.code(404).send(body);
    }
    if (row.deleted_at && row.uploader !== request.session?.person) {
      const body: ApiError = { error: 'not_found', message: 'That item is gone.' };
      return reply.code(404).send(body);
    }
    const item: ItemDTO = rowToItem(ctx.db, row);
    return reply.send(item);
  });

  app.delete<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    const person = requirePerson(request, reply);
    if (!person) return;
    const row = findByIdIncludingDeleted(ctx.db, request.params.id);
    if (!row || row.purged_at || row.deleted_at) {
      const body: ApiError = { error: 'not_found', message: 'That item is gone.' };
      return reply.code(404).send(body);
    }
    if (row.uploader !== person) {
      const body: ApiError = { error: 'not_owner', message: "That's not your upload." };
      return reply.code(403).send(body);
    }

    const trashItemDir = path.join(ctx.paths.trash, row.id);
    await fsp.mkdir(trashItemDir, { recursive: true });
    const newOriginalPath = path.join(trashItemDir, path.basename(row.stored_path));
    await moveFile(row.stored_path, newOriginalPath);
    await moveDirIfExists(path.join(ctx.paths.derived, row.id), path.join(trashItemDir, 'derived'));

    moveToTrash(ctx.db, row.id, newOriginalPath);
    ctx.hub.broadcast({ type: 'item.deleted', id: row.id, by: person });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/items/:id/restore', async (request, reply) => {
    const person = request.session?.person ?? null;
    const row = findByIdIncludingDeleted(ctx.db, request.params.id);
    if (!row) {
      const body: ApiError = { error: 'not_found', message: 'That item is gone.' };
      return reply.code(404).send(body);
    }
    if (row.purged_at) {
      const body: ApiError = { error: 'gone', message: 'That item was permanently removed after 30 days in trash.' };
      return reply.code(410).send(body);
    }
    if (!row.deleted_at) {
      const body: ApiError = { error: 'not_found', message: "That item isn't in trash." };
      return reply.code(404).send(body);
    }
    if (row.uploader !== person) {
      const body: ApiError = { error: 'not_owner', message: "That's not your upload." };
      return reply.code(403).send(body);
    }

    const trashItemDir = path.join(ctx.paths.trash, row.id);
    const destDir = path.join(ctx.paths.originals, row.uploader);
    await fsp.mkdir(destDir, { recursive: true });
    const restoredOriginalPath = path.join(destDir, path.basename(row.stored_path));
    await moveFile(row.stored_path, restoredOriginalPath);
    await moveDirIfExists(path.join(trashItemDir, 'derived'), path.join(ctx.paths.derived, row.id));
    await fsp.rm(trashItemDir, { recursive: true, force: true }).catch(() => {});

    restoreFromTrash(ctx.db, row.id, restoredOriginalPath);
    const item = getItem(ctx.db, row.id)!;
    ctx.hub.broadcast({ type: 'item.added', item });
    return reply.send(item);
  });

  async function setHeartRoute(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, on: boolean) {
    const person = requirePerson(request, reply);
    if (!person) return;
    const row = findByIdIncludingDeleted(ctx.db, request.params.id);
    if (!row || row.deleted_at || row.purged_at) {
      const body: ApiError = { error: 'not_found', message: 'That item is gone.' };
      return reply.code(404).send(body);
    }
    setHeart(ctx.db, row.id, person, on);
    const item = getItem(ctx.db, row.id)!;
    ctx.hub.broadcast({ type: 'item.updated', item });
    return reply.send(item);
  }
  app.put<{ Params: { id: string } }>('/api/items/:id/heart', (req, reply) => setHeartRoute(req, reply, true));
  app.delete<{ Params: { id: string } }>('/api/items/:id/heart', (req, reply) => setHeartRoute(req, reply, false));

  async function setHighlightRoute(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, on: boolean) {
    const person = requirePerson(request, reply);
    if (!person) return;
    const row = findByIdIncludingDeleted(ctx.db, request.params.id);
    if (!row || row.deleted_at || row.purged_at) {
      const body: ApiError = { error: 'not_found', message: 'That item is gone.' };
      return reply.code(404).send(body);
    }
    setHighlight(ctx.db, row.id, person, on);
    const item = getItem(ctx.db, row.id)!;
    ctx.hub.broadcast({ type: 'item.updated', item });
    return reply.send(item);
  }
  app.put<{ Params: { id: string } }>('/api/items/:id/highlight', (req, reply) => setHighlightRoute(req, reply, true));
  app.delete<{ Params: { id: string } }>('/api/items/:id/highlight', (req, reply) => setHighlightRoute(req, reply, false));
}
