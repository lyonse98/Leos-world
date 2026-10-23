/*
  # Fix Security and Performance Issues

  ## Changes Made
  
  1. **Foreign Key Indexes**
     - Add index on `story_queue.landmark_id` for foreign key performance
     - Add index on `tour_sessions.user_id` for foreign key performance
  
  2. **RLS Performance Optimization**
     - Update all RLS policies to use `(select auth.uid())` instead of `auth.uid()`
     - This prevents re-evaluation of auth function for each row
  
  3. **Unused Indexes**
     - Drop unused indexes that are not being utilized
  
  4. **RLS Policy Fixes**
     - Remove overly permissive landmark insert policy
     - Restrict landmark creation to only allow proper validation
  
  ## Notes
  - spatial_ref_sys is a PostGIS system table and cannot be modified
  - postgis extension in public schema is acceptable for this use case
*/

-- Add missing foreign key indexes for performance
CREATE INDEX IF NOT EXISTS story_queue_landmark_id_idx ON story_queue(landmark_id);
CREATE INDEX IF NOT EXISTS tour_sessions_user_id_idx ON tour_sessions(user_id);

-- Drop unused indexes to reduce overhead
DROP INDEX IF EXISTS landmarks_location_idx;
DROP INDEX IF EXISTS story_queue_session_idx;
DROP INDEX IF EXISTS story_queue_told_idx;

-- Drop existing RLS policies to recreate them with optimized auth calls
DROP POLICY IF EXISTS "Users can view own tour sessions" ON tour_sessions;
DROP POLICY IF EXISTS "Users can create own tour sessions" ON tour_sessions;
DROP POLICY IF EXISTS "Users can update own tour sessions" ON tour_sessions;
DROP POLICY IF EXISTS "Users can view own story queues" ON story_queue;
DROP POLICY IF EXISTS "Users can create story queue entries" ON story_queue;
DROP POLICY IF EXISTS "Users can update own story queue entries" ON story_queue;
DROP POLICY IF EXISTS "Authenticated users can create landmarks" ON landmarks;

-- Recreate tour_sessions policies with optimized auth.uid() calls
CREATE POLICY "Users can view own tour sessions"
  ON tour_sessions FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Users can create own tour sessions"
  ON tour_sessions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users can update own tour sessions"
  ON tour_sessions FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- Recreate story_queue policies with optimized auth.uid() calls
CREATE POLICY "Users can view own story queues"
  ON story_queue FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can create story queue entries"
  ON story_queue FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can update own story queue entries"
  ON story_queue FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tour_sessions
      WHERE tour_sessions.id = story_queue.tour_session_id
      AND tour_sessions.user_id = (select auth.uid())
    )
  );

-- Create restrictive landmark insert policy
-- Only allow authenticated users to insert landmarks with valid data
CREATE POLICY "Authenticated users can create landmarks"
  ON landmarks FOR INSERT
  TO authenticated
  WITH CHECK (
    name IS NOT NULL 
    AND name != '' 
    AND story IS NOT NULL 
    AND story != ''
    AND lat IS NOT NULL 
    AND lng IS NOT NULL
    AND radius_meters > 0
  );
