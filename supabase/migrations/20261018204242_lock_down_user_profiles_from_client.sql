/*
  # Lock user_profiles away from the browser

  The table carries subscription_tier, stripe_customer_id and ad_free_until.
  Its three policies were all `true` for the anon role, so anyone could read
  every Stripe customer id and grant themselves a paid tier.

  The application never reads or writes this table, so removing client access
  changes no behaviour. It becomes server-only until a real auth model exists.
*/

DROP POLICY IF EXISTS "anon_select_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "anon_insert_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "anon_update_user_profiles" ON public.user_profiles;

REVOKE ALL ON public.user_profiles FROM anon, authenticated;
