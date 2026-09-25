/**
 * PIN throttling per PLAN.md §1.3. In-memory, a restart resetting it is
 * acceptable. Takes an injectable clock so it is unit-testable without
 * real timers.
 */
import { LIMITS } from '@shared/api';

interface IpState {
  /** Failure timestamps (ms) within the current window. */
  failures: number[];
  lockUntil: number;
  /** How many times this IP has been locked out (drives the doubling). */
  lockCount: number;
}

export class PinThrottle {
  private ipState = new Map<string, IpState>();
  private globalFailures: number[] = [];
  private globalLockUntil = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  private prune(arr: number[], windowMs: number): void {
    const cutoff = this.clock() - windowMs;
    while (arr.length && arr[0]! < cutoff) arr.shift();
  }

  /** Combined lock status (per-IP OR global), the larger retryAfter wins. */
  status(ip: string): { locked: boolean; retryAfterSec: number } {
    const now = this.clock();
    let retryAfter = 0;
    if (this.globalLockUntil > now) {
      retryAfter = Math.max(retryAfter, Math.ceil((this.globalLockUntil - now) / 1000));
    }
    const s = this.ipState.get(ip);
    if (s && s.lockUntil > now) {
      retryAfter = Math.max(retryAfter, Math.ceil((s.lockUntil - now) / 1000));
    }
    return { locked: retryAfter > 0, retryAfterSec: retryAfter };
  }

  attemptsLeft(ip: string): number {
    const s = this.ipState.get(ip);
    if (!s) return LIMITS.pinMaxFailuresPerIp;
    this.prune(s.failures, LIMITS.pinIpWindowMinutes * 60_000);
    return Math.max(0, LIMITS.pinMaxFailuresPerIp - s.failures.length);
  }

  recordFailure(ip: string): void {
    const now = this.clock();
    let s = this.ipState.get(ip);
    if (!s) {
      s = { failures: [], lockUntil: 0, lockCount: 0 };
      this.ipState.set(ip, s);
    }
    this.prune(s.failures, LIMITS.pinIpWindowMinutes * 60_000);
    s.failures.push(now);
    if (s.failures.length >= LIMITS.pinMaxFailuresPerIp) {
      s.lockCount += 1;
      const sec = Math.min(LIMITS.pinLockoutBaseSec * 2 ** (s.lockCount - 1), LIMITS.pinLockoutMaxSec);
      s.lockUntil = now + sec * 1000;
      s.failures = [];
    }

    this.prune(this.globalFailures, LIMITS.pinGlobalWindowMinutes * 60_000);
    this.globalFailures.push(now);
    if (this.globalFailures.length >= LIMITS.pinGlobalMaxFailures) {
      this.globalLockUntil = now + LIMITS.pinGlobalLockoutSec * 1000;
      this.globalFailures = [];
    }
  }

  recordSuccess(ip: string): void {
    const s = this.ipState.get(ip);
    if (s) s.failures = [];
  }
}

/** Rightmost X-Forwarded-For entry (appended by our own local proxy), else the socket address. */
export function clientIp(headers: Record<string, string | string[] | undefined>, socketAddr: string): string {
  const xff = headers['x-forwarded-for'];
  const val = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  if (val) {
    const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return socketAddr;
}
