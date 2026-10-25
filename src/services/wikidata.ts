// Wikidata verified-facts enrichment (Oct 25, 2026).
//
// The fact pack's prose sources (Wikipedia summaries, place listings) are
// strong on narrative and weak on citable specifics — exactly the gap the
// persona's fact-pack contract feels when it must not invent dates or
// names. Wikidata supplies structured claims about a place (inception,
// architect, architectural style, heritage designation, namesake, height)
// that Leo can state as hard fact.
//
// Lookup discipline: search by the subject's name, then VERIFY by
// coordinates — a candidate whose own coordinates sit far from the
// listener's position is a different place with the same name and is
// rejected. Every failure path returns '' (no facts, no error): a story
// must never wait on, or die because of, an enrichment source.

interface LatLng {
  lat: number;
  lng: number;
}

const API = 'https://www.wikidata.org/w/api.php';
const TIMEOUT_MS = 4000;
const MAX_VERIFY_DISTANCE_M = 1500;

const cache = new Map<string, Promise<string>>();

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function firstClaimValue(claims: any, property: string): any {
  const list = claims?.[property];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[0]?.mainsnak?.datavalue?.value ?? null;
}

async function labelsFor(ids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (ids.length === 0) return labels;
  const data = await fetchJson(
    `${API}?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=en&format=json&origin=*`
  );
  for (const id of ids) {
    const label = data?.entities?.[id]?.labels?.en?.value;
    if (label) labels.set(id, label);
  }
  return labels;
}

async function lookup(subjectName: string, position: LatLng): Promise<string> {
  const search = await fetchJson(
    `${API}?action=wbsearchentities&search=${encodeURIComponent(subjectName)}&language=en&type=item&limit=5&format=json&origin=*`
  );
  const hits = search?.search;
  if (!Array.isArray(hits) || hits.length === 0) return '';

  const ids = hits.slice(0, 3).map((h: any) => h.id).filter(Boolean);
  if (ids.length === 0) return '';

  const data = await fetchJson(
    `${API}?action=wbgetentities&ids=${ids.join('|')}&props=claims|labels&languages=en&format=json&origin=*`
  );
  if (!data?.entities) return '';

  // Pick the first candidate that verifies: matching coordinates nearby,
  // or (when the entity carries none) a near-exact label match.
  let entity: any = null;
  for (const id of ids) {
    const candidate = data.entities[id];
    if (!candidate?.claims) continue;
    const coord = firstClaimValue(candidate.claims, 'P625');
    if (coord && typeof coord.latitude === 'number' && typeof coord.longitude === 'number') {
      if (haversineMeters(position, { lat: coord.latitude, lng: coord.longitude }) <= MAX_VERIFY_DISTANCE_M) {
        entity = candidate;
        break;
      }
      continue;
    }
    const label = (candidate.labels?.en?.value || '').toLowerCase();
    if (label && (label === subjectName.toLowerCase() || subjectName.toLowerCase().includes(label))) {
      entity = candidate;
      break;
    }
  }
  if (!entity) return '';

  const claims = entity.claims;
  const facts: string[] = [];

  const inception = firstClaimValue(claims, 'P571');
  if (inception?.time) {
    const year = String(inception.time).match(/([+-]\d{4})-/);
    if (year) facts.push(`built ${year[1].replace('+', '')}`);
  }

  // Item-valued claims need a label lookup.
  const itemClaims: Array<[string, string]> = [
    ['P84', 'architect'],
    ['P149', 'style'],
    ['P1435', 'heritage status'],
    ['P138', 'named after'],
  ];
  const referencedIds: string[] = [];
  const itemFacts: Array<[string, string]> = [];
  for (const [property, label] of itemClaims) {
    const value = firstClaimValue(claims, property);
    if (value?.id) {
      referencedIds.push(value.id);
      itemFacts.push([label, value.id]);
    }
  }
  if (referencedIds.length > 0) {
    const labels = await labelsFor(referencedIds);
    for (const [label, id] of itemFacts) {
      const name = labels.get(id);
      if (name) facts.push(`${label}: ${name}`);
    }
  }

  const height = firstClaimValue(claims, 'P2048');
  if (height?.amount) {
    const amount = Math.round(parseFloat(String(height.amount).replace('+', '')));
    if (Number.isFinite(amount) && amount > 0) facts.push(`height: ${amount} m`);
  }

  if (facts.length === 0) return '';
  const entityName = entity.labels?.en?.value || subjectName;
  return `WIKIDATA VERIFIED FACTS for ${entityName}: ${facts.join('; ')}.`;
}

export const wikidata = {
  /**
   * Prompt-ready verified-facts block for a place, or '' when Wikidata
   * has nothing verifiable nearby. Cached per subject name; never throws.
   */
  getFactsForPlace(subjectName: string, position: LatLng): Promise<string> {
    const key = subjectName.trim().toLowerCase();
    if (!key) return Promise.resolve('');
    let pending = cache.get(key);
    if (!pending) {
      pending = lookup(subjectName, position).catch(() => '');
      cache.set(key, pending);
      if (cache.size > 60) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    return pending;
  },
};
