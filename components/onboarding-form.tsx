"use client";

import { useActionState } from "react";
import { completeOnboardingAction } from "@/app/actions/auth";

const initialState = { message: "", kind: "status" as const };

export function OnboardingForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(completeOnboardingAction, initialState);

  return (
    <main className="auth-gate">
      <section className="auth-panel" aria-labelledby="onboarding-title">
        <div className="auth-heading">
          <h1 id="onboarding-title">Let’s make it you.</h1>
          <p>Add a little about yourself so your profile can be part of discovery.</p>
        </div>
        {state.message && (
          <p className={`auth-message ${state.kind}`} role="status" aria-live="polite">
            {state.message}
          </p>
        )}
        <form className="auth-form" action={action}>
          <label>
            Your name
            <input name="displayName" type="text" autoComplete="name" defaultValue={displayName} maxLength={80} required />
          </label>
          <label>
            City
            <input name="city" type="text" autoComplete="address-level2" maxLength={120} required />
          </label>
          <label>
            A little about you (at least 20 characters)
            <textarea name="bio" minLength={20} maxLength={500} required />
          </label>
          <button className="auth-submit w-full transition" type="submit" disabled={pending}>
            {pending ? "Saving profile…" : "Finish my profile"}
          </button>
        </form>
      </section>
    </main>
  );
}
