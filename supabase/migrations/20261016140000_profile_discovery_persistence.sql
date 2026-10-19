create table public.user_profile_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('like', 'pass')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profile_actions_no_self_action check (actor_id <> target_id),
  constraint user_profile_actions_unique_pair unique (actor_id, target_id)
);

grant insert (
  user_id,
  email_notifications_enabled,
  push_notifications_enabled,
  show_online_status,
  show_distance,
  discovery_enabled
) on table public.user_settings to authenticated;

create index user_profile_actions_target_action_idx
  on public.user_profile_actions (target_id, action, created_at desc);

create trigger user_profile_actions_set_updated_at
  before update on public.user_profile_actions
  for each row execute function public.set_updated_at();

alter table public.user_profile_actions enable row level security;
revoke all on table public.user_profile_actions from public, anon, authenticated;

create policy "users read their own profile actions"
  on public.user_profile_actions for select to authenticated
  using (actor_id = (select auth.uid()));
create policy "active users create their own profile actions"
  on public.user_profile_actions for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (select public.is_account_active())
  );
create policy "active accounts only"
  on public.user_profile_actions as restrictive for all to authenticated
  using ((select public.is_account_active()))
  with check ((select public.is_account_active()));

grant select on table public.user_profile_actions to authenticated;

drop policy if exists "users read discoverable profile photos" on storage.objects;
drop function public.discover_profiles();

create function public.discover_profiles()
returns table (
  id uuid,
  username text,
  display_name text,
  age integer,
  gender text,
  bio text,
  occupation text,
  city text,
  country_code text,
  primary_photo_path text
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
    p.country_code,
    photos.storage_path
  from public.profiles as p
  join private.user_private_data as private_data on private_data.user_id = p.id
  join public.user_preferences as preferences on preferences.user_id = auth.uid()
  join public.user_settings as settings
    on settings.user_id = p.id
    and settings.discovery_enabled
  left join lateral (
    select user_photos.storage_path
    from public.user_photos
    where user_photos.user_id = p.id
    order by user_photos.is_primary desc, user_photos.display_order, user_photos.created_at
    limit 1
  ) as photos on true
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
    )
    and not exists (
      select 1
      from public.user_profile_actions as actions
      where actions.actor_id = auth.uid()
        and actions.target_id = p.id
    )
  order by p.updated_at desc, p.id
  limit 25;
$$;

revoke all on function public.discover_profiles() from public, anon;
grant execute on function public.discover_profiles() to authenticated;

create or replace function public.record_profile_action(
  p_target_id uuid,
  p_action text
)
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
  if p_target_id is null or p_target_id = current_user_id then
    raise exception 'Choose another profile.' using errcode = '22023';
  end if;
  if p_action not in ('like', 'pass') then
    raise exception 'Invalid profile action.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.discover_profiles() as available
    where available.id = p_target_id
  ) and not exists (
    select 1 from public.user_profile_actions as previous_action
    where previous_action.actor_id = current_user_id
      and previous_action.target_id = p_target_id
  ) then
    raise exception 'This profile is no longer available.' using errcode = 'P0002';
  end if;

  insert into public.user_profile_actions (actor_id, target_id, action)
  values (current_user_id, p_target_id, p_action)
  on conflict (actor_id, target_id) do update
    set action = excluded.action,
        updated_at = pg_catalog.now();
end;
$$;

revoke all on function public.record_profile_action(uuid, text) from public, anon;
grant execute on function public.record_profile_action(uuid, text) to authenticated;

create or replace function public.my_received_like_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)
  from public.user_profile_actions as actions
  where actions.target_id = (select auth.uid())
    and actions.action = 'like'
    and public.is_account_active();
$$;

revoke all on function public.my_received_like_count() from public, anon;
grant execute on function public.my_received_like_count() to authenticated;

create or replace function public.set_primary_profile_photo(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active account is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_photos
    where id = p_photo_id and user_id = current_user_id
  ) then
    raise exception 'Photo not found.' using errcode = 'P0002';
  end if;

  update public.user_photos
  set is_primary = false
  where user_id = current_user_id
    and is_primary
    and id <> p_photo_id;

  update public.user_photos
  set is_primary = true
  where id = p_photo_id
    and user_id = current_user_id;
end;
$$;

revoke all on function public.set_primary_profile_photo(uuid) from public, anon;
grant execute on function public.set_primary_profile_photo(uuid) to authenticated;

create policy "users read discoverable profile photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and exists (
      select 1
      from public.discover_profiles() as available
      where available.id::text = (storage.foldername(name))[1]
    )
  );
