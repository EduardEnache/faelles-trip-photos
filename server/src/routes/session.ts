import type { FastifyInstance } from 'fastify';
import { LIMITS, SESSION_COOKIE, type ApiError, type LoginRequest, type SessionDTO, type SetPersonRequest } from '@shared/api';
import { isPersonId, TRIP } from '@shared/trip';
import crypto from 'node:crypto';
import type { AppCtx } from '../context';
import { clientIp } from '../auth/throttle';
import { isSecureRequest, sessionCookieOptions, signSession } from '../auth/session';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function albumOf(ctx: AppCtx): SessionDTO['album'] {
  return {
    title: ctx.config.albumTitle,
    firstDay: TRIP.firstDay,
    lastDay: TRIP.lastDay,
    timeZone: TRIP.timeZone,
  };
}

function timingSafeEqualPin(a: string, b: string): boolean {
  const pad = (s: string) => Buffer.from(s.padEnd(32, '\0'));
  return crypto.timingSafeEqual(pad(a), pad(b));
}

export function registerSessionRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/session', async (request, reply): Promise<SessionDTO> => {
    const session = request.session;
    if (!session) {
      return { authenticated: false, person: null, album: albumOf(ctx) };
    }
    return { authenticated: true, person: session.person, album: albumOf(ctx) };
  });

  app.post<{ Body: LoginRequest }>('/api/session', async (request, reply) => {
    const ip = clientIp(request.headers, request.socket.remoteAddress ?? 'unknown');
    const pin = request.body?.pin;

    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      const body: ApiError = { error: 'bad_request', message: 'PIN must be 4 digits.' };
      return reply.code(400).send(body);
    }

    const pre = ctx.throttle.status(ip);
    if (pre.locked) {
      reply.header('Retry-After', String(pre.retryAfterSec));
      const body: ApiError = {
        error: 'locked',
        message: `Too many tries. Try again in ${Math.ceil(pre.retryAfterSec / 60) || 1} min.`,
        retryAfterSec: pre.retryAfterSec,
      };
      return reply.code(429).send(body);
    }

    if (timingSafeEqualPin(pin, ctx.config.pin)) {
      ctx.throttle.recordSuccess(ip);
      const existingPerson = request.session?.person ?? null;
      const payload = { v: 1 as const, iat: Date.now(), pv: ctx.pinVersion, person: existingPerson };
      const cookieVal = signSession(payload, ctx.secret);
      reply.setCookie(SESSION_COOKIE, cookieVal, sessionCookieOptions(isSecureRequest(request.headers)));
      const res: SessionDTO = { authenticated: true, person: existingPerson, album: albumOf(ctx) };
      return reply.send(res);
    }

    ctx.throttle.recordFailure(ip);
    await sleep(400);
    const post = ctx.throttle.status(ip);
    if (post.locked) {
      reply.header('Retry-After', String(post.retryAfterSec));
      const body: ApiError = {
        error: 'locked',
        message: `Too many tries. Try again in ${Math.ceil(post.retryAfterSec / 60) || 1} min.`,
        retryAfterSec: post.retryAfterSec,
      };
      return reply.code(429).send(body);
    }
    const body: ApiError = {
      error: 'wrong_pin',
      message: 'Wrong PIN.',
      attemptsLeft: ctx.throttle.attemptsLeft(ip),
    };
    return reply.code(401).send(body);
  });

  app.put<{ Body: SetPersonRequest }>('/api/session/person', async (request, reply) => {
    const person = request.body?.person;
    if (!isPersonId(person)) {
      const body: ApiError = { error: 'bad_request', message: 'Unknown person.' };
      return reply.code(400).send(body);
    }
    const payload = { v: 1 as const, iat: Date.now(), pv: ctx.pinVersion, person };
    const cookieVal = signSession(payload, ctx.secret);
    reply.setCookie(SESSION_COOKIE, cookieVal, sessionCookieOptions(isSecureRequest(request.headers)));
    const res: SessionDTO = { authenticated: true, person, album: albumOf(ctx) };
    return reply.send(res);
  });

  app.delete('/api/session', async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
