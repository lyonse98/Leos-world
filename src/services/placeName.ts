// One canonical form for a place name, shared by every identity check in
// the app: the session landmark lockout, angle coverage, and the heard
// set. The same physical place reaches those checks under variant names
// — Google says "Balboa Avenue Station", a cached story's topic may say
// "Balboa Ave. Station", the registry says something else again — and
// each variant used to mint its own identity, so the lockout and the
// heard set each held only the spelling they happened to see first.
// That is how a landmark could be retold at a fresh angle minutes after
// its first telling: the second arrival was, to the key, a stranger.
//
// The normal form: diacritics stripped, lowercased, punctuation turned
// to spaces, a leading "the" dropped, common street-suffix abbreviations
// expanded ("ave" → "avenue"), whitespace collapsed. Deliberately NOT
// fuzzy beyond that — containment matching (placeNamesMatch) is a
// separate, explicit decision at the call site.

const ABBREVIATIONS: Record<string, string> = {
  ave: 'avenue',
  blvd: 'boulevard',
  rd: 'road',
  dr: 'drive',
  ln: 'lane',
  hwy: 'highway',
  pkwy: 'parkway',
  ctr: 'center',
  mt: 'mount',
};

export function normalizePlaceName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map(token => ABBREVIATIONS[token] ?? token)
    .join(' ');
}

// True when two place names plausibly refer to the same place: equal
// after normalization, or one contains the other with a length floor so
// short generic names ("park", "the station") can't swallow longer ones.
// Mirrors the registry's matching discipline, on the deeper normal form.
export function placeNamesMatch(a: string, b: string): boolean {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return shorter.length >= 8 && longer.includes(shorter);
}
