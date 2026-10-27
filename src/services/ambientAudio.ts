// A quiet ambient bed that plays between Leo's stories and steps back the
// moment he speaks, so the tour is never silent and Leo is never hard to hear.
//
// The bed is synthesized rather than streamed: no audio files to download, no
// licensing, and nothing to buffer on a bad connection. It is deliberately
// dull — a low pad plus filtered air — because it has to sit under speech for
// an hour without becoming annoying.
//
// Note on third-party music: this is not a Spotify integration and cannot be.
// A web page has no way to play or control the Spotify app, and Spotify's own
// browser player does not run on mobile at all. This fills the same role —
// something pleasant in the quiet stretches — without depending on anything.

import { trackDiag } from './analytics';

const NORMAL_LEVEL = 0.11;
const DUCKED_LEVEL = 0.012;
const RAMP_SECONDS = 0.8;

class AmbientAudioService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ducked = false;
  private running = false;

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof window !== 'undefined'
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  private buildGraph(ctx: AudioContext): GainNode {
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Slow drift on the filter keeps the pad from sounding like a held tone.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 0.7;
    filter.connect(master);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 70;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    lfo.start();

    // Two slightly detuned voices give the pad a slow, gentle beat.
    const padGain = ctx.createGain();
    padGain.gain.value = 0.5;
    padGain.connect(filter);

    const makeVoice = (frequency: number, level: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain);
      gain.connect(padGain);
      osc.start();
    };
    makeVoice(96, 0.5);
    makeVoice(144, 0.18);
    makeVoice(96.4, 0.4);

    // Filtered noise reads as air or distant traffic rather than static.
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 500;
    noiseFilter.Q.value = 0.6;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.12;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    return master;
  }

  start(): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      // The bed is part of the sonic floor (Area A, Oct 26, 2026): its
      // failure used to be indistinguishable from the toggle being off.
      // On the record now, like every other floor failure.
      trackDiag('playback', 'ambient-unavailable', 'AudioContext could not be created — ambient bed silent');
      return;
    }

    if (!this.master) {
      this.master = this.buildGraph(ctx);
    }

    // Called from a tap, so this is the moment the platform lets us make sound.
    if (ctx.state === 'suspended') {
      ctx.resume()
        .then(() => {
          if (ctx.state !== 'running') {
            trackDiag('playback', 'ambient-suspended', `ambient context still ${ctx.state} after resume — bed silent`);
          }
        })
        .catch((error) => {
          trackDiag('playback', 'ambient-resume-failed', error);
        });
    }

    this.running = true;
    this.ramp(this.ducked ? DUCKED_LEVEL : NORMAL_LEVEL);
  }

  stop(): void {
    this.running = false;
    if (!this.ctx || !this.master) return;
    this.ramp(0);
  }

  // Duck while Leo speaks, and while the listener is talking, so the bed never
  // competes with either voice.
  setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    if (!this.running) return;
    this.ramp(ducked ? DUCKED_LEVEL : NORMAL_LEVEL);
  }

  resumeIfNeeded(): void {
    if (!this.running || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch((error) => {
        trackDiag('playback', 'ambient-resume-failed', error);
      });
    }
  }

  private ramp(target: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(target, ctx.currentTime + RAMP_SECONDS);
    } catch {
      // Context torn down mid-ramp — nothing to fade.
    }
  }
}

export const ambientAudio = new AmbientAudioService();
