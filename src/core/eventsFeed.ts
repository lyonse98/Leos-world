// ============================================================
// THE EVENTS FEED — published calendar feeds (iCal/.ics),
// implemented behind the EventsFeedProvider seam Slice 2 left
// empty (v16.2 events feed v1, Nov 18, 2026).
//
// ERIK'S RULING (Nov 18, 2026): FREE sources only, nothing
// that needs his signup or an API key of his. The vehicle is
// published calendar feeds — the .ics a venue or institution
// deliberately publishes for calendar software to consume —
// never scraped event pages (Eventbrite-style scraping is
// prohibited and out of scope). The Ticketmaster decision is
// his, later, untouched: when he makes it, that provider
// slots behind the same seam this one fills.
//
// THE SOURCE SURVEY (Nov 18, 2026; each candidate was
// actually fetched — a source counts only if the fetch
// returned parseable events with real start times and
// venue/location data):
//
//   IN THE CONFIG (src/data/eventFeeds.ts):
//   • Balboa Park — balboapark.org/events/?ical=1 (The Events
//     Calendar on WordPress). Park-wide: 17 museums/venues.
//     TZID times + all-day DATE spans; LOCATION carries full
//     street addresses (no GEO). Declared publish TTL 1 h.
//   • UC San Diego — calendar.ucsd.edu/calendar.ics
//     (Localist). Campus-wide; GEO coordinates on most
//     events; LOCATION is a building name. The whole-calendar
//     feed is megabytes — fetched whole, filtered on-device.
//
//   VERIFIED AS A FEED, EXCLUDED ON CONTENT:
//   • UC San Diego Health (Trumba) — a real, working feed,
//     but its events are patient support groups, clinical
//     classes and maternity tours, much of it virtual: not
//     suggestion material for a drive companion.
//
//   SURVEYED, NO VERIFIABLE FEED (excluded, revisit if they
//   publish one): SDSU (Omni CMS calendar — its docs describe
//   a per-view iCAL link, no subscribable feed surfaced),
//   San Diego Public Library (migrated platforms; per-event
//   downloads, no feed verified), San Diego County Library
//   (BiblioEvents — rich HTML, per-event downloads only),
//   USD Copley Library (LibCal — JS-rendered, no feed URL
//   verifiable), Mission Trails Regional Park (calendar
//   exists; ?ical=1 returns HTML, not a feed).
//   KPBS: excluded by Erik's standing rule (fact-source
//   only), never surveyed as a feed.
//
// SOURCE FRESHNESS — the design's one judgment call, made
// deliberately: a dated event's sourceAtMs is the SNAPSHOT's
// fetch instant, not the event's DTSTAMP. The freshness
// standard's own wording is "published/last-verified", and
// for a living calendar feed the source re-verifies every
// listing it still carries each time the feed is fetched —
// while per-event DTSTAMPs are authoring stamps (Balboa Park
// exhibitions carry DTSTAMPs months old; Localist stamps
// every event with the export instant). Consequence, exactly
// as designed: a feed that stops answering serves its last
// snapshot with its ORIGINAL fetch time (stale-while-error),
// and once that snapshot is 48 h old assessEvent retires
// every event in it. The feed can never launder staleness.
//
// COORDINATES, in strict order: (1) the event's own GEO
// property; (2) a geocode of the LOCATION text through the
// existing Places stack, charged through the live-spend
// sub-cap (liveSpend.ts) and cached on-device per location
// string, so a museum's address is geocoded once per device,
// ever. An event whose place cannot be resolved is EXCLUDED
// — distance is the product's honesty, and a guess is worse
// than an absence. Venue geocodes are charged at the
// sub-cap's per-ask estimate (a Text Search call bills in
// the same band as the metered Nearby call; the estimate is
// an upper bound, never an undercharge).
//
// RECURRENCE: feeds are full of weekly classes and monthly
// tours, so RRULE is expanded (DAILY/WEEKLY/MONTHLY/YEARLY,
// INTERVAL, COUNT, UNTIL, BYDAY incl. ordinals, BYMONTHDAY,
// BYMONTH), with EXDATE removals and RECURRENCE-ID overrides
// honored. Expansion happens in the event's own wall-clock
// zone, so a 9:30 Saturday tour stays 9:30 across DST.
// Horizon: 14 days out; occurrences that already started are
// left in the output for assessEvent to retire by the same
// rule every source faces.
//
// FAIL-SOFT EVERYWHERE: a dead feed, a malformed calendar, a
// blocked geocode, a full storage — each degrades to fewer
// events or none, never a throw. discoverFeedEvents'
// default stays NO_EVENTS_FEED: no production surface
// consumes feed events yet, so a caller opts in explicitly
// (icalEventsFeed below) rather than the pool changing
// behavior under the shipped app.
// ============================================================

import type { DatedEvent } from './freshness';
import type { EventAnchor, EventsFeedProvider } from './currentEvents';
import { EVENT_FEEDS, type EventFeedConfig } from '../data/eventFeeds';
import {
  createSpendGovernor,
  localSpendLedgerStore,
  type SpendEventSink,
  type SpendLedgerStore,
} from './liveSpend';
import { configuredKeys, MAPS_RETRY_DELAY_MS, type MapsCallOptions } from './routeMode';
import { calculateDistance } from '../utils/geo';

export type { EventFeedConfig };

const HOUR_MS = 60 * 60 * 1000;
/** How far ahead occurrences are expanded. The gate judges the rest. */
const DEFAULT_HORIZON_MS = 14 * 24 * HOUR_MS;
/** New (uncached) venue geocodes allowed per fetchEvents call. */
const DEFAULT_MAX_NEW_GEOCODES = 5;
/** Per-feed in-window occurrence ceiling — a runaway RRULE stops here. */
const MAX_OCCURRENCES_PER_FEED = 500;
/** The provider's answer ceiling, nearest-first by time. */
const MAX_EVENTS_RETURNED = 120;
/** A feed larger than this is not a calendar; it is a mistake. Refused whole. */
const MAX_FEED_CHARS = 12_000_000;
/** Snapshot persistence ceiling; past it the snapshot is memory-only. */
const MAX_SNAPSHOT_CHARS = 1_500_000;

// ------------------------------------------------------------ text plumbing

/** RFC 5545 unfolding: a line beginning with space/tab continues the last. */
function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

const UNESCAPES: Record<string, string> = { n: '\n', N: '\n', ',': ',', ';': ';', '\\': '\\' };

/** RFC 5545 TEXT unescaping (\\, \;, \,, \n), single pass. */
function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, (m, c: string) => UNESCAPES[c] ?? m);
}

interface ICalProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parsePropertyLine(line: string): ICalProperty | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = head.split(';');
  const name = (segments[0] ?? '').trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    params[seg.slice(0, eq).trim().toUpperCase()] = seg.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** The VEVENT property lists of a calendar text; every other component ignored. */
function parseVEvents(text: string): ICalProperty[][] {
  const events: ICalProperty[][] = [];
  let current: ICalProperty[] | null = null;
  let depth = 0;
  for (const line of unfoldLines(text)) {
    const trimmed = line.trim();
    if (/^BEGIN:VEVENT$/i.test(trimmed)) {
      current = [];
      depth = 1;
      continue;
    }
    if (current) {
      if (/^BEGIN:/i.test(trimmed)) {
        depth += 1;
        continue;
      }
      if (/^END:/i.test(trimmed)) {
        depth -= 1;
        if (depth === 0) {
          events.push(current);
          current = null;
        }
        continue;
      }
      if (depth === 1) {
        const prop = parsePropertyLine(line);
        if (prop) current.push(prop);
      }
    }
  }
  return events;
}

function propsNamed(props: ICalProperty[], name: string): ICalProperty[] {
  return props.filter((p) => p.name === name);
}

function firstProp(props: ICalProperty[], name: string): ICalProperty | undefined {
  return props.find((p) => p.name === name);
}

// ------------------------------------------------------------ time

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(zone, f);
  }
  return f;
}

/** The zone's UTC offset (ms) at an instant, via Intl. Unknown zone → 0. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  try {
    const parts = zoneFormatter(zone).formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUtc - Math.floor(utcMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

interface WallTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** A wall-clock time in a named zone → the UTC instant it names. */
export function zonedWallTimeToUtcMs(zone: string, w: WallTime): number {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  let utc = guess - zoneOffsetMs(zone, guess);
  const refined = guess - zoneOffsetMs(zone, utc);
  if (refined !== utc) utc = refined;
  return utc;
}

interface ParsedDateTime {
  ms: number;
  /** The zone the value's wall clock lives in ('UTC' for Z forms). */
  zone: string;
  wall: WallTime;
  allDay: boolean;
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/** One iCal DATE / DATE-TIME value → an instant + its wall reading. */
function parseDateTimeValue(prop: ICalProperty, defaultZone: string): ParsedDateTime | null {
  const value = prop.value.trim();
  const dateMatch = DATE_RE.exec(value);
  if (dateMatch || (prop.params.VALUE ?? '').toUpperCase() === 'DATE') {
    if (!dateMatch) return null;
    const wall = { y: Number(dateMatch[1]), mo: Number(dateMatch[2]), d: Number(dateMatch[3]), h: 0, mi: 0, s: 0 };
    const zone = prop.params.TZID || defaultZone;
    return { ms: zonedWallTimeToUtcMs(zone, wall), zone, wall, allDay: true };
  }
  const m = DATETIME_RE.exec(value);
  if (!m) return null;
  const wall = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]), s: Number(m[6]) };
  if (m[7] === 'Z') {
    return { ms: Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s), zone: 'UTC', wall, allDay: false };
  }
  const zone = prop.params.TZID || defaultZone;
  return { ms: zonedWallTimeToUtcMs(zone, wall), zone, wall, allDay: false };
}

// ------------------------------------------------------------ recurrence

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: ParsedDateTime | null;
  /** Weekday rules: day 0=Sunday..6=Saturday; ord null = every such day. */
  byDay: { ord: number | null; day: number }[];
  byMonthDay: number[];
  byMonth: number[];
}

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(value: string): RRule | null {
  const parts: Record<string, string> = {};
  for (const seg of value.split(';')) {
    const eq = seg.indexOf('=');
    if (eq > 0) parts[seg.slice(0, eq).trim().toUpperCase()] = seg.slice(eq + 1).trim();
  }
  const freq = (parts.FREQ ?? '').toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const interval = Math.max(1, Math.floor(Number(parts.INTERVAL ?? '1')) || 1);
  const countRaw = Number(parts.COUNT ?? '');
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : null;
  let until: ParsedDateTime | null = null;
  if (parts.UNTIL) {
    until = parseDateTimeValue({ name: 'UNTIL', params: {}, value: parts.UNTIL }, 'UTC');
  }
  const byDay: RRule['byDay'] = [];
  if (parts.BYDAY) {
    for (const token of parts.BYDAY.split(',')) {
      const m = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(token.trim().toUpperCase());
      if (!m) continue;
      const day = DAY_CODES[m[2]];
      if (day === undefined) continue;
      byDay.push({ ord: m[1] ? Number(m[1]) : null, day });
    }
  }
  const numList = (raw: string | undefined): number[] =>
    (raw ?? '')
      .split(',')
      .map((t) => Number(t.trim()))
      .filter((n) => Number.isFinite(n) && n !== 0);
  return {
    freq,
    interval,
    count,
    until,
    byDay,
    byMonthDay: numList(parts.BYMONTHDAY),
    byMonth: numList(parts.BYMONTH).filter((n) => n >= 1 && n <= 12),
  };
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function weekdayOf(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function addDays(date: { y: number; mo: number; d: number }, n: number): { y: number; mo: number; d: number } {
  const t = new Date(Date.UTC(date.y, date.mo - 1, date.d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function compareWall(a: WallTime, b: WallTime): number {
  const ka = Date.UTC(a.y, a.mo - 1, a.d, a.h, a.mi, a.s);
  const kb = Date.UTC(b.y, b.mo - 1, b.d, b.h, b.mi, b.s);
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}

/** The days of one month a BYDAY/BYMONTHDAY rule set selects. */
function monthDaysSelected(
  y: number,
  mo: number,
  byDay: RRule['byDay'],
  byMonthDay: number[],
  fallbackDay: number,
): number[] {
  const dim = daysInMonth(y, mo);
  const days = new Set<number>();
  if (byMonthDay.length === 0 && byDay.length === 0) {
    if (fallbackDay >= 1 && fallbackDay <= dim) days.add(fallbackDay);
  }
  for (const md of byMonthDay) {
    const day = md > 0 ? md : dim + md + 1;
    if (day >= 1 && day <= dim) days.add(day);
  }
  for (const rule of byDay) {
    if (rule.ord === null) {
      for (let d = 1; d <= dim; d++) if (weekdayOf(y, mo, d) === rule.day) days.add(d);
    } else if (rule.ord > 0) {
      const firstWeekday = weekdayOf(y, mo, 1);
      const first = 1 + ((rule.day - firstWeekday + 7) % 7);
      const day = first + (rule.ord - 1) * 7;
      if (day <= dim) days.add(day);
    } else {
      const lastWeekday = weekdayOf(y, mo, dim);
      const last = dim - ((lastWeekday - rule.day + 7) % 7);
      const day = last + (rule.ord + 1) * 7;
      if (day >= 1) days.add(day);
    }
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * Expand one master's recurrence into the window, in the
 * master's own wall-clock zone. COUNT is consumed from
 * DTSTART (EXDATE/override removal happens later, per RFC
 * 5545's set construction); occurrences before the window
 * still consume it. Returns UTC instants, ascending.
 */
function expandOccurrences(
  start: ParsedDateTime,
  rrule: RRule | null,
  windowStartMs: number,
  windowEndMs: number,
): number[] {
  if (!rrule) return start.ms >= windowStartMs && start.ms <= windowEndMs ? [start.ms] : [];
  const zone = start.zone;
  const time = { h: start.wall.h, mi: start.wall.mi, s: start.wall.s };
  const out: number[] = [];
  let produced = 0;
  let iterations = 0;

  const untilDate = rrule.until?.allDay ? rrule.until.wall : null;
  const untilMs = rrule.until && !rrule.until.allDay ? rrule.until.ms : null;

  const consider = (date: { y: number; mo: number; d: number }): boolean => {
    // Returns false when generation must stop entirely.
    const wall: WallTime = { ...date, ...time };
    if (compareWall(wall, start.wall) < 0) return true; // before DTSTART: not in the set, not counted
    const ms = zonedWallTimeToUtcMs(zone, wall);
    if (untilMs !== null && ms > untilMs) return false;
    if (untilDate && (date.y > untilDate.y || (date.y === untilDate.y && (date.mo > untilDate.mo || (date.mo === untilDate.mo && date.d > untilDate.d))))) return false;
    produced += 1;
    if (ms >= windowStartMs && ms <= windowEndMs) out.push(ms);
    if (rrule.count !== null && produced >= rrule.count) return false;
    if (ms > windowEndMs + 48 * HOUR_MS) return false; // chronological: safely past the window
    return true;
  };

  const startDate = { y: start.wall.y, mo: start.wall.mo, d: start.wall.d };
  if (rrule.freq === 'DAILY') {
    let date = startDate;
    while (iterations++ < 2000) {
      const monthOk = rrule.byMonth.length === 0 || rrule.byMonth.includes(date.mo);
      const monthDayOk =
        rrule.byMonthDay.length === 0 ||
        rrule.byMonthDay.some((md) => (md > 0 ? md : daysInMonth(date.y, date.mo) + md + 1) === date.d);
      const dayOk = rrule.byDay.length === 0 || rrule.byDay.some((r) => r.day === weekdayOf(date.y, date.mo, date.d));
      if (monthOk && monthDayOk && dayOk) {
        if (!consider(date)) break;
      } else if (zonedWallTimeToUtcMs(zone, { ...date, ...time }) > windowEndMs + 48 * HOUR_MS) {
        break;
      }
      date = addDays(date, rrule.interval);
    }
  } else if (rrule.freq === 'WEEKLY') {
    const wantedDays = rrule.byDay.length > 0 ? [...new Set(rrule.byDay.map((r) => r.day))].sort((a, b) => a - b) : [weekdayOf(startDate.y, startDate.mo, startDate.d)];
    // The Sunday of DTSTART's week; weeks step from there.
    let weekStart = addDays(startDate, -weekdayOf(startDate.y, startDate.mo, startDate.d));
    let stopped = false;
    while (iterations++ < 500 && !stopped) {
      for (const day of wantedDays) {
        const date = addDays(weekStart, day);
        if (rrule.byMonth.length > 0 && !rrule.byMonth.includes(date.mo)) continue;
        if (!consider(date)) {
          stopped = true;
          break;
        }
      }
      weekStart = addDays(weekStart, 7 * rrule.interval);
    }
  } else {
    // MONTHLY / YEARLY share the month-walk; YEARLY filters months.
    let { y, mo } = startDate;
    let yearGuard = 0;
    let stopped = false;
    while (iterations++ < 600 && !stopped) {
      if (rrule.freq === 'YEARLY') {
        if (y > startDate.y && mo === startDate.mo) {
          yearGuard += 1;
          if (yearGuard > 60) break;
        }
        const months = rrule.byMonth.length > 0 ? rrule.byMonth : rrule.byDay.length > 0 || rrule.byMonthDay.length > 0 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [startDate.mo];
        if (!months.includes(mo)) {
          // advance below
        } else {
          for (const d of monthDaysSelected(y, mo, rrule.byDay, rrule.byMonthDay, startDate.d)) {
            if (!consider({ y, mo, d })) {
              stopped = true;
              break;
            }
          }
        }
      } else {
        for (const d of monthDaysSelected(y, mo, rrule.byDay, rrule.byMonthDay, startDate.d)) {
          if (!consider({ y, mo, d })) {
            stopped = true;
            break;
          }
        }
      }
      if (stopped) break;
      // Advance one month (MONTHLY steps by its interval via
      // counting only stepped months; the simple walk below
      // applies the interval by skipping).
      let nextMo = mo + 1;
      let nextY = y;
      if (nextMo > 12) {
        nextMo = 1;
        nextY += 1;
      }
      if (rrule.freq === 'MONTHLY' && rrule.interval > 1) {
        // Skip interval-1 months without generating.
        for (let skip = 1; skip < rrule.interval; skip++) {
          nextMo += 1;
          if (nextMo > 12) {
            nextMo = 1;
            nextY += 1;
          }
        }
      }
      y = nextY;
      mo = nextMo;
      if (zonedWallTimeToUtcMs(zone, { y, mo, d: 1, h: time.h, mi: time.mi, s: time.s }) > windowEndMs + 62 * 24 * HOUR_MS) break;
    }
  }
  return out;
}

// ------------------------------------------------------------ feed → occurrences

/** One occurrence of one feed event, before coordinates are resolved. */
export interface FeedOccurrence {
  title: string;
  startsAtMs: number;
  /** The LOCATION text as published (unescaped), or null. */
  location: string | null;
  /** Coordinates the feed itself stated (GEO), or null. */
  geo: { lat: number; lng: number } | null;
}

function parseGeo(value: string): { lat: number; lng: number } | null {
  const parts = value.split(/[;,]/).map((p) => Number(p.trim()));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function occurrenceFromProps(
  props: ICalProperty[],
): Omit<FeedOccurrence, 'startsAtMs'> | null {
  const summary = firstProp(props, 'SUMMARY');
  const title = summary ? unescapeText(summary.value).trim() : '';
  if (!title) return null;
  const locationProp = firstProp(props, 'LOCATION');
  const location = locationProp ? unescapeText(locationProp.value).trim() || null : null;
  const geoProp = firstProp(props, 'GEO');
  const geo = geoProp ? parseGeo(geoProp.value) : null;
  return { title, location, geo };
}

function isCancelled(props: ICalProperty[]): boolean {
  const status = firstProp(props, 'STATUS');
  return !!status && status.value.trim().toUpperCase() === 'CANCELLED';
}

/** Instants a property family (EXDATE / RDATE) names; values may be comma lists. */
function dateTimeListInstants(props: ICalProperty[], name: string, defaultZone: string): number[] {
  const out: number[] = [];
  for (const prop of propsNamed(props, name)) {
    for (const piece of prop.value.split(',')) {
      const parsed = parseDateTimeValue({ name, params: prop.params, value: piece.trim() }, defaultZone);
      if (parsed) out.push(parsed.ms);
    }
  }
  return out;
}

/**
 * Parse one feed's text into the occurrences that fall in the
 * window: masters expanded, EXDATEs removed, RECURRENCE-ID
 * overrides replacing their master instance (a CANCELLED
 * override removes it outright). Exported for the harness —
 * the provider builds on it.
 */
export function parseFeedOccurrences(
  text: string,
  feed: EventFeedConfig,
  windowStartMs: number,
  windowEndMs: number,
): FeedOccurrence[] {
  if (typeof text !== 'string' || text.length > MAX_FEED_CHARS || !text.includes('BEGIN:VCALENDAR')) return [];
  let vevents: ICalProperty[][];
  try {
    vevents = parseVEvents(text);
  } catch {
    return [];
  }
  const masters: { key: string; props: ICalProperty[] }[] = [];
  const overrides: ICalProperty[][] = [];
  const overriddenInstants = new Map<string, Set<number>>();
  vevents.forEach((props, idx) => {
    const uid = (firstProp(props, 'UID')?.value ?? '').trim();
    const key = uid || `__noid_${idx}`;
    const recurrenceId = firstProp(props, 'RECURRENCE-ID');
    if (recurrenceId) {
      overrides.push(props);
      const parsed = parseDateTimeValue(recurrenceId, feed.defaultZone);
      if (parsed) {
        if (!overriddenInstants.has(key)) overriddenInstants.set(key, new Set());
        overriddenInstants.get(key)!.add(parsed.ms);
      }
    } else {
      masters.push({ key, props });
    }
  });

  const out: FeedOccurrence[] = [];
  const masterByKey = new Map<string, ICalProperty[]>();
  for (const { key, props } of masters) {
    masterByKey.set(key, props);
    if (isCancelled(props)) continue;
    const dtstart = firstProp(props, 'DTSTART');
    if (!dtstart) continue;
    const start = parseDateTimeValue(dtstart, feed.defaultZone);
    if (!start) continue;
    const rruleProp = firstProp(props, 'RRULE');
    const rrule = rruleProp ? parseRRule(rruleProp.value) : null;
    const instants = expandOccurrences(start, rrule, windowStartMs, windowEndMs);
    for (const extra of dateTimeListInstants(props, 'RDATE', feed.defaultZone)) {
      if (extra >= windowStartMs && extra <= windowEndMs) instants.push(extra);
    }
    const exdates = new Set(dateTimeListInstants(props, 'EXDATE', feed.defaultZone));
    const overridden = overriddenInstants.get(key) ?? new Set<number>();
    const base = occurrenceFromProps(props);
    if (!base) continue;
    for (const ms of instants) {
      if (exdates.has(ms) || overridden.has(ms)) continue;
      out.push({ ...base, startsAtMs: ms });
    }
  }
  for (const props of overrides) {
    if (isCancelled(props)) continue; // the master instance is already removed above
    const dtstart = firstProp(props, 'DTSTART');
    if (!dtstart) continue;
    const start = parseDateTimeValue(dtstart, feed.defaultZone);
    if (!start || start.ms < windowStartMs || start.ms > windowEndMs) continue;
    const uid = (firstProp(props, 'UID')?.value ?? '').trim();
    const own = occurrenceFromProps(props);
    const master = uid ? masterByKey.get(uid) : undefined;
    const fallback = master ? occurrenceFromProps(master) : null;
    const merged = own ?? fallback;
    if (!merged) continue;
    out.push({
      title: own?.title ?? merged.title,
      location: own?.location ?? fallback?.location ?? null,
      geo: own?.geo ?? fallback?.geo ?? null,
      startsAtMs: start.ms,
    });
  }
  out.sort((a, b) => a.startsAtMs - b.startsAtMs);
  return out.slice(0, MAX_OCCURRENCES_PER_FEED);
}

// ------------------------------------------------------------ stores

/** A raw-string store seam, the house shape (hours cache, spend ledger). */
export interface FeedKeyValueStore {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

function localStore(key: string): FeedKeyValueStore {
  return {
    read() {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(value: string) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable — caches are an optimization, never a failure */
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const FEED_SNAPSHOT_KEY = 'leo_event_feed_snapshots';
export const localFeedSnapshotStore: FeedKeyValueStore = localStore(FEED_SNAPSHOT_KEY);

interface FeedSnapshot {
  fetchedAtMs: number;
  text: string;
}

interface SnapshotDoc {
  v: 1;
  snapshots: Record<string, FeedSnapshot>;
}

function loadSnapshots(store: FeedKeyValueStore): SnapshotDoc {
  try {
    const raw = store.read();
    if (!raw) return { v: 1, snapshots: {} };
    const doc = JSON.parse(raw) as SnapshotDoc;
    if (doc?.v !== 1 || typeof doc.snapshots !== 'object' || doc.snapshots === null) return { v: 1, snapshots: {} };
    const snapshots: Record<string, FeedSnapshot> = {};
    for (const [id, snap] of Object.entries(doc.snapshots)) {
      if (snap && typeof snap.fetchedAtMs === 'number' && typeof snap.text === 'string') {
        snapshots[id] = { fetchedAtMs: snap.fetchedAtMs, text: snap.text };
      }
    }
    return { v: 1, snapshots };
  } catch {
    return { v: 1, snapshots: {} };
  }
}

function saveSnapshot(store: FeedKeyValueStore, feedId: string, snap: FeedSnapshot): void {
  if (snap.text.length > MAX_SNAPSHOT_CHARS) return; // memory-only; persistence is a bonus
  try {
    const doc = loadSnapshots(store);
    doc.snapshots[feedId] = snap;
    let serialized = JSON.stringify(doc);
    if (serialized.length > MAX_SNAPSHOT_CHARS * 2) {
      // Keep only the freshest snapshot rather than fail the write.
      const freshest = Object.entries(doc.snapshots).sort((a, b) => b[1].fetchedAtMs - a[1].fetchedAtMs)[0];
      serialized = JSON.stringify({ v: 1, snapshots: freshest ? { [freshest[0]]: freshest[1] } : {} });
    }
    store.write(serialized);
  } catch {
    /* fail-soft */
  }
}

// ------------------------------------------------------------ the geocoder

export interface FeedGeocoder {
  /** Synchronous cache read: a venue this device already resolved. */
  lookup(query: string): { lat: number; lng: number } | null;
  /** Resolve (cache, then a governed Places call) or return null. */
  resolve(query: string): Promise<{ lat: number; lng: number } | null>;
}

export const GEOCODE_CACHE_KEY = 'leo_event_geocode_cache';
export const localGeocodeCacheStore: FeedKeyValueStore = localStore(GEOCODE_CACHE_KEY);
const MAX_GEOCODE_ENTRIES = 300;

function normalizeGeocodeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

function loadGeocodeCache(store: FeedKeyValueStore): Record<string, { lat: number; lng: number }> {
  try {
    const raw = store.read();
    if (!raw) return {};
    const doc = JSON.parse(raw) as Record<string, { lat: number; lng: number }>;
    if (typeof doc !== 'object' || doc === null) return {};
    const out: Record<string, { lat: number; lng: number }> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (value && Number.isFinite(value.lat) && Number.isFinite(value.lng)) out[key] = { lat: value.lat, lng: value.lng };
    }
    return out;
  } catch {
    return {};
  }
}

interface PlacesTextSearchResult {
  places?: { location?: { latitude?: number; longitude?: number } }[];
}

/**
 * The bundle's Google keys, collected exactly as discovery
 * collects them (currentEvents.placesKeys): the keys carry
 * DIFFERENT API-restriction lists, so every call walks all
 * of them (routeMode.configuredKeys discipline).
 */
const feedPlacesKeys = (): string[] =>
  configuredKeys(
    [
      import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string | undefined,
      import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
      import.meta.env.VITE_GEMINI_API_KEY as string | undefined,
    ].filter((k): k is string => typeof k === 'string'),
  );

const defaultFetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`places text search ${res.status}`);
  return res.json();
};

/**
 * The shipped geocoder: Places (New) Text Search behind the
 * same key walk + retry discipline as discovery's Nearby
 * calls, charged through the live-spend sub-cap BEFORE
 * dispatch (a blocked ask never leaves the device), cached
 * on-device per location string.
 */
export function createPlacesFeedGeocoder(
  opts: MapsCallOptions & {
    apiKeys?: string[];
    fetchJson?: (url: string, init: RequestInit) => Promise<unknown>;
    spendStore?: SpendLedgerStore;
    onSpendEvent?: SpendEventSink;
    store?: FeedKeyValueStore;
  } = {},
): FeedGeocoder {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spendStore = opts.spendStore ?? localSpendLedgerStore;
  const store = opts.store ?? localGeocodeCacheStore;

  const searchTextPass = async (query: string, keys: string[]): Promise<{ lat: number; lng: number } | null | undefined> => {
    for (const key of keys) {
      try {
        const data = (await fetchJson('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'places.location,places.displayName,places.formattedAddress',
          },
          body: JSON.stringify({
            textQuery: query,
            maxResultCount: 1,
            locationBias: {
              circle: { center: { latitude: 32.85, longitude: -117.16 }, radius: 50000 },
            },
          }),
        })) as PlacesTextSearchResult;
        const loc = data?.places?.[0]?.location;
        if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
          return { lat: loc.latitude as number, lng: loc.longitude as number };
        }
        return null; // an OK answer with no match is definitive for this ask
      } catch {
        /* this key failed — walk to the next */
      }
    }
    return undefined; // every key failed: retryable, not an answer
  };

  return {
    lookup(query: string) {
      return loadGeocodeCache(store)[normalizeGeocodeQuery(query)] ?? null;
    },
    async resolve(query: string) {
      const normalized = normalizeGeocodeQuery(query);
      if (!normalized) return null;
      const cached = loadGeocodeCache(store)[normalized];
      if (cached) return cached;
      const governor = createSpendGovernor({ store: spendStore, nowMs: Date.now(), onEvent: opts.onSpendEvent });
      if (!governor.beginPlacesAsk()) return null; // at the sub-cap: degrade, never overspend
      const keys = opts.apiKeys ?? feedPlacesKeys();
      if (keys.length === 0) return null;
      let coords = await searchTextPass(query, keys);
      if (coords === undefined) {
        await sleep(MAPS_RETRY_DELAY_MS);
        coords = await searchTextPass(query, keys);
      }
      if (!coords) return null;
      try {
        const cache = loadGeocodeCache(store);
        cache[normalized] = coords;
        const entries = Object.entries(cache).slice(-MAX_GEOCODE_ENTRIES);
        store.write(JSON.stringify(Object.fromEntries(entries)));
      } catch {
        /* fail-soft */
      }
      return coords;
    },
  };
}

// ------------------------------------------------------------ the provider

export interface ICalEventsFeedDeps {
  feeds?: EventFeedConfig[];
  /** Feed text fetcher; defaults to global fetch (throws on !ok). */
  fetchText?: (url: string) => Promise<string>;
  snapshotStore?: FeedKeyValueStore | null;
  /** Defaults to the Places geocoder; null disables geocoding (GEO-only). */
  geocoder?: FeedGeocoder | null;
  horizonMs?: number;
  maxNewGeocodes?: number;
}

const defaultFetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`events feed fetch ${res.status}`);
  return res.text();
};

/** The venue name a LOCATION string leads with (its first segment, when it is not itself a street address). */
function venueNameOf(location: string | null): string | null {
  if (!location) return null;
  const first = (location.split(',')[0] ?? '').trim();
  if (!first) return null;
  if (/^\d/.test(first)) return null; // the string leads with a street number: address-only
  return first;
}

function dedupeKey(event: DatedEvent): string {
  const title = event.title.toLowerCase().replace(/\s+/g, ' ').trim();
  const lat = event.lat != null ? event.lat.toFixed(4) : '';
  const lng = event.lng != null ? event.lng.toFixed(4) : '';
  return `${title}|${event.startsAtMs}|${lat},${lng}`;
}

export function createICalEventsFeed(deps: ICalEventsFeedDeps = {}): EventsFeedProvider {
  const feeds = deps.feeds ?? EVENT_FEEDS;
  const fetchText = deps.fetchText ?? defaultFetchText;
  const snapshotStore = deps.snapshotStore === undefined ? localFeedSnapshotStore : deps.snapshotStore;
  const horizonMs = deps.horizonMs ?? DEFAULT_HORIZON_MS;
  const maxNewGeocodes = deps.maxNewGeocodes ?? DEFAULT_MAX_NEW_GEOCODES;
  const memory = new Map<string, FeedSnapshot>();
  let geocoder: FeedGeocoder | null | undefined = deps.geocoder;

  const snapshotFor = async (feed: EventFeedConfig, nowMs: number): Promise<FeedSnapshot | null> => {
    const mem = memory.get(feed.id);
    if (mem && nowMs - mem.fetchedAtMs < feed.refreshMs) return mem;
    const stored = snapshotStore ? loadSnapshots(snapshotStore).snapshots[feed.id] : undefined;
    if (stored && nowMs - stored.fetchedAtMs < feed.refreshMs) {
      memory.set(feed.id, stored);
      return stored;
    }
    try {
      const text = await fetchText(feed.url);
      if (typeof text !== 'string' || text.length > MAX_FEED_CHARS || !text.includes('BEGIN:VCALENDAR')) {
        throw new Error('not a calendar feed');
      }
      const snap = { fetchedAtMs: nowMs, text };
      memory.set(feed.id, snap);
      if (snapshotStore) saveSnapshot(snapshotStore, feed.id, snap);
      return snap;
    } catch {
      // Stale-while-error: the last good snapshot serves with
      // its ORIGINAL fetch time, so the 48 h gate retires its
      // events on schedule if the feed stays down.
      return mem ?? stored ?? null;
    }
  };

  return {
    async fetchEvents(anchor: EventAnchor, radiusM: number, nowMs: number): Promise<DatedEvent[]> {
      if (geocoder === undefined) geocoder = createPlacesFeedGeocoder({});
      const windowEndMs = nowMs + horizonMs;
      const byKey = new Map<string, DatedEvent>();
      let newGeocodes = 0;
      for (const feed of feeds) {
        try {
          const snap = await snapshotFor(feed, nowMs);
          if (!snap) continue;
          const occurrences = parseFeedOccurrences(snap.text, feed, nowMs, windowEndMs);
          for (const occ of occurrences) {
            let coords = occ.geo;
            if (!coords && occ.location && geocoder) {
              coords = geocoder.lookup(occ.location);
              if (!coords && newGeocodes < maxNewGeocodes) {
                newGeocodes += 1;
                coords = await geocoder.resolve(occ.location);
              }
            }
            if (!coords) continue; // unresolvable place: excluded, never guessed
            if (calculateDistance(anchor.lat, anchor.lng, coords.lat, coords.lng) > radiusM) continue;
            const event: DatedEvent = {
              title: occ.title,
              startsAtMs: occ.startsAtMs,
              sourceAtMs: snap.fetchedAtMs,
              sourceName: feed.sourceName,
              venueName: venueNameOf(occ.location),
              address: occ.location,
              lat: coords.lat,
              lng: coords.lng,
            };
            const key = dedupeKey(event);
            if (!byKey.has(key)) byKey.set(key, event);
          }
        } catch {
          /* one feed's failure never costs the others */
        }
      }
      return [...byKey.values()].sort((a, b) => a.startsAtMs - b.startsAtMs).slice(0, MAX_EVENTS_RETURNED);
    },
  };
}

/**
 * The shipped provider over the configured feeds
 * (src/data/eventFeeds.ts). discoverFeedEvents' default stays
 * NO_EVENTS_FEED — a caller opts into this explicitly until a
 * production surface consumes feed events.
 */
export const icalEventsFeed: EventsFeedProvider = createICalEventsFeed();
