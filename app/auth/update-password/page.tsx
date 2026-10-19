import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { Brand } from "@/components/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const recoveryCookie = "splendid-hubs-password-recovery";
const legacyRecoveryCookie = "kindred-password-recovery";

export default async function UpdatePasswordPage() {
  const cookieStore = await cookies();
  const recoveryUserId = cookieStore.get(recoveryCookie)?.value ?? cookieStore.get(legacyRecoveryCookie)?.value;
  if (!recoveryUserId) {
    redirect("/?auth_error=callback");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== recoveryUserId) {
    redirect("/?auth_error=callback");
  }

  return (
    <main className="auth-gate">
      <section className="auth-panel" aria-labelledby="authTitle">
        <Brand />
        <div className="auth-heading">
          <h1 id="authTitle">Choose a new password.</h1>
          <p>Use at least 12 characters. Your recovery link must still be valid.</p>
        </div>
        <UpdatePasswordForm />
      </section>
    </main>
  );
}
