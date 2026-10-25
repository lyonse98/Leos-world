// Pronunciation lexicon for Leo's voice.
//
// Speech engines read text literally and mangle a predictable set of local
// proper nouns ("La Jolla" with a hard J, "Peñasquitos" every possible wrong
// way). This module rewrites ONLY those known traps, replacing the written
// form with a phonetic respelling in the string handed to the synthesizer.
//
// Doctrine:
// - Stored, displayed, and cached story text is NEVER altered. Cache keys in
//   geminiAudio derive from the canonical text; this transform runs inside
//   synthesizeSpeech, downstream of every cache lookup, on the payload only.
// - Exceptions only. Engines are trained on normal orthography — respelling
//   ordinary words degrades prosody. This list is a scalpel, not a system.
// - Erik (a local) is the ground truth for entries. Add an entry when a
//   field drive surfaces a mispronunciation; never guess a respelling for a
//   name nobody has heard the engine fail on.
// - Improving the lexicon does not retro-fix already-cached audio (same
//   rule as persona versions: improvements apply to new syntheses).

// [written form, spoken form]. Matching is case-insensitive with
// unicode-aware word boundaries; the spoken form is emitted as authored
// (its capitalization carries stress). Longest entries win, so
// "Rancho Peñasquitos" beats its own suffix "Peñasquitos".
const LEXICON: ReadonlyArray<readonly [string, string]> = [
  ['Rancho Peñasquitos', 'Rancho Pen-yas-KEE-tos'],
  ['Peñasquitos', 'Pen-yas-KEE-tos'],
  ['Penasquitos', 'Pen-yas-KEE-tos'],
  ['La Jolla', 'Lah HOY-ah'],
  ['El Cajon', 'El Cah-HONE'],
  ['Jamacha', 'HAM-a-shaw'],
  ['Cabrillo', 'Cah-BREE-oh'],
  ['Alcalá', 'Al-kah-LAH'],
  ['Alcala', 'Al-kah-LAH'],
  ['San Ysidro', 'San ee-SEE-droh'],
  ['Jacumba', 'Hah-KOOM-bah'],
  ['Tecate', 'Teh-KAH-teh'],
  ['Kearny', 'KEER-nee'],
  ['Borrego', 'Bor-AY-go'],
  ['Descanso', 'Des-KAHN-so'],
  ['Tijuana', 'Tee-HWAH-nah'],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-compiled matchers, longest written form first so multi-word and
// longer entries claim their text before shorter ones can.
const MATCHERS: ReadonlyArray<{ pattern: RegExp; spoken: string }> = [...LEXICON]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([written, spoken]) => ({
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(written)}(?![\\p{L}\\p{N}])`,
      'giu',
    ),
    spoken,
  }));

/**
 * Return the synthesis-payload version of `text` with every lexicon trap
 * respelled phonetically. The input string is the canonical story text and
 * is never mutated anywhere — this produces a throwaway copy for the voice.
 * Fail-safe: any error returns the original text (a story must never die
 * because a pronunciation nicety threw).
 */
export function applyPronunciation(text: string): string {
  try {
    let out = text;
    for (const { pattern, spoken } of MATCHERS) {
      out = out.replace(pattern, spoken);
    }
    return out;
  } catch {
    return text;
  }
}
