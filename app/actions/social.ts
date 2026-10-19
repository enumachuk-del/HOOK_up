"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export type SocialFormState = { message: string; kind: "error" | "success" | "status" };
const emptyState: SocialFormState = { message: "", kind: "status" };

async function getActiveUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { supabase, user: null };
  const { data: isActive, error: statusError } = await supabase.rpc("is_account_active");
  if (statusError || !isActive) return { supabase, user: null };
  return { supabase, user: data.user };
}

function refreshSocial() {
  revalidatePath("/", "page");
  revalidatePath("/messages", "page");
}

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  return mimeType === "image/webp"
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

export async function createUserPostAction(
  _previousState: SocialFormState = emptyState,
  formData: FormData,
): Promise<SocialFormState> {
  void _previousState;
  const caption = String(formData.get("caption") ?? "").trim();
  const file = formData.get("photo");
  const hasFile = file instanceof File && file.size > 0;
  if (caption.length > 1000) return { message: "Captions must be 1000 characters or fewer.", kind: "error" };
  if (!caption && !hasFile) return { message: "Add a caption or photo to your post.", kind: "error" };
  if (hasFile && file.size > 10 * 1024 * 1024) return { message: "Photos must be 10 MB or smaller.", kind: "error" };

  let extension: string | undefined;
  let bytes: Uint8Array | undefined;
  if (hasFile) {
    extension = imageTypes.get(file.type);
    if (!extension) return { message: "Posts support JPEG, PNG, or WebP photos.", kind: "error" };
    bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasImageSignature(bytes, file.type)) {
      return { message: "The selected file does not appear to be a valid image.", kind: "error" };
    }
  }

  const { supabase, user } = await getActiveUser();
  if (!user) return { message: "Your session is no longer active. Sign in again to post.", kind: "error" };

  let photoPath: string | null = null;
  if (hasFile && bytes && extension) {
    photoPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("profile-photos").upload(photoPath, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (error) return { message: "We couldn’t upload this post photo. Try again.", kind: "error" };
  }

  const { error: postError } = await supabase.rpc("create_user_post", {
    p_caption: caption,
    p_photo_path: photoPath,
  });
  if (postError) {
    if (photoPath) {
      const { error: cleanupError } = await supabase.storage.from("profile-photos").remove([photoPath]);
      if (cleanupError) {
        return { message: "The photo uploaded but the post could not be saved or cleaned up. Contact support before retrying.", kind: "error" };
      }
    }
    return { message: "We couldn’t publish your post. Check your caption and try again.", kind: "error" };
  }

  refreshSocial();
  return { message: "Your post is now in the feed.", kind: "success" };
}

export async function setPostLikeAction(postId: string, liked: boolean): Promise<{ ok: boolean; message: string }> {
  if (!uuidPattern.test(postId) || typeof liked !== "boolean") {
    return { ok: false, message: "That post action is invalid. Refresh and try again." };
  }
  const { supabase, user } = await getActiveUser();
  if (!user) return { ok: false, message: "Sign in again to like posts." };
  const { error } = await supabase.rpc("set_post_like", { p_post_id: postId, p_liked: liked });
  if (error) return { ok: false, message: "We couldn’t save your post like. Refresh and try again." };
  refreshSocial();
  return { ok: true, message: liked ? "Post liked." : "Post like removed." };
}

export type PostComment = { id: string; author_id: string; author_name: string; content: string; created_at: string };

export async function getPostCommentsAction(postId: string): Promise<{ ok: boolean; comments: PostComment[]; message?: string }> {
  if (!uuidPattern.test(postId)) return { ok: false, comments: [], message: "That post could not be found." };
  const { supabase, user } = await getActiveUser();
  if (!user) return { ok: false, comments: [], message: "Sign in again to view comments." };
  const { data, error } = await supabase.rpc("get_post_comments", { p_post_id: postId });
  if (error || !data) return { ok: false, comments: [], message: "Comments could not be loaded. Try again." };
  return { ok: true, comments: data as PostComment[] };
}

export async function addPostCommentAction(
  postId: string,
  content: string,
): Promise<{ ok: boolean; message: string }> {
  if (!uuidPattern.test(postId) || typeof content !== "string" || !content.trim() || content.trim().length > 1000) {
    return { ok: false, message: "Comments must be between 1 and 1000 characters." };
  }
  const { supabase, user } = await getActiveUser();
  if (!user) return { ok: false, message: "Sign in again to comment." };
  const { error } = await supabase.rpc("add_post_comment", { p_post_id: postId, p_content: content.trim() });
  if (error) return { ok: false, message: "We couldn’t post your comment. Try again." };
  refreshSocial();
  return { ok: true, message: "Comment added." };
}

export async function sendDirectMessageAction(
  peerId: string,
  content: string,
  isIntro = false,
): Promise<{ ok: boolean; message: string }> {
  if (!uuidPattern.test(peerId) || typeof content !== "string" || !content.trim() || content.trim().length > 2000) {
    return { ok: false, message: "Messages must be between 1 and 2000 characters." };
  }
  const { supabase, user } = await getActiveUser();
  if (!user) return { ok: false, message: "Sign in again to send messages." };
  const { error } = await supabase.rpc("send_direct_message", {
    p_recipient_id: peerId,
    p_content: content.trim(),
    p_is_intro: isIntro,
  });
  if (error) {
    return { ok: false, message: isIntro
      ? "You can send one introduction with a like. This member may already have received yours."
      : "A mutual active match is required to continue messaging." };
  }
  refreshSocial();
  return { ok: true, message: "Message sent." };
}

export async function unmatchProfileAction(peerId: string): Promise<{ ok: boolean; message: string }> {
  if (!uuidPattern.test(peerId)) return { ok: false, message: "That match could not be found." };
  const { supabase, user } = await getActiveUser();
  if (!user) return { ok: false, message: "Sign in again to manage matches." };
  const { error } = await supabase.rpc("unmatch_profile", { p_target_id: peerId });
  if (error) return { ok: false, message: "We couldn’t end this match. Refresh and try again." };
  refreshSocial();
  return { ok: true, message: "Match ended. This conversation is now closed." };
}
