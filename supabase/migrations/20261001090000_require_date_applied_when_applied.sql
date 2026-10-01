-- =============================================================================
-- An `applied` application has a date applied (Gabe, 2026-10-01: "enforce the
-- applied date everywhere, database too").
--
-- The dialogs, the CSV importer and jobService all refuse an applied row with
-- no date. This is the rule they share, stated where no client can skip it.
--
-- BACKFILL FIRST, so the constraint can be added to a database that already
-- holds such rows. Production had none on 2026-10-01; a self-hosted copy may.
-- The date chosen is the best evidence the row has: the day its status
-- history first recorded `applied`, else the day the row was created. Both
-- are UTC days, which is what a backfill can know.
-- =============================================================================

UPDATE public.jobs AS j
SET date_applied = COALESCE(
  (
    SELECT min(h.changed_at)::date
    FROM public.job_status_history AS h
    WHERE h.job_id = j.id AND h.to_status = 'applied'
  ),
  j.created_at::date
)
WHERE j.status = 'applied' AND j.date_applied IS NULL;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_applied_requires_date;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_applied_requires_date
  CHECK (status <> 'applied' OR date_applied IS NOT NULL);

COMMENT ON CONSTRAINT jobs_applied_requires_date ON public.jobs IS
  'An application whose status is applied must carry the date it was sent.';
