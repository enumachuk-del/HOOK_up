"use client";

import { useActionState } from "react";
import { updatePasswordAction } from "@/app/actions/auth";

const initialState = { message: "", kind: "status" as const };

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initialState);

  return (
    <>
      {state.message && (
        <p className={`auth-message ${state.kind}`} role="status" aria-live="polite">
          {state.message}
        </p>
      )}
      <form className="auth-form" action={action}>
        <label>
          New password (at least 12 characters)
          <input name="password" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <label>
          Confirm new password
          <input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <button className="auth-submit w-full transition" type="submit" disabled={pending}>
          {pending ? "Updating password…" : "Update password"}
        </button>
      </form>
    </>
  );
}
