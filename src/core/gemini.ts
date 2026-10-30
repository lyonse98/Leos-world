// Gemini lanes for the fresh shell: story/Q&A text generation and
// speech synthesis, spoken to the public REST API directly.
//
// The economies live here because they are properties of the lanes
// (spec §5): a quota error trips only its (lane, model) pair, is
// never retried, and restores on cooldown expiry — never by probing.
// A priority waiter queue (spec S3) orders waiting work: live story
// generation outranks Q&A, which outranks prefetch; an in-flight
// request is never preempted.

import { LEO_MODEL_ID, LEO_QA_MODEL_ID, LEO_SYSTEM_INSTRUCTION } from '../services/leoPersona';
import { applyPronunciation } from '../services/pronunciation';

export type Lane = 'story' | 'qa' | 'tts';

export class QuotaError extends Error {
  constructor(lane: Lane, model: string) {
    super(`quota exhausted for ${lane}/${model}`);
    this.name = 'QuotaError';
  }
}

// ------------------------------------------------------------ telemetry sink (P1 salvage)
//
// Lane-level events in A's vocabulary — generation_attempt per API
// attempt, quota_tripped at a breaker trip, question_timing per
// answered question — file through the owning tour's analytics
// emit. The lanes are module-level, so the tour registers its emit
// here at construction (the newest tour owns the sink). A metric
// must never break a lane: the sink call is wrapped and sinkless
// operation (tests, landing) is silent.

export type TelemetrySink = (type: string, payload: Record<string, unknown>) => void;

let telemetrySink: TelemetrySink | null = null;

export function setTelemetrySink(sink: TelemetrySink | null): void {
  telemetrySink = sink;
}

function tele(type: string, payload: Record<string, unknown>): void {
  try {
    telemetrySink?.(type, payload);
  } catch {
    /* a metric must never break a lane */
  }
}

const apiKey = (): string => (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';

// ------------------------------------------------------------ quota breaker (E4/E5)

const COOLDOWNS_MS = [2 * 60_000, 15 * 60_000, 60 * 60_000];

interface BreakerState {
  trips: number;
  until: number;
}

const breakers = new Map<string, BreakerState>();

function breakerKey(lane: Lane, model: string): string {
  return `${lane}:${model}`;
}

function quotaTripped(lane: Lane, model: string): boolean {
  const state = breakers.get(breakerKey(lane, model));
  return Boolean(state && Date.now() < state.until);
}

function tripQuota(lane: Lane, model: string): void {
  const key = breakerKey(lane, model);
  const state = breakers.get(key) ?? { trips: 0, until: 0 };
  state.trips += 1;
  const cooldown = COOLDOWNS_MS[Math.min(state.trips - 1, COOLDOWNS_MS.length - 1)];
  state.until = Date.now() + cooldown;
  breakers.set(key, state);
  // P1 salvage: the trip is on the record in A's pipeline_diag
  // vocabulary, so a quota wall is readable per-event, not inferred.
  tele('quota_tripped', {
    model,
    source: lane,
    lane,
    stage: 'quota',
    reason: 'tripped',
    message: `${key} tripped (trip #${state.trips}) — quiet for ${Math.round(cooldown / 1000)}s`,
  });
}

function isQuotaResponse(status: number, body: string): boolean {
  return status === 429 || body.includes('RESOURCE_EXHAUSTED') || body.includes('quota');
}

// ------------------------------------------------------------ lane priority queue (S3)

const PRIORITY: Record<'live' | 'qa' | 'prefetch', number> = { live: 3, qa: 2, prefetch: 1 };

interface Queued<T> {
  priority: number;
  seq: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

let laneBusy = false;
let laneSeq = 0;
const laneWaiters: Queued<unknown>[] = [];

function laneEnqueue<T>(kind: keyof typeof PRIORITY, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    laneWaiters.push({
      priority: PRIORITY[kind],
      seq: laneSeq++,
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    laneDrain();
  });
}

function laneDrain(): void {
  if (laneBusy) return;
  if (laneWaiters.length === 0) return;
  laneWaiters.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  const next = laneWaiters.shift() as Queued<unknown>;
  laneBusy = true;
  next
    .run()
    .then(next.resolve, next.reject)
    .finally(() => {
      laneBusy = false;
      laneDrain();
    });
}

// ------------------------------------------------------------ REST plumbing

/**
 * Every network call carries a hard timeout (field lesson: live
 * generation stalls without erroring — a request that neither
 * succeeds nor fails must still settle). An abort surfaces as a
 * normal failure to the caller; it is never a quota signal.
 */
const TEXT_TIMEOUT_MS = 45_000;
const TTS_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Consecutive attempts per text lane since the last success (A's attempt index). */
const attemptStreak = new Map<Lane, number>();

/**
 * One generation, on the record (P1 salvage): every attempt files
 * generation_attempt with model / kind / attempt index / outcome —
 * failures included, so a drive of timeouts no longer reads as a
 * drive of slow successes. A breaker skip is not an attempt (A's
 * rule): it throws before the attempt is filed.
 */
async function generateContent(
  lane: Lane,
  model: string,
  systemInstruction: string,
  userText: string,
  maxOutputTokens?: number,
  thinkingOff = false,
): Promise<string> {
  if (quotaTripped(lane, model)) throw new QuotaError(lane, model);
  const attempts = (attemptStreak.get(lane) ?? 0) + 1;
  const kind = lane === 'qa' ? 'answer' : 'story';
  try {
    const out = await generateContentAttempt(lane, model, systemInstruction, userText, maxOutputTokens, thinkingOff);
    attemptStreak.set(lane, 0);
    tele('generation_attempt', { model, kind, attempts, reason: 'ok' });
    return out;
  } catch (err) {
    attemptStreak.set(lane, attempts);
    const reason =
      err instanceof QuotaError
        ? 'quota'
        : (err as { name?: string } | null)?.name === 'AbortError'
          ? 'timeout'
          : 'error';
    tele('generation_attempt', { model, kind, attempts, reason });
    throw err;
  }
}

async function generateContentAttempt(
  lane: Lane,
  model: string,
  systemInstruction: string,
  userText: string,
  maxOutputTokens?: number,
  thinkingOff = false,
): Promise<string> {
  if (quotaTripped(lane, model)) throw new QuotaError(lane, model);
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
        body: JSON.stringify(body),
      },
      TEXT_TIMEOUT_MS,
    );
  } catch (err) {
    throw err instanceof Error ? err : new Error('network failure');
  }
  const text = await res.text();
  if (!res.ok) {
    if (isQuotaResponse(res.status, text)) {
      tripQuota(lane, model);
      throw new QuotaError(lane, model);
    }
    throw new Error(`generation failed (${res.status})`);
  }
  const parsed = JSON.parse(text) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const out = (parsed.candidates?.[0]?.content?.parts ?? [])
    .map(p => p.text ?? '')
    .join('')
    .trim();
  if (!out) throw new Error('generation returned empty text');
  return out;
}

/** Live story text (lane priority: highest). */
export function generateStoryText(userPrompt: string): Promise<string> {
  return laneEnqueue('live', () =>
    generateContent('story', LEO_MODEL_ID, LEO_SYSTEM_INSTRUCTION, userPrompt),
  );
}

/** Prefetch story text (lane priority: lowest; never holds the lane ahead of a live serve). */
export function generatePrefetchText(userPrompt: string): Promise<string> {
  return laneEnqueue('prefetch', () =>
    generateContent('story', LEO_MODEL_ID, LEO_SYSTEM_INSTRUCTION, userPrompt),
  );
}

/**
 * Q&A answer text: reduced model, thinking off; on any failure the
 * lane degrades to the flagship story model so it never dies
 * (persona data contract). Quota on the reduced model does not fall
 * back into a retry against the tripped pair — the fallback is a
 * different (lane, model) pair and is checked against its own breaker.
 */
export async function generateAnswerText(userPrompt: string): Promise<string> {
  // P1 salvage: the answer's latency and the model that actually
  // produced it file as question_timing (A's Q&A instrumentation).
  const startedAt = Date.now();
  const emitTiming = (model: string) =>
    tele('question_timing', {
      fetchTextS: Math.round(((Date.now() - startedAt) / 1000) * 1000) / 1000,
      model,
      source: 'gemini',
    });
  try {
    const text = await laneEnqueue('qa', () =>
      generateContent('qa', LEO_QA_MODEL_ID, LEO_SYSTEM_INSTRUCTION, userPrompt, 1024, true),
    );
    emitTiming(LEO_QA_MODEL_ID);
    return text;
  } catch {
    const text = await laneEnqueue('qa', () =>
      generateContent('qa', LEO_MODEL_ID, LEO_SYSTEM_INSTRUCTION, userPrompt, 1024, true),
    );
    emitTiming(LEO_MODEL_ID);
    return text;
  }
}

// ------------------------------------------------------------ synthesis (TTS lane)

export const TTS_MODEL_ID = 'gemini-3.8-flash-tts';
export const TTS_VOICE = 'Puck';

function pcmToWav(pcm: Int16Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Synthesize speech for a story/answer text. The pronunciation
 * lexicon is applied to the synthesis payload only; the canonical
 * text is never altered (§8A contract F). Returns WAV bytes.
 * Throws QuotaError when the TTS lane is tripped or trips.
 */
export async function synthesizeSpeech(canonicalText: string): Promise<Blob> {
  const lane: Lane = 'tts';
  const model = TTS_MODEL_ID;
  if (quotaTripped(lane, model)) throw new QuotaError(lane, model);
  const payload = applyPronunciation(canonicalText);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: payload }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } },
            },
          },
        }),
      },
      TTS_TIMEOUT_MS,
    );
  } catch (err) {
    throw err instanceof Error ? err : new Error('network failure');
  }
  const text = await res.text();
  if (!res.ok) {
    if (isQuotaResponse(res.status, text)) {
      tripQuota(lane, model);
      throw new QuotaError(lane, model);
    }
    throw new Error(`synthesis failed (${res.status})`);
  }
  const parsed = JSON.parse(text) as {
    candidates?: {
      content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
    }[];
  };
  const part = (parsed.candidates?.[0]?.content?.parts ?? []).find(p => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error('synthesis returned no audio');
  const mime = part.inlineData.mimeType ?? 'audio/L16;rate=24000';
  const rateMatch = /rate=(\d+)/.exec(mime);
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  const binary = atob(part.inlineData.data);
  const pcm = new Int16Array(binary.length / 2);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
  }
  if (mime.includes('wav')) {
    return new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: 'audio/wav' });
  }
  return pcmToWav(pcm, sampleRate);
}

/** True while the TTS (lane, model) breaker stands (E6: presynth stands down). */
export function ttsQuotaTripped(): boolean {
  return quotaTripped('tts', TTS_MODEL_ID);
}

/** True while the story-text (lane, model) breaker stands. */
export function storyQuotaTripped(): boolean {
  return quotaTripped('story', LEO_MODEL_ID);
}
