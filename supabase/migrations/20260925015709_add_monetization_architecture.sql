/*
# Add Monetization Architecture (Scaffolding)

This migration creates the database foundation for future monetization features:
user subscription tiers, analytics tracking, ad campaigns, and ad impressions.
No existing tables are modified. All new tables use anon+authenticated RLS so the
current no-auth app can read/write, with policies that can be tightened later
when authentication is added.

## New Tables

### user_profiles
- Extends auth.users with subscription tier and monetization metadata.
- `id` (uuid, PK, references auth.users) — links to Supabase auth
- `subscription_tier` (text, default 'free') — 'free', 'premium', 'pro'
- `stripe_customer_id` (text, nullable) — for future Stripe integration
- `ad_free_until` (timestamptz, nullable) — grace period for ad-free
- `created_at`, `updated_at` (timestamps)

### analytics_events
- Tracks user engagement: story plays, session starts/stops, location data.
- `id` (uuid, PK)
- `session_id` (text) — matches the existing tour session_id pattern
- `user_id` (uuid, nullable, references auth.users) — null for anonymous users
- `event_type` (text) — 'story_played', 'session_start', 'session_end', 'ad_played', etc.
- `event_data` (jsonb) — flexible payload for event-specific data
- `lat`, `lng` (numeric, nullable) — location of the event
- `movement_mode` (text, nullable) — 'walking', 'driving', 'stationary'
- `created_at` (timestamptz)

### ad_campaigns
- Stores advertiser campaigns with targeting rules.
- `id` (uuid, PK)
- `advertiser_name` (text, not null)
- `ad_text` (text, not null) — the spoken ad content
- `cta_text` (text, nullable) — call-to-action line
- `target_region` (text, nullable) — geographic targeting (e.g. 'US-West', 'NYC')
- `target_speed_mode` (text, nullable) — 'driving', 'walking', 'stationary', null = all
- `max_impressions` (integer, default 0) — 0 = unlimited
- `current_impressions` (integer, default 0)
- `active` (boolean, default true)
- `starts_at` (timestamptz, nullable)
- `ends_at` (timestamptz, nullable)
- `created_at`, `updated_at` (timestamps)

### ad_impressions
- Records each time an ad was played for a user.
- `id` (uuid, PK)
- `campaign_id` (uuid, references ad_campaigns ON DELETE CASCADE)
- `session_id` (text, not null)
- `user_id` (uuid, nullable, references auth.users)
- `lat`, `lng` (numeric, nullable)
- `played_at` (timestamptz, default now())

## Security
- RLS enabled on all new tables.
- All policies use `TO anon, authenticated` since the app has no sign-in screen yet.
- When auth is added later, tighten policies to `TO authenticated` with ownership checks.
- ad_campaigns: SELECT is public (app needs to read active ads), INSERT/UPDATE/DELETE
  are also open for now but should be restricted to admin role when auth is added.

## Important Notes
1. These tables are scaffolding — no app code reads from them yet except the new
   service files (adManager, analytics, subscriptions) which are designed as no-ops
   until the features are activated.
2. The ad insertion point is wired into the story queue as a no-op: it checks for
   active ads, finds none, and continues. When campaigns are added to the table,
   ads will automatically be inserted between stories.
3. Analytics events are fire-and-forget — the service writes them but the app
   continues regardless of success/failure.
4. user_profiles will be populated automatically when auth is added (via a trigger
   or the sign-up flow). Until then it stays empty.
*/

-- user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_tier text NOT NULL DEFAULT 'free',
  stripe_customer_id text,
  ad_free_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_user_profiles" ON user_profiles;
CREATE POLICY "anon_select_user_profiles" ON user_profiles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_user_profiles" ON user_profiles;
CREATE POLICY "anon_insert_user_profiles" ON user_profiles FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_user_profiles" ON user_profiles;
CREATE POLICY "anon_update_user_profiles" ON user_profiles FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- analytics_events
CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}'::jsonb,
  lat numeric,
  lng numeric,
  movement_mode text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_analytics_events" ON analytics_events;
CREATE POLICY "anon_select_analytics_events" ON analytics_events FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_analytics_events" ON analytics_events;
CREATE POLICY "anon_insert_analytics_events" ON analytics_events FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_analytics_events" ON analytics_events;
CREATE POLICY "anon_update_analytics_events" ON analytics_events FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);

-- ad_campaigns
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_name text NOT NULL,
  ad_text text NOT NULL,
  cta_text text,
  target_region text,
  target_speed_mode text,
  max_impressions integer NOT NULL DEFAULT 0,
  current_impressions integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ad_campaigns" ON ad_campaigns;
CREATE POLICY "anon_select_ad_campaigns" ON ad_campaigns FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ad_campaigns" ON ad_campaigns;
CREATE POLICY "anon_insert_ad_campaigns" ON ad_campaigns FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_ad_campaigns" ON ad_campaigns;
CREATE POLICY "anon_update_ad_campaigns" ON ad_campaigns FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_ad_campaigns" ON ad_campaigns;
CREATE POLICY "anon_delete_ad_campaigns" ON ad_campaigns FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_active ON ad_campaigns(active) WHERE active = true;

-- ad_impressions
CREATE TABLE IF NOT EXISTS ad_impressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lat numeric,
  lng numeric,
  played_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ad_impressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ad_impressions" ON ad_impressions;
CREATE POLICY "anon_select_ad_impressions" ON ad_impressions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ad_impressions" ON ad_impressions;
CREATE POLICY "anon_insert_ad_impressions" ON ad_impressions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_ad_impressions" ON ad_impressions;
CREATE POLICY "anon_delete_ad_impressions" ON ad_impressions FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ad_impressions_campaign ON ad_impressions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_session ON ad_impressions(session_id);
