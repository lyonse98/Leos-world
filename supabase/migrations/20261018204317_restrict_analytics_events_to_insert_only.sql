/*
  # Make analytics_events write-only from the browser

  The SELECT policy was `USING true`, so anyone could download the GPS trail
  of every listener. The UPDATE policy was `USING true` with `WITH CHECK true`,
  so anyone could rewrite any recorded event.

  The client only ever inserts (src/services/analytics.ts calls .insert(rows)
  and nothing else), so INSERT is kept and everything else is removed.
*/

DROP POLICY IF EXISTS "anon_select_analytics_events" ON public.analytics_events;
DROP POLICY IF EXISTS "anon_update_analytics_events" ON public.analytics_events;

REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.analytics_events FROM anon, authenticated;
