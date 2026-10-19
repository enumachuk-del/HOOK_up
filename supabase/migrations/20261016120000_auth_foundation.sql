create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text not null check (char_length(display_name) between 1 and 80),
  gender text check (gender is null or char_length(gender) <= 40),
  bio text check (bio is null or char_length(bio) <= 500),
  occupation text check (occupation is null or char_length(occupation) <= 120),
  city text check (city is null or char_length(city) <= 120),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or (username = lower(username) and username ~ '^[a-z0-9_]{3,30}$')
  )
);

create unique index profiles_username_unique
  on public.profiles (username)
  where username is not null;

create table private.user_private_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  date_of_birth date not null,
  created_at timestamptz not null default now(),
  constraint user_private_data_adult check (
    date_of_birth <= (current_date - interval '18 years')::date
  )
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  minimum_age integer not null default 18 check (minimum_age between 18 and 100),
  maximum_age integer not null default 99 check (maximum_age between 18 and 100),
  preferred_genders text[] not null default '{}',
  maximum_distance_km integer check (maximum_distance_km between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_age_range check (minimum_age <= maximum_age),
  constraint user_preferences_gender_count check (
    cardinality(preferred_genders) <= 10
    and array_position(preferred_genders, '') is null
  )
);

create table public.user_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  is_primary boolean not null default false,
  display_order integer not null default 0 check (display_order between 0 and 99),
  created_at timestamptz not null default now(),
  constraint user_photos_owned_path check (
    storage_path ~ ('^' || user_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$')
  )
);

create index user_photos_user_order_idx
  on public.user_photos (user_id, display_order);
create unique index user_photos_one_primary_per_user
  on public.user_photos (user_id)
  where is_primary;

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_notifications_enabled boolean not null default true,
  push_notifications_enabled boolean not null default true,
  show_online_status boolean not null default true,
  show_distance boolean not null default true,
  discovery_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_no_self_block check (blocker_id <> blocked_id),
  constraint user_blocks_unique_pair unique (blocker_id, blocked_id)
);

create index user_blocks_blocked_id_idx on public.user_blocks (blocked_id);

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('harassment', 'fake_profile', 'inappropriate_content', 'spam', 'underage', 'other')),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  constraint user_reports_no_self_report check (reporter_id <> reported_user_id)
);

create index user_reports_reported_created_idx
  on public.user_reports (reported_user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
  birth_date date;
begin
  profile_name := pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if pg_catalog.char_length(profile_name) not between 1 and 80 then
    raise exception 'A display name between 1 and 80 characters is required.'
      using errcode = '23514';
  end if;

  begin
    birth_date := (new.raw_user_meta_data ->> 'date_of_birth')::date;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'A valid date of birth is required.'
        using errcode = '23514';
  end;

  if birth_date is null or birth_date > (current_date - interval '18 years')::date then
    raise exception 'You must be at least 18 years old to register.'
      using errcode = '23514';
  end if;

  insert into private.user_private_data (user_id, date_of_birth)
  values (new.id, birth_date);

  insert into public.profiles (id, display_name)
  values (new.id, profile_name);

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

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

revoke all on function public.complete_profile_onboarding() from public, anon;
grant execute on function public.complete_profile_onboarding() to authenticated;

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

revoke all on function public.discover_profiles() from public, anon;
grant execute on function public.discover_profiles() to authenticated;

alter table public.profiles enable row level security;
alter table private.user_private_data enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_photos enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;

create policy "users read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "users update their own editable profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "users read their own private data"
  on private.user_private_data for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users manage their own preferences"
  on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users manage their own photo metadata"
  on public.user_photos for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
  );

create policy "users manage their own settings"
  on public.user_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users read their own blocks"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy "users create their own blocks"
  on public.user_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy "users remove their own blocks"
  on public.user_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

create policy "users can submit reports for others"
  on public.user_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

revoke all on table public.profiles from anon, authenticated;
revoke all on table private.user_private_data from anon, authenticated;
revoke all on table public.user_preferences from anon, authenticated;
revoke all on table public.user_photos from anon, authenticated;
revoke all on table public.user_settings from anon, authenticated;
revoke all on table public.user_blocks from anon, authenticated;
revoke all on table public.user_reports from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (username, display_name, gender, bio, occupation, city, country_code)
  on table public.profiles to authenticated;

grant select, delete on table public.user_preferences to authenticated;
grant insert (user_id, minimum_age, maximum_age, preferred_genders, maximum_distance_km)
  on table public.user_preferences to authenticated;
grant update (minimum_age, maximum_age, preferred_genders, maximum_distance_km)
  on table public.user_preferences to authenticated;
grant select, delete on table public.user_photos to authenticated;
grant insert (user_id, storage_path, is_primary, display_order)
  on table public.user_photos to authenticated;
grant update (is_primary, display_order) on table public.user_photos to authenticated;
grant select, delete on table public.user_settings to authenticated;
grant insert (user_id) on table public.user_settings to authenticated;
grant update (
  email_notifications_enabled,
  push_notifications_enabled,
  show_online_status,
  show_distance,
  discovery_enabled
) on table public.user_settings to authenticated;
grant select, delete on table public.user_blocks to authenticated;
grant insert (blocked_id) on table public.user_blocks to authenticated;
grant insert (reported_user_id, reason, description) on table public.user_reports to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "users read their own profile photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "users upload their own profile photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "users update their own profile photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "users delete their own profile photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
