// The manifest (route differentiator 3, Erik, Nov 3, 2026):
// before the drive starts, the listener sees the episode card —
// like a podcast episode page before pressing play. Everything
// on the card is read off the REAL final plan (post-composer,
// post-gap-fill): the counts are the plan's own story items,
// the closing story is the plan's actual last story, the
// runtime is the Routes drive estimate. No estimates are
// presented as facts, and nothing here touches the network —
// the harness proves the builder offline.

import { haversineM, type GeoPoint, type LibraryUnit, type RoutePlan } from './routeMode';

/**
 * Human-readable episode titles for the routeTags topic
 * vocabulary. A topic with no entry falls back to its raw tag —
 * the card never invents a fancier name than the data has.
 */
export const THREAD_TITLES: Record<string, string> = {
  'Boom & Bust': 'Boom & Bust',
  Coast: 'The Coast',
  'Navy Century': 'The Navy Century',
  'Food & Drink': 'Food & Drink',
  Sport: 'Sport',
  Film: 'Film',
  'Border / CaliBaja': 'The Border',
  'Deep Time': 'Deep Time',
  Music: 'Music',
  Flight: 'Flight',
  'San Diego River': 'The San Diego River',
  Water: 'Water',
  Highway: 'The Highway',
  folklore: 'Ghosts & Folklore',
  Faith: 'Faith',
  Desert: 'The Desert',
  'Fire & Fault': 'Fire & Fault',
  Rail: 'The Railroad',
  'Mission Chain': 'The Mission Chain',
  Surf: 'Surf',
  'The Cure': 'The Cure',
  'Expositions & the Canal': 'Expositions & the Canal',
};

export function threadTitle(topic: string): string {
  return THREAD_TITLES[topic] ?? topic;
}

export interface RouteManifest {
  /** "<Thread title>: <Origin> to <Destination>", or "<Origin> to <Destination>" with no thread. */
  title: string;
  /** "About N minutes of driving" — the Routes estimate, in words. */
  runtimeLine: string;
  /** Story items in the final plan (fillers never count). */
  storyCount: number;
  /** Of those, the ones whose place the listener has never heard in any telling. */
  newCount: number;
  /** The actual final story item's place name — what the episode ends with. */
  closingStoryName: string | null;
  /** The thread line for the card, when the plan has a thread. */
  threadLine: string | null;
}

/** The ride estimate in plain words, minus rideEstimateLine's tail clause (the card carries its own lines). */
export function driveTimeLine(durationSec: number): string {
  const mins = Math.max(1, Math.round(durationSec / 60));
  if (mins < 60) return `About ${mins} minute${mins === 1 ? '' : 's'} of driving`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const span =
    m === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'}`;
  return `About ${span} of driving`;
}

export function buildManifest(
  plan: RoutePlan,
  heardPlaceKeys: Set<string>,
  opts: { originName: string },
): RouteManifest {
  const stories = plan.items.filter(it => it.kind === 'story' && it.unit);
  const newCount = stories.filter(it => !heardPlaceKeys.has((it.unit as LibraryUnit).placeKey)).length;
  const closing = stories[stories.length - 1];
  const thread = plan.thread ?? null;
  return {
    title: thread
      ? `${threadTitle(thread.topic)}: ${opts.originName} to ${plan.destinationName}`
      : `${opts.originName} to ${plan.destinationName}`,
    runtimeLine: driveTimeLine(plan.driveSec ?? plan.budgetSec),
    storyCount: stories.length,
    newCount,
    closingStoryName: closing ? (closing.unit as LibraryUnit).placeName : null,
    // The thread line is the card's framing text, so a
    // thread-carried episode is framed as one (Nov 4,
    // 2026): the road is quiet today and the drive follows
    // the thread — the same honest sentence the spoken
    // preview opens with, never a member placed on the
    // route.
    threadLine: thread
      ? plan.threadCarried?.active
        ? `The road's quiet today — this drive follows one thread: ${threadTitle(thread.topic)}`
        : `One thread all the way — ${threadTitle(thread.topic)}`
      : null,
  };
}

/**
 * The origin area's name for the title: the fetched unit
 * nearest the departure point (the departure ground names the
 * start of the episode). Beyond 3 km the nearest fetched unit
 * is not the origin's ground in any honest sense — the
 * caller's fallback (the plan's first story) names it instead.
 */
export function originAreaName(units: LibraryUnit[], origin: GeoPoint, fallback: string): string {
  let best: LibraryUnit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of units) {
    const d = haversineM({ lat: u.lat, lng: u.lng }, origin);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best !== null && bestD <= 3000 ? best.placeName : fallback;
}
