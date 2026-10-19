"use client";

import { useActionState } from "react";
import { signOutAction } from "@/app/actions/auth";

const initialState = { message: "", kind: "status" as const };

export function SignOutButton({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(signOutAction, initialState);

  return (
    <form action={action}>
      <button className="top-profile sign-out-link" type="submit" disabled={pending} aria-label={`Sign out ${displayName}`}>
        <span>{pending ? "Signing out…" : "Sign out"}</span>
      </button>
      {state.message && <span className="signout-error" role="alert">{state.message}</span>}
    </form>
  );
}
