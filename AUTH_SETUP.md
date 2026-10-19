# Splendid Hubs: Next.js and Supabase setup

## Architecture

The original interface was a static HTML/CSS prototype. It is now structured as a Next.js App Router application using React, TypeScript, Tailwind CSS, and Node.js. Supabase Auth and PostgreSQL remain the authentication and data services.

- `app/page.tsx` checks the signed-in user with `auth.getUser()` on the server and then renders the sign-in, onboarding, or discovery view.
- `app/actions/auth.ts` implements server actions for sign-up, sign-in, password-reset requests, password updates, onboarding, and sign-out.
- `lib/supabase/server.ts` creates the cookie-backed server client with `@supabase/ssr`.
- `proxy.ts` refreshes Supabase sessions and cookies using the Next.js 16 request proxy convention.
- `app/auth/callback/route.ts` exchanges the PKCE code and permits only the app's known local destinations.
- `supabase/migrations/20261016120000_auth_foundation.sql` creates the schema, trigger, RLS policies, grants, and private photo bucket.
- `supabase/migrations/20261016130000_admin_rbac.sql` adds the protected role registry, single-use verified Super Admin bootstrap, account-status enforcement, admin RPCs, and audit log.
- `supabase/migrations/20261016140000_profile_discovery_persistence.sql` adds persistent like/pass actions and updates the discovery profile and private-photo RPCs.
- `supabase/migrations/20261016150000_member_feed_matching_messaging.sql` adds the member feed, photo galleries, posts, comments, post likes, reciprocal matches/unmatching, introductory messages, and match-only conversations.
- `app/profile/page.tsx` and `app/actions/profile.ts` read and update a user's own profile, preferences, privacy settings, and private profile photos under Supabase RLS.
- `app/admin/page.tsx` and its server actions require the database-verified Super Admin role; the dashboard is never authorized by hidden navigation alone.

The existing visual design is retained while discovery is expanded into a social dating feed. Eligible active members' profile galleries and posts are read from Supabase. Members can create caption/photo posts, like posts, comment, like/pass on profiles, send one introduction with a like, form a match with a reciprocal like, unmatch, and continue messaging only while a match is active. Unmatched conversations are closed and excluded from message reads. Follow graphs and push/email delivery are not implemented.

## Install and run

Use Node.js 20 LTS (20.19 or newer) or Node.js 22 LTS, plus npm:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set these values in `.env.local`, then restart Next.js:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Find the URL and **publishable** key in Supabase project API settings. A legacy `anon` key is also a public browser-safe key. Never use a service-role or secret key in a `NEXT_PUBLIC_` variable, client component, or this repository. No privileged operation here requires one. `.env.local` is excluded from Git.

## Create the Supabase project and apply migrations

1. Create a Supabase project and store its database password securely.
2. Install Docker Desktop and the Supabase CLI for a local development stack. This project already has `supabase/migrations/`; run `npx supabase init` only if `supabase/config.toml` does not yet exist.
3. For local development:

   ```powershell
   npx supabase start
   npx supabase db reset
   ```

   `db reset` resets the **local** database and replays migrations. Do not use it on a hosted database.
4. To apply the migration to a linked development project:

   ```powershell
   npx supabase login
   npx supabase link --project-ref your-project-ref
   npx supabase db push
   ```

   Review the migrations before applying them to any existing project. They create application tables/policies and configure the dedicated `profile-photos` bucket; they do not drop existing tables or user records. The RBAC migration backfills existing Auth identities as regular users, adds a private single-Super-Admin role registry, and adds active account status by default. The profile/discovery migration adds an interaction table and updates discovery and photo policies; the member-feed migration adds posts, comments, matches, and private messages. Existing profiles, preferences, photos, and reports are preserved.
5. Run the database permission/schema checks against the local stack:

   ```powershell
   npx supabase test db
   ```
6. Optionally generate TypeScript types:

   ```powershell
   npx supabase gen types typescript --local > src/database.types.ts
   ```

## Supabase Auth settings

In **Authentication → URL Configuration**:

- Set **Site URL** to the production app origin.
- Allow the development and production callback paths, for example `http://localhost:3000/auth/callback*` and `https://your-domain.example/auth/callback*`. The wildcard is limited to the callback path because the app adds fixed PKCE flow parameters; do not allow broad wildcard origins.
- `NEXT_PUBLIC_APP_URL` must be the origin only. The server builds fixed callback URLs and ignores client-supplied redirect destinations.

In **Authentication → Providers → Email**:

- Enable email confirmations. With confirmation disabled, the signup action signs out any session Supabase may create and reports the configuration problem.
- Set the password minimum to at least 12 characters.
- Configure production SMTP and review confirmation/recovery templates.
- Configure the Supabase Auth rate limits for sign-up, sign-in, and recovery. The app relies on Supabase's Auth rate limits; it has no separate IP-based application rate limiter.
- Enable leaked-password protection if available. CAPTCHA is not wired into the current forms; integrate a supported provider before requiring CAPTCHA in Supabase Auth.

The signup form checks age in the server action, and the database trigger independently checks the submitted date of birth before creating the Auth user. The DOB is self-reported and does not establish identity or prove legal age; use an appropriate verification provider if that is a product requirement.

## Authentication flows

- **Sign-up:** The server action normalizes/validates input and calls Supabase Auth with whitelisted display-name and DOB metadata. The database trigger creates the profile atomically and rejects missing/invalid/under-18 DOB. The user receives a generic email-confirmation message; sign-in remains unavailable until Supabase confirms email.
- **Sign-in and protected page:** Server action uses `signInWithPassword`. Middleware refreshes cookies; the App Router page independently verifies identity with `getUser()` and reads the user's profile under RLS. Client-visible state is not the security boundary. Suspended/deactivated accounts are blocked by the application and restrictive RLS policies.
- **Sign-out:** Calls Supabase `signOut()` and refreshes the root layout.
- **Profile management:** `/profile` loads the authenticated user's profile, preferences, privacy settings, and photo metadata from Supabase. Server actions re-check the authenticated identity and active-account status; table grants and owner RLS restrict every write to permitted columns and the user's own rows.
- **Password reset:** Sends a generic response whether or not an account exists. The email callback exchanges a PKCE code, checks the local destination, and sets an HttpOnly, short-lived recovery marker tied to the verified user id. The password action requires both that marker and a verified session before calling `updateUser`; the recovery marker is cleared afterward.
- **Onboarding:** Server action verifies the user, updates only that user's allowed profile fields, then calls the no-argument `complete_profile_onboarding()` RPC. PostgreSQL derives the id from `auth.uid()` and controls completion.

Next Server Actions provide same-origin action handling; there are no redundant `/api/auth/*` wrappers. No access, refresh, or recovery token is logged or returned in page content.

## Database and access model

- `auth.users` is the identity/password source of truth. A fixed-search-path trigger atomically creates a `profiles` row and a private birth-date row.
- `public.profiles` contains public profile fields only. Direct RLS access is owner-only; `discover_profiles()` exposes only selected fields and age in years, applying preferences, discovery visibility, and blocks in both directions.
- `private.user_private_data` stores DOB in a non-exposed schema with RLS enabled and no Data API grants.
- Preferences and settings are owner-only. Photo metadata paths must use the owner's UUID folder. Blocks are only readable/creatable/deletable by the blocker. Reports may be submitted by users but cannot be read or resolved by them.
- `user_profile_actions` stores each user's latest like/pass for another account. The discovery RPC returns only profiles eligible under the signed-in user's preferences and block/action history. New choices are written by a database RPC that derives the actor from `auth.uid()`; users cannot choose an actor id.
- `user_matches` stores one durable row per member pair. Reciprocal likes create an active match; unmatching ends that pair and prevents the same pair from silently rematching. The application has no direct table grants for social data: feeds, comments, matches, and messages are read or mutated through authenticated, server-checked database RPCs.
- Posts and post interactions are stored in Supabase. Comments and post likes are visible only when the author is visible to the signed-in member. A first introduction is limited to one message per sender/recipient pair and requires a like; ongoing direct messages require an active mutual match. Unmatching closes access to the conversation.
- Profile photo galleries can contain multiple uploaded pictures; new uploads are stored in the private `profile-photos` bucket and ordered with the primary image first. Feed and chat image URLs are short-lived signed URLs issued under the member-visibility storage policy.
- Profile photos are uploaded to the private `profile-photos` bucket after size, MIME type, and image-signature checks. Short-lived signed URLs for other members are issued only when the discovery RPC confirms the target is currently eligible. Users can only manage their own photo metadata and storage paths.
- Every application table has RLS enabled. Explicit grants further restrict roles, operations, and writable columns.
- Location coordinates are not collected. `maximum_distance_km` is stored for future use but cannot filter discovery until a privacy-safe location system is designed.

## Super Admin and administration

- New Auth identities receive the `user` role from a database trigger. Existing Auth identities are backfilled as `user`; role and account-status tables remain in the non-exposed `private` schema, with RLS enabled and no Data API grants.
- After sign-in, `claim_super_admin()` may assign the one Super Admin slot only when `auth.users.id` matches the verified session and `auth.users.email_confirmed_at` is set for `enumachuk@gmail.com`. The check runs in PostgreSQL against the verified Auth identity, never from submitted form data or client metadata. The unique index and transaction lock prevent multiple assignments and bootstrap races.
- If the authorized account does not exist yet, create it through the normal verified-email signup flow. On its first verified sign-in, the database claims the reserved Super Admin slot. If another Super Admin slot has already been assigned, the function will not transfer it. The role is bound to the UUID, so changing that account's email does not move the role to another user.
- There is no role-editing UI or client table permission. Each admin read/write RPC verifies the caller's active Super Admin role in PostgreSQL. The `/admin` page and every server action independently verify that role. Direct database calls to admin RPCs also enforce it.
- The dashboard can search/filter and page through up to 100 users at a time, inspect available profile fields, set regular-account access to active/suspended/deactivated, review and update reports, view aggregate registration/activity metrics, and view administrator audit records plus Auth's last-sign-in timestamps. It cannot change roles, delete Auth users, read DOBs/passwords, or manage features/settings not implemented in the existing application.
- Account and report status changes require an Auth session established in the last 10 minutes; otherwise the administrator must sign out and sign in again. Administrative changes are written to a private audit log. Login history uses Supabase Auth's `last_sign_in_at`; detailed per-login/security-event tracking is not available in the current integration.
- The dashboard's account actions are app-level suspension/deactivation enforced by protected pages, database policies, and discovery/onboarding RPC checks. They do not delete the Auth identity or invoke privileged Auth Admin APIs.

The SQL tests check owner RLS, grants, private-schema visibility, discovery and social RPC access, bucket privacy, role table isolation, single-admin constraints, and admin RPC privileges. They do not replace live testing with two regular accounts and the verified Super Admin account.

## Supabase Storage

The migration creates or makes private the `profile-photos` bucket with a 10 MiB limit and JPEG, PNG, and WebP MIME types. Storage policies limit upload/replace/delete to the authenticated user's UUID folder. The latest migration permits signed reads for owners and for users who can currently view the target member or an active match. Use unique names such as `<auth.uid()>/<random-uuid>.webp`; never accept arbitrary paths. MIME, signature, and size controls do not replace server-side image decoding and content inspection.

The bucket remains private; do not make it public or expose a service key.

## Validation and deployment

```powershell
npm test
npm run lint
npm run build
```

Deploy the Next.js application to a Node.js-compatible host, provide the three environment variables in the host's server environment, apply all four Supabase migrations in timestamp order, and add the production callback URL to Supabase. Keep `.env.local` and all secrets out of source control.

Before launch, test email confirmation and recovery links with a dedicated development project; exercise cross-user profile, preference, settings, photo, discovery, interaction, block, and report access using two separate test users; configure production SMTP and Auth limits; and review the migration/RLS policies. The browser UI gate is not a substitute for database RLS.
