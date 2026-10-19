"use client";

import { useActionState, useState } from "react";
import {
  requestPasswordResetAction,
  signInAction,
  signUpAction,
} from "@/app/actions/auth";
import { Brand } from "@/components/brand";

type AuthMode = "login" | "signup" | "recovery";
type FormState = { message: string; kind: "error" | "success" | "status" };

const emptyState: FormState = { message: "", kind: "status" };

function Message({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p className={`auth-message ${state.kind}`} role="status" aria-live="polite">
      {state.message}
    </p>
  );
}

export function AuthPanel({
  configMissing,
  initialMessage,
  initialKind = "error",
}: {
  configMissing: boolean;
  initialMessage?: string;
  initialKind?: "error" | "success" | "status";
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginState, loginAction, loginPending] = useActionState(signInAction, emptyState);
  const [signupState, signupAction, signupPending] = useActionState(signUpAction, emptyState);
  const [recoveryState, recoveryAction, recoveryPending] = useActionState(requestPasswordResetAction, emptyState);

  return (
    <main className="auth-gate" id="authGate">
      <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <Brand />
        <div className="auth-heading">
          <h1 id="authTitle">
            {mode === "login" ? "Welcome back." : mode === "signup" ? "A lovely place to start." : "A fresh start."}
          </h1>
          <p>
            {mode === "login" && "A good connection starts with showing up as yourself."}
            {mode === "signup" && "Create your account and check your inbox to verify your email."}
            {mode === "recovery" && "We’ll send a secure password reset link if there’s an account for that email."}
          </p>
        </div>
        {configMissing && (
          <div className="auth-config" role="status">
            Set valid <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>, and <code>NEXT_PUBLIC_APP_URL</code> values in <code>.env.local</code>, then restart Next.js.
          </div>
        )}
        {initialMessage && <p className={`auth-message ${initialKind}`} role="status">{initialMessage}</p>}
        {mode === "login" && (
          <form className="auth-form" action={loginAction}>
            <Message state={loginState} />
            <label>
              Email address
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="auth-submit w-full transition" type="submit" disabled={loginPending || configMissing}>
              {loginPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
        {mode === "signup" && (
          <form className="auth-form" action={signupAction}>
            <Message state={signupState} />
            <label>
              Your name
              <input name="displayName" type="text" autoComplete="name" minLength={1} maxLength={80} required />
            </label>
            <label>
              Date of birth
              <input name="dateOfBirth" type="date" autoComplete="bday" required />
            </label>
            <label>
              Email address
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </label>
            <label>
              Password (at least 12 characters)
              <input name="password" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label>
              Confirm password
              <input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <button className="auth-submit w-full transition" type="submit" disabled={signupPending || configMissing}>
              {signupPending ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
        {mode === "recovery" && (
          <form className="auth-form" action={recoveryAction}>
            <Message state={recoveryState} />
            <label>
              Email address
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </label>
            <button className="auth-submit w-full transition" type="submit" disabled={recoveryPending || configMissing}>
              {recoveryPending ? "Sending link…" : "Send reset link"}
            </button>
          </form>
        )}
        <div className="auth-links">
          {mode !== "login" ? (
            <button className="auth-link" type="button" onClick={() => setMode("login")}>Back to sign in</button>
          ) : (
            <>
              <button className="auth-link" type="button" onClick={() => setMode("signup")}>Create an account</button>
              <button className="auth-link" type="button" onClick={() => setMode("recovery")}>Forgot password?</button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
