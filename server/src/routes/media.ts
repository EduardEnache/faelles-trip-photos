import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ApiError, MediaVariant } from '@shared/api';
import type { AppCtx } from '../context';
import { findByIdIncludingDeleted } from '../db';

const VARIANTS: readonly MediaVariant[] = ['thumb', 'display', 'preview', 'original'];

function contentTypeFor(variant: MediaVariant, mime: string): string {
  if (variant === 'thumb' || variant === 'display') return 'image/webp';
  if (variant === 'preview') return 'video/mp4';
  return mime || 'application/octet-stream';
}

function contentDisposition(fileName: string, download: boolean): string | null {
  if (!download) return null;
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function registerMediaRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get<{ Params: { id: string; variant: string }; Querystring: { v?: string; download?: string } }>(
    '/api/media/:id/:variant',
    async (request, reply) => {
      const { id, variant } = request.params;
      if (!VARIANTS.includes(variant as MediaVariant)) {
        const body: ApiError = { error: 'not_found', message: 'Unknown media variant.' };
        return reply.code(404).send(body);
      }
      const row = findByIdIncludingDeleted(ctx.db, id);
      if (!row || row.purged_at || (row.deleted_at && row.uploader !== request.session?.person)) {
        const body: ApiError = { error: 'not_found', message: 'Not found.' };
        return reply.code(404).send(body);
      }

      let filePath: string;
      let mime: string;
      let fileName: string;
      let cacheControl: string;
      const v = variant as MediaVariant;
      if (v === 'original') {
        if (!row.stored_path) {
          const body: ApiError = { error: 'not_found', message: 'Not found.' };
          return reply.code(404).send(body);
        }
        filePath = row.stored_path;
        mime = row.mime;
        fileName = row.file_name;
        cacheControl = 'private, max-age=3600';
      } else {
        const hasIt = v === 'thumb' ? row.has_thumb : v === 'display' ? row.has_display : row.has_preview;
        if (!hasIt) {
          const body: ApiError = { error: 'not_found', message: 'Not ready yet.' };
          return reply.code(404).send(body);
        }
        const fname = v === 'thumb' ? 'thumb.webp' : v === 'display' ? 'display.webp' : 'preview.mp4';
        filePath = path.join(ctx.paths.derived, id, fname);
        mime = contentTypeFor(v, row.mime);
        fileName = fname;
        cacheControl = 'private, max-age=31536000, immutable';
      }

      let stat: fs.Stats;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        const body: ApiError = { error: 'not_found', message: 'Not found.' };
        return reply.code(404).send(body);
      }

      const download = request.query.download === '1';
      reply.header('Content-Type', mime);
      reply.header('Cache-Control', cacheControl);
      reply.header('Accept-Ranges', 'bytes');
      const disp = contentDisposition(fileName, download);
      if (disp) reply.header('Content-Disposition', disp);

      const range = request.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          const size = stat.size;
          let start = m[1] ? Number(m[1]) : NaN;
          let end = m[2] ? Number(m[2]) : NaN;
          if (Number.isNaN(start) && !Number.isNaN(end)) {
            start = Math.max(0, size - end);
            end = size - 1;
          } else if (!Number.isNaN(start) && Number.isNaN(end)) {
            end = size - 1;
          }
          if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && end < size) {
            reply.code(206);
            reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
            reply.header('Content-Length', String(end - start + 1));
            return reply.send(fs.createReadStream(filePath, { start, end }));
          }
        }
        reply.code(416);
        reply.header('Content-Range', `bytes */${stat.size}`);
        return reply.send();
      }

      reply.header('Content-Length', String(stat.size));
      return reply.send(fs.createReadStream(filePath));
    },
  );
}
