"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordProfileAction } from "@/app/actions/discovery";
import { ProfileMenu } from "@/components/profile-menu";

const navItems = [
  { icon: "⌕", label: "Discover" },
  { icon: "♡", label: "Likes you" },
  { icon: "✉", label: "Messages" },
  { icon: "✧", label: "Standouts" },
];

export type DiscoveryProfile = {
  id: string;
  name: string;
  age: number;
  job: string | null;
  city: string | null;
  bio: string | null;
  imageUrl: string | null;
};

export function DiscoveryApp({
  displayName,
  email,
  avatarUrl,
  isSuperAdmin = false,
  profiles,
  receivedLikes,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isSuperAdmin?: boolean;
  profiles: DiscoveryProfile[];
  receivedLikes: number;
}) {
  const router = useRouter();
  const [hiddenProfiles, setHiddenProfiles] = useState<Set<string>>(new Set());
  const [activeNav, setActiveNav] = useState("Discover");
  const [toast, setToast] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const profile = profiles.find((candidate) => !hiddenProfiles.has(candidate.id));

  async function advance(action: "like" | "pass") {
    if (!profile || actionPending) return;
    setActionPending(true);
    try {
      const result = await recordProfileAction(profile.id, action);
      setToast(result.message);
      if (result.ok) {
        setHiddenProfiles((current) => new Set(current).add(profile.id));
        router.refresh();
      }
    } catch {
      setToast("We couldn’t save that action. Refresh and try again.");
    } finally {
      setActionPending(false);
    }
  }

  function chooseNav(label: string) {
    setActiveNav(label);
    if (label !== "Discover") setToast(`${label} is coming soon.`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Splendid Hubs home">
          <span className="brand-mark" aria-hidden="true">♡</span><span className="brand-name">Splendid Hubs</span>
        </Link>
        <div className="top-note">A little less swiping, a little more <span>✨ something.</span></div>
        <ProfileMenu displayName={displayName} email={email} avatarUrl={avatarUrl} isSuperAdmin={isSuperAdmin} />
      </header>

      <main className="layout">
        <aside className="sidebar" aria-label="Main navigation">
          <p className="side-label">Your space</p>
          <nav className="menu">
            {navItems.map(item => (
              <button
                className={`menu-item ${activeNav === item.label ? "active" : ""}`}
                key={item.label}
                onClick={() => chooseNav(item.label)}
                type="button"
              >
                <span className="menu-icon">{item.icon}</span>{item.label}
              </button>
            ))}
          </nav>
          {isSuperAdmin && <Link className="admin-discovery-link" href="/admin"><span aria-hidden="true">◫</span> Admin Dashboard</Link>}
          <div className="sidebar-divider" />
          <p className="side-label">Make it yours</p>
          <Link className="profile-prompt profile-prompt-link" href="/profile">
            <span className="prompt-icon">✳</span>
            <h3>Make your profile yours.</h3>
            <p>Update your story, photo, and discovery preferences.</p>
            <span className="profile-prompt-action">Manage profile →</span>
          </Link>
        </aside>

        <section className="discover" aria-label="Discover people">
          <div className="discover-heading">
            <div><p className="eyebrow">Thoughtful connections</p><h1>Your kind of people.</h1></div>
            <button className="filter-button" onClick={() => setToast("Discovery filters are coming soon.")} type="button">
              <span>☷</span> Filters
            </button>
          </div>
          <p className="preview-note">Profiles come from Supabase. Likes and passes are saved to your account.</p>
          <article className="card" aria-live="polite">
            {profile ? (
              <>
                {profile.imageUrl
                  ? <Image className="card-image" src={profile.imageUrl} alt={`${profile.name}'s profile photo`} fill sizes="(max-width: 700px) 100vw, 550px" priority unoptimized />
                  : <div className="card-photo-placeholder" aria-label="No profile photo provided">{profile.name.slice(0, 1).toUpperCase()}</div>}
                <div className="card-shade" />
                <div className="card-copy">
                  <div className="name-row">
                    <h2>{profile.name}</h2><span className="age">{profile.age}</span>
                  </div>
                  {(profile.job || profile.city) && <p className="occupation">{[profile.job, profile.city].filter(Boolean).join(" · ")}</p>}
                  {profile.bio && <p className="bio">{profile.bio}</p>}
                </div>
              </>
            ) : (
              <div className="empty-card">
                <div>
                  <div className="empty-heart">♡</div>
                  <h2>You’re all caught up.</h2>
                  <p>There are no more profiles to discover right now. Check back later as new people join.</p>
                  <Link href="/profile#preferences">Update discovery preferences</Link>
                </div>
              </div>
            )}
          </article>
          <div className="actions" aria-label="Profile actions">
            <div className="action-wrap"><button className="action pass" onClick={() => advance("pass")} aria-label="Pass on this profile" disabled={!profile || actionPending} type="button">×</button><span className="action-label">PASS</span></div>
            <div className="action-wrap"><button className="action boost" onClick={() => setToast("Kind notes are coming soon.")} aria-label="Send a kind note" disabled={!profile || actionPending} type="button">✦</button><span className="action-label">KIND NOTE</span></div>
            <div className="action-wrap"><button className="action like" onClick={() => advance("like")} aria-label="Like this profile" disabled={!profile || actionPending} type="button"><span aria-hidden="true">♡</span></button><span className="action-label">LIKE</span></div>
          </div>
          <p className="action-hint">{actionPending ? "Saving your choice…" : "A thoughtful hello goes a long way."}</p>
        </section>

        <aside className="right-rail" aria-label="Preview activity">
          <section className="rail-card">
            <div className="rail-title"><h3>Your likes</h3><span className="text-link">Saved</span></div>
            <div className="match-stat"><div className="match-icon">♡</div><div><strong>{receivedLikes}</strong><small> likes received</small></div></div>
            <p className="match-footnote">Likes are stored securely. Mutual matches and messaging aren’t available yet.</p>
          </section>
          <section className="rail-card">
            <div className="rail-title"><h3>Messages</h3><span className="text-link">Coming soon</span></div>
            <p className="match-footnote">Private conversations will be available after messaging is connected.</p>
          </section>
          <section className="rail-card date-card">
            <div className="rail-title"><h3>Good first-date energy</h3><span>☀</span></div>
            <p>“A walk, a good pastry, and letting the conversation find its own way.”</p>
          </section>
        </aside>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 3).map(item => (
          <button
            className={activeNav === item.label ? "active" : ""}
            key={item.label}
            onClick={() => chooseNav(item.label)}
            type="button"
          >
            <span>{item.icon}</span>{item.label === "Likes you" ? "Likes" : item.label === "Messages" ? "Chats" : item.label}
          </button>
        ))}
        <Link href="/profile"><span>☺</span>Profile</Link>
        {isSuperAdmin && <Link className="mobile-admin-link" href="/admin"><span aria-hidden="true">◫</span>Admin</Link>}
      </nav>
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
