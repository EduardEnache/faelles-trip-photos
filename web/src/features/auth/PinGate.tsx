/**
 * screen 01: PIN gate. Custom keypad (4 soft cells, shake on
 * wrong code), keyboard entry + paste on desktop, honest lockout copy.
 */
import { useEffect, useRef, useState } from 'react';
import { BackspaceIcon } from '@/lib/icons';
import { Wordmark } from '@/ui';
import { useSession } from '@/state/session';
import { tripRangeLabel } from '@/app/copy';
import s from './PinGate.module.css';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

function formatRetry(sec: number): string {
  if (sec >= 60) {
    const m = Math.ceil(sec / 60);
    return `${m} min`;
  }
  return `${sec}s`;
}

export function PinGate() {
  const login = useSession((st) => st.login);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (lockUntil == null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setLockUntil(null);
        setMsg('');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockUntil]);

  const locked = lockUntil != null && remaining > 0;

  async function submit(fullPin: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    const result = await login(fullPin);
    submittingRef.current = false;
    setBusy(false);
    if (result.ok) return;
    if (result.reason === 'wrong_pin') {
      setError(true);
      setMsg(
        result.attemptsLeft != null && result.attemptsLeft > 0
          ? `Not quite. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`
          : 'Not quite. Try again.',
      );
      window.setTimeout(() => {
        setError(false);
        setPin('');
      }, 650);
    } else if (result.reason === 'locked') {
      setError(true);
      setLockUntil(Date.now() + result.retryAfterSec * 1000);
      setMsg(`Too many tries. Try again in ${formatRetry(result.retryAfterSec)}.`);
      window.setTimeout(() => {
        setError(false);
        setPin('');
      }, 650);
    } else {
      setMsg(result.message);
      window.setTimeout(() => setPin(''), 650);
    }
  }

  function press(k: string) {
    if (locked || busy || error) return;
    if (k === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) {
      window.setTimeout(() => void submit(next), 180);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, locked, busy, error]);

  function onPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (text.length === 4) {
      e.preventDefault();
      setPin(text);
      window.setTimeout(() => void submit(text), 180);
    }
  }

  return (
    <div className={s.screen} onPaste={onPaste}>
      <div className={s.top}>
        <Wordmark />
        <div className={s.tag}>PRIVATE ALBUM</div>
      </div>
      <div className={s.center}>
        <div className={s.intro}>
          <div className={s.tag}>{tripRangeLabel()}</div>
          <div className={s.title}>Velkommen.</div>
          <div className={s.sub}>Enter the four-digit code from the group chat.</div>
        </div>
        <div className={[s.dots, error ? s.shake : ''].join(' ')} role="status" aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => {
            const filled = i < pin.length;
            const cls = [s.cell, filled && s.filled, i === pin.length && s.current, error && s.error]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={i} className={cls}>
                <div className={[s.dot, filled && s.on].filter(Boolean).join(' ')} />
              </div>
            );
          })}
        </div>
        <div className={s.msg} aria-live="polite">
          {msg}
          {locked && remaining > 0 ? ` (${formatRetry(remaining)})` : ''}
        </div>
        <div className={s.keypad}>
          {KEYS.map((k, i) =>
            k === '' ? (
              <div key={i} className={s.keyGhost} />
            ) : (
              <button
                key={i}
                type="button"
                className={[s.key, k === 'del' && s.keyDel].filter(Boolean).join(' ')}
                disabled={locked || busy}
                aria-label={k === 'del' ? 'Delete' : k}
                onClick={() => press(k)}
              >
                {k === 'del' ? <BackspaceIcon aria-hidden /> : k}
              </button>
            ),
          )}
        </div>
      </div>
      <div className={s.bottom}>SHARED BY LINK · NO ACCOUNTS</div>
    </div>
  );
}
