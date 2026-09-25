import type { FastifyInstance } from 'fastify';
import { LIMITS, type ApiError, type CaptionDTO, type CaptionRequest, type DayKey } from '@shared/api';
import { DAYS } from '@shared/trip';
import type { AppCtx } from '../context';
import { requirePerson } from '../auth/plugin';
import { deleteCaption, setCaption } from '../db';

const TRIP_DAY_KEYS: ReadonlySet<string> = new Set(DAYS.map((d) => d.key));

export function registerCaptionRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.put<{ Params: { day: string }; Body: CaptionRequest }>('/api/days/:day/caption', async (request, reply) => {
    const person = requirePerson(request, reply);
    if (!person) return;
    const day = request.params.day;
    if (!TRIP_DAY_KEYS.has(day)) {
      const body: ApiError = { error: 'bad_request', message: 'Unknown day.' };
      return reply.code(400).send(body);
    }
    const raw = request.body?.text ?? '';
    const text = raw.replace(/[\r\n]+/g, ' ').trim().slice(0, LIMITS.captionMaxChars);

    if (text === '') {
      deleteCaption(ctx.db, day);
      ctx.hub.broadcast({ type: 'caption.updated', day: day as DayKey, caption: null });
      return reply.send({ day: day as DayKey, text: null });
    }

    const caption: CaptionDTO = setCaption(ctx.db, day, text, person);
    ctx.hub.broadcast({ type: 'caption.updated', day: day as DayKey, caption });
    return reply.send(caption);
  });
}
