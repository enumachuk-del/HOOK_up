create table public.user_matches (
  user_low_id uuid not null references auth.users (id) on delete cascade,
  user_high_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'unmatched')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null,
  primary key (user_low_id, user_high_id),
  constraint user_matches_ordered_pair check (user_low_id < user_high_id),
  constraint user_matches_status_timestamps check (
    (status = 'active' and ended_at is null and ended_by is null)
    or (status = 'unmatched' and ended_at is not null)
  )
);

create table public.user_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  caption text not null default '',
  photo_path text,
  created_at timestamptz not null default now(),
  constraint user_posts_content check (
    char_length(caption) <= 1000
    and (char_length(btrim(caption)) > 0 or photo_path is not null)
  ),
  constraint user_posts_owned_photo check (
    photo_path is null or photo_path like (author_id::text || '/%')
  )
);

create index user_posts_feed_idx on public.user_posts (created_at desc);
create index user_posts_author_idx on public.user_posts (author_id, created_at desc);

create table public.user_post_likes (
  post_id uuid not null references public.user_posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.user_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.user_posts (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index user_post_comments_post_idx on public.user_post_comments (post_id, created_at);

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  is_intro boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_no_self_message check (sender_id <> recipient_id)
);

create index direct_messages_inbox_idx
  on public.direct_messages (recipient_id, created_at desc);
create index direct_messages_sender_idx
  on public.direct_messages (sender_id, recipient_id, created_at desc);
create unique index direct_messages_one_intro_per_pair
  on public.direct_messages (sender_id, recipient_id)
  where is_intro;

alter table public.user_matches enable row level security;
alter table public.user_posts enable row level security;
alter table public.user_post_likes enable row level security;
alter table public.user_post_comments enable row level security;
alter table public.direct_messages enable row level security;

revoke all on table public.user_matches, public.user_posts, public.user_post_likes,
  public.user_post_comments, public.direct_messages from public, anon, authenticated;

drop policy if exists "users read discoverable profile photos" on storage.objects;
drop function if exists public.record_profile_action(uuid, text);

create or replace function public.can_view_member(p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and p_target_id is not null
    and public.is_account_active()
    and exists (
      select 1
      from private.account_status as target_status
      where target_status.user_id = p_target_id
        and target_status.status = 'active'
    )
    and not exists (
      select 1
      from public.user_blocks as blocks
      where (blocks.blocker_id = auth.uid() and blocks.blocked_id = p_target_id)
        or (blocks.blocker_id = p_target_id and blocks.blocked_id = auth.uid())
    )
    and (
      p_target_id = auth.uid()
      or exists (
        select 1
        from public.user_matches as matches
        where matches.status = 'active'
          and matches.user_low_id = least(auth.uid(), p_target_id)
          and matches.user_high_id = greatest(auth.uid(), p_target_id)
      )
      or exists (
        select 1
        from public.profiles as target_profile
        join private.user_private_data as target_private
          on target_private.user_id = target_profile.id
        join public.user_settings as target_settings
          on target_settings.user_id = target_profile.id
          and target_settings.discovery_enabled
        join public.user_preferences as viewer_preferences
          on viewer_preferences.user_id = auth.uid()
        where target_profile.id = p_target_id
          and target_profile.onboarding_completed
          and extract(year from pg_catalog.age(current_date, target_private.date_of_birth))::integer
            between viewer_preferences.minimum_age and viewer_preferences.maximum_age
          and (
            pg_catalog.cardinality(viewer_preferences.preferred_genders) = 0
            or target_profile.gender = any(viewer_preferences.preferred_genders)
          )
      )
    );
$$;

revoke all on function public.can_view_member(uuid) from public, anon;
grant execute on function public.can_view_member(uuid) to authenticated;

create or replace function public.feed_profiles(
  p_limit integer default 50,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  updated_at timestamptz,
  username text,
  display_name text,
  age integer,
  gender text,
  bio text,
  occupation text,
  city text,
  country_code text,
  photo_paths text[],
  liked_by_me boolean,
  they_liked_me boolean,
  is_matched boolean,
  intro_sent_by_me boolean,
  intro_sent_by_them boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.updated_at,
    profile.username,
    profile.display_name,
    extract(year from pg_catalog.age(current_date, private_data.date_of_birth))::integer,
    profile.gender,
    profile.bio,
    profile.occupation,
    profile.city,
    profile.country_code,
    coalesce(photos.paths, '{}'::text[]),
    coalesce(my_action.action = 'like', false),
    coalesce(their_action.action = 'like', false),
    coalesce(matches.status = 'active', false),
    exists (
      select 1 from public.direct_messages as message
      where message.sender_id = auth.uid()
        and message.recipient_id = profile.id
        and message.is_intro
    ),
    exists (
      select 1 from public.direct_messages as message
      where message.sender_id = profile.id
        and message.recipient_id = auth.uid()
        and message.is_intro
    )
  from public.profiles as profile
  join private.user_private_data as private_data on private_data.user_id = profile.id
  left join public.user_profile_actions as my_action
    on my_action.actor_id = auth.uid()
    and my_action.target_id = profile.id
  left join public.user_profile_actions as their_action
    on their_action.actor_id = profile.id
    and their_action.target_id = auth.uid()
  left join public.user_matches as matches
    on matches.user_low_id = least(auth.uid(), profile.id)
    and matches.user_high_id = greatest(auth.uid(), profile.id)
  left join lateral (
    select pg_catalog.array_agg(photo.storage_path order by photo.is_primary desc, photo.display_order, photo.created_at) as paths
    from public.user_photos as photo
    where photo.user_id = profile.id
  ) as photos on true
  where profile.id <> auth.uid()
    and public.can_view_member(profile.id)
    and coalesce(my_action.action, 'like') <> 'pass'
    and not exists (
      select 1 from public.user_matches as ended_match
      where ended_match.user_low_id = least(auth.uid(), profile.id)
        and ended_match.user_high_id = greatest(auth.uid(), profile.id)
        and ended_match.status = 'unmatched'
    )
    and (
      p_after_updated_at is null
      or (
        p_after_id is not null
        and (
          profile.updated_at < p_after_updated_at
          or (profile.updated_at = p_after_updated_at and profile.id > p_after_id)
        )
      )
    )
  order by profile.updated_at desc, profile.id
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.feed_profiles(integer, timestamptz, uuid) from public, anon;
grant execute on function public.feed_profiles(integer, timestamptz, uuid) to authenticated;

create or replace function public.my_received_like_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)
  from public.user_profile_actions as actions
  join private.account_status as liker_status
    on liker_status.user_id = actions.actor_id
    and liker_status.status = 'active'
  where actions.target_id = (select auth.uid())
    and actions.action = 'like'
    and public.is_account_active()
    and not exists (
      select 1 from public.user_matches as matches
      where matches.user_low_id = least(actions.actor_id, actions.target_id)
        and matches.user_high_id = greatest(actions.actor_id, actions.target_id)
        and matches.status = 'unmatched'
    )
    and not exists (
      select 1 from public.user_blocks as blocks
      where (blocks.blocker_id = actions.actor_id and blocks.blocked_id = actions.target_id)
        or (blocks.blocker_id = actions.target_id and blocks.blocked_id = actions.actor_id)
    );
$$;

revoke all on function public.my_received_like_count() from public, anon;
grant execute on function public.my_received_like_count() to authenticated;

create or replace function public.record_profile_action(
  p_target_id uuid,
  p_action text,
  p_intro_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  higher_user_id uuid;
  match_created boolean := false;
begin
  if p_liked is null then
    raise exception 'Choose whether to like or unlike this post.' using errcode = '22023';
  end if;
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  if p_target_id is null or p_target_id = current_user_id then
    raise exception 'Choose another profile.' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('like', 'pass') or (p_intro_message is not null and p_action <> 'like') then
    raise exception 'Invalid profile action.' using errcode = '22023';
  end if;
  if p_intro_message is not null and char_length(btrim(p_intro_message)) not between 1 and 500 then
    raise exception 'An introductory message must be between 1 and 500 characters.' using errcode = '22023';
  end if;
  if not public.can_view_member(p_target_id) then
    raise exception 'This profile is not available.' using errcode = '42501';
  end if;

  lower_user_id := least(current_user_id, p_target_id);
  higher_user_id := greatest(current_user_id, p_target_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lower_user_id::text || ':' || higher_user_id::text, 0)
  );

  if p_intro_message is not null and exists (
    select 1 from public.user_matches
    where user_low_id = lower_user_id and user_high_id = higher_user_id and status = 'active'
  ) then
    raise exception 'Use the active conversation to send a message.' using errcode = '22023';
  end if;
  if p_action = 'pass' and exists (
    select 1 from public.user_matches
    where user_low_id = lower_user_id and user_high_id = higher_user_id and status = 'active'
  ) then
    raise exception 'End the match to stop seeing this member.' using errcode = '22023';
  end if;

  insert into public.user_profile_actions (actor_id, target_id, action)
  values (current_user_id, p_target_id, p_action)
  on conflict (actor_id, target_id) do update
    set action = excluded.action,
        updated_at = pg_catalog.now();

  if p_action = 'like' then
    if p_intro_message is not null then
      insert into public.direct_messages (sender_id, recipient_id, content, is_intro)
      values (current_user_id, p_target_id, btrim(p_intro_message), true);
    end if;

    if exists (
      select 1 from public.user_profile_actions
      where actor_id = p_target_id and target_id = current_user_id and action = 'like'
    ) then
      insert into public.user_matches (user_low_id, user_high_id)
      values (lower_user_id, higher_user_id)
      on conflict (user_low_id, user_high_id) do nothing;
      match_created := found;
    end if;
  end if;

  return match_created;
end;
$$;

revoke all on function public.record_profile_action(uuid, text, text) from public, anon;
grant execute on function public.record_profile_action(uuid, text, text) to authenticated;

create or replace function public.unmatch_profile(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  if p_target_id is null or p_target_id = current_user_id then
    raise exception 'Choose another member.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(current_user_id, p_target_id)::text || ':' || greatest(current_user_id, p_target_id)::text,
      0
    )
  );

  update public.user_matches
  set status = 'unmatched',
      ended_at = pg_catalog.now(),
      ended_by = current_user_id
  where user_low_id = least(current_user_id, p_target_id)
    and user_high_id = greatest(current_user_id, p_target_id)
    and status = 'active';

  if not found then
    raise exception 'No active match was found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.unmatch_profile(uuid) from public, anon;
grant execute on function public.unmatch_profile(uuid) to authenticated;

create or replace function public.get_social_feed()
returns table (
  id uuid,
  author_id uuid,
  author_name text,
  author_photo_path text,
  caption text,
  photo_path text,
  created_at timestamptz,
  like_count bigint,
  comment_count bigint,
  liked_by_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id,
    post.author_id,
    profile.display_name,
    (select photo.storage_path from public.user_photos as photo
      where photo.user_id = post.author_id
      order by photo.is_primary desc, photo.display_order, photo.created_at limit 1),
    post.caption,
    post.photo_path,
    post.created_at,
    (select pg_catalog.count(*) from public.user_post_likes as likes where likes.post_id = post.id),
    (select pg_catalog.count(*) from public.user_post_comments as comments where comments.post_id = post.id),
    exists (
      select 1 from public.user_post_likes as likes
      where likes.post_id = post.id and likes.user_id = auth.uid()
    )
  from public.user_posts as post
  join public.profiles as profile on profile.id = post.author_id
  where public.can_view_member(post.author_id)
  order by post.created_at desc
  limit 100;
$$;

revoke all on function public.get_social_feed() from public, anon;
grant execute on function public.get_social_feed() to authenticated;

create or replace function public.create_user_post(p_caption text, p_photo_path text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_post_id uuid;
  clean_caption text := btrim(coalesce(p_caption, ''));
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  if char_length(clean_caption) > 1000 or (clean_caption = '' and p_photo_path is null) then
    raise exception 'Add a caption or photo to your post.' using errcode = '22023';
  end if;
  if p_photo_path is not null and (
    p_photo_path not like (current_user_id::text || '/%')
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'profile-photos' and name = p_photo_path
    )
  ) then
    raise exception 'The post photo is unavailable.' using errcode = '42501';
  end if;

  insert into public.user_posts (author_id, caption, photo_path)
  values (current_user_id, clean_caption, p_photo_path)
  returning id into new_post_id;
  return new_post_id;
end;
$$;

revoke all on function public.create_user_post(text, text) from public, anon;
grant execute on function public.create_user_post(text, text) to authenticated;

create or replace function public.set_post_like(p_post_id uuid, p_liked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  post_author_id uuid;
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  select author_id into post_author_id from public.user_posts where id = p_post_id;
  if post_author_id is null or not public.can_view_member(post_author_id) then
    raise exception 'This post is not available.' using errcode = '42501';
  end if;

  if p_liked then
    insert into public.user_post_likes (post_id, user_id)
    values (p_post_id, current_user_id)
    on conflict do nothing;
  else
    delete from public.user_post_likes
    where post_id = p_post_id and user_id = current_user_id;
  end if;
end;
$$;

revoke all on function public.set_post_like(uuid, boolean) from public, anon;
grant execute on function public.set_post_like(uuid, boolean) to authenticated;

create or replace function public.get_post_comments(p_post_id uuid)
returns table (
  id uuid,
  author_id uuid,
  author_name text,
  content text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select comment.id, comment.author_id, profile.display_name, comment.content, comment.created_at
  from public.user_post_comments as comment
  join public.user_posts as post on post.id = comment.post_id
  join public.profiles as profile on profile.id = comment.author_id
  where post.id = p_post_id
    and public.can_view_member(post.author_id)
    and public.can_view_member(comment.author_id)
  order by comment.created_at
  limit 100;
$$;

revoke all on function public.get_post_comments(uuid) from public, anon;
grant execute on function public.get_post_comments(uuid) to authenticated;

create or replace function public.add_post_comment(p_post_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  post_author_id uuid;
  new_comment_id uuid;
  clean_content text := btrim(coalesce(p_content, ''));
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  if char_length(clean_content) not between 1 and 1000 then
    raise exception 'Comments must be between 1 and 1000 characters.' using errcode = '22023';
  end if;
  select author_id into post_author_id from public.user_posts where id = p_post_id;
  if post_author_id is null or not public.can_view_member(post_author_id) then
    raise exception 'This post is not available.' using errcode = '42501';
  end if;

  insert into public.user_post_comments (post_id, author_id, content)
  values (p_post_id, current_user_id, clean_content)
  returning id into new_comment_id;
  return new_comment_id;
end;
$$;

revoke all on function public.add_post_comment(uuid, text) from public, anon;
grant execute on function public.add_post_comment(uuid, text) to authenticated;

create or replace function public.send_direct_message(p_recipient_id uuid, p_content text, p_is_intro boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  lower_user_id uuid;
  higher_user_id uuid;
  active_match boolean;
  new_message_id uuid;
  clean_content text := btrim(coalesce(p_content, ''));
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  if p_recipient_id is null or p_recipient_id = current_user_id then
    raise exception 'Choose another member.' using errcode = '22023';
  end if;
  if p_is_intro is null then
    raise exception 'Choose a valid message type.' using errcode = '22023';
  end if;
  if not public.can_view_member(p_recipient_id) then
    raise exception 'This member is not available.' using errcode = '42501';
  end if;
  if char_length(clean_content) not between 1 and 2000 then
    raise exception 'Messages must be between 1 and 2000 characters.' using errcode = '22023';
  end if;

  lower_user_id := least(current_user_id, p_recipient_id);
  higher_user_id := greatest(current_user_id, p_recipient_id);
  select exists (
    select 1 from public.user_matches
    where user_low_id = lower_user_id and user_high_id = higher_user_id and status = 'active'
  ) into active_match;

  if active_match then
    if p_is_intro then
      raise exception 'You already have an active conversation.' using errcode = '22023';
    end if;
  else
    if not p_is_intro
      or not public.can_view_member(p_recipient_id)
      or not exists (
        select 1 from public.user_profile_actions
        where actor_id = current_user_id and target_id = p_recipient_id and action = 'like'
      )
      or exists (
        select 1 from public.user_matches
        where user_low_id = lower_user_id and user_high_id = higher_user_id and status = 'unmatched'
      )
    then
      raise exception 'A mutual match is required to continue messaging.' using errcode = '42501';
    end if;
  end if;

  insert into public.direct_messages (sender_id, recipient_id, content, is_intro)
  values (current_user_id, p_recipient_id, clean_content, not active_match)
  returning id into new_message_id;
  return new_message_id;
end;
$$;

revoke all on function public.send_direct_message(uuid, text, boolean) from public, anon;
grant execute on function public.send_direct_message(uuid, text, boolean) to authenticated;

create or replace function public.list_my_conversations()
returns table (
  peer_id uuid,
  peer_name text,
  peer_photo_path text,
  is_matched boolean,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with peers as (
    select candidates.id, pg_catalog.bool_or(candidates.matched) as matched
    from (
      select case when user_low_id = auth.uid() then user_high_id else user_low_id end as id,
        true as matched
      from public.user_matches
      where (user_low_id = auth.uid() or user_high_id = auth.uid()) and status = 'active'
      union all
      select case when sender_id = auth.uid() then recipient_id else sender_id end,
        false
      from public.direct_messages
      where is_intro and (sender_id = auth.uid() or recipient_id = auth.uid())
        and not exists (
          select 1 from public.user_matches as ended_match
          where ended_match.user_low_id = least(auth.uid(), case when sender_id = auth.uid() then recipient_id else sender_id end)
            and ended_match.user_high_id = greatest(auth.uid(), case when sender_id = auth.uid() then recipient_id else sender_id end)
            and ended_match.status = 'unmatched'
        )
    ) as candidates
    group by candidates.id
  )
  select
    peer.id,
    profile.display_name,
    (select photo.storage_path from public.user_photos as photo
      where photo.user_id = peer.id
      order by photo.is_primary desc, photo.display_order, photo.created_at limit 1),
    peer.matched,
    latest.content,
    latest.created_at,
    (select pg_catalog.count(*) from public.direct_messages as unread
      where unread.sender_id = peer.id and unread.recipient_id = auth.uid() and unread.read_at is null
        and (unread.is_intro or peer.matched))
  from peers as peer
  join public.profiles as profile on profile.id = peer.id
  left join lateral (
    select message.content, message.created_at
    from public.direct_messages as message
    where (
      (message.sender_id = auth.uid() and message.recipient_id = peer.id)
      or (message.sender_id = peer.id and message.recipient_id = auth.uid())
    )
      and (message.is_intro or peer.matched)
    order by message.created_at desc
    limit 1
  ) as latest on true
  where public.can_view_member(peer.id)
  group by peer.id, peer.matched, profile.display_name, latest.content, latest.created_at
  order by latest.created_at desc nulls last;
$$;

revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;

create or replace function public.get_conversation_messages(p_peer_id uuid)
returns table (
  id uuid,
  sender_id uuid,
  recipient_id uuid,
  content text,
  is_intro boolean,
  created_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  active_match boolean;
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.user_matches
    where user_low_id = least(current_user_id, p_peer_id)
      and user_high_id = greatest(current_user_id, p_peer_id)
      and status = 'active'
  ) into active_match;

  if (
    not active_match
    and not exists (
      select 1 from public.direct_messages
      where is_intro
        and ((sender_id = current_user_id and recipient_id = p_peer_id)
          or (sender_id = p_peer_id and recipient_id = current_user_id))
    )
  ) or exists (
    select 1 from public.user_matches
    where user_low_id = least(current_user_id, p_peer_id)
      and user_high_id = greatest(current_user_id, p_peer_id)
      and status = 'unmatched'
  ) then
    raise exception 'This conversation is not available.' using errcode = '42501';
  end if;
  if not public.can_view_member(p_peer_id) then
    raise exception 'This conversation is not available.' using errcode = '42501';
  end if;

  return query
  select message.id, message.sender_id, message.recipient_id, message.content,
    message.is_intro, message.created_at, message.read_at
  from public.direct_messages as message
  where (
      (message.sender_id = current_user_id and message.recipient_id = p_peer_id)
      or (message.sender_id = p_peer_id and message.recipient_id = current_user_id)
    )
    and (message.is_intro or active_match)
  order by message.created_at
  limit 500;
end;
$$;

revoke all on function public.get_conversation_messages(uuid) from public, anon;
grant execute on function public.get_conversation_messages(uuid) to authenticated;

create or replace function public.mark_conversation_read(p_peer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_account_active() then
    raise exception 'An active signed-in account is required.' using errcode = '42501';
  end if;
  if (
    not exists (
      select 1 from public.user_matches
      where user_low_id = least(current_user_id, p_peer_id)
        and user_high_id = greatest(current_user_id, p_peer_id)
        and status = 'active'
    )
    and not exists (
      select 1 from public.direct_messages
      where is_intro
        and ((sender_id = p_peer_id and recipient_id = current_user_id)
          or (sender_id = current_user_id and recipient_id = p_peer_id))
    )
  ) or exists (
    select 1 from public.user_matches
    where user_low_id = least(current_user_id, p_peer_id)
      and user_high_id = greatest(current_user_id, p_peer_id)
      and status = 'unmatched'
  ) then
    raise exception 'This conversation is not available.' using errcode = '42501';
  end if;
  if not public.can_view_member(p_peer_id) then
    raise exception 'This conversation is not available.' using errcode = '42501';
  end if;

  update public.direct_messages
  set read_at = pg_catalog.now()
  where sender_id = p_peer_id
    and recipient_id = current_user_id
    and read_at is null
    and (is_intro or exists (
      select 1 from public.user_matches
      where user_low_id = least(current_user_id, p_peer_id)
        and user_high_id = greatest(current_user_id, p_peer_id)
        and status = 'active'
    ));
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create policy "users read profile photos for visible members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then public.can_view_member((storage.foldername(name))[1]::uuid)
      else false
    end
  );
