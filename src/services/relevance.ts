import { NearbyPlace } from './placesService';
import { heardStories } from './heardStories';
import { tasteProfile } from './tasteProfile';
import { deriveTags, isInterestTag } from './storyTags';

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

  return { place, score, reasons };
}

// Ranks every candidate and returns them best-first.
export function rankPlaces(
  places: NearbyPlace[],
  recentPrimaryTags: string[] = [],
  options: RankOptions = {}
): ScoredPlace[] {
  return places
    .map(place => scorePlace(place, heardStories.hasHeard(place.name), recentPrimaryTags, options))
    .sort((a, b) => b.score - a.score);
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
