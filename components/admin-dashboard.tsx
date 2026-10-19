"use client";

import Link from "next/link";
import { setAccountStatusAction, setReportStatusAction } from "@/app/actions/admin";

export type AdminStats = {
  total_users: number;
  active_users: number;
  suspended_users: number;
  deactivated_users: number;
  registrations_last_7_days: number;
  signins_last_7_days: number;
  open_reports: number;
};

export type AdminUser = {
  user_id: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  city: string | null;
  gender: string | null;
  bio: string | null;
  occupation: string | null;
  onboarding_completed: boolean;
  registered_at: string;
  last_sign_in_at: string | null;
  account_status: "active" | "suspended" | "deactivated";
  role: "user" | "super_admin";
};

export type AdminReport = {
  report_id: string;
  reporter_id: string;
  reporter_name: string;
  reported_user_id: string;
  reported_user_name: string;
  reason: string;
  description: string | null;
  report_status: "open" | "reviewing" | "resolved" | "dismissed";
  reported_at: string;
};

export type AdminActivity = {
  event_type: string;
  actor_id: string | null;
  actor_email: string | null;
  target_id: string | null;
  details: Record<string, string>;
  occurred_at: string;
};

const number = new Intl.NumberFormat("en");

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function AccountStatusForm({ user }: { user: AdminUser }) {
  return (
    <form
      action={setAccountStatusAction}
      className="admin-status-form"
      onSubmit={(event) => {
        if (!window.confirm(`Change ${user.display_name}’s access status?`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={user.user_id} />
      <label className="sr-only" htmlFor={`status-${user.user_id}`}>Account status for {user.display_name}</label>
      <select id={`status-${user.user_id}`} name="status" defaultValue={user.account_status}>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="deactivated">Deactivated</option>
      </select>
      <button type="submit" className="admin-small-button">Save</button>
    </form>
  );
}

export function AdminDashboard({
  stats,
  users,
  reports,
  activity,
  search,
  status,
  offset,
  notice,
}: {
  stats: AdminStats | null;
  users: AdminUser[];
  reports: AdminReport[];
  activity: AdminActivity[];
  search: string;
  status: string | null;
  offset: number;
  notice?: string;
}) {
  const totalUsers = stats?.total_users ?? 0;
  const activeShare = totalUsers ? ((stats?.active_users ?? 0) / totalUsers) * 100 : 0;
  const suspendedShare = totalUsers ? ((stats?.suspended_users ?? 0) / totalUsers) * 100 : 0;
  const deactivatedShare = totalUsers ? ((stats?.deactivated_users ?? 0) / totalUsers) * 100 : 0;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-account">
          <span className="admin-avatar" aria-hidden="true">SH</span>
          <span><strong>Super Admin</strong><small>Platform control</small></span>
        </div>
        <nav className="admin-nav">
          <a className="selected" href="#overview"><span>◫</span> Overview</a>
          <a href="#users"><span>♙</span> Users</a>
          <a href="#reports"><span>⚑</span> Reports <b>{stats?.open_reports ?? 0}</b></a>
          <a href="#activity"><span>◷</span> Activity & security</a>
        </nav>
        <Link className="admin-sidebar-back" href="/">← Return to Splendid_Hubs</Link>
      </aside>

      <main className="admin-main">
        <div className="admin-heading" id="overview">
          <div>
            <p className="admin-eyebrow">Platform administration</p>
            <h1>Good morning. Here’s your overview.</h1>
            <p className="admin-subtitle">Manage accounts, review reports, and keep Splendid_Hubs running smoothly.</p>
          </div>
          <span className="admin-secure-pill"><span /> Secure admin session</span>
        </div>

        {notice === "saved" && <p className="admin-notice success" role="status">Your change was saved and recorded in the audit log.</p>}
        {notice === "error" && <p className="admin-notice error" role="alert">We couldn’t save that change. Check the selected value and try again.</p>}
        {notice === "reauth_required" && <p className="admin-notice error" role="alert">For security, sign out and sign back in before making account or report changes.</p>}

        <section className="admin-stats" aria-label="Platform metrics">
          <article className="admin-stat-card"><span className="admin-stat-icon rose">♙</span><span className="admin-stat-label">Registered users</span><strong>{number.format(stats?.total_users ?? 0)}</strong><small>All accounts</small></article>
          <article className="admin-stat-card"><span className="admin-stat-icon green">✓</span><span className="admin-stat-label">Active accounts</span><strong>{number.format(stats?.active_users ?? 0)}</strong><small>Can use the platform</small></article>
          <article className="admin-stat-card"><span className="admin-stat-icon blue">↗</span><span className="admin-stat-label">New this week</span><strong>{number.format(stats?.registrations_last_7_days ?? 0)}</strong><small>Last 7 days</small></article>
          <article className="admin-stat-card"><span className="admin-stat-icon amber">⚑</span><span className="admin-stat-label">Open reports</span><strong>{number.format(stats?.open_reports ?? 0)}</strong><small>Awaiting review</small></article>
        </section>

        <section className="admin-panel admin-health-chart" aria-labelledby="health-heading">
          <div className="admin-section-heading"><div><h2 id="health-heading">Account health</h2><p>Current access status across registered accounts.</p></div></div>
          <div
            className="admin-health-bar"
            role="img"
            aria-label={`${number.format(stats?.active_users ?? 0)} active, ${number.format(stats?.suspended_users ?? 0)} suspended, ${number.format(stats?.deactivated_users ?? 0)} deactivated`}
          >
            <span className="active" style={{ width: `${activeShare}%` }} />
            <span className="suspended" style={{ width: `${suspendedShare}%` }} />
            <span className="deactivated" style={{ width: `${deactivatedShare}%` }} />
          </div>
          <div className="admin-health-legend">
            <span><i className="active" /> Active <strong>{number.format(stats?.active_users ?? 0)}</strong></span>
            <span><i className="suspended" /> Suspended <strong>{number.format(stats?.suspended_users ?? 0)}</strong></span>
            <span><i className="deactivated" /> Deactivated <strong>{number.format(stats?.deactivated_users ?? 0)}</strong></span>
            <span className="admin-activity-summary">Users active this week <strong>{number.format(stats?.signins_last_7_days ?? 0)}</strong></span>
          </div>
        </section>

        <section className="admin-panel" id="users">
          <div className="admin-section-heading">
            <div><h2>User management</h2><p>Search accounts, inspect profile basics, and manage platform access.</p></div>
            <span className="admin-total">{number.format(users.length)} shown</span>
          </div>
          <form className="admin-filters" action="/admin#users">
            <label className="admin-search"><span aria-hidden="true">⌕</span><input name="search" type="search" placeholder="Search name, email, or city" defaultValue={search} maxLength={120} /></label>
            <input type="hidden" name="offset" value="0" />
            <label className="sr-only" htmlFor="user-status-filter">Filter by account status</label>
            <select id="user-status-filter" name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option>
            </select>
            <button type="submit" className="admin-filter-button">Apply filters</button>
          </form>

          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead><tr><th>User</th><th>Location</th><th>Registered</th><th>Last sign in</th><th>Account status</th><th>Manage access</th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id}>
                    <td><details className="admin-user-details"><summary><span className="user-initials">{user.display_name.slice(0, 1).toUpperCase()}</span><span><strong>{user.display_name}</strong><small>{user.email}{user.email_verified ? " · Verified" : " · Unverified"}</small></span></summary><div className="admin-profile-details"><strong>Profile details</strong><span>{user.occupation || "Occupation not set"}{user.gender ? ` · ${user.gender}` : ""}</span><p>{user.bio || "No bio provided."}</p><span>{user.onboarding_completed ? "Onboarding complete" : "Onboarding incomplete"}</span></div></details></td>
                    <td>{user.city || "—"}</td>
                    <td>{formatDate(user.registered_at)}</td>
                    <td>{formatDate(user.last_sign_in_at)}</td>
                    <td><span className={`admin-status ${user.account_status}`}>{user.account_status}</span></td>
                    <td>{user.role === "user" ? <AccountStatusForm user={user} /> : <span className="admin-role">Protected role</span>}</td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td className="admin-empty" colSpan={6}>No accounts match those filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <nav className="admin-pagination" aria-label="User pages">
            <span>Showing {users.length ? number.format(offset + 1) : "0"}–{number.format(offset + users.length)} of {number.format(stats?.total_users ?? 0)} accounts</span>
            <div>
              {offset > 0 && <Link href={`/admin?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status ?? "")}&offset=${Math.max(0, offset - 100)}#users`}>Previous</Link>}
              {users.length === 100 && <Link href={`/admin?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status ?? "")}&offset=${offset + 100}#users`}>Next</Link>}
            </div>
          </nav>
          <p className="admin-table-note">For privacy, dates of birth and passwords are never displayed. Super Admin roles are protected from this interface.</p>
        </section>

        <div className="admin-lower-grid">
          <section className="admin-panel" id="reports">
            <div className="admin-section-heading"><div><h2>Community reports</h2><p>Review and update the status of user reports.</p></div></div>
            <div className="admin-report-list">
              {reports.map((report) => (
                <article className="admin-report" key={report.report_id}>
                  <div className="admin-report-top"><span className={`admin-status ${report.report_status}`}>{report.report_status}</span><time>{formatDate(report.reported_at)}</time></div>
                  <h3>{report.reason.replaceAll("_", " ")}</h3>
                  <p>Reported by <strong>{report.reporter_name}</strong> about <strong>{report.reported_user_name}</strong>.</p>
                  {report.description && <blockquote>{report.description}</blockquote>}
                  <form action={setReportStatusAction} className="admin-report-action">
                    <input type="hidden" name="reportId" value={report.report_id} />
                    <label className="sr-only" htmlFor={`report-${report.report_id}`}>Report status</label>
                    <select id={`report-${report.report_id}`} name="status" defaultValue={report.report_status}>
                      <option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
                    </select>
                    <button className="admin-small-button" type="submit">Update</button>
                  </form>
                </article>
              ))}
              {reports.length === 0 && <p className="admin-empty-inline">There are no user reports yet.</p>}
            </div>
          </section>

          <section className="admin-panel" id="activity">
            <div className="admin-section-heading"><div><h2>Recent activity</h2><p>Admin changes and recent sign-ins.</p></div></div>
            <div className="admin-activity-list">
              {activity.map((event, index) => (
                <article className="admin-activity" key={`${event.event_type}-${event.occurred_at}-${index}`}>
                  <span className={`activity-dot ${event.event_type === "user_login" ? "login" : "admin"}`} />
                  <div><strong>{event.event_type.replaceAll("_", " ")}</strong><p>{event.actor_email ?? "Account unavailable"}{event.details?.status ? ` · status set to ${event.details.status}` : ""}</p><time>{formatDate(event.occurred_at)}</time></div>
                </article>
              ))}
              {activity.length === 0 && <p className="admin-empty-inline">New activity will appear here.</p>}
            </div>
            <div className="admin-usage">
              <div><span>Users active this week</span><strong>{number.format(stats?.signins_last_7_days ?? 0)}</strong></div>
              <div><span>Suspended accounts</span><strong>{number.format(stats?.suspended_users ?? 0)}</strong></div>
              <div><span>Deactivated accounts</span><strong>{number.format(stats?.deactivated_users ?? 0)}</strong></div>
            </div>
            <p className="admin-table-note">Login timestamps are supplied by Supabase Auth. Detailed event tracking is not enabled.</p>
          </section>
        </div>
        <footer className="admin-footer">Sensitive account and report information is visible only to the authorized Super Admin.</footer>
      </main>
    </div>
  );
}
