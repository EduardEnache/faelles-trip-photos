/**
 * generative ambient audio engine (PLAN.md §3.2). Not unit
 * tested (needs a real AudioContext); the deterministic maths it schedules
 * with live in theory.ts (tested) and moods.ts (data).
 *
 * One engine instance per open MemoryPlayer. Call `start()` synchronously
 * inside the user gesture that opens the player (iOS autoplay policy),
 * `onSlide(i)` on every slide change (drives chord changes), `pause()` /
 * `resumeFromPause()` with the player's own play state, and `stop()` on
 * close. Never throws: every method is a no-op before `start()` and after
 * `stop()`, and Web Audio failures (no AudioContext, suspended forever)
 * degrade to silence rather than breaking the player.
 */
import { moodOf, nextMood, type MoodId } from './moods';
import { chordNotes, hashString, midiToFreq, mulberry32, nextEventGap, pickScaleNote } from './theory';

const MUTE_KEY = 'faelles:audio-muted';

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode / storage blocked: keep going in-memory only */
  }
}

interface Voice {
  gain: GainNode;
  stop(at: number): void;
}

export interface AmbientEngine {
  /** Create/resume the AudioContext and begin the pad/bed/scheduler. Call inside a user gesture. */
  start(): void;
  /** 300ms ramp down then suspend. */
  pause(): void;
  /** Resume from a pause. */
  resumeFromPause(): void;
  /** 600ms fade then close. Safe to call multiple times. */
  stop(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  setMood(id: MoodId): void;
  cycleMood(): MoodId;
  readonly moodId: MoodId;
  /** Call on every slide-index change: aligns the next chord change to the visual clock. */
  onSlide(index: number): void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createAmbientEngine(seedKey: string, initialMood: MoodId): AmbientEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let comp: DynamicsCompressorNode | null = null;
  let toneFilter: BiquadFilterNode | null = null;
  let filterLfoGain: GainNode | null = null;
  let reverbSend: GainNode | null = null;
  let convolver: ConvolverNode | null = null;
  let bedNodes: { src: AudioBufferSourceNode; bandpass: BiquadFilterNode; gain: GainNode } | null = null;
  let padVoices: Voice[] = [];
  let schedulerId: number | null = null;
  let nextBellTime = 0;
  let started = false;
  let stopped = false;
  let muted = loadMuted();
  let mood = moodOf(initialMood);
  let rand = mulberry32(hashString(`${seedKey}:${mood.id}`));
  let chordDegree = 0;

  function buildImpulseResponse(c: AudioContext): AudioBuffer {
    const seconds = 2.8;
    const rate = c.sampleRate;
    const length = Math.max(1, Math.floor(seconds * rate));
    const buf = c.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const decay = Math.pow(1 - t, 3.1);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    return buf;
  }

  function buildNoiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
    const rate = c.sampleRate;
    const length = Math.max(1, Math.floor(seconds * rate));
    const buf = c.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  function ensureContext(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
    if (!Ctor) return null;
    const c = new Ctor();
    ctx = c;
    master = c.createGain();
    master.gain.value = 0;
    comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.02;
    comp.release.value = 0.3;
    toneFilter = c.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = mood.cutoff;
    toneFilter.Q.value = 0.5;

    // Slow filter LFO (breathing cutoff), modest depth.
    const filterLfo = c.createOscillator();
    filterLfo.frequency.value = 0.045 + rand() * 0.02;
    filterLfoGain = c.createGain();
    filterLfoGain.gain.value = mood.cutoff * 0.18;
    filterLfo.connect(filterLfoGain).connect(toneFilter.frequency);
    filterLfo.start();

    reverbSend = c.createGain();
    reverbSend.gain.value = 0.32;
    convolver = c.createConvolver();
    convolver.buffer = buildImpulseResponse(c);

    toneFilter.connect(master);
    toneFilter.connect(reverbSend).connect(convolver).connect(master);
    master.connect(comp).connect(c.destination);
    return c;
  }

  function rampMaster(target: number, ms: number) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, target)) * 0.7, t + ms / 1000);
  }

  function startPadChord() {
    if (!ctx || !toneFilter) return;
    const notesMidi = chordNotes(mood.root, mood.scale, chordDegree).slice(0, mood.padVoices);
    const t = ctx.currentTime;
    const attack = 2.0;
    const release = 3.0;
    const voices: Voice[] = notesMidi.map((midi, i) => {
      const osc = ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = (rand() - 0.5) * 10 + i * 2;
      const gain = ctx!.createGain();
      const peak = 0.09 / Math.max(1, notesMidi.length - 1) + 0.03;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + attack);
      osc.connect(gain).connect(toneFilter!);
      osc.start(t);
      return {
        gain,
        stop(at: number) {
          gain.gain.cancelScheduledValues(at);
          gain.gain.setValueAtTime(gain.gain.value, at);
          gain.gain.linearRampToValueAtTime(0, at + release);
          osc.stop(at + release + 0.05);
        },
      };
    });
    // Release the previous chord's voices over `release` seconds (legato swell).
    for (const v of padVoices) v.stop(t);
    padVoices = voices;
  }

  function playBell(atTime: number) {
    if (!ctx || !toneFilter) return;
    const midi = pickScaleNote(mood.root, mood.scale, rand, 2);
    const freq = midiToFreq(midi + 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, atTime);
    gain.gain.linearRampToValueAtTime(0.05, atTime + 0.012);
    gain.gain.setTargetAtTime(0, atTime + 0.02, 0.7);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const partial = ctx.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = freq * 2.76;
    const partialGain = ctx.createGain();
    partialGain.gain.value = 0.28;

    osc.connect(gain);
    partial.connect(partialGain).connect(gain);
    gain.connect(toneFilter);

    osc.start(atTime);
    partial.start(atTime);
    osc.stop(atTime + 2.6);
    partial.stop(atTime + 2.6);
  }

  function startBed() {
    if (!ctx || !toneFilter || !mood.bed) return;
    const src = ctx.createBufferSource();
    src.buffer = buildNoiseBuffer(ctx, 3.5);
    src.loop = true;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = mood.bed === 'sea' ? 1100 : 320;
    bandpass.Q.value = mood.bed === 'sea' ? 0.7 : 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0.02;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = mood.bed === 'sea' ? 0.09 : 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.014;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(bandpass).connect(gain).connect(toneFilter);
    src.start();
    lfo.start();
    bedNodes = { src, bandpass, gain };
  }

  function tick() {
    if (!ctx) return;
    const horizon = ctx.currentTime + 1.0;
    if (nextBellTime === 0) nextBellTime = ctx.currentTime + nextEventGap(rand);
    while (nextBellTime < horizon) {
      if (rand() < mood.bellDensity + 0.5) playBell(nextBellTime);
      nextBellTime += nextEventGap(rand) / Math.max(0.15, mood.bellDensity * 2);
    }
  }

  function startScheduler() {
    if (schedulerId != null) return;
    schedulerId = globalThis.setInterval(tick, 25) as unknown as number;
  }

  function stopScheduler() {
    if (schedulerId != null) {
      clearInterval(schedulerId);
      schedulerId = null;
    }
  }

  function teardownVoices(atTime: number) {
    for (const v of padVoices) v.stop(atTime);
    padVoices = [];
    if (bedNodes) {
      try {
        bedNodes.src.stop(atTime + 0.05);
      } catch {
        /* already stopped */
      }
      bedNodes = null;
    }
  }

  return {
    start() {
      if (stopped) return;
      const c = ensureContext();
      if (!c) return;
      void c.resume();
      if (!started) {
        startPadChord();
        startBed();
        startScheduler();
        started = true;
      }
      rampMaster(muted ? 0 : 1, 900);
    },
    pause() {
      if (!ctx) return;
      rampMaster(0, 300);
      const c = ctx;
      const t0 = now();
      setTimeout(() => {
        if (ctx === c && now() - t0 >= 250) void c.suspend();
      }, 320);
    },
    resumeFromPause() {
      if (!ctx) return;
      void ctx.resume();
      rampMaster(muted ? 0 : 1, 300);
    },
    stop() {
      if (stopped || !ctx) {
        stopped = true;
        return;
      }
      stopped = true;
      rampMaster(0, 600);
      stopScheduler();
      const c = ctx;
      const teardownAt = c.currentTime;
      teardownVoices(teardownAt + 0.6);
      setTimeout(() => {
        void c.close();
      }, 650);
      ctx = null;
    },
    setMuted(m: boolean) {
      muted = m;
      saveMuted(m);
      if (started) rampMaster(m ? 0 : 1, 250);
    },
    isMuted: () => muted,
    setMood(id: MoodId) {
      if (id === mood.id) return;
      mood = moodOf(id);
      rand = mulberry32(hashString(`${seedKey}:${mood.id}`));
      chordDegree = 0;
      nextBellTime = 0;
      if (toneFilter && ctx) {
        toneFilter.frequency.cancelScheduledValues(ctx.currentTime);
        toneFilter.frequency.setTargetAtTime(mood.cutoff, ctx.currentTime, 0.6);
      }
      if (filterLfoGain) filterLfoGain.gain.value = mood.cutoff * 0.18;
      if (bedNodes && ctx) {
        const t = ctx.currentTime;
        teardownVoices(t);
        startBed();
      }
      if (started) startPadChord();
    },
    cycleMood() {
      const id = nextMood(mood.id);
      this.setMood(id);
      return id;
    },
    get moodId() {
      return mood.id;
    },
    onSlide(_index: number) {
      chordDegree = (chordDegree + 1) % mood.scale.length;
      if (started) startPadChord();
    },
  };
}
