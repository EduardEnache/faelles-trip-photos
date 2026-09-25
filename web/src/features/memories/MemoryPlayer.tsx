/**
 * full-bleed memory player (PLAN.md §3.1). One rAF clock drives
 * everything: slide index, segment bar widths and Ken Burns progress are all
 * derived from a single `t` (ms) and pushed to the DOM via refs/CSS vars, so
 * nothing re-renders 60 times a second. React state only changes on slide
 * boundaries, play/pause, mute and mood.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ItemDTO } from '@shared/api';
import { cityOf, localTime, sectionTitle, tripDay } from '@shared/trip';
import { mediaUrl } from '@/lib/api';
import { CloseIcon, DownloadIcon, MusicIcon, SoundOffIcon, SoundOnIcon } from '@/lib/icons';
import { useReducedMotion, useWide } from '@/lib/useMedia';
import { saveItems } from '@/lib/save';
import type { MemoryPlayerProps } from '@/slots';
import { Button, IconButton } from '@/ui';
import { claimPreparedEngine, discardUnclaimedEngine } from './audio/handoff';
import { createAmbientEngine, type AmbientEngine } from './audio/engine';
import { moodOf, type MoodId } from './audio/moods';
import { slideDurationMs } from './pickMemories';
import { useMemory } from './useMemories';
import s from './MemoryPlayer.module.css';

const ALBUM_RANGE = '25–28 SEPTEMBER 2026';
const FRONT_FADE_MS_NORMAL = 600;
const FRONT_FADE_MS_REDUCED = 300;

function indexAtTime(t: number, cumStart: readonly number[]): number {
  for (let i = cumStart.length - 1; i >= 0; i--) {
    if (t >= cumStart[i]!) return i;
  }
  return 0;
}

function slideMetaLine(it: ItemDTO): string {
  const day = tripDay(it.day);
  const city = it.lat != null && it.lon != null ? cityOf(it.lat, it.lon) : null;
  const time = localTime(Date.parse(it.takenAt));
  const dayLabel = day ? `DAY ${day.n}` : sectionTitle(it.day).toUpperCase();
  return [dayLabel, city ? city.toUpperCase() : null, time].filter(Boolean).join(' · ');
}

export default function MemoryPlayer({ memoryId, onClose }: MemoryPlayerProps) {
  const memory = useMemory(memoryId);
  const reducedMotion = useReducedMotion();
  const wide = useWide();

  const slides = memory?.slides ?? [];
  const durations = useMemo(() => slides.map(slideDurationMs), [slides]);
  const cumStart = useMemo(() => {
    let acc = 0;
    return durations.map((d) => {
      const start = acc;
      acc += d;
      return start;
    });
  }, [durations]);
  const totalLen = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations]);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [moodId, setMoodIdState] = useState<MoodId>(memory?.mood ?? 'kystlys');

  const tRef = useRef(0);
  const indexRef = useRef(0);
  const playingRef = useRef(true);
  const reducedMotionRef = useRef(reducedMotion);
  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const frontLayerRef = useRef<HTMLDivElement | null>(null);
  const loadedIds = useRef<Set<string>>(new Set());
  const requestedIds = useRef<Set<string>>(new Set());
  const engineRef = useRef<AmbientEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  // Reset the clock whenever a different memory opens.
  useEffect(() => {
    tRef.current = 0;
    indexRef.current = 0;
    setIndex(0);
    setEnded(false);
    playingRef.current = true;
    setPlaying(true);
  }, [memoryId]);

  // Engine lifecycle: claim the one prepared in the opening tap, or make a best-effort one.
  useEffect(() => {
    if (!memory) return undefined;
    let engine = claimPreparedEngine(memory.id);
    discardUnclaimedEngine();
    if (!engine) {
      engine = createAmbientEngine(memory.id, memory.mood);
      engine.start();
    }
    engineRef.current = engine;
    setMutedState(engine.isMuted());
    setMoodIdState(engine.moodId);
    return () => {
      engine!.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory?.id]);

  // The one clock. Advances t while playing; everything else is derived from it.
  useEffect(() => {
    if (!memory || slides.length === 0) return undefined;
    function frame(ts: number) {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      if (playingRef.current && last != null) {
        let dt = ts - last;
        const curIdx = indexRef.current;
        const curEnd = (cumStart[curIdx] ?? 0) + (durations[curIdx] ?? 0);
        if (tRef.current + dt >= curEnd && curIdx < slides.length - 1) {
          const nextItem = slides[curIdx + 1]!;
          if (!loadedIds.current.has(nextItem.id)) {
            dt = Math.max(0, curEnd - tRef.current - 1);
          }
        }
        tRef.current = Math.min(totalLen, tRef.current + dt);
      }

      for (let i = 0; i < durations.length; i++) {
        const el = barRefs.current[i];
        if (!el) continue;
        const dur = durations[i] ?? 0;
        const p = dur > 0 ? Math.min(1, Math.max(0, (tRef.current - (cumStart[i] ?? 0)) / dur)) : 0;
        el.style.width = `${p * 100}%`;
      }

      const newIdx = indexAtTime(tRef.current, cumStart);
      if (newIdx !== indexRef.current) {
        indexRef.current = newIdx;
        setIndex(newIdx);
        engineRef.current?.onSlide(newIdx);
      }

      const front = frontLayerRef.current;
      if (front) {
        const slideStart = cumStart[indexRef.current] ?? 0;
        const dur = durations[indexRef.current] || 1;
        const p = Math.min(1, Math.max(0, (tRef.current - slideStart) / dur));
        front.style.setProperty('--p', String(p));
        const fadeMs = reducedMotionRef.current ? FRONT_FADE_MS_REDUCED : FRONT_FADE_MS_NORMAL;
        const fadeP = Math.min(1, (tRef.current - slideStart) / fadeMs);
        front.style.setProperty('--fade', String(fadeP));
      }

      if (tRef.current >= totalLen && playingRef.current) {
        playingRef.current = false;
        setPlaying(false);
        setEnded(true);
        engineRef.current?.pause();
      }

      rafRef.current = requestAnimationFrame(frame);
    }
    lastTsRef.current = null;
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory?.id, slides.length]);

  // Preload the current slide's neighbours; the clock holds at a boundary until they're loaded.
  useEffect(() => {
    for (const it of slides.slice(index, index + 3)) {
      if (requestedIds.current.has(it.id)) continue;
      requestedIds.current.add(it.id);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => loadedIds.current.add(it.id);
      img.onerror = () => loadedIds.current.add(it.id);
      img.src = mediaUrl(it, 'display');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory?.id, index]);

  // Sync the current slide's video element with play/pause.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true; // belt-and-braces: some browsers only honour the DOM property, not the JSX attribute
    if (playing && !ended) {
      v.currentTime = 0;
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [index, playing, ended]);

  // Pause on a hidden tab.
  useEffect(() => {
    function onVis() {
      if (document.hidden && playingRef.current) {
        playingRef.current = false;
        setPlaying(false);
        engineRef.current?.pause();
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  function unlockAudio() {
    engineRef.current?.start();
  }

  function togglePlay() {
    if (ended) {
      replay();
      return;
    }
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    if (next) engineRef.current?.resumeFromPause();
    else engineRef.current?.pause();
    unlockAudio();
  }

  function skip(delta: number) {
    if (slides.length === 0) return;
    const newIdx = Math.min(slides.length - 1, Math.max(0, indexRef.current + delta));
    tRef.current = cumStart[newIdx] ?? 0;
    indexRef.current = newIdx;
    setIndex(newIdx);
    setEnded(false);
    if (!playingRef.current) {
      playingRef.current = true;
      setPlaying(true);
    }
    engineRef.current?.onSlide(newIdx);
    unlockAudio();
    engineRef.current?.resumeFromPause();
  }

  function replay() {
    tRef.current = 0;
    indexRef.current = 0;
    setIndex(0);
    setEnded(false);
    playingRef.current = true;
    setPlaying(true);
    engineRef.current?.onSlide(0);
    unlockAudio();
    engineRef.current?.resumeFromPause();
  }

  function toggleMute() {
    const next = !muted;
    setMutedState(next);
    engineRef.current?.setMuted(next);
    unlockAudio();
  }

  function changeMood() {
    const id = engineRef.current?.cycleMood();
    if (id) setMoodIdState(id);
    unlockAudio();
  }

  async function handleSave() {
    if (!memory) return;
    await saveItems(memory.slides, { wide });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === 'ArrowRight') {
        skip(1);
        return;
      }
      if (e.key === 'ArrowLeft') {
        skip(-1);
        return;
      }
      if (e.key === 'm' || e.key === 'M') toggleMute();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, ended, playing, muted, index]);

  if (!memory || slides.length === 0) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Memory" className={s.unavailable}>
        <p>This memory isn&rsquo;t available.</p>
        <Button variant="ghostDark" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const cur = slides[index]!;
  const prev = index > 0 ? slides[index - 1]! : null;
  const kbClass = reducedMotion ? s.noZoom : index % 2 === 0 ? s.kb0 : s.kb1;
  const mood = moodOf(moodId);
  const endedTitle = memory.kind === 'day' ? 'Tak for i dag.' : 'Tak for turen.';

  function onTap(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    if (frac < 0.3) skip(-1);
    else if (frac > 0.7) skip(1);
    else togglePlay();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Memory: ${memory.title}`} className={s.overlay}>
      <div className={s.slides}>
        {prev ? (
          <div className={s.slideLayer} key={`back-${prev.id}`}>
            <img src={mediaUrl(prev, 'display')} alt="" decoding="async" style={{ background: prev.tone ?? 'var(--nat)' }} />
          </div>
        ) : null}
        <div
          className={`${s.slideLayer} ${s.front} ${kbClass}`}
          key={`front-${cur.id}`}
          ref={frontLayerRef}
          style={{ '--p': 0, '--fade': 0 } as CSSProperties}
        >
          <img src={mediaUrl(cur, 'display')} alt="" decoding="async" style={{ background: cur.tone ?? 'var(--nat)' }} />
          {cur.kind === 'video' ? (
            <video key={`video-${cur.id}`} ref={videoRef} muted playsInline preload="auto" poster={mediaUrl(cur, 'display')} src={mediaUrl(cur, 'preview')} />
          ) : null}
        </div>
      </div>
      <div className={s.scrim} aria-hidden="true" />

      <button type="button" className={s.tapGrid} aria-label="Tap the sides to skip, the centre to play or pause" onClick={onTap} />

      <div className={s.top}>
        <div className={s.segments}>
          {slides.map((it, i) => (
            <div className={s.seg} key={it.id}>
              <div className={s.segFill} ref={(el) => { barRefs.current[i] = el; }} />
            </div>
          ))}
        </div>
        <div className={s.topRow}>
          <div className={s.meta}>
            <div className={s.metaTitle}>{memory.title}</div>
            <div className={s.metaLine}>{slideMetaLine(cur)}</div>
          </div>
          <div className={s.topActions}>
            <IconButton label={muted ? 'Unmute' : 'Mute'} tone="dark" onClick={toggleMute}>
              {muted ? <SoundOffIcon /> : <SoundOnIcon />}
            </IconButton>
            <IconButton label="Close" tone="dark" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </div>
        </div>
      </div>

      {index === 0 && !ended ? (
        <div className={s.titleCard}>
          <div className={s.titleEyebrow}>{ALBUM_RANGE}</div>
          <div className={s.titleMain}>{memory.title}</div>
        </div>
      ) : null}

      {ended ? (
        <div className={s.ended}>
          <div className={s.endedTitle}>{endedTitle}</div>
          <div className={s.endedActions}>
            <Button variant="ghostDark" onClick={replay}>
              Replay
            </Button>
            <Button variant="light" icon={<DownloadIcon />} onClick={handleSave}>
              Save these {slides.length}
            </Button>
          </div>
        </div>
      ) : null}

      <div className={s.bottom}>
        <Button variant="ghostDark" className={s.moodBtn} icon={<MusicIcon />} meta="CHANGE" onClick={changeMood}>
          {mood.label}
        </Button>
        <div className={s.bottomActions}>
          <Button variant="ghostDark" onClick={togglePlay}>
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Button variant="light" icon={<DownloadIcon />} onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
