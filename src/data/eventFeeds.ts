// The events-feed source list (v16.2 events feed v1, Nov 18,
// 2026) — CONFIG, NOT CODE: adding or retiring a source is an
// edit here, never a change to the provider (eventsFeed.ts).
//
// Erik's ruling (Nov 18, 2026): the feed runs on FREE sources
// that need NO signup and NO API key of his — published
// calendar feeds (iCal/.ics) and deliberately published
// structured event data only. The Ticketmaster decision is
// his, later, and untouched by this list. No HTML scraping of
// event pages, ever (the Eventbrite lesson); KPBS is excluded
// by his standing fact-source-only rule.
//
// A source earns its place here ONLY by verification: the
// feed was actually fetched during the Nov 18, 2026 survey
// and returned parseable events with real start times and
// venue/location data. The survey's full record — verified,
// verified-but-excluded, and surveyed-with-no-verifiable-feed
// sources — lives in the eventsFeed.ts header and the build
// report (events-feed-report-2026-11-18.md).

export interface EventFeedConfig {
  /** Stable id: snapshot + cache keys hang off it. */
  id: string;
  /** The sourceName stamped on every event this feed yields. */
  sourceName: string;
  /** The published feed URL, fetched as-is. */
  url: string;
  /**
   * Zone floating times are read in and all-day (DATE) starts
   * land in, when the feed itself does not name one.
   */
  defaultZone: string;
  /** How long a fetched snapshot serves before a refetch. */
  refreshMs: number;
  /** What this source covers — the survey's note, for the next editor. */
  coverage: string;
}

const HOUR_MS = 60 * 60 * 1000;

export const EVENT_FEEDS: EventFeedConfig[] = [
  {
    id: 'balboa-park',
    sourceName: 'Balboa Park',
    url: 'https://balboapark.org/events/?ical=1',
    defaultZone: 'America/Los_Angeles',
    // The feed itself declares a 1 h publish TTL; 3 h is the
    // middle course — 16× fresher than the 48 h gate needs.
    refreshMs: 3 * HOUR_MS,
    coverage:
      'Park-wide (The Events Calendar on WordPress): the 17 Balboa Park museums and venues — The Nat, Fleet Science Center, San Diego Museum of Art, Mingei, Museum of Us, Old Globe, Japanese Friendship Garden — concerts, films, exhibitions, festivals. LOCATION carries full street addresses (no GEO), so venues resolve through the geocode cache. Many entries are long-running exhibitions.',
  },
  {
    id: 'uc-san-diego',
    sourceName: 'UC San Diego Events Calendar',
    url: 'https://calendar.ucsd.edu/calendar.ics',
    defaultZone: 'America/Los_Angeles',
    refreshMs: 3 * HOUR_MS,
    coverage:
      'Campus-wide (Localist): lectures, performances (La Jolla Playhouse / Epstein Amphitheater), athletics, exhibits, student life across the La Jolla campus. Most events carry GEO coordinates in-feed; LOCATION is a building name. The feed is the WHOLE calendar (megabytes) — fetched whole, filtered on-device.',
  },
];
