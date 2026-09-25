/**
 * Global auth hook: every /api/* route except health and GET/POST session
 * requires the signed session cookie. Attaches `request.session` (nullable)
 * so public routes can still read it when present (e.g. GET session).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, type ApiError, type PersonId } from '@shared/api';
import type { AppCtx } from '../context';
import { readSessionFromCookieHeader, type SessionPayload } from './session';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionPayload | null;
  }
}

export function registerAuth(app: FastifyInstance, ctx: AppCtx): void {
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.raw.url ?? '';
    const cookieHeader = request.headers.cookie;
    request.session = readSessionFromCookieHeader(cookieHeader, ctx.secret, ctx.pinVersion);

    if (!url.startsWith('/api/')) return; // static SPA shell, hashed assets: public
    if (url.startsWith('/api/uploads')) return; // tus does its own auth in the hooks
    const pathOnly = url.split('?')[0];
    if (pathOnly === '/api/health') return;
    if (pathOnly === '/api/session' && (request.method === 'GET' || request.method === 'POST')) return;

    if (!request.session) {
      const body: ApiError = { error: 'unauthenticated', message: 'Sign in with the PIN first.' };
      reply.code(401).send(body);
    }
  });
}

/** Route helper: 409 no_person if the session has no chosen person yet. */
export function requirePerson(request: FastifyRequest, reply: FastifyReply): PersonId | null {
  const person = request.session?.person ?? null;
  if (!person) {
    const body: ApiError = { error: 'no_person', message: "Choose who you are first (tap Who's this?)." };
    reply.code(409).send(body);
    return null;
  }
  return person;
}

export { SESSION_COOKIE };
