"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ProfileFormState = {
  message: string;
  kind: "error" | "success" | "status";
};

const emptyState: ProfileFormState = { message: "", kind: "status" };
const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validGenderPreference = (value: string) => value.length > 0 && value.length <= 40;

async function getActiveUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { supabase, user: null };

  const { data: isActive, error: statusError } = await supabase.rpc("is_account_active");
  if (statusError || !isActive) return { supabase, user: null };
  return { supabase, user: data.user };
}

function refreshProfile() {
  revalidatePath("/", "page");
  revalidatePath("/profile", "page");
}

export async function updateProfileAction(
  _previousState: ProfileFormState = emptyState,
  formData: FormData,
): Promise<ProfileFormState> {
  void _previousState;
  const displayName = String(formData.get("displayName") ?? "").trim();
  const usernameInput = String(formData.get("username") ?? "").trim().toLowerCase();
  const genderInput = String(formData.get("gender") ?? "").trim();
  const bioInput = String(formData.get("bio") ?? "").trim();
  const occupationInput = String(formData.get("occupation") ?? "").trim();
  const cityInput = String(formData.get("city") ?? "").trim();
  const countryInput = String(formData.get("countryCode") ?? "").trim().toUpperCase();

  if (!displayName || displayName.length > 80) {
    return { message: "Your display name must be between 1 and 80 characters.", kind: "error" };
  }
  if (usernameInput && !/^[a-z0-9_]{3,30}$/.test(usernameInput)) {
    return { message: "Usernames must be 3–30 lowercase letters, numbers, or underscores.", kind: "error" };
  }
  if (genderInput.length > 40 || bioInput.length > 500 || occupationInput.length > 120 || cityInput.length > 120) {
    return { message: "One or more profile fields exceed their character limit.", kind: "error" };
  }
  if (countryInput && !/^[A-Z]{2}$/.test(countryInput)) {
    return { message: "Enter a two-letter country code, such as US or GB.", kind: "error" };
  }

  const { supabase, user } = await getActiveUser();
  if (!user) return { message: "Your session is no longer active. Sign in again to update your profile.", kind: "error" };

  const { error } = await supabase
    .from("profiles")
    .update({
      username: usernameInput || null,
      display_name: displayName,
      gender: genderInput || null,
      bio: bioInput || null,
      occupation: occupationInput || null,
      city: cityInput || null,
      country_code: countryInput || null,
    })
    .eq("id", user.id);

  if (error?.code === "23505") {
    return { message: "That username is already in use. Choose another one.", kind: "error" };
  }
  if (error) return { message: "We couldn’t save your profile. Check your details and try again.", kind: "error" };

  refreshProfile();
  return { message: "Your profile has been updated.", kind: "success" };
}

export async function updatePreferencesAction(
  _previousState: ProfileFormState = emptyState,
  formData: FormData,
): Promise<ProfileFormState> {
  void _previousState;
  const minimumAge = Number(formData.get("minimumAge"));
  const maximumAge = Number(formData.get("maximumAge"));
  const maximumDistanceInput = String(formData.get("maximumDistanceKm") ?? "").trim();
  const maximumDistance = maximumDistanceInput ? Number(maximumDistanceInput) : null;
  const preferredGenders = String(formData.get("preferredGenders") ?? "")
    .split(",")
    .map((gender) => gender.trim())
    .filter(Boolean);

  if (
    !Number.isInteger(minimumAge) || minimumAge < 18 || minimumAge > 100
    || !Number.isInteger(maximumAge) || maximumAge < minimumAge || maximumAge > 100
  ) {
    return { message: "Choose a valid age range between 18 and 100.", kind: "error" };
  }
  if (maximumDistance !== null && (!Number.isInteger(maximumDistance) || maximumDistance < 1 || maximumDistance > 500)) {
    return { message: "Maximum distance must be between 1 and 500 kilometres.", kind: "error" };
  }
  if (preferredGenders.length > 10 || preferredGenders.some((gender) => !validGenderPreference(gender))) {
    return { message: "Enter up to 10 preferred genders, each no longer than 40 characters.", kind: "error" };
  }

  const { supabase, user } = await getActiveUser();
  if (!user) return { message: "Your session is no longer active. Sign in again to update settings.", kind: "error" };

  const { error: preferencesError } = await supabase.from("user_preferences").upsert({
      user_id: user.id,
      minimum_age: minimumAge,
      maximum_age: maximumAge,
      preferred_genders: preferredGenders,
      maximum_distance_km: maximumDistance,
  }, { onConflict: "user_id" });
  if (preferencesError) {
    return { message: "We couldn’t save your discovery preferences. Check the selected values and try again.", kind: "error" };
  }

  const { error: settingsError } = await supabase.from("user_settings").upsert({
      user_id: user.id,
      email_notifications_enabled: formData.get("emailNotifications") === "on",
      push_notifications_enabled: formData.get("pushNotifications") === "on",
      show_online_status: formData.get("showOnlineStatus") === "on",
      show_distance: formData.get("showDistance") === "on",
      discovery_enabled: formData.get("discoveryEnabled") === "on",
  }, { onConflict: "user_id" });
  if (settingsError) {
    return { message: "Your discovery preferences were saved, but privacy settings could not be saved. Please retry.", kind: "error" };
  }

  refreshProfile();
  return { message: "Your discovery and privacy settings have been updated.", kind: "success" };
}

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mimeType === "image/webp") {
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

export async function uploadProfilePhotoAction(
  _previousState: ProfileFormState = emptyState,
  formData: FormData,
): Promise<ProfileFormState> {
  void _previousState;
  const uploads = formData.getAll("photos");
  const legacyFile = formData.get("photo");
  if (legacyFile) uploads.push(legacyFile);
  if (!uploads.length || uploads.some((file) => !(file instanceof File) || file.size === 0)) {
    return { message: "Choose one or more JPEG, PNG, or WebP images to upload.", kind: "error" };
  }
  if (uploads.length > 10) {
    return { message: "Add up to 10 photos in one upload.", kind: "error" };
  }
  const files = uploads as File[];
  if (files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) {
    return { message: "The combined photo upload must be 10 MB or smaller.", kind: "error" };
  }
  const preparedFiles: { file: File; extension: string; bytes: Uint8Array }[] = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      return { message: "Each photo must be 10 MB or smaller.", kind: "error" };
    }
    const extension = imageTypes.get(file.type);
    if (!extension) return { message: "Photos must be JPEG, PNG, or WebP images.", kind: "error" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasImageSignature(bytes, file.type)) {
      return { message: "One of the selected files does not appear to be a valid image.", kind: "error" };
    }
    preparedFiles.push({ file, extension, bytes });
  }

  const { supabase, user } = await getActiveUser();
  if (!user) return { message: "Your session is no longer active. Sign in again to upload a photo.", kind: "error" };

  const uploadedPaths: string[] = [];
  for (const { file, extension, bytes } of preparedFiles) {
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("profile-photos").upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      const { error: cleanupError } = uploadedPaths.length
        ? await supabase.storage.from("profile-photos").remove(uploadedPaths)
        : { error: null };
      return {
        message: cleanupError
          ? "Some photos uploaded but could not be fully cleaned up. Contact support before retrying."
          : "We couldn’t upload every photo. Check the files and try again.",
        kind: "error",
      };
    }
    uploadedPaths.push(path);
  }

  const { data: photos, error: metadataError } = await supabase
    .from("user_photos")
    .insert(uploadedPaths.map((storage_path, display_order) => ({
      user_id: user.id,
      storage_path,
      is_primary: false,
      display_order,
    })))
    .select("id");

  if (metadataError || !photos || photos.length !== uploadedPaths.length) {
    const { error: cleanupError } = await supabase.storage.from("profile-photos").remove(uploadedPaths);
    return {
      message: cleanupError
        ? "The photos uploaded but their profile records could not be saved or cleaned up. Contact support before retrying."
        : "We couldn’t save the photos to your profile. Try again.",
      kind: "error",
    };
  }

  const { error: primaryError } = await supabase.rpc("set_primary_profile_photo", {
    p_photo_id: photos[0].id,
  });
  if (primaryError) {
    const { error: metadataCleanupError } = await supabase.from("user_photos").delete().in("id", photos.map((photo) => photo.id));
    const { error: storageCleanupError } = await supabase.storage.from("profile-photos").remove(uploadedPaths);
    if (metadataCleanupError || storageCleanupError) {
      return { message: "The photos uploaded but could not be activated or fully cleaned up. Contact support before retrying.", kind: "error" };
    }
    return { message: "We couldn’t make the first new photo your profile photo. Try again.", kind: "error" };
  }

  refreshProfile();
  return {
    message: files.length === 1 ? "Your profile photo has been updated." : `${files.length} photos were added to your profile.`,
    kind: "success",
  };
}

export async function makeProfilePhotoPrimaryAction(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  void _previousState;
  const photoId = String(formData.get("photoId") ?? "");
  if (!uuidPattern.test(photoId)) return { message: "Choose a valid profile photo.", kind: "error" };

  const { supabase, user } = await getActiveUser();
  if (!user) return { message: "Your session is no longer active. Sign in again to update your photo.", kind: "error" };
  const { error } = await supabase.rpc("set_primary_profile_photo", { p_photo_id: photoId });
  if (error) return { message: "We couldn’t update your profile photo. Try again.", kind: "error" };

  refreshProfile();
  return { message: "Your profile photo has been updated.", kind: "success" };
}
