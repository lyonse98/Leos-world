import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Landmark {
  id: string;
  name: string;
  lat: number;
  lng: number;
  story: string;
  radius_meters: number;
}

export interface TourSession {
  id: string;
  user_id: string;
  start_location: string;
  destination_location: string;
  destination_name: string;
  route_polyline: string;
  started_at: string;
  ended_at?: string;
}

export interface StoryQueueItem {
  id: string;
  tour_session_id: string;
  landmark_id: string;
  distance_along_route: number;
  has_been_told: boolean;
  told_at?: string;
  landmark?: Landmark;
}
