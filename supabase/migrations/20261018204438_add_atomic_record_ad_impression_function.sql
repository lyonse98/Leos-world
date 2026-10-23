/*
  # Make the impression cap atomic and server-enforced

  The browser used to read current_impressions, compare it to max_impressions
  itself, then write back the value plus one. Two devices playing an ad at the
  same moment both read N and both wrote N+1, so the cap leaked deliveries, and
  a crafted request could write any number at all.

  This replaces both client writes with one statement. The cap lives in the
  WHERE clause, so the increment only happens when there is headroom, and the
  impression row is only written when the increment actually claimed a slot.
  Returns true when the ad may be played.
*/

CREATE OR REPLACE FUNCTION public.record_ad_impression(
  p_campaign_id uuid,
  p_session_id text,
  p_lat numeric,
  p_lng numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed boolean := false;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN false;
  END IF;

  -- Atomic claim: the cap is part of the predicate, so concurrent callers
  -- cannot both pass it.
  UPDATE ad_campaigns
     SET current_impressions = current_impressions + 1
   WHERE id = p_campaign_id
     AND active = true
     AND (starts_at IS NULL OR starts_at <= now())
     AND (ends_at IS NULL OR ends_at >= now())
     AND (max_impressions <= 0 OR current_impressions < max_impressions)
  RETURNING true INTO claimed;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO ad_impressions (campaign_id, session_id, lat, lng)
  VALUES (
    p_campaign_id,
    COALESCE(NULLIF(left(p_session_id, 200), ''), 'unknown'),
    p_lat,
    p_lng
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ad_impression(uuid, text, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.record_ad_impression(uuid, text, numeric, numeric) TO anon, authenticated;
