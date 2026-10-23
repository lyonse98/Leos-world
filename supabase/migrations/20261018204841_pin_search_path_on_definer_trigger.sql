/*
  # Pin the search path on the story-location trigger and take it off the API

  set_tour_story_location runs as its owner and had no fixed search_path, so
  the names it resolves (ST_SetSRID, ST_MakePoint) could be captured. It is a
  trigger helper and was never meant to be called directly, so EXECUTE is
  removed from the client roles as well. Trigger execution is unaffected.
*/

CREATE OR REPLACE FUNCTION public.set_tour_story_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_tour_story_location() FROM anon, authenticated, public;
