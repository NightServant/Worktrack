-- Every `auth.uid() = user_id` policy becomes `(select auth.uid()) = user_id`.
--
-- THE FIX IS A SUBQUERY AND THE REASON IS THE PLANNER. Written bare,
-- `auth.uid()` is a volatile-looking call in a per-row filter, so Postgres
-- re-evaluates it for EVERY ROW the policy tests -- the same answer, computed
-- again, once per row, on every select, insert, update and delete against
-- every user table. Wrapped in a scalar subquery it becomes an InitPlan:
-- evaluated once per statement and used as a constant. This is the database
-- linter's `auth_rls_initplan` (0003), which named all forty of these.
--
-- ALTER POLICY, NOT DROP AND RECREATE. The expressions are the only thing
-- changing; the names, the commands, the roles and the permissive/restrictive
-- split all stay. Dropping would open a window -- brief, but a window during
-- which a table has one fewer policy -- and would risk restoring a policy
-- subtly different from the one that was there. The statements below were
-- GENERATED from pg_policies rather than typed, because forty near-identical
-- lines is exactly where a hand-copied `user_id` goes wrong once.
--
-- BEHAVIOUR IS UNCHANGED. `auth.uid()` is stable within a statement, so one
-- evaluation and N identical evaluations cannot disagree. Nobody gains or
-- loses access; the same rows match.
--
-- NOT DONE HERE, and worth its own decision: the `demo_block_*` RESTRICTIVE
-- policies call `is_demo()` per row, which is a SECURITY DEFINER function that
-- reads a table -- a more expensive per-row call than `auth.uid()`. The linter
-- does not flag it (it only knows `auth.<function>()` and `current_setting()`),
-- and the same `(select ...)` wrap would fix it.
ALTER POLICY "Users can delete own activity" ON public.activity_log USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own activity" ON public.activity_log WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own activity" ON public.activity_log USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own activity" ON public.activity_log USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own application contacts" ON public.application_contacts USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own application contacts" ON public.application_contacts WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own application contacts" ON public.application_contacts USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own application documents" ON public.application_documents USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own application documents" ON public.application_documents WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own application documents" ON public.application_documents USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own application documents" ON public.application_documents USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own contacts" ON public.contacts USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own contacts" ON public.contacts WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own contacts" ON public.contacts USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own contacts" ON public.contacts USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own events" ON public.events USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own events" ON public.events WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own events" ON public.events USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own events" ON public.events USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own job status history" ON public.job_status_history USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own job status history" ON public.job_status_history WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own job status history" ON public.job_status_history USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own jobs" ON public.jobs USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own jobs" ON public.jobs WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own jobs" ON public.jobs USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own jobs" ON public.jobs USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own resume snapshots" ON public.resume_snapshots USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own resume snapshots" ON public.resume_snapshots WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own resume snapshots" ON public.resume_snapshots USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own resumes" ON public.resumes USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own resumes" ON public.resumes WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own resumes" ON public.resumes USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own resumes" ON public.resumes USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own preferences" ON public.user_preferences WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own preferences" ON public.user_preferences USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own preferences" ON public.user_preferences USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own profile" ON public.user_profiles USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own profile" ON public.user_profiles WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own profile" ON public.user_profiles USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own profile" ON public.user_profiles USING ((select auth.uid()) = user_id);
