import Link from "next/link";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { AdminDashboard, type AdminActivity, type AdminReport, type AdminUser } from "@/components/admin-dashboard";
import { requireSuperAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams: Promise<{
    search?: string;
    status?: string;
    offset?: string;
    notice?: string;
  }>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const search = (params.search ?? "").slice(0, 120);
  const status = ["active", "suspended", "deactivated"].includes(params.status ?? "")
    ? params.status!
    : null;
  const parsedOffset = Number.parseInt(params.offset ?? "0", 10);
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset > 0
    ? Math.min(parsedOffset, 100_000)
    : 0;
  const { supabase, user } = await requireSuperAdmin();
  const [statsResult, usersResult, reportsResult, activityResult] = await Promise.all([
    supabase.rpc("admin_dashboard_stats"),
    supabase.rpc("admin_list_users", {
      p_search: search || null,
      p_status: status,
      p_limit: 100,
      p_offset: offset,
    }),
    supabase.rpc("admin_list_reports", { p_limit: 50 }),
    supabase.rpc("admin_recent_activity", { p_limit: 20 }),
  ]);

  if (statsResult.error || usersResult.error || reportsResult.error || activityResult.error) {
    throw new Error("The admin dashboard could not load its data. Check that the latest database migration is applied.");
  }

  return (
    <div className="admin-app">
      <header className="topbar admin-topbar">
        <Brand />
        <div className="admin-top-actions">
          <Link className="admin-back-link" href="/">Back to the app</Link>
          <SignOutButton displayName={user.email ?? "Super Admin"} />
        </div>
      </header>
      <AdminDashboard
        stats={statsResult.data?.[0] ?? null}
        users={(usersResult.data ?? []) as AdminUser[]}
        reports={(reportsResult.data ?? []) as AdminReport[]}
        activity={(activityResult.data ?? []) as AdminActivity[]}
        search={search}
        status={status}
        offset={offset}
        notice={params.notice}
      />
    </div>
  );
}
