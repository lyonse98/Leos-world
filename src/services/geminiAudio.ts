// Native Gemini audio generation service.
//
// Uses the @google/genai SDK to produce spoken audio directly from text.
// The Gemini 3.8 Flash TTS model accepts text and returns inline base64
// WAV audio data via generateContent with responseModalities: ['AUDIO'].

import { GoogleGenAI } from '@google/genai';
import type { FactPack } from './poiManager';
import { formatFactPackForPrompt } from './poiManager';
import { hashString } from '../utils/hash';
import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { quotaGuard } from './quotaGuard';
import { applyPronunciation } from './pronunciation';
import { audioHealth } from './audioHealth';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export const TTS_MODEL = 'gemini-3.8-flash-tts';
const TEXT_MODEL = 'gemini-3.8-flash';
const VOICE_NAME = 'Puck';

const LEO_SYSTEM_INSTRUCTION = `You are Leo — part local historian, part true-crime podcast host, part that friend who always knows the weird story behind everything. Think "Mysteries at the Museum" meets a road-trip buddy. Your job is to make people look at a random street corner and go "no WAY."

NARRATIVE STYLE — HOOK, TWIST, LANDING:
1. HOOK: Open with something the listener can SEE, a mystery, or a question.
2. TWIST: The human conflict behind it — greed, rivalry, stubbornness, a scandal.
3. LANDING: A punchy closer that sticks. A dry one-liner or a haunting detail.

VOICE: Conversational and natural. Enthusiastic but never fake-hyped. You sound like a real person talking to a friend, not a narrator reading a script.

OUTPUT CONTRACT: Plain spoken prose only. No asterisks, no markdown, no bullet points. This is audio — never address the listener as a reader.

FACT PACK CONTRACT: The fact pack is the ONLY source you may state as hard fact. Never invent dates, names, or events. If you are not confident, zoom out to broader regional history or explicitly attribute — "the story goes", "locals will tell you".`;

export interface AudioStoryResult {
  audioUrl: string;
  text: string;
  model: string;
}

class GeminiAudioService {
  private ai: GoogleGenAI | null = null;
  // The cache holds audio BLOBS, never object URLs. An object URL is
  // valid only in the document that minted it, yet the old cache stored
  // the URL string in IndexedDB and handed it back as a "hit" in later
  // sessions — a dead blob: URL that the audio element cannot load.
  // The canned intro lines, being the most-repeated texts in the app,
  // were the surest victims: their Gemini playback errored on the dead
  // URL and the line fell to the browser voice (or was lost entirely).
  // Blobs persist correctly; each playback mints a fresh object URL.
  private audioCache = new Map<string, Blob>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('leo_tts_cache', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('audio')) {
            db.createObjectStore('audio');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private async getCachedAudio(text: string): Promise<Blob | null> {
    const key = this.cacheKey(text);
    const memHit = this.audioCache.get(key);
    if (memHit) return memHit;

    const db = await this.openDb();
    if (!db) return null;
    try {
      return await new Promise<Blob | null>((resolve) => {
        const tx = db.transaction('audio', 'readonly');
        const req = tx.objectStore('audio').get(key);
        // Entries written by older builds are URL strings, not Blobs —
        // treat them as the misses they are (the URL died with its
        // document) and let the fresh Blob overwrite them below.
        req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  private async setCachedAudio(text: string, blob: Blob): Promise<void> {
    const key = this.cacheKey(text);
    this.audioCache.set(key, blob);

    const db = await this.openDb();
    if (!db) return;
    try {
      const tx = db.transaction('audio', 'readwrite');
      tx.objectStore('audio').put(blob, key);
      tx.oncomplete = () => {};
    } catch {
      // non-critical
    }
  }

  private cacheKey(text: string): string {
    return `${VOICE_NAME}|${text.length}|${hashString(text)}`;
  }

  initialize(): void {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
      throw new Error('Gemini API key is missing. Please add VITE_GEMINI_API_KEY to your .env file.');
    }
    this.ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }

  hasModel(): boolean {
    return this.ai !== null;
  }

  async generateAudioStory(
    factPack: FactPack,
    options?: { mode?: 'walking' | 'driving' | 'highway' | 'rural'; destination?: string }
  ): Promise<AudioStoryResult> {
    if (!this.ai) {
      throw new Error('Gemini audio service not initialized. Call initialize() first.');
    }

    const mode = options?.mode || 'walking';
    const destination = options?.destination;
    const prompt = this.buildPrompt(factPack, mode, destination);

    const audioBase64 = await this.synthesizeSpeech(prompt);
    const audioUrl = URL.createObjectURL(this.base64ToBlob(audioBase64, 'audio/wav'));
    return { audioUrl, text: prompt, model: TTS_MODEL };
  }

  async textToAudioUrl(text: string): Promise<{ url: string; cacheHit: boolean }> {
    if (!this.ai) {
      throw new Error('Gemini audio service not initialized. Call initialize() first.');
    }

    const cached = await this.getCachedAudio(text);
    if (cached) {
      console.log('[GeminiAudio] TTS local cache hit — skipping synthesis');
      // A fresh object URL per playback: the player revokes the URL it
      // played, which must never invalidate the cached audio itself.
      return { url: URL.createObjectURL(cached), cacheHit: true };
    }

    // Try the shared Supabase Storage cache before paying for synthesis.
    const key = this.cacheKey(text);
    if (SUPABASE_CONFIGURED) {
      const sharedBlob = await this.tryDownloadSharedAudio(key);
      if (sharedBlob) {
        console.log('[GeminiAudio] TTS shared cache hit — skipping synthesis');
        await this.setCachedAudio(text, sharedBlob);
        return { url: URL.createObjectURL(sharedBlob), cacheHit: true };
      }
    }

    const audioBase64 = await this.synthesizeSpeech(text);
    const blob = this.base64ToBlob(audioBase64, 'audio/wav');
    await this.setCachedAudio(text, blob);

    // Fire-and-forget upload so the next listener gets a cache hit.
    if (SUPABASE_CONFIGURED) {
      this.uploadSharedAudio(key, blob).catch((e) => {
        console.warn('[GeminiAudio] Shared cache upload failed:', e);
      });
    }

    return { url: URL.createObjectURL(blob), cacheHit: false };
  }

  private async tryDownloadSharedAudio(key: string): Promise<Blob | null> {
    try {
      const { data, error } = await supabase.storage
        .from('tts-audio')
        .download(`${key}.wav`);
      if (error || !data) return null;
      // Verify the blob looks like audio before trusting it.
      const blob = data as Blob;
      if (blob.size === 0 || !blob.type.startsWith('audio')) return null;
      return blob;
    } catch (e) {
      console.warn('[GeminiAudio] Shared cache download failed:', e);
      return null;
    }
  }

  private async uploadSharedAudio(key: string, blob: Blob): Promise<void> {
    const { error } = await supabase.storage
      .from('tts-audio')
      .upload(`${key}.wav`, blob, { contentType: 'audio/wav', upsert: false });
    if (error && error.message && !error.message.includes('already exists')) {
      console.warn('[GeminiAudio] Shared cache upload error:', error.message);
    }
  }

  // Core TTS method: calls generateContent with AUDIO modality to get
  // spoken audio back as inline base64 WAV data.
  private async synthesizeSpeech(text: string): Promise<string> {
    if (!this.ai) {
      throw new Error('Gemini audio service not initialized.');
    }

    // Circuit breaker: cache hits are checked by callers BEFORE this point,
    // so a tripped TTS lane means "ride the cache / fallback voice" — never
    // spend a request against the quota wall.
    if (quotaGuard.isTripped('tts', TTS_MODEL)) {
      throw new Error('TTS quota cooldown active — skipping synthesis');
    }

    // Playback breaker (fix stack RC-6): while the GEMINI playback
    // engine is tripped, synthesis spends quota warming audio that
    // engine currently cannot play — fail fast so callers ride the
    // cache or the fallback voice. (Per-engine: a browser-voice
    // storm does not pause Gemini synthesis.)
    if (audioHealth.isEngineTripped('gemini')) {
      throw new Error('Gemini playback breaker open — skipping synthesis');
    }

    // Pronunciation lexicon: respell known local-name traps in the payload
    // only. Callers checked every cache with the canonical text before this
    // point, and the canonical text is what gets stored and displayed — the
    // voice alone hears the phonetic forms.
    const spokenText = applyPronunciation(text);

    let response;
    try {
      response = await this.ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{
          role: 'user',
          parts: [{ text: spokenText }],
        }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { voice: VOICE_NAME },
          },
        },
      });
    } catch (error) {
      if (quotaGuard.isQuotaError(error)) quotaGuard.trip('tts', TTS_MODEL);
      throw error;
    }

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) {
      throw new Error('Gemini TTS returned no audio data in response parts.');
    }
    return data;
  }

  async generateTextStory(
    factPack: FactPack,
    options?: { mode?: 'walking' | 'driving' | 'highway' | 'rural'; destination?: string }
  ): Promise<string> {
    if (!this.ai) {
      throw new Error('Gemini audio service not initialized. Call initialize() first.');
    }

    const mode = options?.mode || 'walking';
    const destination = options?.destination;
    const prompt = this.buildPrompt(factPack, mode, destination);

    const response = await this.ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        systemInstruction: LEO_SYSTEM_INSTRUCTION,
      },
    });

    return response.text || '';
  }

  private buildPrompt(factPack: FactPack, mode: string, destination?: string): string {
    const parts: string[] = [];
    parts.push(LEO_SYSTEM_INSTRUCTION);
    parts.push('');
    parts.push(formatFactPackForPrompt(factPack));
    if (destination) parts.push(`Destination: ${destination}`);
    parts.push(`MODE: ${mode}`);
    parts.push('');
    parts.push('Tell the best story about what is here. Follow the HOOK, TWIST, LANDING shape. Keep it to 3-5 sentences. Speak naturally as if talking to a friend in a car.');

    return parts.join('\n');
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }

  revokeAudioUrl(url: string): void {
    URL.revokeObjectURL(url);
  }
}

export const geminiAudio = new GeminiAudioService();
