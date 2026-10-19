import { AuthPanel } from "@/components/auth-panel";
import { MemberFeed } from "@/components/member-feed";
import { OnboardingForm } from "@/components/onboarding-form";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/supabase/env";

type HomeProps = {
  searchParams: Promise<{ auth_error?: string; password?: string }>;
};

type FeedRpcProfile = {
  id: string;
  updated_at: string;
  username: string | null;
  display_name: string;
  age: number;
  gender: string | null;
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

type FeedRpcPost = {
  id: string;
  author_id: string;
  author_name: string;
  author_photo_path: string | null;
  caption: string;
  photo_path: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
};

function SignedInProblem({ message }: { message: string }) {
  return (
    <main className="auth-gate">
      <section className="auth-panel" role="alert">
        <Brand />
        <div className="auth-heading">
          <h1>We couldn’t load your profile.</h1>
          <p>{message}</p>
        </div>
        <SignOutButton displayName="your account" />
      </section>
    </main>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  if (!hasSupabaseConfig()) {
    return (
      <div className="app">
        <header className="topbar"><Brand /><div className="top-note">A little less swiping, a little more <span>✨ something.</span></div></header>
        <AuthPanel configMissing />
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const hasAuthError = authError !== null && !isAuthSessionMissingError(authError);
  if (hasAuthError || !authData.user) {
    const initialMessage = hasAuthError
      ? "We couldn’t verify your session. Check your connection and try again."
      : params.auth_error === "callback"
      ? "That verification or recovery link is invalid or expired. Sign in or request a new link."
      : params.password === "updated"
        ? "Password updated. You can now sign in with your new password."
        : undefined;
    const initialKind = params.password === "updated" && !hasAuthError ? "success" : "error";
    return (
      <div className="app">
        <header className="topbar"><Brand /><div className="top-note">A little less swiping, a little more <span>✨ something.</span></div></header>
        <AuthPanel configMissing={false} initialMessage={initialMessage} initialKind={initialKind} />
      </div>
    );
  }

  const { error: bootstrapError } = await supabase.rpc("claim_super_admin");
  if (bootstrapError) {
    return <SignedInProblem message="The account authorization migration is not available yet. Apply the latest Supabase migration, then reload this page." />;
  }
  const [{ data: isSuperAdmin, error: roleError }, { data: accountStatus, error: statusError }] = await Promise.all([
    supabase.rpc("is_super_admin"),
    supabase.rpc("current_account_status"),
  ]);
  if (roleError || statusError || !accountStatus) {
    return <SignedInProblem message="We couldn’t verify account permissions. Check the latest Supabase migration and try again." />;
  }
  if (accountStatus !== "active") {
    return <SignedInProblem message="This account is currently suspended or deactivated. Contact the platform administrator if you believe this is a mistake." />;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, onboarding_completed")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profile) {
    return <SignedInProblem message="The profile database is unavailable. Check that the Supabase migration has been applied, then try again." />;
  }
  if (!profile.onboarding_completed) {
    return (
      <div className="app">
        <header className="topbar"><Brand /><div className="top-note">A little less swiping, a little more <span>✨ something.</span></div>{isSuperAdmin && <Link className="admin-discovery-link" href="/admin">Admin Dashboard</Link>}</header>
        <OnboardingForm displayName={profile.display_name} />
      </div>
    );
  }

  const [
    { data: discoveryProfiles, error: discoveryError },
    { data: feedPosts, error: feedPostsError },
    { data: receivedLikes, error: likesError },
    { data: primaryPhoto, error: primaryPhotoError },
  ] = await Promise.all([
    supabase.rpc("feed_profiles", {
      p_limit: 50,
      p_after_updated_at: null,
      p_after_id: null,
    }),
    supabase.rpc("get_social_feed"),
    supabase.rpc("my_received_like_count"),
    supabase.from("user_photos").select("storage_path").eq("user_id", authData.user.id).eq("is_primary", true).maybeSingle(),
  ]);

  if (discoveryError || feedPostsError || likesError || primaryPhotoError || !discoveryProfiles || !feedPosts || receivedLikes === null) {
    return <SignedInProblem message="We couldn’t load your saved discovery data. Check that the latest Supabase migration is applied, then try again." />;
  }

  const profilesForDiscovery = discoveryProfiles as FeedRpcProfile[];
  const postsForFeed = feedPosts as FeedRpcPost[];
  const receivedLikesCount = Number(receivedLikes);
  if (!Number.isSafeInteger(receivedLikesCount) || receivedLikesCount < 0) {
    return <SignedInProblem message="We couldn’t load your saved discovery data. Check that the latest Supabase migration is applied, then try again." />;
  }
  const imagePaths = [...new Set([
    ...(primaryPhoto ? [primaryPhoto.storage_path] : []),
    ...profilesForDiscovery.flatMap((candidate) => candidate.photo_paths ?? []),
    ...postsForFeed.flatMap((post) => [post.author_photo_path, post.photo_path].filter((path): path is string => Boolean(path))),
  ])];
  const signedPhotoResults = await Promise.all(
    Array.from({ length: Math.ceil(imagePaths.length / 100) }, (_, index) =>
      supabase.storage.from("profile-photos").createSignedUrls(imagePaths.slice(index * 100, (index + 1) * 100), 60 * 60),
    ),
  );
  if (signedPhotoResults.some((result) => result.error)) {
    return <SignedInProblem message="We couldn’t securely load your profile photos. Check the photo-storage policies and try again." />;
  }
  const photoUrls = new Map(
    signedPhotoResults.flatMap((result) => result.data ?? []).map((signedPhoto) => [signedPhoto.path, signedPhoto.signedUrl]),
  );

  const cards = profilesForDiscovery.map((candidate) => ({
    id: candidate.id,
    name: candidate.display_name,
    age: candidate.age,
    job: candidate.occupation,
    city: candidate.country_code ? `${candidate.city ?? ""}${candidate.city ? ", " : ""}${candidate.country_code}` : candidate.city,
    bio: candidate.bio,
    photos: candidate.photo_paths.map((path) => photoUrls.get(path)).filter((url): url is string => Boolean(url)),
    likedByMe: candidate.liked_by_me,
    theyLikedMe: candidate.they_liked_me,
    isMatched: candidate.is_matched,
    introSentByMe: candidate.intro_sent_by_me,
    introSentByThem: candidate.intro_sent_by_them,
  }));

  return (
    <MemberFeed
      displayName={profile.display_name}
      email={authData.user.email ?? ""}
      avatarUrl={primaryPhoto ? photoUrls.get(primaryPhoto.storage_path) ?? null : null}
      isSuperAdmin={isSuperAdmin ?? false}
      profiles={cards}
      profileCursor={profilesForDiscovery.length
        ? { updatedAt: profilesForDiscovery[profilesForDiscovery.length - 1].updated_at, id: profilesForDiscovery[profilesForDiscovery.length - 1].id }
        : null}
      hasMoreProfiles={profilesForDiscovery.length === 50}
      posts={postsForFeed.map((post) => ({
        id: post.id,
        authorId: post.author_id,
        authorName: post.author_name,
        authorAvatarUrl: post.author_photo_path ? photoUrls.get(post.author_photo_path) ?? null : null,
        caption: post.caption,
        photoUrl: post.photo_path ? photoUrls.get(post.photo_path) ?? null : null,
        createdAt: post.created_at,
        likes: Number(post.like_count),
        comments: Number(post.comment_count),
        likedByMe: post.liked_by_me,
      }))}
      receivedLikes={receivedLikesCount}
    />
  );
}
