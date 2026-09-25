import type { FastifyInstance } from 'fastify';
import type { ApiError, ZipRequest, ZipTicketDTO } from '@shared/api';
import { dayOf } from '@shared/trip';
import type { AppCtx } from '../context';
import { findByIdIncludingDeleted, listActiveItems } from '../db';
import { buildZip, zipFileName, ZipTicketStore, type ZipItemInput } from '../zip';

export function registerZipRoutes(app: FastifyInstance, ctx: AppCtx, tickets: ZipTicketStore): void {
  app.post<{ Body: ZipRequest }>('/api/zip', async (request, reply) => {
    const req = request.body;
    let inputs: ZipItemInput[];
    let all = false;

    if (req && 'all' in req && req.all === true) {
      all = true;
      inputs = listActiveItems(ctx.db).map((item) => {
        const row = findByIdIncludingDeleted(ctx.db, item.id)!;
        return { id: item.id, fileName: item.fileName, day: item.day, takenAt: item.takenAt, storedPath: row.stored_path };
      });
    } else if (req && 'ids' in req && Array.isArray(req.ids)) {
      if (req.ids.length === 0) {
        const body: ApiError = { error: 'bad_request', message: 'No items selected.' };
        return reply.code(400).send(body);
      }
      inputs = [];
      for (const id of req.ids) {
        const row = findByIdIncludingDeleted(ctx.db, id);
        if (!row || row.deleted_at || row.purged_at) {
          const body: ApiError = { error: 'not_found', message: `Unknown item: ${id}` };
          return reply.code(404).send(body);
        }
        inputs.push({ id: row.id, fileName: row.file_name, day: dayOf(row.taken_at), takenAt: row.taken_at, storedPath: row.stored_path });
      }
    } else {
      const body: ApiError = { error: 'bad_request', message: 'Provide ids or all.' };
      return reply.code(400).send(body);
    }

    if (inputs.length === 0) {
      const body: ApiError = { error: 'bad_request', message: 'No items to zip.' };
      return reply.code(400).send(body);
    }

    const { zipfile, bytes } = await buildZip(inputs);
    const fileName = zipFileName(all, inputs.length);
    const { token, expiresAt } = tickets.create(zipfile, fileName, bytes);
    const res: ZipTicketDTO = { token, fileName, count: inputs.length, bytes, expiresAt };
    return reply.send(res);
  });

  app.get<{ Params: { token: string } }>('/api/zip/:token', async (request, reply) => {
    const ticket = tickets.take(request.params.token);
    if (!ticket) {
      const body: ApiError = { error: 'gone', message: 'This download link expired. Start the download again.' };
      return reply.code(410).send(body);
    }
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Length', String(ticket.bytes));
    const ascii = ticket.fileName.replace(/[^\x20-\x7E]/g, '_');
    reply.header('Content-Disposition', `attachment; filename="${ascii}"`);
    return reply.send(ticket.zipfile.outputStream);
  });
}
