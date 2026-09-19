-- Cover the four foreign keys that had no index.
--
-- WHY A FOREIGN KEY WANTS AN INDEX ON THE CHILD SIDE: the constraint is checked
-- from the PARENT. Deleting a row from `auth.users` or `resumes` makes Postgres
-- find every child row pointing at it, and without an index that is a full scan
-- of the child table per deleted parent row. Three of these four cascade
-- (`ON DELETE CASCADE`) and the fourth nulls out (`ON DELETE SET NULL`), so the
-- scan is not hypothetical -- `delete_own_account()` walks all of them.
--
-- The database linter's `unindexed_foreign_keys` (0001) named exactly these.
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id
  ON public.activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_application_contacts_user_id
  ON public.application_contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_application_documents_resume_id
  ON public.application_documents (resume_id);
CREATE INDEX IF NOT EXISTS idx_application_documents_snapshot_id
  ON public.application_documents (snapshot_id);

-- THE OTHER HALF OF THAT ADVISORY -- six "unused" indexes -- IS DELIBERATELY
-- NOT ACTED ON, and this is the record of why.
--
-- `unused_index` reads pg_stat_user_indexes, which counts SCANS. The largest
-- table in this database holds 65 rows (jobs), and below a few thousand rows
-- the planner correctly prefers a sequential scan to any index -- so a zero
-- scan count here measures the size of the dataset, not the worth of the index.
-- `idx_jobs_status`, `idx_jobs_date_applied`, `idx_jobs_company_lower`,
-- `idx_job_status_history_changed_at` and `idx_resumes_sections` each match a
-- filter or sort the app actually issues, and dropping them would mean
-- recreating them the week the data grows enough to need them.
--
-- The sixth, `analytics_cache_updated_at_idx`, IS gone -- with its table, in
-- 20260919120000. That one was unused because nothing ever wrote to it.
