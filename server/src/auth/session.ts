/**
 * Signed session cookie. Implemented with plain Node crypto (not
 * @fastify/cookie's signer) so both ordinary Fastify routes and the tus
 * hooks (which see a raw http.IncomingMessage) can verify it the same way.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS, SESSION_COOKIE, type PersonId } from '@shared/api';
import { isPersonId } from '@shared/trip';

export interface SessionPayload {
  v: 1;
  /** Issued-at, ms epoch. */
  iat: number;
  /** First 8 hex chars of sha256(PIN + secret): changing the PIN invalidates all sessions. */
  pv: string;
  person: PersonId | null;
}

export function loadOrCreateSecret(secretFile: string): Buffer {
  try {
    const buf = fs.readFileSync(secretFile);
    if (buf.length >= 32) return buf;
  } catch {
    // fall through to create
  }
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  try {
    fs.chmodSync(secretFile, 0o600);
  } catch {
    // best effort (e.g. some filesystems)
  }
  return secret;
}

export function pinVersion(pin: string, secret: Buffer): string {
  return crypto.createHash('sha256').update(pin).update(secret).digest('hex').slice(0, 8);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function signSession(payload: SessionPayload, secret: Buffer): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(cookieValue: string | undefined, secret: Buffer, currentPv: string): SessionPayload | null {
  if (!cookieValue) return null;
  const idx = cookieValue.lastIndexOf('.');
  if (idx < 0) return null;
  const body = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.v !== 1) return null;
  if (payload.pv !== currentPv) return null; // PIN rotated
  if (payload.person !== null && !isPersonId(payload.person)) return null;
  const ageMs = Date.now() - payload.iat;
  if (ageMs < 0 || ageMs > LIMITS.sessionDays * 24 * 3600_000) return null;
  return payload;
}

/** Minimal cookie header parser (no external dep needed for the tus raw-request path). */
export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function readSessionFromCookieHeader(
  header: string | undefined | null,
  secret: Buffer,
  currentPv: string,
): SessionPayload | null {
  const cookies = parseCookieHeader(header);
  return verifySession(cookies[SESSION_COOKIE], secret, currentPv);
}

export function sessionCookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: LIMITS.sessionDays * 24 * 3600,
  };
}

/** Secure flag: true when the request arrived via the HTTPS-terminating proxy. */
export function isSecureRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const proto = headers['x-forwarded-proto'];
  const val = Array.isArray(proto) ? proto[0] : proto;
  if (val) return val.split(',')[0]!.trim().toLowerCase() === 'https';
  return false;
}
