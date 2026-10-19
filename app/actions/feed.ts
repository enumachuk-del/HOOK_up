"use server";

import type { FeedProfile } from "@/components/member-feed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FeedProfileRow = {
  id: string;
  updated_at: string;
  display_name: string;
  age: number;
  occupation: string | null;
  city: string | null;
  country_code: string | null;
  bio: string | null;
  photo_paths: string[];
  liked_by_me: boolean;
  they_liked_me: boolean;
  is_matched: boolean;
  intro_sent_by_me: boolean;
  intro_sent_by_them: boolean;
};

export type FeedCursor = { updatedAt: string; id: string } | null;

export async function loadMoreProfilesAction(
  cursor: FeedCursor,
): Promise<{ ok: boolean; profiles: FeedProfile[]; nextCursor: FeedCursor; hasMore: boolean; message?: string }> {
  if (cursor && (!uuidPattern.test(cursor.id) || !Number.isFinite(Date.parse(cursor.updatedAt)))) {
    return { ok: false, profiles: [], nextCursor: null, hasMore: false, message: "Refresh the feed and try again." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false, profiles: [], nextCursor: null, hasMore: false, message: "Sign in again to continue browsing." };
  }
  const { data: isActive, error: statusError } = await supabase.rpc("is_account_active");
  if (statusError || !isActive) {
    return { ok: false, profiles: [], nextCursor: null, hasMore: false, message: "Your account cannot browse members right now." };
  }

  const { data, error } = await supabase.rpc("feed_profiles", {
    p_limit: 50,
    p_after_updated_at: cursor?.updatedAt ?? null,
    p_after_id: cursor?.id ?? null,
  });
  if (error || !data) {
    return { ok: false, profiles: [], nextCursor: null, hasMore: false, message: "More profiles could not be loaded. Try again." };
  }
  const rows = data as FeedProfileRow[];
  const paths = [...new Set(rows.flatMap((row) => row.photo_paths ?? []))];
  const signedResults = await Promise.all(
    Array.from({ length: Math.ceil(paths.length / 100) }, (_, index) =>
      supabase.storage.from("profile-photos").createSignedUrls(paths.slice(index * 100, (index + 1) * 100), 60 * 60),
    ),
  );
  if (signedResults.some((result) => result.error)) {
    return { ok: false, profiles: [], nextCursor: null, hasMore: false, message: "More profile photos could not be loaded securely. Try again." };
  }
  const urls = new Map(
    signedResults.flatMap((result) => result.data ?? []).map((photo) => [photo.path, photo.signedUrl]),
  );
  const profiles = rows.map((row): FeedProfile => ({
    id: row.id,
    name: row.display_name,
    age: row.age,
    job: row.occupation,
    city: row.country_code ? `${row.city ?? ""}${row.city ? ", " : ""}${row.country_code}` : row.city,
    bio: row.bio,
    photos: row.photo_paths.map((path) => urls.get(path)).filter((url): url is string => Boolean(url)),
    likedByMe: row.liked_by_me,
    theyLikedMe: row.they_liked_me,
    isMatched: row.is_matched,
    introSentByMe: row.intro_sent_by_me,
    introSentByThem: row.intro_sent_by_them,
  }));
  const last = rows.at(-1);
  return {
    ok: true,
    profiles,
    nextCursor: last ? { updatedAt: last.updated_at, id: last.id } : cursor,
    hasMore: rows.length === 50,
  };
}
