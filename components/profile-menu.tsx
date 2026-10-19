"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";
import { signOutAction } from "@/app/actions/auth";

const initialSignOutState = { message: "", kind: "status" as const };

export function ProfileMenu({
  displayName,
  email,
  avatarUrl,
  isSuperAdmin = false,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isSuperAdmin?: boolean;
}) {
  const [signOutState, signOut, signOutPending] = useActionState(signOutAction, initialSignOutState);

  return (
    <details className="profile-menu">
      <summary className="top-profile" aria-label="Open profile menu">
        {avatarUrl ? (
          <Image className="avatar" src={avatarUrl} alt="" width={36} height={36} unoptimized />
        ) : (
          <span className="avatar avatar-fallback" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
        )}
        <span className="profile-menu-name">{displayName}</span><span className="profile-menu-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="profile-menu-panel">
        <div className="profile-menu-identity">
          <strong>{displayName}</strong>
          <span>{email}</span>
        </div>
        <Link href="/profile">Manage profile</Link>
        <Link href="/profile#preferences">Discovery & privacy settings</Link>
        {isSuperAdmin && <Link href="/admin">Admin Dashboard</Link>}
        <form action={signOut}>
          <button type="submit" disabled={signOutPending}>
            {signOutPending ? "Signing out…" : "Log out"}
          </button>
          {signOutState.message && <span className="signout-error" role="alert">{signOutState.message}</span>}
        </form>
      </div>
    </details>
  );
}
