"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function recordProfileAction(
  profileId: string,
  action: "like" | "pass",
  introMessage?: string,
): Promise<{ ok: boolean; message: string; matched?: boolean }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return { ok: false, message: "That profile could not be found. Refresh and try again." };
  }
  if (action !== "like" && action !== "pass") {
    return { ok: false, message: "Choose like or pass, then try again." };
  }
  const cleanIntro = introMessage?.trim() ?? "";
  if (cleanIntro.length > 500 || (cleanIntro && action !== "like")) {
    return { ok: false, message: "An introductory message must be 500 characters or fewer and accompany a like." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: user, error: userError } = await supabase.auth.getUser();
  if (userError || !user.user) {
    return { ok: false, message: "Your session expired. Sign in again to continue." };
  }

  const { data: isActive, error: statusError } = await supabase.rpc("is_account_active");
  if (statusError || !isActive) {
    return { ok: false, message: "Your account cannot perform discovery actions right now." };
  }

  const { data: matched, error } = await supabase.rpc("record_profile_action", {
    p_target_id: profileId,
    p_action: action,
    p_intro_message: cleanIntro || null,
  });
  if (error) {
    return { ok: false, message: error.message.includes("duplicate key")
      ? "You’ve already sent an introductory message to this member."
      : "We couldn’t save that action. Refresh and try again." };
  }

  revalidatePath("/", "page");
  return {
    ok: true,
    message: action === "like" ? "Your like was saved." : "Your pass was saved.",
    matched: matched === true,
  };
}
