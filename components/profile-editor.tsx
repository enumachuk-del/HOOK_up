"use client";

import Image from "next/image";
import { useActionState } from "react";
import {
  makeProfilePhotoPrimaryAction,
  updatePreferencesAction,
  updateProfileAction,
  uploadProfilePhotoAction,
  type ProfileFormState,
} from "@/app/actions/profile";

const initialState: ProfileFormState = { message: "", kind: "status" };

function FormMessage({ state }: { state: ProfileFormState }) {
  if (!state.message) return null;
  return <p className={`profile-form-message ${state.kind}`} role={state.kind === "error" ? "alert" : "status"}>{state.message}</p>;
}

function PhotoPrimaryButton({ photoId, isPrimary }: { photoId: string; isPrimary: boolean }) {
  const [state, action, pending] = useActionState(makeProfilePhotoPrimaryAction, initialState);
  if (isPrimary) return <span className="profile-photo-primary">Current photo</span>;
  return (
    <form action={action} className="profile-photo-primary-form">
      <input type="hidden" name="photoId" value={photoId} />
      <button type="submit" disabled={pending}>{pending ? "Updating…" : "Use as profile photo"}</button>
      <FormMessage state={state} />
    </form>
  );
}

export type EditableProfile = {
  username: string | null;
  display_name: string;
  gender: string | null;
  bio: string | null;
  occupation: string | null;
  city: string | null;
  country_code: string | null;
};

export type EditablePreferences = {
  minimum_age: number;
  maximum_age: number;
  preferred_genders: string[];
  maximum_distance_km: number | null;
};

export type EditableSettings = {
  email_notifications_enabled: boolean;
  push_notifications_enabled: boolean;
  show_online_status: boolean;
  show_distance: boolean;
  discovery_enabled: boolean;
};

export type ProfilePhoto = {
  id: string;
  imageUrl: string;
  isPrimary: boolean;
};

export function ProfileEditor({
  profile,
  preferences,
  settings,
  photos,
}: {
  profile: EditableProfile;
  preferences: EditablePreferences;
  settings: EditableSettings;
  photos: ProfilePhoto[];
}) {
  const [profileState, profileAction, profilePending] = useActionState(updateProfileAction, initialState);
  const [preferencesState, preferencesAction, preferencesPending] = useActionState(updatePreferencesAction, initialState);
  const [photoState, photoAction, photoPending] = useActionState(uploadProfilePhotoAction, initialState);
  const primaryPhoto = photos.find((photo) => photo.isPrimary) ?? photos[0];

  return (
    <div className="profile-editor">
      <section className="profile-panel" aria-labelledby="profile-details-heading">
        <div className="profile-panel-heading">
          <div><p className="eyebrow">Your introduction</p><h2 id="profile-details-heading">Profile details</h2><p>Update the details other members can see in discovery.</p></div>
        </div>
        <div className="profile-photo-area">
          {primaryPhoto ? (
            <Image className="profile-photo-preview" src={primaryPhoto.imageUrl} alt="Your current profile photo" width={96} height={96} unoptimized />
          ) : (
            <span className="profile-photo-preview profile-photo-fallback" aria-hidden="true">{profile.display_name.slice(0, 1).toUpperCase()}</span>
          )}
          <div className="profile-photo-copy">
            <strong>Profile photo</strong>
            <span>JPEG, PNG, or WebP · up to 10 MB per upload</span>
            {primaryPhoto && <PhotoPrimaryButton photoId={primaryPhoto.id} isPrimary={primaryPhoto.isPrimary} />}
          </div>
        </div>
        {photos.length > 1 && (
          <div className="profile-photo-list" aria-label="Your saved profile photos">
            {photos.map((photo) => (
              <div className={`profile-photo-item ${photo.isPrimary ? "selected" : ""}`} key={photo.id}>
                <Image src={photo.imageUrl} alt={photo.isPrimary ? "Current profile photo" : "Saved profile photo"} width={54} height={54} unoptimized />
                <PhotoPrimaryButton photoId={photo.id} isPrimary={photo.isPrimary} />
              </div>
            ))}
          </div>
        )}
        <form className="profile-photo-upload" action={photoAction}>
          <label className="profile-file-picker">Add photos<input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required /></label>
          <button className="profile-secondary-button" type="submit" disabled={photoPending}>{photoPending ? "Uploading…" : "Add photos and use first as profile photo"}</button>
          <FormMessage state={photoState} />
        </form>

        <form className="profile-form" action={profileAction}>
          <div className="profile-form-grid">
            <label>Display name<input name="displayName" type="text" defaultValue={profile.display_name} maxLength={80} autoComplete="name" required /></label>
            <label>Username<input name="username" type="text" defaultValue={profile.username ?? ""} maxLength={30} autoComplete="username" placeholder="e.g. sunny_days" /></label>
            <label>Gender<input name="gender" type="text" defaultValue={profile.gender ?? ""} maxLength={40} /></label>
            <label>Occupation<input name="occupation" type="text" defaultValue={profile.occupation ?? ""} maxLength={120} autoComplete="organization-title" /></label>
            <label>City<input name="city" type="text" defaultValue={profile.city ?? ""} maxLength={120} autoComplete="address-level2" /></label>
            <label>Country code<input name="countryCode" type="text" defaultValue={profile.country_code ?? ""} maxLength={2} autoComplete="country" placeholder="e.g. US" /></label>
            <label className="profile-bio-label">Bio<textarea name="bio" defaultValue={profile.bio ?? ""} maxLength={500} rows={5} /></label>
          </div>
          <FormMessage state={profileState} />
          <button className="auth-submit profile-save-button" type="submit" disabled={profilePending}>{profilePending ? "Saving changes…" : "Save profile"}</button>
        </form>
      </section>

      <section className="profile-panel" id="preferences" aria-labelledby="preferences-heading">
        <div className="profile-panel-heading">
          <div><p className="eyebrow">Your experience</p><h2 id="preferences-heading">Discovery & privacy</h2><p>These preferences are saved to your account and used to filter discovery.</p></div>
        </div>
        <form className="profile-form" action={preferencesAction}>
          <div className="profile-form-grid">
            <label>Minimum age<input name="minimumAge" type="number" min={18} max={100} defaultValue={preferences.minimum_age} required /></label>
            <label>Maximum age<input name="maximumAge" type="number" min={18} max={100} defaultValue={preferences.maximum_age} required /></label>
            <label>Preferred genders<input name="preferredGenders" type="text" defaultValue={preferences.preferred_genders.join(", ")} placeholder="Leave blank for all" /></label>
            <label>Maximum distance (km)<input name="maximumDistanceKm" type="number" min={1} max={500} defaultValue={preferences.maximum_distance_km ?? ""} placeholder="Any distance" /></label>
          </div>
          <p className="profile-settings-note">Enter preferred genders as a comma-separated list matching profile gender labels. Distance is saved for future filtering; distance-based discovery is not enabled because precise location isn’t collected.</p>
          <div className="profile-toggle-list">
            <label><input type="checkbox" name="discoveryEnabled" defaultChecked={settings.discovery_enabled} /> Show my profile in discovery</label>
            <label><input type="checkbox" name="showOnlineStatus" defaultChecked={settings.show_online_status} /> Show my online status</label>
            <label><input type="checkbox" name="showDistance" defaultChecked={settings.show_distance} /> Show my distance</label>
            <label><input type="checkbox" name="emailNotifications" defaultChecked={settings.email_notifications_enabled} /> Email notifications</label>
            <label><input type="checkbox" name="pushNotifications" defaultChecked={settings.push_notifications_enabled} /> Push notifications</label>
          </div>
          <p className="profile-settings-note">Notification preferences are stored with your account. Email and push delivery are not connected yet.</p>
          <FormMessage state={preferencesState} />
          <button className="auth-submit profile-save-button" type="submit" disabled={preferencesPending}>{preferencesPending ? "Saving settings…" : "Save discovery & privacy"}</button>
        </form>
      </section>
    </div>
  );
}
