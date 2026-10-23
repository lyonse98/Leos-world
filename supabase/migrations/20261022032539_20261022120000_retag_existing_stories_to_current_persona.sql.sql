/*
# Retag existing cached stories to current persona version

## Purpose
When the persona version changes (e.g. leo-v2 → leo-v6), the `find_nearby_cached_story`
function filters by `version_key` and returns nothing for old stories — they become
invisible to new listeners even though the stories are still perfectly usable.

This migration retags all existing `tour_stories` rows so their `version_key`
starts with the current persona version prefix (`leo-v6`). The fact-pack hash
portion of the key is preserved where it exists; stories with a null version_key
get a plain `leo-v6` tag so they are findable by version-agnostic lookups.

## Changes
1. UPDATE `tour_stories` SET `version_key` = replace the persona prefix
   while keeping the model and hash portions intact.
2. Stories with NULL version_key get `leo-v6` (no model/hash — these predate
   the version key system and are served by version-agnostic lookups).

## Safety
- No schema changes, no drops, no column type changes.
- Pure data update — reversible by running the same pattern with a different prefix.
- RLS and policies are not affected.
*/

-- Retag stories that have an old persona version prefix (leo-v2, leo-v3, etc.)
-- but preserve the model and fact-pack hash portions of the key.
UPDATE tour_stories
SET version_key = 'leo-v6' || SUBSTRING(version_key FROM POSITION('|' IN version_key))
WHERE version_key IS NOT NULL
  AND version_key NOT LIKE 'leo-v6|%';

-- Retag stories with a NULL version_key so they are at least findable.
UPDATE tour_stories
SET version_key = 'leo-v6'
WHERE version_key IS NULL;
