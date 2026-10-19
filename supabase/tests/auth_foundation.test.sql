begin;

select extensions.plan(11);

select extensions.has_table('public', 'profiles', 'public profile table exists');
select extensions.has_table('public', 'user_preferences', 'preference table exists');
select extensions.has_table('private', 'user_private_data', 'private birth-date table exists');
select extensions.ok(
  (
    select pg_catalog.bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname = any (array[
      'profiles', 'user_preferences', 'user_photos', 'user_settings', 'user_blocks', 'user_reports'
    ]))
       or (n.nspname = 'private' and c.relname = 'user_private_data')
  ),
  'RLS is enabled on every application table'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated users can read profiles through owner RLS'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous users cannot read profiles'
);
select extensions.ok(
  not has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed', 'UPDATE'),
  'users cannot set their own onboarding completion flag'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.user_reports', 'SELECT'),
  'users cannot read report records'
);
select extensions.ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'private profile schema is not exposed to authenticated API clients'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.discover_profiles()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.discover_profiles()', 'EXECUTE'),
  'discovery RPC is restricted to authenticated users'
);
select extensions.ok(
  not (select b.public from storage.buckets as b where b.id = 'profile-photos'),
  'profile photo bucket is private'
);

select * from extensions.finish();
rollback;
