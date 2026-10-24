import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIGURED = Boolean(supabaseUrl && supabaseAnonKey);

if (!SUPABASE_CONFIGURED) {
  console.error(
    '[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. ' +
    'The app will load but database features (stories, heard history, taste profile) will not work.'
  );
}

export const supabase = createClient(
  SUPABASE_CONFIGURED ? supabaseUrl : 'https://placeholder.supabase.co',
  SUPABASE_CONFIGURED ? supabaseAnonKey : 'placeholder-key'
);

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
