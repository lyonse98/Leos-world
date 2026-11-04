// Audio finish for route mode's LIVE renders (composer v3.1,
// commit D — Erik, Nov 4, 2026): the audible seam between the
// batch-rendered shelf and the pieces route mode renders at
// build time (the spoken preview, the plan-time bridges, the
// wrap-up, and any story the runner must synthesize live
// because its shelf audio is missing — a promoted gap story
// whose ingest failed among them). Same voice, two pipelines:
// without a finish, the live pieces sit at whatever level the
// TTS call happened to return and butt against the shelf as
// hard, uneven cuts.
//
// Two mechanical fixes live here:
//   1. LOUDNESS MATCHING. Each live render is measured
//      (RMS dBFS over the whole render) and gained toward the
//      SHELF TARGET below, clamped to ±6 dB, with peak
//      protection: the applied gain can never push a sample
//      past the peak ceiling. Stored library items are NOT
//      re-processed — they ARE the target; only live renders
//      move.
//   2. The inter-item breath lives in routePlayback (the
//      runner's Player hook), not here — this module is only
//      about the level of a single render.
//
// THE TARGET, and how it was derived (Nov 4, 2026): the local
// render corpora under ~/workspace/leos-world hold the actual
// WAV files the batch pipeline uploaded to the shelf bucket —
// 2,778 renders (library corpus mirrors, wave fills, retells,
// corridor + gap-fill corpora), all 24 kHz / 16-bit / mono
// PCM. A stride-4 sample of 695 of them was measured
// (whole-file RMS, channels averaged): p10 −21.9 dBFS,
// p25 −21.3, MEDIAN −20.7, mean −20.7, p75 −20.1, p90 −19.6.
// The shelf is tight — Puck renders consistently — so the
// median, rounded, is the target: −21 dBFS. Re-derive the
// same way if the voice or pipeline ever changes.
//
// Everything here is pure over PCM sample arrays except the
// blob seam at the bottom, whose decoder is injectable so the
// harness can drive the whole finish with synthetic WAVs and
// zero live calls. The finish NEVER fails a render: any
// problem (undecodable bytes, silence, an exception) returns
// the original blob untouched.

/** The shelf's loudness: median whole-file RMS of the batch renders (see header). */
export const SHELF_TARGET_RMS_DB = -21;
/** Gain clamp: a live render moves at most this far toward the target. */
export const LOUDNESS_GAIN_LIMIT_DB = 6;
/** Peak ceiling (linear, ≈ −0.09 dBFS): gain may never push a peak past it. */
export const PEAK_CEILING = 0.99;
/** Below this much correction, the render is already at level — hand it back untouched. */
const FINISH_SKIP_DB = 0.25;

export interface PcmAudio {
  sampleRate: number;
  /** One Float32Array per channel, samples in [-1, 1]. */
  channels: Float32Array[];
}

/** Whole-render RMS in dBFS (all channels pooled). Silence (or no samples) → −Infinity. */
export function measureRmsDb(audio: PcmAudio): number {
  let sum = 0;
  let n = 0;
  for (const ch of audio.channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    n += ch.length;
  }
  if (n === 0 || sum === 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(Math.sqrt(sum / n));
}

/** Peak absolute sample across all channels (0 for silence). */
export function measurePeak(audio: PcmAudio): number {
  let peak = 0;
  for (const ch of audio.channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/**
 * The gain to apply to one live render: toward the shelf
 * target, clamped to ±LOUDNESS_GAIN_LIMIT_DB, then limited
 * so the render's own peak can never cross PEAK_CEILING.
 * Silence is never gained (there is nothing to match).
 */
export function planLoudnessGainDb(audio: PcmAudio, targetDb: number = SHELF_TARGET_RMS_DB): number {
  const rmsDb = measureRmsDb(audio);
  if (!Number.isFinite(rmsDb)) return 0;
  let gain = targetDb - rmsDb;
  gain = Math.max(-LOUDNESS_GAIN_LIMIT_DB, Math.min(LOUDNESS_GAIN_LIMIT_DB, gain));
  const peak = measurePeak(audio);
  if (peak > 0) {
    // The cap is floored to cents: rounding it could land a
    // hair ABOVE the exact cap and push the peak past the
    // ceiling — the ceiling is the one promise kept exactly.
    const peakCapDb = Math.floor(20 * Math.log10(PEAK_CEILING / peak) * 100) / 100;
    if (gain > peakCapDb) gain = peakCapDb;
  }
  return Math.round(gain * 100) / 100;
}

/** A gained copy of the render (hard-clamped to [−1, 1] as the final safety). */
export function applyGainDb(audio: PcmAudio, gainDb: number): PcmAudio {
  const factor = Math.pow(10, gainDb / 20);
  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map(ch => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i] * factor;
        out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
      return out;
    }),
  };
}

/** Encode PCM as a 16-bit WAV (the shelf's container). */
export function encodeWavPcm16(audio: PcmAudio): Uint8Array {
  const channels = Math.max(1, audio.channels.length);
  const frames = audio.channels[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + frames * channels * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const v = audio.channels[c][f] ?? 0;
      const clamped = v > 1 ? 1 : v < -1 ? -1 : v;
      view.setInt16(44 + (f * channels + c) * 2, Math.round(clamped * 32767), true);
    }
  }
  return bytes;
}

/**
 * Decode a 16-bit PCM WAV (the synth's output shape and the
 * shelf's). Anything else — other formats, corrupt bytes —
 * returns null; the caller falls back, never fails.
 */
export function decodeWavPcm16(bytes: Uint8Array): PcmAudio | null {
  try {
    if (bytes.length < 44) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let fmt: { channels: number; sampleRate: number } | null = null;
    let dataOff = -1;
    let dataLen = 0;
    for (let off = 12; off + 8 <= bytes.length; ) {
      const id = tag(off);
      const len = view.getUint32(off + 4, true);
      if (id === 'fmt ') {
        if (view.getUint16(off + 8, true) !== 1 || view.getUint16(off + 22, true) !== 16) return null;
        fmt = { channels: view.getUint16(off + 10, true), sampleRate: view.getUint32(off + 12, true) };
      }
      if (id === 'data') {
        dataOff = off + 8;
        dataLen = len;
        break;
      }
      off += 8 + len + (len % 2);
    }
    if (!fmt || dataOff < 0 || fmt.channels < 1 || fmt.channels > 2) return null;
    const frames = Math.floor(dataLen / 2 / fmt.channels);
    const channels: Float32Array[] = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < fmt.channels; c++) {
        channels[c][f] = view.getInt16(dataOff + (f * fmt.channels + c) * 2, true) / 32768;
      }
    }
    return { sampleRate: fmt.sampleRate, channels };
  } catch {
    return null;
  }
}

/** Default decoder for a live render blob: PCM WAV first (the synth's shape), WebAudio for anything else. */
async function decodeLiveRender(blob: Blob): Promise<PcmAudio | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const wav = decodeWavPcm16(bytes);
  if (wav) return wav;
  const Ctor = (
    globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  ).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(new Float32Array(decoded.getChannelData(c)));
    return { sampleRate: decoded.sampleRate, channels };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/**
 * The finish seam (App wiring): a live render blob in, a
 * level-matched WAV blob out — or the ORIGINAL blob when the
 * render is already at level, undecodable, silent, or
 * anything goes wrong. Stored shelf audio never passes
 * through here. The decoder is injectable for the harness.
 */
export async function finishLiveRenderBlob(
  blob: Blob,
  decode: (blob: Blob) => Promise<PcmAudio | null> = decodeLiveRender,
): Promise<Blob> {
  try {
    const samples = await decode(blob);
    if (!samples || samples.channels.length === 0) return blob;
    const gainDb = planLoudnessGainDb(samples);
    if (Math.abs(gainDb) < FINISH_SKIP_DB) return blob;
    const finished = applyGainDb(samples, gainDb);
    return new Blob([encodeWavPcm16(finished)], { type: 'audio/wav' });
  } catch {
    return blob;
  }
}
