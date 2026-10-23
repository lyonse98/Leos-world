/*
  # Stop the browser writing ad campaigns

  INSERT, UPDATE and DELETE were all `true` for the anon role. Anyone could
  create an active campaign whose ad_text is read back by every listener and
  spoken aloud through their device, or delete the owner's real campaigns.

  The client only needs to READ the currently active campaign. The impression
  counter it used to write moves to record_ad_impression() in a later
  migration, so UPDATE is not needed either.

  The SELECT policy is also narrowed: a campaign is only visible while it is
  active and inside its date window, which is what the client checked locally
  anyway, so no behaviour changes.
*/

DROP POLICY IF EXISTS "anon_insert_ad_campaigns" ON public.ad_campaigns;
DROP POLICY IF EXISTS "anon_update_ad_campaigns" ON public.ad_campaigns;
DROP POLICY IF EXISTS "anon_delete_ad_campaigns" ON public.ad_campaigns;
DROP POLICY IF EXISTS "anon_select_ad_campaigns" ON public.ad_campaigns;

CREATE POLICY "read_active_ad_campaigns"
  ON public.ad_campaigns
  FOR SELECT
  TO anon, authenticated
  USING (
    active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.ad_campaigns FROM anon, authenticated;
