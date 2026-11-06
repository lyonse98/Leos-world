// Ambient sound beds for route mode (ambience scope, Nov 5, 2026).
//
// A low, place-aware sound bed under a route tour — the produced
// podcast's room tone. Pre-rendered ~90 s loops from the tts-audio
// bucket (see ~/workspace/leos-world/ambience-bank/: the first bank
// was our own offline procedural renders; v1.2 re-sourced four of
// the five beds from CC0 field recordings).
//
// THE ARCHITECTURAL RULE (the scope's non-negotiable): the bed
// never rejoins the opening choreography. It lives OUTSIDE the
// Player's queue, owns its own elements, starts only after the
// unlock latch + the first PROVEN sound (the runner's first
// onSoundStart), and can never gate, delay, or break a story. Any
// bed fault self-silences for the rest of the tour and files one
// pipeline_diag; narration is never touched.
//
// History: a synthesized WebAudio pad lived on the avatar line and
// was removed Oct 27, 2026 — imperceptible under real drive
// conditions and one async actor too many in the fragile start
// sequence. This rebuild answers both recorded causes: real
// rendered loops at levels a car can register, and a fully
// decoupled layer that the start sequence does not know exists.
//
// v1.1 (Nov 5, 2026, Erik's ruling): a fourth bed, canyon wind,
// for the inland hill country — beds expand built-in naturally
// as place-tied signatures earn their place, no per-context
// settings. A fifth candidate, quiet-street for residential
// contexts, was rendered the same evening but held unwired while
// Erik settled its recipe direction (distant life wanted real
// recordings, not pure procedural).
//
// v1.2 (Nov 6, 2026, Erik's ruling): the recorded hunt shipped.
// Ocean, road, city-air, and quiet-street are now CC0 field
// recordings (ambience/<kind>-rec-v1.m4a — sources, authors, and
// license receipts in the bank's README and recorded/CANDIDATES.md;
// Erik auditioned and approved the recommended winners).
// Quiet-street is WIRED: residential contexts resolve it (see the
// resolver). Canyon wind stays procedural — its recorded
// candidate ran ~6.8 dB under bank level with bird phrases in
// it. The procedural originals remain in the bucket as
// unreferenced fallbacks (the accepted orphan pattern).

import { resolveFillerRegion } from '../data/fillerRegions';
import { FREEWAY_MPS } from './tour';
import { systemClock, type Clock } from './player';

export type AmbientBedKind = 'ocean' | 'road' | 'city' | 'street' | 'canyon';

/** Full / ducked bed gain (the removed service's proven constants: 0.012 ≈ −19 dB under 0.11). */
export const AMBIENT_FULL_LEVEL = 0.11;
export const AMBIENT_DUCK_LEVEL = 0.012;
/** A new context target must persist this long before adoption (anti-flap, scope §4). */
export const AMBIENT_HYSTERESIS_MS = 15_000;
/** Once adoption is due, a story boundary inside this grace adopts immediately; else the crossfade fires. */
export const AMBIENT_BOUNDARY_GRACE_MS = 2_500;
/** Equal-power crossfade duration for mid-story adoptions (scope: 4–6 s). */
export const AMBIENT_XFADE_MS = 5_000;
/** Fade-in from the first proven sound (scope: ~3 s). */
export const AMBIENT_FADE_IN_MS = 3_000;

const DUCK_MS = 500; // gain fall to ducked at a sound start (~0.5 s)
const RELEASE_MS = 2_500; // gain rise back after a settle (~2.5 s; the 700 ms breath barely lifts it)
const PAUSE_FADE_MS = 1_000; // bed out on pause (~1 s)
const KILL_FADE_MS = 500; // kill-switch fade
const TICK_MS = 50;

/** Persisted kill-switch setting (the old service's key). Default ON with no stored value. */
export const AMBIENT_ON_KEY = 'leo_ambient_on';

export function loadAmbientEnabled(): boolean {
  try {
    return localStorage.getItem(AMBIENT_ON_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveAmbientEnabled(on: boolean): void {
  try {
    localStorage.setItem(AMBIENT_ON_KEY, on ? '1' : '0');
  } catch {
    /* private mode etc. — the in-tour toggle still works */
  }
}

/**
 * Scope §4's curated urban-area names for the city-air context
 * (downtown core, the close-in neighborhoods, the valley retail
 * core, Barrio Logan, the airport). Matched as substrings against
 * area / destination / story place names — the route runner never
 * reverse-geocodes mid-tour, so in route v1 the signal is the
 * episode's own geography (destination circle / current geo story).
 */
export const URBAN_AREA_NAMES: readonly string[] = [
  'downtown',
  'gaslamp',
  'east village',
  'cortez hill',
  'marina district',
  'little italy',
  'seaport village',
  'harborview',
  'midtown',
  'hillcrest',
  'mission hills',
  'north park',
  'south park',
  'university heights',
  'normal heights',
  'bankers hill',
  'balboa park',
  'mission valley',
  'fashion valley',
  'linda vista',
  'barrio logan',
  'airport',
];

export function isUrbanAreaName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return URBAN_AREA_NAMES.some(u => n.includes(u));
}

export interface AmbientContextInput {
  lat: number;
  lng: number;
  /** Current speed (GPS speed when available; the runner falls back to route-progress-derived speed). */
  speedMps: number;
  /** On foot — passenger-declared tour at walking pace (route v1's walking derivation). Always silent. */
  walking: boolean;
  /** Urban-context signal for city-air, computed by the runner from the curated names. */
  urban: boolean;
}

/**
 * The bed follows where the driver IS, from signals the app
 * already has (scope §4 — no new API calls, no topic triggers):
 * road at freeway speed beats everything; the coast band gives
 * ocean; the urban core at surface speed gives city-air; the
 * inland hill country (the region map's 'backcountry' and 'east'
 * — the crest, the desert edge, and the East County canyon-and-
 * granite belt the filler corpus itself tags as one geography)
 * gives canyon wind (v1.1, Erik's Nov 5 ruling: beds expand
 * built-in naturally, no per-context settings). The residential
 * remainder — the 'north' and 'south' suburban polygons, plus
 * 'central' when the urban signal is absent (the residential
 * core: University City, Clairemont, Mira Mesa, Tierrasanta) —
 * gives quiet-street (v1.2: a recorded residential bed, wired at
 * Erik's approval; it is the lowest-precedence place bed, and
 * the urban signal still promotes central to city-air first).
 * Anything else — outside the county, walking — is quiet.
 */
export function resolveAmbientBed(input: AmbientContextInput): AmbientBedKind | null {
  if (input.walking) return null;
  if (input.speedMps >= FREEWAY_MPS) return 'road';
  const region = resolveFillerRegion(input.lat, input.lng);
  if (region === 'coast') return 'ocean';
  if (region === 'backcountry' || region === 'east') return 'canyon';
  if (region === 'central' && input.urban) return 'city';
  if (region === 'central' || region === 'north' || region === 'south') return 'street';
  return null;
}

// ------------------------------------------------------------ audio layer

/** One loop channel, abstracted exactly like the Player's AudioPort. */
export interface BedChannel {
  load(src: string): void;
  play(): Promise<void>;
  pause(): void;
  setLevel(level: number): void;
  dispose(): void;
  setOnError(cb: (() => void) | null): void;
}

export interface BedAudioFactory {
  /** Which mixing path is live: WebAudio gain routing, or the element.volume ramp fallback. */
  readonly mode: 'webaudio' | 'volume';
  /**
   * Decide the mixing path for a loop URL: WebAudio routing needs
   * CORS-clean media (MediaElementSource taints silently without
   * it), so the bucket answer is probed once; any failure → the
   * volume fallback, which is audibly equivalent at these ramp
   * constants.
   */
  decide(url: string): Promise<'webaudio' | 'volume'>;
  /** Resume the shared context after a user gesture (autoplay policy). */
  resume(): void;
  createChannel(): BedChannel;
}

class BrowserBedChannel implements BedChannel {
  private el: HTMLAudioElement;
  private gain: GainNode | null = null;

  constructor(ctx: AudioContext | null) {
    this.el = new Audio();
    this.el.loop = true;
    this.el.preload = 'auto';
    if (ctx) {
      // CORS-clean routing (the decide() probe proved the bucket
      // answers with allow-origin); without it the source would
      // output silence through WebAudio.
      this.el.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(this.el);
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      src.connect(this.gain);
      this.gain.connect(ctx.destination);
    } else {
      this.el.volume = 0;
    }
  }

  load(src: string): void {
    this.el.src = src;
  }
  play(): Promise<void> {
    return this.el.play();
  }
  pause(): void {
    this.el.pause();
  }
  setLevel(level: number): void {
    const v = Math.max(0, Math.min(1, level));
    if (this.gain) this.gain.gain.value = v;
    else this.el.volume = v;
  }
  dispose(): void {
    try {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    } catch {
      /* teardown is best-effort */
    }
  }
  setOnError(cb: (() => void) | null): void {
    this.el.onerror = cb;
  }
}

class BrowserBedAudioFactory implements BedAudioFactory {
  private ctx: AudioContext | null = null;
  private decision: 'webaudio' | 'volume' | null = null;

  get mode(): 'webaudio' | 'volume' {
    return this.decision ?? 'volume';
  }

  async decide(url: string): Promise<'webaudio' | 'volume'> {
    if (this.decision) return this.decision;
    let ok = false;
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const probe = await fetch(url, { mode: 'cors', headers: { Range: 'bytes=0-1023' } });
        ok = probe.ok || probe.status === 206;
        if (ok) this.ctx = new AC();
      }
    } catch {
      ok = false;
    }
    this.decision = ok && this.ctx ? 'webaudio' : 'volume';
    return this.decision;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  createChannel(): BedChannel {
    return new BrowserBedChannel(this.decision === 'webaudio' ? this.ctx : null);
  }
}

// ------------------------------------------------------------ controller

export interface AmbientBedDeps {
  /** Loop URLs by kind (App wires each kind's shipped bucketUrl). */
  assets: Record<AmbientBedKind, string>;
  /** The persisted kill-switch state at tour start. */
  enabled: boolean;
  /** Injectable for sims; the browser factory is the default, created lazily. */
  factory?: BedAudioFactory;
  clock?: Clock;
  /** File one diagnostic (the runner wires pipeline_diag). Faults only — never chatty. */
  onDiag?: (reason: string) => void;
}

interface LiveChannel {
  ch: BedChannel;
  kind: AmbientBedKind;
  /** Crossfade weight 0..1 (parametric, equal-power during a swap). */
  weight: number;
  fade: { from: number; to: number; start: number; dur: number } | null;
  playing: boolean;
  playWanted: boolean;
}

/**
 * The bed controller: context resolution + hysteresis + adoption,
 * the duck/release ramp engine, pause/stop follows, and fault
 * self-silence. Driven entirely by runner taps (sound start /
 * settle / position / pause / gesture / teardown) on a 50 ms tick;
 * it never calls back into the Player.
 */
export class AmbientBedController {
  private deps: AmbientBedDeps;
  private clock: Clock;
  private factory: BedAudioFactory | null;
  private tickHandle: unknown = null;

  private enabledFlag: boolean;
  private gateOpen = false;
  private faulted = false;
  private stopped = false;
  private deciding = false;

  private targetKind: AmbientBedKind | null = null;
  private pendingKind: AmbientBedKind | null | undefined = undefined; // undefined = nothing pending
  private pendingSince = 0;
  private adoptionDueAt: number | null = null;

  private channels: LiveChannel[] = [];
  private sounding = false;
  private pausedFlag = false;
  /** Narration-mix level (duck engine state). */
  private level = 0;
  /** Presence multipliers: pause ~1 s, kill ~0.5 s, stop = stop()'s fade. */
  private pauseMul = 1;
  private killMul: number;
  private stopMul = 1;
  private stopDur = 0;
  private stopStartedAt = 0;

  constructor(deps: AmbientBedDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
    this.factory = deps.factory ?? null;
    this.enabledFlag = deps.enabled;
    this.killMul = deps.enabled ? 1 : 0;
    this.tickHandle = this.clock.setInterval(() => this.tick(), TICK_MS);
  }

  get enabled(): boolean {
    return this.enabledFlag && !this.faulted;
  }

  get kind(): AmbientBedKind | null {
    const live = this.channels.find(c => c.weight > 0) ?? this.channels[0];
    return live ? live.kind : null;
  }

  get isFaulted(): boolean {
    return this.faulted;
  }

  /** The mixing path actually in use ('volume' until decide() runs). */
  get mixMode(): 'webaudio' | 'volume' {
    return this.factory ? this.factory.mode : 'volume';
  }

  // ---------------------------------------------------------- runner taps

  /** Latest position/context evaluation (GPS-rate). */
  updateContext(ctx: AmbientContextInput): void {
    const resolved = resolveAmbientBed(ctx);
    if (resolved === this.targetKind) return;
    this.targetKind = resolved;
    if (!this.gateOpen || this.faulted || this.stopped) return;
    if (resolved === this.kind) {
      this.pendingKind = undefined;
      this.adoptionDueAt = null;
      return;
    }
    this.pendingKind = resolved;
    this.pendingSince = this.clock.now();
    this.adoptionDueAt = null;
  }

  /** The start gate: first PROVEN sound (latch + a story actually sounding). Nothing plays before this. */
  noteFirstSound(): void {
    if (this.gateOpen) return;
    this.gateOpen = true;
    if (!this.enabledFlag || this.faulted || this.stopped) return;
    if (this.targetKind) {
      this.pendingKind = undefined;
      void this.startKind(this.targetKind, AMBIENT_FADE_IN_MS);
    }
  }

  /** Narration sounding or silent (the runner's honest view-model signal). */
  noteSounding(sounding: boolean): void {
    this.sounding = sounding;
  }

  /** A story boundary: an adoption that is due lands here instead of mid-story when it can. */
  noteStoryBoundary(): void {
    if (this.adoptionDueAt !== null) this.adopt();
  }

  /** User/guard pause follow: bed out in ~1 s; back on resume. */
  notePaused(paused: boolean): void {
    this.pausedFlag = paused;
  }

  /** A user gesture landed (transport taps): retry a gesture-blocked play, resume the context. */
  noteGesture(): void {
    this.factory?.resume();
    for (const live of this.channels) {
      if (live.playWanted && !live.playing) this.tryPlay(live);
    }
  }

  /** The transport-pill kill switch. Persisting the choice is the caller's job. */
  setEnabled(on: boolean): void {
    if (this.faulted || this.stopped) {
      this.enabledFlag = on;
      return;
    }
    this.enabledFlag = on;
    if (on) {
      if (this.gateOpen && this.channels.length === 0 && this.targetKind) {
        this.pendingKind = undefined;
        void this.startKind(this.targetKind, AMBIENT_FADE_IN_MS);
      } else {
        for (const live of this.channels) {
          live.playWanted = true;
          if (!this.pausedFlag) this.tryPlay(live);
        }
      }
    }
  }

  /** Tour over: fade out across fadeMs, then full stop. Idempotent. */
  stop(fadeMs: number): void {
    if (this.stopped) return;
    if (fadeMs <= 0) {
      this.teardown();
      return;
    }
    if (this.stopDur > 0) return; // already stopping
    this.stopDur = fadeMs;
    this.stopStartedAt = this.clock.now();
  }

  dispose(): void {
    this.teardown();
  }

  // ---------------------------------------------------------- internals

  private async startKind(kind: AmbientBedKind, fadeMs: number): Promise<void> {
    if (this.faulted || this.stopped || !this.gateOpen) return;
    try {
      if (!this.factory) this.factory = new BrowserBedAudioFactory();
      if (!this.deciding && this.factory.mode !== 'webaudio') {
        this.deciding = true;
        try {
          await this.factory.decide(this.deps.assets[kind]);
        } catch {
          /* decide() never throws by construction; volume is the standing fallback */
        }
        this.deciding = false;
        if (this.faulted || this.stopped || !this.gateOpen) return;
      }
      const ch = this.factory.createChannel();
      const live: LiveChannel = {
        ch,
        kind,
        weight: 0,
        fade: { from: 0, to: 1, start: this.clock.now(), dur: fadeMs },
        playing: false,
        playWanted: true,
      };
      ch.setOnError(() => this.fault(`element-error:${kind}`));
      ch.load(this.deps.assets[kind]);
      this.channels.push(live);
      if (!this.pausedFlag && this.enabledFlag) this.tryPlay(live);
    } catch {
      // A bed layer that cannot even construct (no Audio in the
      // environment, a factory failure) is a bed fault like any
      // other: self-silence + one diag, narration untouched.
      this.fault('start-failed');
    }
  }

  private adopt(): void {
    if (this.pendingKind === undefined || this.faulted || this.stopped) return;
    const next = this.pendingKind;
    this.pendingKind = undefined;
    this.adoptionDueAt = null;
    const now = this.clock.now();
    // Fade the current channel(s) out on the equal-power curve.
    for (const live of this.channels) {
      live.fade = { from: live.weight, to: 0, start: now, dur: AMBIENT_XFADE_MS };
    }
    if (next !== null) void this.startKind(next, AMBIENT_XFADE_MS);
  }

  private tryPlay(live: LiveChannel): void {
    if (this.faulted || this.stopped) return;
    live.ch
      .play()
      .then(() => {
        live.playing = true;
        // A pause that landed while the play was in flight wins.
        if (this.pausedFlag || !this.enabledFlag) {
          live.ch.pause();
          live.playing = false;
        }
      })
      .catch((err: unknown) => {
        const name = (err as { name?: string } | null)?.name ?? 'unknown';
        if (name === 'NotAllowedError') {
          // Autoplay policy: not a fault. The next gesture tap retries.
          live.playing = false;
          return;
        }
        this.fault(`play-rejected:${name}`);
      });
  }

  /** Self-silence for the rest of the tour + ONE diag. Narration is never touched. */
  private fault(reason: string): void {
    if (this.faulted) return;
    this.faulted = true;
    for (const live of this.channels) {
      try {
        live.ch.setLevel(0);
        live.ch.pause();
        live.ch.dispose();
      } catch {
        /* best-effort silence */
      }
    }
    this.channels = [];
    this.deps.onDiag?.(reason);
  }

  private teardown(): void {
    this.stopped = true;
    for (const live of this.channels) {
      try {
        live.ch.pause();
        live.ch.dispose();
      } catch {
        /* best-effort */
      }
    }
    this.channels = [];
    if (this.tickHandle !== null) {
      this.clock.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private tick(): void {
    if (this.faulted || this.stopped) return;
    const now = this.clock.now();
    const dt = TICK_MS;

    // Adoption timing: hysteresis, then the boundary grace.
    if (this.pendingKind !== undefined && this.gateOpen && this.enabledFlag) {
      if (now - this.pendingSince >= AMBIENT_HYSTERESIS_MS) {
        if (this.adoptionDueAt === null) this.adoptionDueAt = now;
        else if (now - this.adoptionDueAt >= AMBIENT_BOUNDARY_GRACE_MS) this.adopt();
      }
    }

    // Duck engine: fall fast, release slowly (the breath never blooms).
    const levelTarget = this.sounding ? AMBIENT_DUCK_LEVEL : AMBIENT_FULL_LEVEL;
    const range = AMBIENT_FULL_LEVEL - AMBIENT_DUCK_LEVEL;
    if (this.level > levelTarget) {
      this.level = Math.max(levelTarget, this.level - (range / DUCK_MS) * dt);
    } else if (this.level < levelTarget) {
      this.level = Math.min(levelTarget, this.level + (range / RELEASE_MS) * dt);
    }

    // Presence multipliers.
    const pauseTarget = this.pausedFlag ? 0 : 1;
    this.pauseMul = approach(this.pauseMul, pauseTarget, dt / PAUSE_FADE_MS);
    this.killMul = approach(this.killMul, this.enabledFlag ? 1 : 0, dt / KILL_FADE_MS);
    if (this.stopDur > 0) {
      const u = Math.min(1, (now - this.stopStartedAt) / this.stopDur);
      this.stopMul = 1 - u;
      if (u >= 1) {
        this.teardown();
        return;
      }
    }

    // Channel weights (crossfades) + level application.
    const presence = this.pauseMul * this.killMul * this.stopMul;
    let anyAudible = false;
    for (const live of [...this.channels]) {
      if (live.fade) {
        const u = Math.min(1, Math.max(0, (now - live.fade.start) / live.fade.dur));
        // Equal-power: sin toward 1, cos toward 0.
        live.weight =
          live.fade.to > live.fade.from
            ? live.fade.from + (live.fade.to - live.fade.from) * Math.sin((u * Math.PI) / 2)
            : live.fade.from + (live.fade.to - live.fade.from) * (1 - Math.cos((u * Math.PI) / 2));
        if (u >= 1) {
          live.weight = live.fade.to;
          live.fade = null;
          if (live.weight <= 0) {
            try {
              live.ch.pause();
              live.ch.dispose();
            } catch {
              /* best-effort */
            }
            this.channels = this.channels.filter(c => c !== live);
            continue;
          }
        }
      }
      const applied = this.level * presence * live.weight;
      live.ch.setLevel(applied);
      if (applied > 0.0005) anyAudible = true;
    }

    // Fully faded for pause/kill: park the elements (they resume on the way back).
    if (presence <= 0.001) {
      for (const live of this.channels) {
        if (live.playing) {
          live.ch.pause();
          live.playing = false;
        }
      }
    } else if (!this.pausedFlag && this.enabledFlag && anyAudible) {
      for (const live of this.channels) {
        if (live.playWanted && !live.playing && live.weight > 0) this.tryPlay(live);
      }
    }
  }
}

function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return value;
}
