/*
  # Make the coordinate-system reference table read-only for clients

  spatial_ref_sys is PostGIS-owned, exposed through the Data API, and cannot
  have row level security enabled on it. It had write privileges for anon and
  authenticated, so any visitor could insert or delete projection definitions
  and corrupt every distance calculation the app makes. Reads stay: PostGIS
  needs them. Writes are removed.
*/

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.spatial_ref_sys FROM anon, authenticated;
