-- 006 revoked EXECUTE from anon and authenticated, but Postgres grants EXECUTE on new
-- functions to the PUBLIC role by default, and anon/authenticated inherit it from there.
-- The advisor still flagged both functions afterwards. Revoke at the source.
--
-- Neither function is meant to be called over /rest/v1/rpc/:
--   handle_new_user()          — invoked only by the on_auth_user_created trigger
--   is_project_owner(uuid)     — unused by current RLS policies and app code
-- Both are SECURITY DEFINER, so they execute as owner; the trigger path is unaffected.

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.is_project_owner(uuid) from public;
