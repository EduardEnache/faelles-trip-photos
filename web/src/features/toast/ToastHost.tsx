/**
 * single dark toast for long jobs (upload results elsewhere,
 * save/zip/share progress). One at a time, per state/toast.ts.
 */
import { useToast } from '@/state/toast';
import { useSelection } from '@/features/select/selectionStore';
import s from './ToastHost.module.css';

export function ToastHost() {
  const t = useToast((st) => st.current);
  const selectMode = useSelection((st) => st.active);
  if (!t) return null;

  const pct = t.progress != null ? Math.round(Math.min(1, Math.max(0, t.progress)) * 100) : null;

  return (
    <div
      className={[s.toast, selectMode && s.select, t.error && s.error].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
    >
      <div className={s.top}>
        <div className={s.title}>{t.title}</div>
        {pct != null && <div className={s.pct}>{t.done ? '100%' : `${pct}%`}</div>}
      </div>
      {pct != null && (
        <div className={s.bar}>
          <div className={[s.barFill, t.done && s.done].filter(Boolean).join(' ')} style={{ width: `${pct}%` }} />
        </div>
      )}
      {t.sub && <div className={s.sub}>{t.sub}</div>}
      {t.action && (
        <button type="button" className={s.action} onClick={t.action.onAction}>
          {t.action.label}
        </button>
      )}
    </div>
  );
}
