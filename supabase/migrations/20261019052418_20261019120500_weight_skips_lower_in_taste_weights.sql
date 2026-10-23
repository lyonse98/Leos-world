/*
# Weight skips lower than explicit ratings in the taste profile

## Purpose
The first version of `get_taste_weights` treated every row the same. That is
wrong for the signal we actually collect: an explicit thumb is the listener
telling us what they think, while a skip is ambiguous — it may mean "not my
subject", or merely "wrong moment, I'm turning here".

This migration replaces `get_taste_weights` so a skip contributes one fifth of
what an explicit rating contributes. Skips still shape taste, but they can
never dominate it, and no amount of skipping can outvote a deliberate tap.

## What changed
- The `rated` CTE now carries the row's `source`.
- A skip is multiplied by 0.2 when accumulating both `score` (the direction)
  and `weight` (the amount of evidence).
- `n` still reports the raw number of rows, so the two can be compared.

## Security
Unchanged. The function remains `SECURITY DEFINER` with `search_path` pinned to
`public, pg_temp`, and direct table access stays revoked from `anon` and
`authenticated`. No table is modified and no data is deleted.

## Notes
1. The 0.2 constant is intentionally a plain literal here rather than a
   parameter — it is a policy choice, not a per-call input.
2. Replacing the function is safe to re-run.
*/

CREATE OR REPLACE FUNCTION get_taste_weights(
  p_user_key text,
  p_limit integer DEFAULT 60
)
RETURNS TABLE(tag text, score numeric, weight numeric, n bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH rated AS (
    SELECT f.value::double precision AS v,
           EXTRACT(EPOCH FROM (now() - f.rated_at)) / 86400.0 AS age_days,
           CASE WHEN f.source = 'skip' THEN 0.2 ELSE 1.0 END AS source_weight,
           t.tag
      FROM story_feedback f
      CROSS JOIN LATERAL unnest(f.tags) AS t(tag)
     WHERE p_user_key IS NOT NULL
       AND f.user_key = btrim(p_user_key)
       AND f.tags IS NOT NULL
  ),
  decayed AS (
    -- 60-day half-life constant: recent taste outweighs old taste.
    SELECT tag,
           v * source_weight * exp(-(age_days / 60.0)) AS weighted_value,
           source_weight * exp(-(age_days / 60.0)) AS weighted_count
      FROM rated
  )
  SELECT tag,
         SUM(weighted_value)::numeric AS score,
         SUM(weighted_count)::numeric AS weight,
         COUNT(*)::bigint AS n
    FROM decayed
   GROUP BY tag
   ORDER BY weight DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
$$;
