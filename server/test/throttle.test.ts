import { describe, expect, it } from 'vitest';
import { PinThrottle } from '../src/auth/throttle';
import { LIMITS } from '@shared/api';

function clockAt(startMs: number) {
  let now = startMs;
  return { advance: (ms: number) => (now += ms), fn: () => now };
}

describe('PinThrottle', () => {
  it('allows up to pinMaxFailuresPerIp-1 failures without locking', () => {
    const clock = clockAt(0);
    const t = new PinThrottle(clock.fn);
    for (let i = 0; i < LIMITS.pinMaxFailuresPerIp - 1; i++) {
      t.recordFailure('1.2.3.4');
      expect(t.status('1.2.3.4').locked).toBe(false);
    }
  });

  it('locks the IP on the Nth failure, base lockout duration', () => {
    const clock = clockAt(0);
    const t = new PinThrottle(clock.fn);
    for (let i = 0; i < LIMITS.pinMaxFailuresPerIp; i++) t.recordFailure('1.2.3.4');
    const s = t.status('1.2.3.4');
    expect(s.locked).toBe(true);
    expect(s.retryAfterSec).toBeLessThanOrEqual(LIMITS.pinLockoutBaseSec);
    expect(s.retryAfterSec).toBeGreaterThan(LIMITS.pinLockoutBaseSec - 2);
  });

  it('a different IP is unaffected by another IP being locked', () => {
    const clock = clockAt(0);
    const t = new PinThrottle(clock.fn);
    for (let i = 0; i < LIMITS.pinMaxFailuresPerIp; i++) t.recordFailure('1.2.3.4');
    expect(t.status('1.2.3.4').locked).toBe(true);
    expect(t.status('5.6.7.8').locked).toBe(false);
  });

  it('lockout doubles on repeated offences, capped', () => {
    const clock = clockAt(0);
    const t = new PinThrottle(clock.fn);
    const lockAndExpire = () => {
      for (let i = 0; i < LIMITS.pinMaxFailuresPerIp; i++) t.recordFailure('9.9.9.9');
      const sec = t.status('9.9.9.9').retryAfterSec;
      clock.advance((sec + 1) * 1000);
      return sec;
    };
    const first = lockAndExpire();
    const second = lockAndExpire();
    expect(second).toBeGreaterThanOrEqual(first * 2 - 2);
  });

  it('lockout is capped at pinLockoutMaxSec', () => {
    const clock = clockAt(0);
    const t = new PinThrottle(clock.fn);
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < LIMITS.pinMaxFailuresPerIp; i++) t.recordFailure('9.9.9.9');
      const sec = t.status('9.9.9.9').retryAfterSec;
      expect(sec).toBeLessThanOrEqual(LIMITS.pinLockoutMaxSec);
      clock.advance((sec + 1) * 1000);
    }
  });

  it('recordSuccess clears the failure count for that IP', () => {
    const clock = clockAt(0);
    const t = new PinThrottle(clock.fn);
    for (let i = 0; i < LIMITS.pinMaxFailuresPerIp - 1; i++) t.recordFailure('1.1.1.1');
    t.recordSuccess('1.1.1.1');
    expect(t.attemptsLeft('1.1.1.1')).toBe(LIMITS.pinMaxFailuresPerIp);
  });

  it('global backoff locks everyone after pinGlobalMaxFailures across distinct IPs', () => {
    const clock = clockAt(0);
    const t = new PinThrottle(clock.fn);
    // spread failures across many IPs, staying under each IP's own limit
    let ipN = 0;
    for (let i = 0; i < LIMITS.pinGlobalMaxFailures; i++) {
      t.recordFailure(`10.0.0.${ipN}`);
      ipN = (ipN + 1) % (LIMITS.pinMaxFailuresPerIp - 1 || 1);
    }
    expect(t.status('brand-new-ip').locked).toBe(true);
  });
});
