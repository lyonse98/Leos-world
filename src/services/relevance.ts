import { NearbyPlace } from './placesService';
import { heardStories } from './heardStories';
import { tasteProfile } from './tasteProfile';
import { deriveTags, isInterestTag } from './storyTags';
import { normalizePlaceName } from './placeName';

export interface ScoredPlace {
  place: NearbyPlace;
  score: number;
  reasons: string[];
}

export interface StorySubject {
  name: string;
  distance: number;
  direction: string;
  types: string[];
}

// Relevance scoring decides WHICH story to tell, not just which landmark is
// closest. A famous monument 80m away is a better story than a fire station
// 20m away. The score blends how story-worthy a place is, how easy it is to
// point at, whether this listener has already heard it, and — once they have
// rated a few stories — what kind of story they actually like.

// Already-heard penalty. Large enough that a heard place loses to a fresh one
// of comparable interest, but not so large that we skip a genuinely major
// landmark in favour of a filler story.
const HEARD_PENALTY = 120;

// Below this, a place is not worth telling a story about at all.
const MIN_WORTHY_SCORE = 30;

// Historic-registry guardrail (hard cap). A registry candidate's total
// ranked score can never exceed this, no matter how close it is or how
// well it matches the listener's taste. The weakest realistic Tier-1
// landmark scores ~140+ before position bonuses (placesService's
// isTier1Landmark paths start at a 130-point type score plus rating),
// so a 120 ceiling guarantees a designated place can win its
// neighborhood but can never outrank a Tier-1 landmark. The registry
// historicalScore is also bounded at construction (<= 85 in
// historicRegistry.ts), and registry candidates are excluded from
// isTier1Landmark outright — three independent layers, one rule.
const REGISTRY_SCORE_CAP = 120;

// Diversity guard. Even a favourite subject wears thin on the fourth story in
// a row, so a repeat of the same tag is gently pushed down. It is a nudge, not
// a veto — a major landmark still wins on its own merits.
const PRIMARY_TAG_REPEAT_LIMIT = 3;
const PRIMARY_TAG_REPEAT_PENALTY = 30;

function primaryTag(place: NearbyPlace): string | null {
  const tags = deriveTags({ topic: place.name, types: place.types });
  return tags.find(isInterestTag) ?? null;
}

export interface RankOptions {
  // Revisit passes deliberately include landmarks this listener has already
  // heard about — they are coming back for a different angle, not a repeat —
  // so the heard penalty would be scoring them for the wrong thing. It is only
  // safe when the caller has already narrowed the list to landmarks that still
  // have something new to say.
  ignoreHeardPenalty?: boolean;
}

// Prominence: how much public attention a place commands, proxied by
// review volume. It is the closest measurable thing to "you can SEE
// this place matters" — a ten-block district with twelve thousand
// reviews is a landmark in the lived sense whatever its category says.
// Tiered so the merely popular don't swamp the genuinely major.
function prominenceBonus(userRatingCount: number | undefined): number {
  if (userRatingCount === undefined) return 0;
  if (userRatingCount >= 10000) return 60;
  if (userRatingCount >= 5000) return 45;
  if (userRatingCount >= 2500) return 35;
  if (userRatingCount >= 1000) return 25;
  if (userRatingCount >= 400) return 18;
  if (userRatingCount >= 150) return 12;
  if (userRatingCount >= 50) return 6;
  return 0;
}

// Physical scale: types whose footprint you can see from the road —
// the place occupies ground, not a storefront. Max one applies; the
// point is that bigness itself is story signal, separate from the
// category interest already inside historicalScore.
const SCALE_TYPE_BONUS: Record<string, number> = {
  airport: 30, amusement_park: 30, stadium: 30, zoo: 30,
  aquarium: 25, university: 20, shopping_mall: 15, neighborhood: 15,
  train_station: 15, transit_station: 10, park: 10, marina: 10,
};

// Minor-subject demotion. A place whose entire claim is a name keyword
// (historicalScore at keyword level), with no public footprint and no
// designation, is the "house on the hill" — tellable when nothing
// better exists, but it must not beat the district it sits in or crowd
// out the neighborhood's own story. Applied as a ranking penalty, not
// an exclusion: with nothing else around, it still clears the floor.
const MINOR_SUBJECT_PENALTY = 40;
const MINOR_KEYWORD_CEILING = 45;

// The whole place outranks its parts. When one candidate's name is
// contained in another's ("Liberty Station" inside "THE LOT Liberty
// Station"), the contained name is the whole — a district, a campus, a
// complex — and the container is a tenant. Until the whole has been
// introduced, telling the tenant first is exactly backwards.
const CONTAINER_BONUS = 50;

export function scorePlace(
  place: NearbyPlace,
  heard: boolean,
  recentPrimaryTags: string[] = [],
  options: RankOptions = {}
): ScoredPlace {
  const reasons: string[] = [];
  const tags = deriveTags({ topic: place.name, types: place.types });

  // Story-worthiness comes straight from the existing historical score
  // (museums 100, parks 50, schools 25, businesses excluded).
  let score = place.historicalScore;
  reasons.push(`interest ${place.historicalScore}`);

  // Prominence and physical scale: first-class inputs (Erik's rule,
  // Oct 25) — a large, much-visited, visually unavoidable place
  // outranks a minor subject even when the minor one is closer.
  const prom = prominenceBonus(place.userRatingCount);
  if (prom > 0) {
    score += prom;
    reasons.push(`prominence +${prom} (${place.userRatingCount} reviews)`);
  }
  let scaleBonus = 0;
  for (const t of place.types) scaleBonus = Math.max(scaleBonus, SCALE_TYPE_BONUS[t] ?? 0);
  if (scaleBonus > 0) {
    score += scaleBonus;
    reasons.push(`scale +${scaleBonus}`);
  }

  // Historic designation folded in from a registry record proven to be
  // this same place (the merge in gemini.ts). Google-tier candidates
  // only — a registry candidate's own score already IS its designation.
  if (place.source !== 'historic_registry' && place.designationBoost) {
    score += place.designationBoost;
    reasons.push(`designated historic +${place.designationBoost}`);
  }

  // Minor-subject demotion (see the constant). Registry candidates are
  // exempt by construction: designation IS significance, and their
  // bounded score already encodes it.
  if (
    place.source !== 'historic_registry' &&
    place.historicalScore <= MINOR_KEYWORD_CEILING &&
    (place.userRatingCount ?? 0) < 100 &&
    !place.designationBoost
  ) {
    score -= MINOR_SUBJECT_PENALTY;
    reasons.push(`minor subject -${MINOR_SUBJECT_PENALTY}`);
  }

  // Proximity: close places are easier to point at, but this is a gentle
  // bonus — it must not let a minor place outrank a major one.
  let proximityBonus: number;
  if (place.distance <= 25) proximityBonus = 40;
  else if (place.distance <= 50) proximityBonus = 28;
  else if (place.distance <= 100) proximityBonus = 16;
  else if (place.distance <= 250) proximityBonus = 8;
  else proximityBonus = 2;
  score += proximityBonus;
  reasons.push(`proximity +${proximityBonus}`);

  // Directional framing: "dead ahead" is the easiest to narrate to someone
  // in motion; "directly behind you" is the hardest and least useful. When
  // walking, phone heading is often unavailable (phone in pocket), so the
  // bearing falls back to compass directions. Map those onto the same bonus
  // scale by comparing the compass bearing to the listener's travel direction
  // inferred from recent movement — but when we only have a raw compass
  // bearing and no heading, treat "ahead" bearings (N/NE/E etc. relative to
  // forward travel) generously rather than defaulting to a flat +8. A
  // walking tour loses too much directional framing otherwise.
  const directionBonus: Record<string, number> = {
    'dead ahead': 20,
    'ahead to your right': 16,
    'ahead to your left': 16,
    'to your right': 10,
    'to your left': 10,
    'behind to your right': 2,
    'behind to your left': 2,
    'directly behind you': 0,
    // Compass fallbacks (used when heading is null — typically walking). A
    // landmark in the forward half of the compass still gets a real bonus.
    'north': 12, 'northeast': 12, 'east': 10, 'southeast': 10,
    'south': 6, 'southwest': 6, 'west': 10, 'northwest': 12,
  };
  const dirBonus = directionBonus[place.direction] ?? 8;
  score += dirBonus;
  reasons.push(`direction ${place.direction} +${dirBonus}`);

  // A place with a strong rating is more likely to be a real, notable place.
  if (place.rating !== undefined) {
    const ratingBonus = Math.round((place.rating - 3.5) * 12);
    if (ratingBonus > 0) {
      score += ratingBonus;
      reasons.push(`rating +${ratingBonus}`);
    }
  }

  // What this listener has liked before, applied to the kind of story this
  // place would produce. Zero when nothing here has ever been rated, so an
  // unrated library scores exactly as it did before taste existed.
  const tasteBoost = tasteProfile.boostFor(tags);
  if (tasteBoost !== 0) {
    score += tasteBoost;
    reasons.push(`taste ${tasteBoost > 0 ? '+' : ''}${tasteBoost}`);
  }

  // Diversity guard: the third story in a row about the same kind of thing
  // starts to feel like a rut.
  const tag = primaryTag(place);
  if (tag && recentPrimaryTags.filter(t => t === tag).length >= PRIMARY_TAG_REPEAT_LIMIT) {
    score -= PRIMARY_TAG_REPEAT_PENALTY;
    reasons.push(`variety (${tag} x3) -${PRIMARY_TAG_REPEAT_PENALTY}`);
  }

  // Never re-tell a story this listener has already heard.
  if (heard && !options.ignoreHeardPenalty) {
    score -= HEARD_PENALTY;
    reasons.push(`already heard -${HEARD_PENALTY}`);
  }

  // Registry ceiling, applied last so no combination of proximity,
  // direction or taste bonuses can lift a designated place past it.
  if (place.source === 'historic_registry' && score > REGISTRY_SCORE_CAP) {
    score = REGISTRY_SCORE_CAP;
    reasons.push(`registry cap ${REGISTRY_SCORE_CAP}`);
  }

  return { place, score, reasons };
}

// Ranks every candidate and returns them best-first.
export function rankPlaces(
  places: NearbyPlace[],
  recentPrimaryTags: string[] = [],
  options: RankOptions = {}
): ScoredPlace[] {
  const scored = places.map(place =>
    scorePlace(place, heardStories.hasHeardSubject(place.name), recentPrimaryTags, options)
  );

  // Container rule: needs the whole candidate set, so it runs here
  // rather than in scorePlace. A candidate whose normalized name is
  // contained in another candidate's name is the whole place; it earns
  // the bonus once, however many tenants surround it. The registry
  // ceiling is re-applied afterwards so the cap stays absolute.
  const normalized = places.map(p => normalizePlaceName(p.name));
  scored.forEach((entry, i) => {
    const self = normalized[i];
    if (self.length < 8) return;
    const hasTenant = normalized.some((other, j) => j !== i && other.length > self.length && other.includes(self));
    if (!hasTenant) return;
    entry.score += CONTAINER_BONUS;
    entry.reasons.push(`whole place +${CONTAINER_BONUS}`);
    if (entry.place.source === 'historic_registry' && entry.score > REGISTRY_SCORE_CAP) {
      entry.score = REGISTRY_SCORE_CAP;
      entry.reasons.push(`registry cap ${REGISTRY_SCORE_CAP}`);
    }
  });

  return scored.sort((a, b) => b.score - a.score);
}

// The single best subject to tell a story about right now, or null if nothing
// nearby is worth a story. recentPrimaryTags is the run of subject kinds Leo
// has just covered, used to keep him off the same theme story after story.
export function pickStorySubject(
  places: NearbyPlace[],
  recentPrimaryTags: string[] = [],
  options: RankOptions = {}
): StorySubject | null {
  const ranked = rankPlaces(places, recentPrimaryTags, options);
  if (ranked.length === 0) return null;

  const best = ranked[0];
  if (best.score < MIN_WORTHY_SCORE) {
    console.log('[Relevance] Nothing nearby worth a story (best score', best.score, ')');
    return null;
  }

  console.log(
    '[Relevance] Chose',
    best.place.name,
    `(score ${best.score}: ${best.reasons.join(', ')})`
  );

  return {
    name: best.place.name,
    distance: best.place.distance,
    direction: best.place.direction,
    types: best.place.types,
  };
}
