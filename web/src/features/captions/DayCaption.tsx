/**
 * one-line day caption (PLAN.md §5). Inline edit, optimistic,
 * kept live by the library store's SSE handling. Nothing for before/after
 * sections (there's no day to attach a line to).
 */
import { useEffect, useRef, useState } from 'react';
import { LIMITS, type CaptionDTO } from '@shared/api';
import { tripDay } from '@shared/trip';
import { api, ApiRequestError } from '@/lib/api';
import { useMe } from '@/state/session';
import { useLibrary } from '@/state/library';
import { toast } from '@/state/toast';
import type { DayCaptionProps } from '@/slots';
import { Avatar } from '@/ui';
import s from './DayCaption.module.css';

export function DayCaption({ day, editable }: DayCaptionProps) {
  const isTripDay = tripDay(day) != null;
  const caption = useLibrary((st) => st.captions[day] ?? null);
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!isTripDay) return null;

  function startEdit() {
    if (!editable || !me) return;
    setDraft(caption?.text ?? '');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function save() {
    if (savingRef.current) return;
    const text = draft.trim().slice(0, LIMITS.captionMaxChars);
    setEditing(false);
    if (text === (caption?.text ?? '')) return;
    savingRef.current = true;
    const prev = caption;
    const optimistic: CaptionDTO | null = text && me ? { day, text, by: me, updatedAt: new Date().toISOString() } : null;
    useLibrary.getState().setCaption(day, optimistic);
    try {
      const res = await api.setCaption(day, text);
      useLibrary.getState().setCaption(day, 'text' in res && res.text ? (res as CaptionDTO) : null);
    } catch (e) {
      useLibrary.getState().setCaption(day, prev);
      toast.show({
        id: `caption-${day}`,
        title: "Couldn't save that line",
        sub: e instanceof ApiRequestError ? e.message : 'Check your connection and try again.',
        error: true,
      });
    } finally {
      savingRef.current = false;
    }
  }

  if (editing) {
    return (
      <span className={s.editRow}>
        <input
          ref={inputRef}
          className={s.input}
          type="text"
          name="dayCaption"
          autoComplete="off"
          value={draft}
          maxLength={LIMITS.captionMaxChars}
          placeholder="Add a line about this day…"
          aria-label="Day caption"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
        />
      </span>
    );
  }

  if (!caption) {
    if (!editable || !me) return null;
    return (
      <button type="button" className={s.addBtn} onClick={startEdit}>
        Add a line about this day
      </button>
    );
  }

  if (!editable) {
    return (
      <span className={s.readOnly}>
        <Avatar person={caption.by} size={16} decorative={false} />
        <span className={s.text}>{caption.text}</span>
      </span>
    );
  }

  return (
    <button type="button" className={s.viewBtn} onClick={startEdit} aria-label={`Day caption, by ${caption.by}: ${caption.text}. Tap to edit.`}>
      <Avatar person={caption.by} size={16} />
      <span className={s.text}>{caption.text}</span>
    </button>
  );
}
