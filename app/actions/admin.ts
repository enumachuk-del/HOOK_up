"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/supabase/admin";

const statuses = new Set(["active", "suspended", "deactivated"]);
const reportStatuses = new Set(["open", "reviewing", "resolved", "dismissed"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function redirectWithResult(result: "saved" | "error" | "reauth_required") {
  revalidatePath("/admin");
  redirect(`/admin?notice=${result}`);
}

export async function setAccountStatusAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!uuidPattern.test(userId) || !statuses.has(status)) redirectWithResult("error");

  const { supabase } = await requireSuperAdmin();
  const { error } = await supabase.rpc("admin_set_account_status", {
    p_user_id: userId,
    p_status: status,
  });
  if (error?.code === "42501" && error.message.includes("Sign in again")) redirectWithResult("reauth_required");
  redirectWithResult(error ? "error" : "saved");
}

export async function setReportStatusAction(formData: FormData) {
  const reportId = String(formData.get("reportId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!uuidPattern.test(reportId) || !reportStatuses.has(status)) redirectWithResult("error");

  const { supabase } = await requireSuperAdmin();
  const { error } = await supabase.rpc("admin_set_report_status", {
    p_report_id: reportId,
    p_status: status,
  });
  if (error?.code === "42501" && error.message.includes("Sign in again")) redirectWithResult("reauth_required");
  redirectWithResult(error ? "error" : "saved");
}
