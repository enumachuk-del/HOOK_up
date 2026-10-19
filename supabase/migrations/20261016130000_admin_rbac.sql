create table private.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'super_admin')),
  assigned_at timestamptz not null default now()
);

create unique index user_roles_single_super_admin
  on private.user_roles (role)
  where role = 'super_admin';

create table private.account_status (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deactivated')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table private.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('super_admin_bootstrap', 'account_status_changed', 'report_status_changed')),
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_at_idx
  on private.admin_audit_log (created_at desc);

alter table private.user_roles enable row level security;
alter table private.account_status enable row level security;
alter table private.admin_audit_log enable row level security;

revoke all on table private.user_roles, private.account_status, private.admin_audit_log
  from public, anon, authenticated;

insert into private.user_roles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

insert into private.account_status (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function private.handle_new_user_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.user_roles (user_id) values (new.id);
  insert into private.account_status (user_id) values (new.id);
  return new;
end;
$$;

revoke all on function private.handle_new_user_access() from public, anon, authenticated;

create trigger on_auth_user_access_created
  after insert on auth.users
  for each row execute function private.handle_new_user_access();

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.user_roles as roles
    join private.account_status as account on account.user_id = roles.user_id
    where roles.user_id = (select auth.uid())
      and roles.role = 'super_admin'
      and account.status = 'active'
  );
$$;

revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.account_status as account
    where account.user_id = (select auth.uid())
      and account.status = 'active'
  );
$$;

revoke all on function public.is_account_active() from public, anon;
grant execute on function public.is_account_active() to authenticated;

create or replace function private.is_recently_authenticated()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.to_timestamp(nullif(auth.jwt() ->> 'auth_time', '')::double precision)
      >= pg_catalog.now() - interval '10 minutes',
    false
  );
$$;

revoke all on function private.is_recently_authenticated() from public, anon, authenticated;

create or replace function public.complete_profile_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_account_active() then
    raise exception 'An active account is required.' using errcode = '42501';
  end if;

  update public.profiles
  set onboarding_completed = true
  where id = current_user_id
    and not onboarding_completed
    and pg_catalog.char_length(pg_catalog.btrim(bio)) between 20 and 500
    and pg_catalog.char_length(pg_catalog.btrim(city)) between 1 and 120;

  if not found then
    raise exception 'Complete your profile details before continuing.'
      using errcode = '23514';
  end if;

  insert into public.user_preferences (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.discover_profiles()
returns table (
  id uuid,
  username text,
  display_name text,
  age integer,
  gender text,
  bio text,
  occupation text,
  city text,
  country_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.display_name,
    extract(year from pg_catalog.age(current_date, private_data.date_of_birth))::integer,
    p.gender,
    p.bio,
    p.occupation,
    p.city,
    p.country_code
  from public.profiles as p
  join private.user_private_data as private_data on private_data.user_id = p.id
  join public.user_preferences as preferences on preferences.user_id = auth.uid()
  join public.user_settings as settings
    on settings.user_id = p.id
    and settings.discovery_enabled
  where auth.uid() is not null
    and public.is_account_active()
    and p.id <> auth.uid()
    and p.onboarding_completed
    and extract(year from pg_catalog.age(current_date, private_data.date_of_birth))::integer
      between preferences.minimum_age and preferences.maximum_age
    and (
      pg_catalog.cardinality(preferences.preferred_genders) = 0
      or p.gender = any(preferences.preferred_genders)
    )
    and not exists (
      select 1
      from public.user_blocks as blocks
      where (blocks.blocker_id = auth.uid() and blocks.blocked_id = p.id)
        or (blocks.blocker_id = p.id and blocks.blocked_id = auth.uid())
    );
$$;

create or replace function public.claim_super_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  verified_email text;
  email_verified_at timestamptz;
  assigned_admin_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select email, email_confirmed_at
  into verified_email, email_verified_at
  from auth.users
  where id = current_user_id;

  if email_verified_at is null or pg_catalog.lower(verified_email) is distinct from 'enumachuk@gmail.com' then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('splendid_hubs_super_admin_bootstrap', 0)
  );

  select email, email_confirmed_at
  into verified_email, email_verified_at
  from auth.users
  where id = current_user_id;

  if email_verified_at is null or pg_catalog.lower(verified_email) is distinct from 'enumachuk@gmail.com' then
    return false;
  end if;

  select user_id
  into assigned_admin_id
  from private.user_roles
  where role = 'super_admin';

  if assigned_admin_id is not null then
    return assigned_admin_id = current_user_id;
  end if;

  insert into private.user_roles (user_id, role)
  values (current_user_id, 'super_admin')
  on conflict (user_id) do update
    set role = 'super_admin', assigned_at = pg_catalog.now()
    where private.user_roles.role = 'user';

  if not found then
    return false;
  end if;

  insert into private.admin_audit_log (actor_id, action, target_id)
  values (current_user_id, 'super_admin_bootstrap', current_user_id);

  return true;
end;
$$;

revoke all on function public.claim_super_admin() from public, anon;
grant execute on function public.claim_super_admin() to authenticated;

create or replace function public.current_account_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select account.status
  from private.account_status as account
  where account.user_id = (select auth.uid());
$$;

revoke all on function public.current_account_status() from public, anon;
grant execute on function public.current_account_status() to authenticated;

create or replace function public.admin_dashboard_stats()
returns table (
  total_users bigint,
  active_users bigint,
  suspended_users bigint,
  deactivated_users bigint,
  registrations_last_7_days bigint,
  signins_last_7_days bigint,
  open_reports bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required.' using errcode = '42501';
  end if;

  return query
  select
    (select pg_catalog.count(*) from auth.users)::bigint,
    (select pg_catalog.count(*) from private.account_status where status = 'active')::bigint,
    (select pg_catalog.count(*) from private.account_status where status = 'suspended')::bigint,
    (select pg_catalog.count(*) from private.account_status where status = 'deactivated')::bigint,
    (select pg_catalog.count(*) from auth.users where created_at >= pg_catalog.now() - interval '7 days')::bigint,
    (select pg_catalog.count(*) from auth.users where last_sign_in_at >= pg_catalog.now() - interval '7 days')::bigint,
    (select pg_catalog.count(*) from public.user_reports where status in ('open', 'reviewing'))::bigint;
end;
$$;

create or replace function public.admin_list_users(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  email_verified boolean,
  display_name text,
  city text,
  gender text,
  bio text,
  occupation text,
  onboarding_completed boolean,
  registered_at timestamptz,
  last_sign_in_at timestamptz,
  account_status text,
  role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'deactivated') then
    raise exception 'Invalid account status.' using errcode = '22023';
  end if;

  return query
  select
    users.id,
    users.email::text,
    (users.email_confirmed_at is not null),
    coalesce(
      profiles.display_name,
      nullif(users.raw_user_meta_data ->> 'display_name', ''),
      'Profile unavailable'
    ),
    profiles.city,
    profiles.gender,
    profiles.bio,
    profiles.occupation,
    profiles.onboarding_completed,
    users.created_at,
    users.last_sign_in_at,
    account.status,
    roles.role
  from auth.users as users
  left join public.profiles as profiles on profiles.id = users.id
  join private.account_status as account on account.user_id = users.id
  join private.user_roles as roles on roles.user_id = users.id
  where (p_status is null or account.status = p_status)
    and (
      nullif(pg_catalog.btrim(p_search), '') is null
      or users.email ilike '%' || pg_catalog.btrim(p_search) || '%'
      or profiles.display_name ilike '%' || pg_catalog.btrim(p_search) || '%'
      or profiles.city ilike '%' || pg_catalog.btrim(p_search) || '%'
    )
  order by users.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required.' using errcode = '42501';
  end if;
  if not private.is_recently_authenticated() then
    raise exception 'Sign in again before changing account access.' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = current_user_id then
    raise exception 'You cannot change your own account status.' using errcode = '22023';
  end if;
  if p_status not in ('active', 'suspended', 'deactivated') then
    raise exception 'Invalid account status.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.user_roles
    where user_id = p_user_id and role = 'user'
  ) then
    raise exception 'Only regular user accounts can be changed.' using errcode = '42501';
  end if;

  update private.account_status
  set status = p_status, updated_at = pg_catalog.now(), updated_by = current_user_id
  where user_id = p_user_id;

  if not found then
    raise exception 'User account was not found.' using errcode = 'P0002';
  end if;

  insert into private.admin_audit_log (actor_id, action, target_id, details)
  values (
    current_user_id,
    'account_status_changed',
    p_user_id,
    pg_catalog.jsonb_build_object('status', p_status)
  );
end;
$$;

create or replace function public.admin_list_reports(p_limit integer default 50)
returns table (
  report_id uuid,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_user_name text,
  reason text,
  description text,
  report_status text,
  reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required.' using errcode = '42501';
  end if;

  return query
  select reports.id, reports.reporter_id, reporter.display_name,
    reports.reported_user_id, reported.display_name, reports.reason,
    reports.description, reports.status, reports.created_at
  from public.user_reports as reports
  join public.profiles as reporter on reporter.id = reports.reporter_id
  join public.profiles as reported on reported.id = reports.reported_user_id
  order by
    case reports.status when 'open' then 0 when 'reviewing' then 1 else 2 end,
    reports.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

create or replace function public.admin_set_report_status(
  p_report_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required.' using errcode = '42501';
  end if;
  if not private.is_recently_authenticated() then
    raise exception 'Sign in again before moderating reports.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'Invalid report status.' using errcode = '22023';
  end if;

  update public.user_reports
  set status = p_status
  where id = p_report_id;
  if not found then
    raise exception 'Report was not found.' using errcode = 'P0002';
  end if;

  insert into private.admin_audit_log (actor_id, action, target_id, details)
  values (
    current_user_id,
    'report_status_changed',
    p_report_id,
    pg_catalog.jsonb_build_object('status', p_status)
  );
end;
$$;

create or replace function public.admin_recent_activity(p_limit integer default 20)
returns table (
  event_type text,
  actor_id uuid,
  actor_email text,
  target_id uuid,
  details jsonb,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required.' using errcode = '42501';
  end if;

  return query
  select activity.event_type, activity.actor_id, activity.actor_email,
    activity.target_id, activity.details, activity.occurred_at
  from (
    select
      audit.action as event_type,
      audit.actor_id,
      actor.email::text as actor_email,
      audit.target_id,
      audit.details,
      audit.created_at as occurred_at
    from private.admin_audit_log as audit
    left join auth.users as actor on actor.id = audit.actor_id
    union all
    select
      'user_login'::text,
      users.id,
      users.email::text,
      users.id,
      '{}'::jsonb,
      users.last_sign_in_at
    from auth.users as users
    where users.last_sign_in_at >= pg_catalog.now() - interval '30 days'
  ) as activity
  order by activity.occurred_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon;
revoke all on function public.admin_list_users(text, text, integer, integer) from public, anon;
revoke all on function public.admin_set_account_status(uuid, text) from public, anon;
revoke all on function public.admin_list_reports(integer) from public, anon;
revoke all on function public.admin_set_report_status(uuid, text) from public, anon;
revoke all on function public.admin_recent_activity(integer) from public, anon;

grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_list_users(text, text, integer, integer) to authenticated;
grant execute on function public.admin_set_account_status(uuid, text) to authenticated;
grant execute on function public.admin_list_reports(integer) to authenticated;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;
grant execute on function public.admin_recent_activity(integer) to authenticated;

create policy "active accounts only"
  on public.profiles as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));
create policy "active accounts only"
  on public.user_preferences as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));
create policy "active accounts only"
  on public.user_photos as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));
create policy "active accounts only"
  on public.user_settings as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));
create policy "active accounts only"
  on public.user_blocks as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));
create policy "active accounts only"
  on public.user_reports as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));
create policy "active accounts only"
  on private.user_private_data as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));
create policy "active accounts only"
  on storage.objects as restrictive for all to authenticated
  using (
    bucket_id <> 'profile-photos'
    or (select public.is_account_active())
  )
  with check (
    bucket_id <> 'profile-photos'
    or (select public.is_account_active())
  );
