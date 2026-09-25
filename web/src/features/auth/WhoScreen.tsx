/**
 * screen 02: "Who's this?" Shown once per device on first login,
 * and again ("Change") from the top bar without leaving the app.
 */
import { useEffect } from 'react';
import { PEOPLE, type PersonId } from '@shared/trip';
import { CloseIcon } from '@/lib/icons';
import { IconButton } from '@/ui';
import { useSession, useMe } from '@/state/session';
import s from './WhoScreen.module.css';

export function WhoScreen({ mode }: { mode: 'first' | 'change' }) {
  const setPerson = useSession((st) => st.setPerson);
  const cancel = useSession((st) => st.cancelChoosingPerson);
  const me = useMe();

  useEffect(() => {
    if (mode !== 'change') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, cancel]);

  return (
    <div className={s.screen}>
      {mode === 'change' && (
        <IconButton label="Cancel" className={s.close} onClick={cancel}>
          <CloseIcon />
        </IconButton>
      )}
      <div className={s.intro}>
        <div className={s.tag}>ONE LAST THING</div>
        <div className={s.title}>Who&rsquo;s this?</div>
        <div className={s.sub}>Your name goes on everything you upload and every heart you give.</div>
      </div>
      <div className={s.grid}>
        {PEOPLE.map((p) => (
          <button
            key={p.id}
            type="button"
            className={[s.card, p.id === me && s.me].filter(Boolean).join(' ')}
            onClick={() => void setPerson(p.id as PersonId)}
          >
            <span className={s.avatar} style={{ background: p.color }} aria-hidden="true">
              {p.name[0]}
            </span>
            <span className={s.name}>{p.name}</span>
          </button>
        ))}
      </div>
      <div className={s.foot}>Remembered on this device. Change it anytime.</div>
    </div>
  );
}
