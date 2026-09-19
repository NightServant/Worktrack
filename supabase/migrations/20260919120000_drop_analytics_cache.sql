-- analytics_cache and its upsert helper are gone.
--
-- Nothing ever wrote to them. The table was created for an
-- `analytics-cache-proxy` edge function that was deleted undeployed on
-- 2026-09-17 -- it recomputed every metric a second time in Deno, against a
-- shape the charts had already moved past, and its read path had no expiry, so
-- the first payload it stored would have been served forever. The charts are
-- computed fresh on each visit and always have been.
--
-- What it left behind was worse than nothing: a table with RLS enabled and no
-- policies (the database linter's `rls_enabled_no_policy`), an index that has
-- never been scanned, a `SECURITY INVOKER` function callable by anon, a row in
-- the Row type in src/types/database.ts, and a line on the PUBLIC PRIVACY PAGE
-- promising users a table that holds "nothing today". A privacy policy should
-- not have to explain an empty table nobody can fill.
--
-- Restoring it is `git show 20260822132836` if an analytics cache is ever
-- wanted -- and the shape it should have is not this one.
DROP FUNCTION IF EXISTS public.upsert_analytics_cache(uuid, text, jsonb);
DROP TABLE IF EXISTS public.analytics_cache;
