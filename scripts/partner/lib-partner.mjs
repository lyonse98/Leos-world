// Shared plumbing for the partner tooling scripts.
//
// - loadPartnerTools(): esbuild-bundles partner-tools-entry.ts so the
//   scripts execute the shipped registry code (src/data/partners.ts).
// - loadAnon(): the shared project's anon credentials via the library
//   tooling's loadKeys() (extracted from the live bundle; values are
//   never printed).
// - fetchLiveRows(): story_library rows for a set of unit ids, keyed
//   back into a Map by unit id (place_key|angle).

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');

export async function loadPartnerTools() {
  const out = join(mkdtempSync(join(tmpdir(), 'partner-tools-')), 'tools.mjs');
  execFileSync(
    join(repoRoot, 'node_modules', '.bin', 'esbuild'),
    [
      join(here, 'partner-tools-entry.ts'),
      '--bundle',
      '--format=esm',
      '--platform=node',
      `--outfile=${out}`,
      '--log-level=warning',
      '--define:import.meta.env={"VITE_MILES_SUPABASE_URL":"https://fake.test","VITE_MILES_SUPABASE_ANON_KEY":"fake-anon","VITE_GEMINI_API_KEY":"fake-gemini","VITE_GOOGLE_MAPS_API_KEY":"fake-maps","VITE_GOOGLE_PLACES_API_KEY":"fake-places"}',
      "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    ],
    { stdio: 'inherit' },
  );
  return import(pathToFileURL(out).href);
}

export async function loadAnon() {
  const { loadKeys } = await import('../library/lib.mjs');
  const keys = await loadKeys();
  if (!keys.supabaseUrl || !keys.anonKey) throw new Error('anon credentials unavailable from loadKeys()');
  return { supabaseUrl: keys.supabaseUrl, anonKey: keys.anonKey };
}

const headers = anonKey => ({ apikey: anonKey, Authorization: `Bearer ${anonKey}` });

/** Fetch story_library rows for unit ids → Map unitId → row (or absent). */
export async function fetchLiveRows({ supabaseUrl, anonKey }, unitIds) {
  const tools = await loadPartnerTools();
  const byUnit = new Map();
  for (const unitId of unitIds) {
    const placeKey = tools.unitPlaceKey(unitId);
    const angle = tools.unitAngle(unitId);
    const q =
      `${supabaseUrl}/rest/v1/story_library?place_key=eq.${encodeURIComponent(placeKey)}` +
      `&angle=eq.${encodeURIComponent(angle)}&select=place_key,place_name,angle,audio_path,story_text`;
    const res = await fetch(q, { headers: headers(anonKey) });
    if (!res.ok) throw new Error(`story_library read failed for ${unitId}: HTTP ${res.status}`);
    const rows = await res.json();
    if (rows.length > 0) {
      const r = rows[0];
      byUnit.set(unitId, {
        audioPath: r.audio_path,
        storyText: r.story_text,
        placeName: r.place_name,
        placeKey: r.place_key,
        angle: r.angle,
      });
    }
  }
  return byUnit;
}

/** Public bucket URL for a story's audio (tts-audio is public-read). */
export function audioPublicUrl(supabaseUrl, audioPath) {
  return `${supabaseUrl}/storage/v1/object/public/tts-audio/${encodeURI(audioPath)}`;
}

/** Measured duration from the WAV's byte size (≈48.5 KB/s shelf audio); null when unreachable. */
export async function measuredDurationSec(supabaseUrl, audioPath) {
  try {
    const res = await fetch(audioPublicUrl(supabaseUrl, audioPath), { method: 'HEAD' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    if (!Number.isFinite(len) || len <= 0) return null;
    return Math.round(len / 48_500);
  } catch {
    return null;
  }
}
