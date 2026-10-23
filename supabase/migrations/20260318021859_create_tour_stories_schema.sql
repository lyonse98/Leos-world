/*
  # Tour Stories and Landmarks Schema

  1. New Tables
    - `landmarks`
      - `id` (uuid, primary key) - Unique identifier
      - `name` (text) - Name of the landmark
      - `location` (geography) - Geographic point for the landmark
      - `lat` (numeric) - Latitude for easy access
      - `lng` (numeric) - Longitude for easy access
      - `story` (text) - The story/narration about this landmark
      - `radius_meters` (integer) - How close user needs to be to trigger (default 100m)
      - `created_at` (timestamptz) - When this was created
    
    - `tour_sessions`
      - `id` (uuid, primary key) - Unique identifier
      - `user_id` (uuid) - Reference to auth.users
      - `start_location` (geography) - Where tour started
      - `destination_location` (geography) - Where heading to
      - `destination_name` (text) - Name of destination
      - `route_polyline` (text) - Encoded polyline of the route
      - `started_at` (timestamptz) - When tour started
      - `ended_at` (timestamptz) - When tour ended (nullable)
    
    - `story_queue`
      - `id` (uuid, primary key) - Unique identifier
      - `tour_session_id` (uuid) - Which tour this belongs to
      - `landmark_id` (uuid) - Which landmark this is for
      - `distance_along_route` (numeric) - How far along route this landmark is
      - `has_been_told` (boolean) - Whether this story has been narrated yet
      - `told_at` (timestamptz) - When it was told (nullable)
      - `created_at` (timestamptz) - When queued
  
  2. Security
    - Enable RLS on all tables
    - Users can only access their own tour sessions and story queues
    - Landmarks are publicly readable but only insertable by authenticated users
  
  3. Indexes
    - Geographic index on landmarks for proximity queries
    - Index on tour_session_id for story queue lookups
*/

-- Enable PostGIS extension for geography type
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create landmarks table
CREATE TABLE IF NOT EXISTS landmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location geography(POINT, 4326) NOT NULL,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  story text NOT NULL,
  radius_meters integer DEFAULT 100,
  created_at timestamptz DEFAULT now()
);

-- Create tour_sessions table
CREATE TABLE IF NOT EXISTS tour_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  start_location geography(POINT, 4326),
  destination_location geography(POINT, 4326),
  destination_name text,
  route_polyline text,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz
);

-- Create story_queue table
CREATE TABLE IF NOT EXISTS story_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_session_id uuid REFERENCES tour_sessions(id) ON DELETE CASCADE NOT NULL,
  landmark_id uuid REFERENCES landmarks(id) ON DELETE CASCADE NOT NULL,
  distance_along_route numeric NOT NULL,
  has_been_told boolean DEFAULT false,
  told_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS landmarks_location_idx ON landmarks USING GIST(location);
CREATE INDEX IF NOT EXISTS story_queue_session_idx ON story_queue(tour_session_id);
CREATE INDEX IF NOT EXISTS story_queue_told_idx ON story_queue(has_been_told) WHERE has_been_told = false;

-- Enable RLS
ALTER TABLE landmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tour_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_queue ENABLE ROW LEVEL SECURITY;

-- Landmarks policies: Anyone can read, authenticated users can insert
CREATE POLICY "Anyone can view landmarks"
  ON landmarks FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create landmarks"
  ON landmarks FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Tour sessions policies: Users can only access their own sessions
CREATE POLICY "Users can view own tour sessions"
  ON tour_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tour sessions"
  ON tour_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tour sessions"
  ON tour_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Story queue policies: Users can only access queues for their own sessions
CREATE POLICY "Users can view own story queues"
  ON story_queue FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create story queue entries"
  ON story_queue FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own story queue entries"
  ON story_queue FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = auth.uid()
    )
  );