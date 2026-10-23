# Leo's World — Technical Blueprint

## Overview
A React + TypeScript + Vite single-page app that delivers location-aware, AI-generated audio tour narration. The browser talks directly to Google Gemini (story generation), Google Maps Places/Geocoder (landmark + area context), and Supabase (story cache, analytics, ad campaigns). No backend server — all logic runs client-side; Supabase Postgres serves as the shared data layer.

## Tech Stack
- **Framework:** React 18 + TypeScript + Vite 5
- **Styling:** Tailwind CSS 3, lucide-react icons
- **AI:** `@google/generative-ai` (Gemini 2.5 Flash)
- **Maps:** `@googlemaps/js-api-loader` (Places + Geocoder)
- **Database:** Supabase (`@supabase/supabase-js`) — Postgres + RLS
- **Voice:** Web Speech API — `SpeechSynthesis` (TTS) + `SpeechRecognition` (STT for Q&A)
- **Geolocation:** `navigator.geolocation.watchPosition` with a custom median-of-3 + low-pass filter

## Architecture

### Entry Point
`src/main.tsx` → `src/App.tsx` — a single-screen app with two states: pre-tour (start screen) and on-tour (narration UI + controls). No router.

### Core Loop
1. `useGeolocation` hook watches GPS, filters fixes, infers movement mode (walking/driving/stationary with hysteresis), and fires an interval callback scaled to speed.
2. The interval callback (`handleIntervalUpdate` in App.tsx) calls `storyCache.tryGetStoryForPosition`.
3. `storyCache` checks the in-memory cache for a nearby unplayed story; if found, returns it. If online and no cache hit, calls `geminiService.getTourNarration`. If offline, queues the position in a "missed queue" for catch-up.
4. `geminiService.getTourNarration` fetches landmarks (`placesService.getNearbyLandmarks`) and area info (`placesService.getAreaInfo`) in parallel, asks `locationTracker.shouldTellNewStory` whether a story is warranted (and what context/depth), checks the DB via `storyLookup.findNearbyStory` (a Supabase RPC) for a previously-cached story, and if none, calls Gemini with a context-aware prompt.
5. The returned story is queued in `useVoice`'s story queue, which plays it via `SpeechSynthesis` one utterance at a time. A watchdog handles the browser's known bug where `onend` doesn't fire.
6. When the queue empties, an `onStoryComplete` callback fires, which fetches the next story (with a speed-scaled cooldown to avoid API hammering).
7. A background prefetch loop fetches stories for the current position every 30s when the cache is under capacity and Leo isn't speaking.
8. A separate observation loop fills dead air with local template lines (no API cost) after jittered silence gaps (45-60s walking, 90-120s driving).

### Key Modules

#### `src/services/gemini.ts` — GeminiService
- **Model:** `gemini-2.5-flash`
- **Rate limiting:** min 3s between requests, single in-flight request slot, retry with exponential backoff on 429/quota errors.
- **Request tokens:** `issueRequestToken` / `cancelAllRequests` / `currentRequestToken` — a monotonic counter so stale streaming responses are dropped (e.g., when the user hits skip or the mic mid-stream).
- **Three prompt modes:** `getTourNarration` (live, streaming), `prefetchStory` (background, non-streaming), `answerQuestion` (Q&A, streaming with context injection).
- **Prompt construction:** A large `leoPersona` system block (character, narrative style, hunt priorities, humor, voice, transition variety, location naming, no distance math, length rules, pronunciation). Three location-type branches: rural (no landmarks/city), has-landmarks, no-landmarks. Each branch injects: transition prompt (context-dependent), previous story text, recent story texts (last 8), all told topics, depth level + cycle, speed-adaptive length rules, and driving corridor rules.
- **Story-connection philosophy:** Fresh story is the priority. Previous stories are context for an optional one-line callback in the delivery — never the subject. Pivoting freely is the default, not the exception. Prevents collapse into the first story as a throughline.
- **`generateBridge`:** A separate Gemini call that produces a short transition sentence between two stories (used for cached-story insertion).
- **`answerQuestion`:** Injects the last spoken sentences and nearby landmark names as context, streams the answer.

#### `src/services/locationTracker.ts` — LocationTracker
- **State:** last location, last story topic + text, told-stories Set, recent story texts (max 8), session ID, movement mode.
- **`shouldTellNewStory`:** The decision engine. Returns `{ shouldTell, context, depthLevel, depthCycle }`. Triggers a new story if: the user moved beyond a movement-scaled threshold (500m driving, 10m walking), new landmarks appeared, or a stationary timer elapsed (30s driving, 12s walking). When stationary, cycles through 12 depth contexts (landmark → neighborhood → region → people → culture → streets → architecture → nature → transport → demographics → geology → folklore), then loops with an incremented cycle counter for fresh angles.
- **Persistence:** Recent stories and told topics persist to `localStorage`; told topics also hydrate from the `tour_stories` Supabase table (last 1 hour) on init.
- **`updateLastStoryTopic`:** Saves the story to in-memory state, localStorage, and inserts a row into `tour_stories` (for future cache lookups by other sessions).

#### `src/services/storyCache.ts` — StoryCacheService
- **In-memory cache:** Max 20 unplayed stories, 100m match threshold. `findNearestUnplayedCache` returns the closest unplayed story within threshold; falls back to any unplayed story if offline.
- **Missed queue:** When offline and no cache hit, positions are queued (10-min TTL). On reconnect, `processMissedQueue` fetches stories for each queued position and adds them to the cache.
- **Prefetch:** `prefetchForPosition` fetches a background story if: online, not already prefetching, cache under capacity, 10s since last fetch, and >50m from last prefetch position.
- **Callbacks:** Notifies the UI on cache changes, missed-queue changes, and network status changes.

#### `src/services/storyLookup.ts` — StoryLookupService
- Calls the Supabase RPC `find_nearby_cached_story(p_lat, p_lng, p_radius_m)` — returns a previously-saved story within radius. Allows cross-session story reuse so the same location doesn't re-call Gemini.

#### `src/services/placesService.ts` — PlacesService
- **`getNearbyLandmarks`:** Google Places `nearbySearch`. Uses GPS accuracy to clamp search radius. When driving, offsets the search position 80m ahead based on heading so stories are about approaching landmarks. Progressive radius expansion (50 → 250 → 500 → 1000 → 1500m) for sparse suburbs. 30s TTL cache.
- **`calculateHistoricalScore`:** Scores places by type (high-value: museums, landmarks, churches, etc.; medium: parks, neighborhoods; suburban: schools, fire stations). Excludes generic businesses unless they have civic types. Name-based blacklist/allowlist with word-boundary regex.
- **`directionFromTo`:** Computes relative direction (dead ahead, to your right, behind you) using heading-aware bearing, or compass direction if no heading.
- **`getAreaInfo`:** Google Geocoder reverse-geocodes to neighborhood, city, district, street. 5-min TTL cache.

#### `src/hooks/useVoice.ts` — useVoice
- **Story queue:** Stories queue and play sequentially; a new story waits if one is playing. `queueStoryWithTransition` prepends a transition line.
- **Streaming:** `speakStream` accumulates chunks, splits on sentence boundaries, and feeds a sentence queue to `SpeechSynthesis` one utterance at a time.
- **Watchdog:** Detects when `SpeechSynthesis` stops speaking but `onend` didn't fire (a known browser bug) and force-advances the queue.
- **Voice selection:** Prefers male English voices (Google US English, Alex, Daniel, etc.); pitch 0.95, rate 0.95.
- **Mute/skip/cancel:** `muteForMinutes` drops all queued stories; `skipCurrent` flushes the queue and fires the on-complete callback; `stop` full reset.
- **Context tracking:** `recordSpokenText` / `getLastSpokenSentences` keeps the last 2 spoken sentences for Q&A context injection.

#### `src/hooks/useGeolocation.ts` — useGeolocation + GpsFilter
- **GpsFilter:** Rejects fixes >85mph or >150m accuracy. Median-of-3 smoothing + low-pass blend (α=0.45). Snaps on large jumps (>100m) instead of smoothing.
- **Movement inference:** `inferMode` uses GPS speed if available, else derives speed from distance/time between fixes. Delegates to `resolveMovementMode` (hysteresis: enter driving >6.0 m/s, exit below 4.5 m/s; walking ≥1.4 m/s).
- **Interval triggers:** Fires the callback every 10s (walking), 45s (driving), 30s (stationary).

#### `src/hooks/useSpeechRecognition.ts`
- Press-and-hold mic: starts listening on press, stops on release. Transcript triggers `handleUserQuestion` in App.tsx.

#### `src/hooks/useWakeLock.ts`
- Requests the Screen Wake Lock API while the tour is active so the phone doesn't sleep.

#### `src/services/intros.ts`
- Rotating intro lines (fresh vs. resume) with no-repeat tracking via localStorage.

#### `src/services/observations.ts`
- Local template pool (no API cost) for filling dead air: time-of-day lines, street/neighborhood templates, generic moving/stationary fillers, and bridge lines referencing the last topic. No-repeat window of 12.

#### `src/services/adManager.ts` — AdManagerService
- Inserts an ad every 4 stories (free tier only). Queries `ad_campaigns` for active campaigns, filters by speed mode and impression cap, increments impressions, logs to `ad_impressions`. No-op until campaigns exist in the DB.

#### `src/services/subscriptions.ts` — SubscriptionService
- Tiers: free (ads), premium (ad-free), pro (ad-free). Currently hardcoded to free; `setTier` exists for future auth integration.

#### `src/services/analytics.ts` — AnalyticsService
- Fire-and-forget event queue (story_played, session_start, ad_played, question_asked). Flushes to `analytics_events` every 15s. Re-queues on failure.

#### `src/utils/geo.ts`
- `calculateDistance`: Haversine. `resolveMovementMode`: hysteresis-band classifier. `MovementModeHysteresis` type.

### Database (Supabase Postgres)
Tables (across migrations):
- **`tour_stories`** — session_id, topic, lat, lng, story_text, context, depth_level, created_at. RPC `find_nearby_cached_story` for proximity lookup. RLS enabled.
- **`user_profiles`** — links to auth.users, subscription_tier, stripe_customer_id, ad_free_until. Scaffolding for future auth.
- **`analytics_events`** — session_id, event_type, event_data (jsonb), lat, lng, movement_mode, created_at. Indexed on session, type, created_at.
- **`ad_campaigns`** — advertiser_name, ad_text, cta_text, targeting (region, speed_mode), impression caps, active flag, scheduling. Indexed on active.
- **`ad_impressions`** — campaign_id, session_id, lat, lng, played_at. Indexed on campaign, session.

All tables have RLS enabled with `anon, authenticated` policies (no-auth app — to be tightened when auth is added).

### App.tsx Orchestration
- **Tour lifecycle:** `handleStartTour` initializes Gemini, voice, story cache, ad manager, subscriptions, location tracker, observations; starts GPS; speaks intro. `handleEndTour` cancels everything and resets.
- **Resume:** `localStorage` flag with 30-min TTL; on reopen, offers resume vs. fresh start.
- **Story flow:** `handleIntervalUpdate` → `storyCache.tryGetStoryForPosition` → queue + analytics + ad check + prefetch trigger. Transition lines are prepended for cached stories that don't already start with a transition phrase (regex match).
- **Queue-empty handler:** `onStoryComplete` callback fetches the next story with a speed-scaled cooldown (30s driving, 8s walking). Offline + empty cache → filler line with 45s throttle.
- **Observation loop:** 15s interval checks for silence gaps; fires a local template after jittered threshold.
- **Catch-up:** On reconnect with a non-empty missed queue, plays all unplayed cached stories with an intro.
- **Q&A:** Mic press cancels all in-flight requests + voice, starts listening. Transcript triggers `handleUserQuestion` → `geminiService.answerQuestion` with streaming + context.

### Environment
- `VITE_GEMINI_API_KEY` — Google Gemini API key
- `VITE_GOOGLE_MAPS_API_KEY` — Google Maps JS API key
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` — pre-populated

### Build
- `npm run build` — Vite production build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint

## Key Design Decisions
1. **No backend server** — all orchestration is client-side; Supabase is the only shared state. Keeps infrastructure minimal.
2. **Streaming + queuing** — Gemini streams chunks; the voice hook splits on sentence boundaries and plays as a queue so narration starts fast and stays smooth.
3. **Request tokens** — a monotonic counter prevents stale AI responses from playing after a skip/mute/question.
4. **Fresh-story-first prompt philosophy** — the prompt prioritizes the most interesting new story over connecting to previous ones; connections are optional delivery seasoning, preventing topic collapse.
5. **Depth cycling** — 12 contextual angles at a stationary spot prevent repetition without requiring movement.
6. **Prefetch + offline cache + missed queue** — three layers of resilience against signal loss on the road.
7. **GPS filtering** — median-of-3 + low-pass + accuracy/speed rejection prevents jitter from triggering false story events.
8. **Movement hysteresis** — stop-and-go traffic doesn't flap the mode between walking and driving.
9. **Monetization scaffolding** — ads, subscriptions, and analytics are wired but dormant; activating them is a data + auth change, not a rebuild.
