-- `is_demo()` stops being callable by signed-out visitors.
--
-- It is `SECURITY DEFINER` and it was executable by PUBLIC and by `anon`, which
-- means anyone on the internet could call it over `/rest/v1/rpc/is_demo`. The
-- database linter flags that (`anon_security_definer_function_executable`,
-- 0028) and it is right to: a definer function runs as its owner, so its
-- reachability is the whole of its access control.
--
-- What it actually leaks is small -- whether the CALLER is one of the demo
-- accounts, which for a signed-out caller is always false -- but "small" is an
-- argument for revoking it, not for keeping it: nothing signed-out has ever
-- needed the answer.
--
-- `authenticated` KEEPS IT, AND MUST. Every `demo_block_*` RESTRICTIVE policy
-- on every user table is `(NOT is_demo())`, and a policy expression runs with
-- the privileges of the querying role. Revoke it from `authenticated` and every
-- write in the app fails with "permission denied for function is_demo" -- the
-- demo guard would take the whole product down with it. `service_role` keeps it
-- for the same reason: it is what the seed script runs as.
--
-- The two remaining findings on that advisory are intentional and stay:
--   * `is_demo()` by `authenticated` -- the line above.
--   * `delete_own_account()` by `authenticated` -- that IS the feature. It was
--     already revoked from anon in 20260828093000, and its ACL confirms no
--     PUBLIC grant. A signed-in user deleting their own account is the entire
--     purpose of the function, and it derives the account from auth.uid()
--     rather than from an argument, so there is nothing to point at anyone else.
REVOKE EXECUTE ON FUNCTION public.is_demo() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_demo() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_demo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_demo() TO service_role;
