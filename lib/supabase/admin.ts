import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireSuperAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/");

  const { error: bootstrapError } = await supabase.rpc("claim_super_admin");
  if (bootstrapError) {
    throw new Error("Super Admin authorization is unavailable. Apply the RBAC migration and try again.");
  }

  const { data: isSuperAdmin, error: roleError } = await supabase.rpc("is_super_admin");
  if (roleError) {
    throw new Error("Super Admin authorization could not be verified.");
  }
  if (!isSuperAdmin) redirect("/");

  return { supabase, user: data.user };
}
