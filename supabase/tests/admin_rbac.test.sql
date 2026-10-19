begin;

select extensions.plan(22);

select extensions.has_table('private', 'user_roles', 'private user roles exist');
select extensions.has_table('private', 'account_status', 'private account status exists');
select extensions.has_table('private', 'admin_audit_log', 'private admin audit log exists');
select extensions.ok(
  (
    select pg_catalog.bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname = any (array['user_roles', 'account_status', 'admin_audit_log'])
  ),
  'all admin data tables have row-level security enabled'
);
select extensions.ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated users cannot access the private schema'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'private.user_roles', 'SELECT')
    and not has_table_privilege('authenticated', 'private.user_roles', 'INSERT')
    and not has_table_privilege('authenticated', 'private.user_roles', 'UPDATE'),
  'users cannot read or modify role assignments'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'private.account_status', 'UPDATE'),
  'users cannot modify account status'
);
select extensions.ok(
  pg_catalog.to_regclass('private.user_roles_single_super_admin') is not null,
  'a unique index prevents multiple Super Admin assignments'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.claim_super_admin()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_super_admin()', 'EXECUTE'),
  'the verified identity bootstrap is available only to authenticated users'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.is_super_admin()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.is_super_admin()', 'EXECUTE'),
  'the role check is not available to anonymous users'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.admin_list_users(text,text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_list_users(text,text,integer,integer)', 'EXECUTE'),
  'the user directory RPC is restricted to authenticated callers and checks the admin role'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.admin_set_account_status(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_set_account_status(uuid,text)', 'EXECUTE'),
  'account management RPC is not available to anonymous callers'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.admin_list_reports(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_list_reports(integer)', 'EXECUTE'),
  'report details are not available to anonymous callers'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.admin_set_report_status(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_set_report_status(uuid,text)', 'EXECUTE'),
  'report moderation is not available to anonymous callers'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.admin_recent_activity(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_recent_activity(integer)', 'EXECUTE'),
  'audit and login activity is not available to anonymous callers'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.is_account_active()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.current_account_status()', 'EXECUTE'),
  'active-account checks are available for backend authorization'
);
select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'on_auth_user_access_created'
      and not tgisinternal
  ),
  'new Auth identities receive a private role and account status'
);
select extensions.ok(
  (
    select pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) = '''user''::text'
    from pg_catalog.pg_attrdef as defaults
    join pg_catalog.pg_attribute as columns
      on columns.attrelid = defaults.adrelid
      and columns.attnum = defaults.adnum
    where defaults.adrelid = 'private.user_roles'::regclass
      and columns.attname = 'role'
  ),
  'new role rows default to the regular user role'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.claim_super_admin()'::regprocedure) like '%auth.uid()%'
    and pg_catalog.pg_get_functiondef('public.claim_super_admin()'::regprocedure) like '%email_confirmed_at%'
    and pg_catalog.pg_get_functiondef('public.claim_super_admin()'::regprocedure) like '%enumachuk@gmail.com%',
  'Super Admin bootstrap binds verified email to the authenticated user id'
);
select extensions.ok(
  (
    select pg_catalog.bool_and(
      pg_catalog.pg_get_functiondef(functions.oid) like '%public.is_super_admin()%'
    )
    from pg_catalog.pg_proc as functions
    where functions.oid = any (array[
      'public.admin_dashboard_stats()'::regprocedure,
      'public.admin_list_users(text,text,integer,integer)'::regprocedure,
      'public.admin_set_account_status(uuid,text)'::regprocedure,
      'public.admin_list_reports(integer)'::regprocedure,
      'public.admin_set_report_status(uuid,text)'::regprocedure,
      'public.admin_recent_activity(integer)'::regprocedure
    ])
  ),
  'every admin RPC checks the caller role inside the database'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.admin_set_account_status(uuid,text)'::regprocedure)
    like '%private.is_recently_authenticated()%'
    and pg_catalog.pg_get_functiondef('public.admin_set_report_status(uuid,text)'::regprocedure)
      like '%private.is_recently_authenticated()%',
  'sensitive admin changes require recent authentication'
);
select extensions.ok(
  (
    select pg_catalog.count(*) = 8
    from pg_catalog.pg_policies
    where policyname = 'active accounts only'
  ),
  'active account status is enforced by restrictive policies on app and photo data'
);

select * from extensions.finish();
rollback;
