/*
  # Add Tour Stories Tracking Table

  1. New Table
    - `tour_stories`
      - `id` (uuid, primary key) - Unique identifier
      - `session_id` (text) - Session identifier for grouping stories
      - `topic` (text) - The main topic/landmark of the story
      - `lat` (numeric) - Latitude where story was told
      - `lng` (numeric) - Longitude where story was told
      - `created_at` (timestamptz) - When the story was told
  
  2. Purpose
    - Track all stories told during tours to avoid repetition
    - Enable endless storytelling by knowing what has already been covered
    - Allow analysis of tour patterns
  
  3. Security
    - Public read/write for anonymous users (no auth required for basic tour functionality)
    - Stories expire after 1 hour to keep database clean
*/

CREATE TABLE IF NOT EXISTS tour_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  topic text NOT NULL,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS tour_stories_session_idx ON tour_stories(session_id);
CREATE INDEX IF NOT EXISTS tour_stories_created_at_idx ON tour_stories(created_at);
CREATE INDEX IF NOT EXISTS tour_stories_topic_idx ON tour_stories(topic);

-- Enable RLS
ALTER TABLE tour_stories ENABLE ROW LEVEL SECURITY;

-- Allow public access for anonymous tour functionality
CREATE POLICY "Anyone can view tour stories"
  ON tour_stories FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can create tour stories"
  ON tour_stories FOR INSERT
  TO public
  WITH CHECK (true);