import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ProfileEditor, type ProfilePhoto } from "@/components/profile-editor";
import { ProfileMenu } from "@/components/profile-menu";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/");

  const [{ data: isActive, error: accountError }, { data: profile, error: profileError },
    { data: preferences, error: preferencesError }, { data: settings, error: settingsError },
    { data: photoRows, error: photosError }, { data: isSuperAdmin, error: roleError }] = await Promise.all([
    supabase.rpc("is_account_active"),
    supabase.from("profiles").select("username, display_name, gender, bio, occupation, city, country_code").eq("id", authData.user.id).single(),
    supabase.from("user_preferences").select("minimum_age, maximum_age, preferred_genders, maximum_distance_km").eq("user_id", authData.user.id).maybeSingle(),
    supabase.from("user_settings").select("email_notifications_enabled, push_notifications_enabled, show_online_status, show_distance, discovery_enabled").eq("user_id", authData.user.id).maybeSingle(),
    supabase.from("user_photos").select("id, storage_path, is_primary").eq("user_id", authData.user.id).order("is_primary", { ascending: false }).order("display_order").limit(24),
    supabase.rpc("is_super_admin"),
  ]);

  if (accountError || !isActive) redirect("/");
  if (profileError || !profile || preferencesError || settingsError || photosError || roleError) {
    throw new Error("Your profile settings could not be loaded. Check your Supabase migration and try again.");
  }

  const photos = await Promise.all((photoRows ?? []).map(async (photo): Promise<ProfilePhoto> => {
    const { data, error } = await supabase.storage.from("profile-photos").createSignedUrl(photo.storage_path, 60 * 60);
    if (error) {
      throw new Error("A saved profile photo could not be signed. Verify the profile-photo bucket policies before continuing.");
    }
    return { id: photo.id, imageUrl: data.signedUrl, isPrimary: photo.is_primary };
  }));
  const avatarUrl = photos.find((photo) => photo.isPrimary)?.imageUrl ?? photos[0]?.imageUrl ?? null;

  return (
    <div className="app profile-page">
      <header className="topbar">
        <Brand />
        <Link className="profile-back-link" href="/">Back to discovery</Link>
        <ProfileMenu displayName={profile.display_name} email={authData.user.email ?? ""} avatarUrl={avatarUrl} isSuperAdmin={isSuperAdmin ?? false} />
      </header>
      <main className="profile-page-main">
        <div className="profile-page-heading">
          <p className="eyebrow">Make it yours</p>
          <h1>Your profile & settings</h1>
          <p>Changes are saved to your Splendid Hubs account and used across the app.</p>
        </div>
        <ProfileEditor
          profile={profile}
          preferences={preferences ?? { minimum_age: 18, maximum_age: 99, preferred_genders: [], maximum_distance_km: null }}
          settings={settings ?? {
            email_notifications_enabled: true,
            push_notifications_enabled: true,
            show_online_status: true,
            show_distance: true,
            discovery_enabled: true,
          }}
          photos={photos}
        />
      </main>
    </div>
  );
}
