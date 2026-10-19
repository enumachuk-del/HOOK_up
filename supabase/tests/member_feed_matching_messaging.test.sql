begin;

select extensions.plan(23);

select extensions.has_table('public', 'user_matches', 'mutual match registry exists');
select extensions.has_table('public', 'user_posts', 'member posts exist');
select extensions.has_table('public', 'user_post_likes', 'post likes exist');
select extensions.has_table('public', 'user_post_comments', 'post comments exist');
select extensions.has_table('public', 'direct_messages', 'private messages exist');
select extensions.ok(
  (
    select pg_catalog.bool_and(relation.relrowsecurity)
    from pg_catalog.pg_class as relation
    where relation.oid = any (array[
      'public.user_matches'::regclass,
      'public.user_posts'::regclass,
      'public.user_post_likes'::regclass,
      'public.user_post_comments'::regclass,
      'public.direct_messages'::regclass
    ])
  ),
  'all feed, match, and message tables have RLS enabled'
);
select extensions.ok(
  (
    select pg_catalog.bool_and(
      not has_table_privilege('authenticated', table_name, 'SELECT')
      and not has_table_privilege('authenticated', table_name, 'INSERT')
      and not has_table_privilege('authenticated', table_name, 'UPDATE')
      and not has_table_privilege('authenticated', table_name, 'DELETE')
    )
    from unnest(array[
      'public.user_matches',
      'public.user_posts',
      'public.user_post_likes',
      'public.user_post_comments',
      'public.direct_messages'
    ]) as tables(table_name)
  ),
  'social records are available only through protected RPCs'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.feed_profiles(integer,timestamp with time zone,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.feed_profiles(integer,timestamp with time zone,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_social_feed()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_social_feed()', 'EXECUTE'),
  'member and post feeds are restricted to authenticated callers'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.record_profile_action(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.record_profile_action(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.unmatch_profile(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.unmatch_profile(uuid)', 'EXECUTE'),
  'like and unmatch actions are restricted to authenticated callers'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.create_user_post(text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_user_post(text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_post_like(uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_post_like(uuid,boolean)', 'EXECUTE'),
  'post creation and post likes require authentication'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_post_comments(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_post_comments(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.add_post_comment(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.add_post_comment(uuid,text)', 'EXECUTE'),
  'post comments require authenticated feed access'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.send_direct_message(uuid,text,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.send_direct_message(uuid,text,boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.list_my_conversations()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.list_my_conversations()', 'EXECUTE'),
  'message delivery and inbox access require authentication'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_conversation_messages(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_conversation_messages(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.mark_conversation_read(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.mark_conversation_read(uuid)', 'EXECUTE'),
  'conversation reads and receipts require authentication'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.record_profile_action(uuid,text,text)'::regprocedure)
    like '%auth.uid()%'
    and pg_catalog.pg_get_functiondef('public.record_profile_action(uuid,text,text)'::regprocedure)
      like '%user_profile_actions%',
  'profile likes derive their actor and reciprocal state from the database'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.send_direct_message(uuid,text,boolean)'::regprocedure)
    like '%public.user_matches%'
    and pg_catalog.pg_get_functiondef('public.send_direct_message(uuid,text,boolean)'::regprocedure)
      like '%public.user_profile_actions%',
  'ongoing messages require a match and introductions require a like'
);
select extensions.ok(
  pg_catalog.to_regclass('public.direct_messages_one_intro_per_pair') is not null,
  'a member can only send one introductory message to another member'
);
select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.user_matches'::regclass
      and contype = 'p'
      and pg_catalog.pg_get_constraintdef(oid) like '%user_low_id, user_high_id%'
  ),
  'each member pair has one durable match record'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.can_view_member(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.can_view_member(uuid)', 'EXECUTE'),
  'member visibility checks are not available to anonymous callers'
);
select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'users read profile photos for visible members'
  ),
  'photo access follows database member visibility'
);
select extensions.ok(
  not (select public from storage.buckets where id = 'profile-photos'),
  'member photos remain in private storage'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.record_profile_action(uuid,text,text)'::regprocedure)
    like '%pg_advisory_xact_lock%'
    and pg_catalog.pg_get_functiondef('public.unmatch_profile(uuid)'::regprocedure)
      like '%pg_advisory_xact_lock%',
  'simultaneous mutual likes and unmatches are serialized by pair'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.get_conversation_messages(uuid)'::regprocedure)
    like '%status = ''unmatched''%'
    and pg_catalog.pg_get_functiondef('public.get_conversation_messages(uuid)'::regprocedure)
      like '%public.can_view_member%',
  'closed or blocked conversations cannot be read'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef('public.feed_profiles(integer,timestamp with time zone,uuid)'::regprocedure)
    like '%p_after_updated_at%'
    and pg_catalog.pg_get_functiondef('public.feed_profiles(integer,timestamp with time zone,uuid)'::regprocedure)
      like '%profile.id > p_after_id%',
  'member feed pagination uses a stable keyset cursor'
);

select * from extensions.finish();
rollback;
