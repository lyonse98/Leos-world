/*
  # Close direct client access to ad_impressions

  SELECT and DELETE were both `USING true`, so anyone could download the
  advertiser delivery log (campaign, session, coordinates, timestamp) and
  then erase it.

  Impression rows are still written, but only through record_ad_impression(),
  added in the next migration, which writes them with definer rights. Nothing
  in the browser needs to read, update or delete them.
*/

DROP POLICY IF EXISTS "anon_select_ad_impressions" ON public.ad_impressions;
DROP POLICY IF EXISTS "anon_delete_ad_impressions" ON public.ad_impressions;
DROP POLICY IF EXISTS "anon_insert_ad_impressions" ON public.ad_impressions;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.ad_impressions FROM anon, authenticated;
