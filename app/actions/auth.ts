"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidEmail, normalizeEmail, validateSignup } from "@/src/auth-validation.js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/supabase/env";

type FormState = {
  message: string;
  kind: "error" | "success" | "status";
};

const recoveryCookie = "splendid-hubs-password-recovery";
const legacyRecoveryCookie = "kindred-password-recovery";

const invalidLogin: FormState = {
  message: "We couldn’t sign you in. Check your details and confirm your email address.",
  kind: "error",
};

export async function signInAction(_previousState: FormState, formData: FormData): Promise<FormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!isValidEmail(email) || !password) {
    return { message: "Enter a valid email address and password.", kind: "error" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return invalidLogin;
  } catch {
    return invalidLogin;
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUpAction(_previousState: FormState, formData: FormData): Promise<FormState> {
  const result = validateSignup({
    displayName: String(formData.get("displayName") ?? ""),
    dateOfBirth: String(formData.get("dateOfBirth") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    passwordConfirmation: String(formData.get("passwordConfirmation") ?? ""),
  });
  if (result.error || !result.value) {
    return { message: result.error ?? "Check your signup details and try again.", kind: "error" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const appUrl = getAppUrl();
    const { data, error } = await supabase.auth.signUp({
      email: result.value.email,
      password: result.value.password,
      options: {
        data: {
          display_name: result.value.displayName,
          date_of_birth: result.value.dateOfBirth,
        },
        emailRedirectTo: `${appUrl}/auth/callback?next=%2F`,
      },
    });
    if (error) {
      return {
        message: "We couldn’t complete signup. Check your details and try again later.",
        kind: "error",
      };
    }
    if (data.session) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        return {
          message: "Email confirmation is disabled. Enable it in Supabase before allowing sign-in.",
          kind: "error",
        };
      }
      return {
        message: "Account created, but email confirmation is disabled. Enable email confirmations in Supabase before allowing sign-in.",
        kind: "error",
      };
    }
  } catch {
    return {
      message: "We couldn’t complete signup. Check your details and try again later.",
      kind: "error",
    };
  }

  return {
    message: "If the address can be registered, a verification email is on its way. Confirm your email before signing in.",
    kind: "success",
  };
}

export async function requestPasswordResetAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!isValidEmail(email)) {
    return { message: "Enter a valid email address.", kind: "error" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const appUrl = getAppUrl();
    const redirectTo = `${appUrl}/auth/callback?flow=recovery&next=%2Fauth%2Fupdate-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      return {
        message: "We couldn’t send a reset email right now. Please wait a moment and try again.",
        kind: "error",
      };
    }
  } catch {
    return {
      message: "We couldn’t send a reset email right now. Please wait a moment and try again.",
      kind: "error",
    };
  }

  return {
    message: "If an account uses that address, a password reset link will arrive shortly.",
    kind: "success",
  };
}

export async function updatePasswordAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");
  if (password.length < 12) {
    return { message: "Choose a password with at least 12 characters.", kind: "error" };
  }
  if (password !== confirmation) {
    return { message: "Your passwords do not match.", kind: "error" };
  }

  const cookieStore = await cookies();
  const recoveryUserId = cookieStore.get(recoveryCookie)?.value ?? cookieStore.get(legacyRecoveryCookie)?.value;
  if (!recoveryUserId) {
    return { message: "This recovery link is invalid or expired. Request a new one to continue.", kind: "error" };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user || data.user.id !== recoveryUserId) {
      cookieStore.set(recoveryCookie, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      cookieStore.set(legacyRecoveryCookie, "", { path: "/", maxAge: 0 });
      return { message: "This recovery link is invalid or expired. Request a new one to continue.", kind: "error" };
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return {
        message: "We couldn’t update the password. The reset link may have expired; request a new one.",
        kind: "error",
      };
    }
  } catch {
    return {
      message: "We couldn’t update the password. The reset link may have expired; request a new one.",
      kind: "error",
    };
  }

  cookieStore.set(recoveryCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  cookieStore.set(legacyRecoveryCookie, "", { path: "/", maxAge: 0 });
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { message: "Your password was updated. Please sign out and sign back in.", kind: "error" };
    }
  } catch {
    return { message: "Your password was updated. Please sign out and sign back in.", kind: "error" };
  }
  revalidatePath("/", "layout");
  redirect("/?password=updated");
}

export async function completeOnboardingAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  if (!displayName || displayName.length > 80 || !city || city.length > 120 || bio.length < 20 || bio.length > 500) {
    return { message: "Add your name, city, and a bio of 20 to 500 characters.", kind: "error" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) {
      return { message: "Your session expired. Please sign in again.", kind: "error" };
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ display_name: displayName, city, bio })
      .eq("id", data.user.id);
    if (profileError) {
      return { message: "We couldn’t save your profile. Please try again.", kind: "error" };
    }

    const { error } = await supabase.rpc("complete_profile_onboarding");
    if (error) {
      return {
        message: "Your details were saved, but your profile isn’t complete yet. Check the required fields and try again.",
        kind: "error",
      };
    }
  } catch {
    return { message: "We couldn’t save your profile. Please try again.", kind: "error" };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOutAction(_previousState: FormState): Promise<FormState> {
  void _previousState;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { message: "We couldn’t sign you out. Please try again.", kind: "error" };
    }
  } catch {
    return { message: "We couldn’t sign you out. Please try again.", kind: "error" };
  }
  const cookieStore = await cookies();
  cookieStore.set(recoveryCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  cookieStore.set(legacyRecoveryCookie, "", { path: "/", maxAge: 0 });
  revalidatePath("/", "layout");
  redirect("/");
}
