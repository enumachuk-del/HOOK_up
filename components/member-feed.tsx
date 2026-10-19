"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { recordProfileAction } from "@/app/actions/discovery";
import { loadMoreProfilesAction, type FeedCursor } from "@/app/actions/feed";
import {
  addPostCommentAction,
  createUserPostAction,
  getPostCommentsAction,
  sendDirectMessageAction,
  setPostLikeAction,
  unmatchProfileAction,
  type PostComment,
  type SocialFormState,
} from "@/app/actions/social";
import { ProfileMenu } from "@/components/profile-menu";

export type FeedProfile = {
  id: string;
  name: string;
  age: number;
  job: string | null;
  city: string | null;
  bio: string | null;
  photos: string[];
  likedByMe: boolean;
  theyLikedMe: boolean;
  isMatched: boolean;
  introSentByMe: boolean;
  introSentByThem: boolean;
};

export type FeedPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  caption: string;
  photoUrl: string | null;
  createdAt: string;
  likes: number;
  comments: number;
  likedByMe: boolean;
};

const initialPostState: SocialFormState = { message: "", kind: "status" };

function ProfileCard({
  profile,
  onAction,
  onIntro,
  onUnmatch,
}: {
  profile: FeedProfile;
  onAction: (profile: FeedProfile, action: "like" | "pass", intro?: string) => Promise<void>;
  onIntro: (profile: FeedProfile, intro: string) => Promise<void>;
  onUnmatch: (profile: FeedProfile) => Promise<void>;
}) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [intro, setIntro] = useState("");
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const photo = profile.photos[photoIndex];

  function swipe(endX: number) {
    if (touchStart === null) return;
    const delta = endX - touchStart;
    setTouchStart(null);
    if (Math.abs(delta) < 70) return;
    if (delta < 0) void onAction(profile, "pass");
    else if (!profile.likedByMe) void onAction(profile, "like", intro);
  }

  return (
    <article
      id={`member-${profile.id}`}
      className="member-card"
      onTouchStart={(event) => setTouchStart(event.changedTouches[0].clientX)}
      onTouchEnd={(event) => swipe(event.changedTouches[0].clientX)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") void onAction(profile, "pass");
        if (event.key === "ArrowRight" && !profile.likedByMe) void onAction(profile, "like", intro);
      }}
      tabIndex={0}
      aria-label={`${profile.name}, ${profile.age}`}
    >
      <div className="member-card-photo">
        {photo
          ? <Image src={photo} alt={`${profile.name}'s photo ${photoIndex + 1}`} fill sizes="(max-width: 700px) 88vw, 300px" unoptimized />
          : <div className="member-photo-placeholder">{profile.name.slice(0, 1).toUpperCase()}</div>}
        <div className="member-card-shade" />
        {profile.photos.length > 1 && (
          <>
            <button type="button" className="gallery-arrow previous" aria-label="Previous photo" onClick={() => setPhotoIndex((photoIndex - 1 + profile.photos.length) % profile.photos.length)}>‹</button>
            <button type="button" className="gallery-arrow next" aria-label="Next photo" onClick={() => setPhotoIndex((photoIndex + 1) % profile.photos.length)}>›</button>
            <span className="gallery-count">{photoIndex + 1} / {profile.photos.length}</span>
          </>
        )}
        <div className="member-card-copy">
          <div className="member-name-line"><h3>{profile.name}</h3><span>{profile.age}</span></div>
          {(profile.job || profile.city) && <p>{[profile.job, profile.city].filter(Boolean).join(" · ")}</p>}
          {profile.bio && <p className="member-card-bio">{profile.bio}</p>}
        </div>
      </div>
      <div className="member-card-actions">
        {profile.isMatched ? (
          <>
            <span className="matched-label">It’s a match</span>
            <Link className="member-message-button" href={`/messages?with=${profile.id}`}>Message</Link>
            <button type="button" className="member-unmatch-button" onClick={() => void onUnmatch(profile)}>Unmatch</button>
          </>
        ) : profile.likedByMe ? (
          <span className="liked-label">{profile.theyLikedMe ? "Like them back to match" : "Like sent"}</span>
        ) : (
          <button type="button" className="member-like-button" onClick={() => void onAction(profile, "like", intro)}>
          {profile.theyLikedMe ? (profile.introSentByThem ? "Like back & match ♥" : "Like back ♥") : "Like profile ♥"}
          </button>
        )}
        {!profile.isMatched && !profile.introSentByMe && (
          <label className="intro-message-field">
            {profile.likedByMe ? "Add your one introduction" : "Add a first message (optional)"}
            <textarea value={intro} maxLength={500} rows={2} onChange={(event) => setIntro(event.target.value)} placeholder="Say hello with a thoughtful note" />
          </label>
        )}
        {profile.introSentByMe && !profile.isMatched && <span className="liked-label">Your introduction is waiting for a reply</span>}
        {profile.likedByMe && !profile.isMatched && !profile.introSentByMe && intro.trim() && (
          <button type="button" className="member-like-button" onClick={() => void onIntro(profile, intro)}>Send introduction</button>
        )}
        {!profile.isMatched && <button type="button" className="member-pass-button" onClick={() => void onAction(profile, "pass")}>Pass</button>}
      </div>
    </article>
  );
}

function PostComposer({ displayName, avatarUrl }: { displayName: string; avatarUrl: string | null }) {
  const [state, action, pending] = useActionState(createUserPostAction, initialPostState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.kind === "success") formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} className="feed-composer" action={action}>
      <div className="feed-composer-heading">
        {avatarUrl
          ? <Image className="feed-post-avatar" src={avatarUrl} alt="" width={42} height={42} unoptimized />
          : <span className="feed-avatar-fallback">{displayName.slice(0, 1).toUpperCase()}</span>}
        <strong>Share a moment</strong>
      </div>
      <textarea name="caption" maxLength={1000} rows={3} placeholder="A little about what’s happening in your world…" />
      <div className="feed-composer-actions">
        <label className="feed-photo-picker">Add a photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></label>
        <button type="submit" disabled={pending}>{pending ? "Sharing…" : "Share post"}</button>
      </div>
      {state.message && <p className={`feed-form-message ${state.kind}`} role={state.kind === "error" ? "alert" : "status"}>{state.message}</p>}
    </form>
  );
}

function FeedPostCard({ post, onNotice }: { post: FeedPost; onNotice: (message: string) => void }) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likes);
  const [commentCount, setCommentCount] = useState(post.comments);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [pending, startTransition] = useTransition();

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikes((count) => count + (next ? 1 : -1));
    try {
      const result = await setPostLikeAction(post.id, next);
      if (result.ok) return;
      setLiked(!next);
      setLikes((count) => count + (next ? -1 : 1));
      onNotice(result.message);
    } catch {
      setLiked(!next);
      setLikes((count) => count + (next ? -1 : 1));
      onNotice("We couldn’t save your post like. Refresh and try again.");
    }
  }

  async function toggleComments() {
    const opening = !commentsOpen;
    setCommentsOpen(opening);
    if (!opening || comments.length) return;
    setLoadingComments(true);
    try {
      const result = await getPostCommentsAction(post.id);
      if (result.ok) setComments(result.comments);
      else onNotice(result.message ?? "Comments could not be loaded.");
    } catch {
      onNotice("Comments could not be loaded. Try again.");
    } finally {
      setLoadingComments(false);
    }
  }

  function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commentText.trim();
    if (!text || pending) return;
    startTransition(async () => {
      try {
        const result = await addPostCommentAction(post.id, text);
        if (result.ok) {
          setComments((current) => [...current, {
            id: crypto.randomUUID(),
            author_id: "",
            author_name: "You",
            content: text,
            created_at: new Date().toISOString(),
          }]);
          setCommentCount((count) => count + 1);
          setCommentText("");
          onNotice(result.message);
        } else onNotice(result.message);
      } catch {
        onNotice("We couldn’t post your comment. Try again.");
      }
    });
  }

  return (
    <article className="feed-post">
      <header className="feed-post-author">
        {post.authorAvatarUrl
          ? <Image className="feed-post-avatar" src={post.authorAvatarUrl} alt="" width={44} height={44} unoptimized />
          : <span className="feed-post-avatar feed-avatar-fallback">{post.authorName.slice(0, 1).toUpperCase()}</span>}
        <div><strong>{post.authorName}</strong><time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>
        <Link href={`/#member-${post.authorId}`} className="feed-post-view-profile">View profile</Link>
      </header>
      {post.photoUrl && <div className="feed-post-image"><Image src={post.photoUrl} alt={`Photo shared by ${post.authorName}`} fill sizes="(max-width: 700px) 100vw, 640px" unoptimized /></div>}
      {post.caption && <p className="feed-post-caption">{post.caption}</p>}
      <div className="feed-post-actions">
        <button type="button" onClick={() => void toggleLike()} aria-pressed={liked} className={liked ? "liked" : ""}>♥ {liked ? "Liked" : "Like"} <span>{likes}</span></button>
        <button type="button" onClick={() => void toggleComments()}>Comment <span>{commentCount}</span></button>
        <Link href={`/#member-${post.authorId}`} className="feed-message-link">Meet member</Link>
      </div>
      {commentsOpen && (
        <div className="feed-comments">
          {loadingComments ? <p>Loading comments…</p> : comments.map((comment) => (
            <p key={comment.id}><strong>{comment.author_name}</strong> {comment.content}</p>
          ))}
          <form onSubmit={addComment}>
            <input value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={1000} placeholder="Write a comment…" aria-label="Write a comment" />
            <button type="submit" disabled={pending || !commentText.trim()}>{pending ? "…" : "Post"}</button>
          </form>
        </div>
      )}
    </article>
  );
}

export function MemberFeed({
  displayName,
  email,
  avatarUrl,
  isSuperAdmin = false,
  profiles,
  posts,
  receivedLikes,
  profileCursor,
  hasMoreProfiles,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isSuperAdmin?: boolean;
  profiles: FeedProfile[];
  posts: FeedPost[];
  receivedLikes: number;
  profileCursor: FeedCursor;
  hasMoreProfiles: boolean;
}) {
  const router = useRouter();
  const [hiddenProfiles, setHiddenProfiles] = useState<Set<string>>(new Set());
  const [additionalProfiles, setAdditionalProfiles] = useState<FeedProfile[]>([]);
  const [nextProfileCursor, setNextProfileCursor] = useState(profileCursor);
  const [moreProfilesAvailable, setMoreProfilesAvailable] = useState(hasMoreProfiles);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(false);

  const allProfiles = [...profiles, ...additionalProfiles];

  async function loadMoreProfiles() {
    if (loadingProfiles || !moreProfilesAvailable || !nextProfileCursor) return;
    setLoadingProfiles(true);
    try {
      const result = await loadMoreProfilesAction(nextProfileCursor);
      if (!result.ok) {
        setNotice(result.message ?? "More profiles could not be loaded.");
        return;
      }
      setAdditionalProfiles((current) => {
        const existing = new Set([...profiles, ...current].map((profile) => profile.id));
        return [...current, ...result.profiles.filter((profile) => !existing.has(profile.id))];
      });
      setNextProfileCursor(result.nextCursor);
      setMoreProfilesAvailable(result.hasMore);
    } catch {
      setNotice("More profiles could not be loaded. Try again.");
    } finally {
      setLoadingProfiles(false);
    }
  }

  async function onAction(profile: FeedProfile, action: "like" | "pass", intro?: string) {
    if (pending) return;
    setPending(true);
    try {
      const result = await recordProfileAction(profile.id, action, intro);
      setNotice(result.message);
      if (result.ok) {
        if (action === "pass") setHiddenProfiles((current) => new Set(current).add(profile.id));
        if (action === "like") {
          setAdditionalProfiles((current) => current.map((candidate) => candidate.id === profile.id
            ? { ...candidate, likedByMe: true, isMatched: result.matched === true }
            : candidate));
        }
        if (result.matched) setNotice("It’s a match! You can now message each other.");
        router.refresh();
      }
    } catch {
      setNotice("We couldn’t save that action. Refresh and try again.");
    } finally {
      setPending(false);
    }
  }

  async function onUnmatch(profile: FeedProfile) {
    if (!window.confirm(`Unmatch from ${profile.name}? This closes your conversation.`)) return;
    try {
      const result = await unmatchProfileAction(profile.id);
      setNotice(result.message);
      if (result.ok) {
        setAdditionalProfiles((current) => current.filter((candidate) => candidate.id !== profile.id));
        router.refresh();
      }
    } catch {
      setNotice("We couldn’t end this match. Refresh and try again.");
    }
  }

  async function onIntro(profile: FeedProfile, intro: string) {
    if (pending) return;
    setPending(true);
    try {
      const result = await sendDirectMessageAction(profile.id, intro, true);
      setNotice(result.message);
      if (result.ok) {
        setAdditionalProfiles((current) => current.map((candidate) => candidate.id === profile.id
          ? { ...candidate, introSentByMe: true }
          : candidate));
        router.refresh();
      }
    } catch {
      setNotice("We couldn’t send your introduction. Refresh and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Splendid Hubs home">
          <span className="brand-mark" aria-hidden="true">♡</span><span className="brand-name">Splendid Hubs</span>
        </Link>
        <div className="top-note">Good conversations begin with <span>showing up.</span></div>
        <ProfileMenu displayName={displayName} email={email} avatarUrl={avatarUrl} isSuperAdmin={isSuperAdmin} />
      </header>
      <main className="layout member-feed-layout">
        <aside className="sidebar" aria-label="Main navigation">
          <p className="side-label">Your space</p>
          <nav className="menu">
            <a className="menu-item active" href="#people"><span className="menu-icon">⌕</span>Discover</a>
            <a className="menu-item" href="#posts"><span className="menu-icon">▤</span>Community feed</a>
            <Link className="menu-item" href="/messages"><span className="menu-icon">✉</span>Matches & messages</Link>
          </nav>
          {isSuperAdmin && <Link className="admin-discovery-link" href="/admin"><span aria-hidden="true">◫</span> Admin Dashboard</Link>}
          <div className="sidebar-divider" />
          <p className="side-label">Make it yours</p>
          <Link className="profile-prompt profile-prompt-link" href="/profile">
            <span className="prompt-icon">✳</span><h3>Your profile</h3>
            <p>Update your story, photos, and discovery preferences.</p>
            <span className="profile-prompt-action">Manage profile →</span>
          </Link>
        </aside>

        <section className="member-feed-content">
          <section id="people" className="people-section" aria-labelledby="people-heading">
            <div className="discover-heading">
              <div><p className="eyebrow">Thoughtful connections</p><h1 id="people-heading">People to meet</h1></div>
              <Link className="filter-button" href="/profile#preferences">Preferences</Link>
            </div>
            <p className="feed-intro">Get to know real members, explore their photos, and start with a thoughtful like.</p>
            {allProfiles.length ? (
              <div className="member-card-grid">
                {allProfiles.filter((profile) => !hiddenProfiles.has(profile.id)).map((profile) => (
                  <ProfileCard key={profile.id} profile={profile} onAction={onAction} onIntro={onIntro} onUnmatch={onUnmatch} />
                ))}
              </div>
            ) : (
              <div className="feed-empty-state"><h2>More introductions are on the way.</h2><p>We’ll show active members who match your discovery preferences here.</p><Link href="/profile#preferences">Review preferences</Link></div>
            )}
            {moreProfilesAvailable && (
              <button className="feed-load-more" type="button" onClick={() => void loadMoreProfiles()} disabled={loadingProfiles}>
                {loadingProfiles ? "Loading members…" : "Show more members"}
              </button>
            )}
          </section>

          <section id="posts" className="posts-section" aria-labelledby="posts-heading">
            <div className="discover-heading"><div><p className="eyebrow">A little about your day</p><h2 id="posts-heading">Community feed</h2></div></div>
            <PostComposer displayName={displayName} avatarUrl={avatarUrl} />
            {posts.length ? posts.map((post) => (
              <FeedPostCard key={`${post.id}:${post.likes}:${post.likedByMe}:${post.comments}`} post={post} onNotice={setNotice} />
            )) : (
              <div className="feed-empty-state"><h3>Start the conversation.</h3><p>Share a photo or a small moment to welcome others into your feed.</p></div>
            )}
          </section>
        </section>

        <aside className="right-rail" aria-label="Your activity">
          <section className="rail-card">
            <div className="rail-title"><h3>Your likes</h3><span className="text-link">Activity</span></div>
            <div className="match-stat"><div className="match-icon">♡</div><div><strong>{receivedLikes}</strong><small> likes received</small></div></div>
            <p className="match-footnote">When you both like each other, you’ll find your match in messages.</p>
            <Link className="rail-action-link" href="/messages">View matches & messages →</Link>
          </section>
          <section className="rail-card">
            <div className="rail-title"><h3>Good connections</h3><span>♡</span></div>
            <p className="match-footnote">Be kind, take your time, and share only what feels right for you.</p>
          </section>
        </aside>
      </main>
      <nav className="mobile-member-nav" aria-label="Mobile navigation">
        <a href="#people"><span aria-hidden="true">⌕</span>People</a>
        <a href="#posts"><span aria-hidden="true">▤</span>Feed</a>
        <Link href="/messages"><span aria-hidden="true">✉</span>Matches</Link>
        <Link href="/profile"><span aria-hidden="true">◉</span>Profile</Link>
      </nav>
      {notice && <div className="feed-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
      {pending && <div className="feed-pending" aria-live="polite">Saving your choice…</div>}
    </div>
  );
}
