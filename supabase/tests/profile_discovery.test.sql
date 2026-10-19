begin;

select extensions.plan(14);

select extensions.has_table('public', 'user_profile_actions', 'like/pass history table exists');
select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.user_profile_actions'::regclass),
  'like/pass history has RLS enabled'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.user_profile_actions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.user_profile_actions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.user_profile_actions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.user_profile_actions', 'DELETE'),
  'users cannot directly create or alter like/pass history'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.record_profile_action(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.record_profile_action(uuid,text,text)', 'EXECUTE'),
  'authenticated users can save actions only through the guarded RPC'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.record_profile_action(uuid,text,text)'::regprocedure) like '%auth.uid()%'
    and pg_catalog.pg_get_functiondef('public.record_profile_action(uuid,text,text)'::regprocedure)
      like '%public.is_account_active()%',
  'saved actions use the authenticated actor and require an active account'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.discover_profiles()'::regprocedure)
    like '%public.user_profile_actions%'
    and pg_catalog.pg_get_functiondef('public.discover_profiles()'::regprocedure)
      like '%public.user_blocks%',
  'discovery excludes acted-on profiles and blocked users'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.discover_profiles()'::regprocedure) like '%public.user_photos%',
  'discovery selects photo paths from Supabase photo metadata'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.my_received_like_count()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.my_received_like_count()', 'EXECUTE'),
  'like summaries are only exposed to authenticated users'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.my_received_like_count()'::regprocedure) like '%auth.uid()%',
  'received-like count is scoped to the authenticated user'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.set_primary_profile_photo(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_primary_profile_photo(uuid)', 'EXECUTE'),
  'only authenticated users can select their primary photo'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.set_primary_profile_photo(uuid)'::regprocedure)
    like '%user_id = current_user_id%',
  'primary photo updates are restricted to the owning user'
);
select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'users read profile photos for visible members'
  ),
  'photo reads require discovery eligibility'
);
select extensions.ok(
  not (select public from storage.buckets where id = 'profile-photos'),
  'profile photos remain in a private bucket'
);
select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.user_profile_actions'::regclass
      and conname = 'user_profile_actions_unique_pair'
  ),
  'each user has one saved action per target profile'
);

select * from extensions.finish();
rollback;
