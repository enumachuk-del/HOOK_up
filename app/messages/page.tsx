import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { MessageCenter, type ConversationMessage, type ConversationPreview } from "@/components/message-center";
import { ProfileMenu } from "@/components/profile-menu";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConversationRpcRow = {
  peer_id: string;
  peer_name: string;
  peer_photo_path: string | null;
  is_matched: boolean;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/");
  const [{ data: isActive, error: activeError }, { data: profile, error: profileError }, { data: isSuperAdmin, error: roleError },
    { data: conversationsData, error: conversationsError }, { data: primaryPhoto, error: primaryPhotoError }] = await Promise.all([
    supabase.rpc("is_account_active"),
    supabase.from("profiles").select("display_name").eq("id", authData.user.id).single(),
    supabase.rpc("is_super_admin"),
    supabase.rpc("list_my_conversations"),
    supabase.from("user_photos").select("storage_path").eq("user_id", authData.user.id).eq("is_primary", true).maybeSingle(),
  ]);
  if (activeError || !isActive) redirect("/");
  if (profileError || !profile || roleError || conversationsError || !conversationsData || primaryPhotoError) {
    throw new Error("Your messages could not be loaded. Check the member-feed Supabase migration and try again.");
  }

  const rows = conversationsData as ConversationRpcRow[];
  const paths = [...new Set([
    ...(primaryPhoto ? [primaryPhoto.storage_path] : []),
    ...rows.map((row) => row.peer_photo_path).filter((path): path is string => Boolean(path)),
  ])];
  const signedResult = paths.length
    ? await supabase.storage.from("profile-photos").createSignedUrls(paths, 60 * 60)
    : { data: [], error: null };
  if (signedResult.error) throw new Error("A conversation photo could not be loaded. Verify the private photo-storage policy.");
  const photoUrls = new Map((signedResult.data ?? []).map((entry) => [entry.path, entry.signedUrl]));
  const conversations: ConversationPreview[] = rows.map((row) => ({
    peer_id: row.peer_id,
    peer_name: row.peer_name,
    peer_photo_url: row.peer_photo_path ? photoUrls.get(row.peer_photo_path) ?? null : null,
    is_matched: row.is_matched,
    last_message: row.last_message,
    last_message_at: row.last_message_at,
    unread_count: Number(row.unread_count),
  }));

  const selectedId = params.with && uuidPattern.test(params.with) ? params.with : null;
  const selected = conversations.find((conversation) => conversation.peer_id === selectedId) ?? null;
  let messages: ConversationMessage[] = [];
  if (selected) {
    const { error: readError } = await supabase.rpc("mark_conversation_read", { p_peer_id: selected.peer_id });
    if (readError) throw new Error("This conversation could not be marked as read.");
    const { data, error } = await supabase.rpc("get_conversation_messages", { p_peer_id: selected.peer_id });
    if (error || !data) throw new Error("This conversation could not be loaded.");
    messages = data as ConversationMessage[];
  }

  return (
    <div className="app messages-page">
      <header className="topbar">
        <Brand />
        <Link href="/" className="profile-back-link">Back to feed</Link>
        <ProfileMenu
          displayName={profile.display_name}
          email={authData.user.email ?? ""}
          avatarUrl={primaryPhoto ? photoUrls.get(primaryPhoto.storage_path) ?? null : null}
          isSuperAdmin={isSuperAdmin ?? false}
        />
      </header>
      <main className="messages-main">
        <MessageCenter currentUserId={authData.user.id} conversations={conversations} selected={selected} messages={messages} />
      </main>
      <nav className="mobile-member-nav" aria-label="Mobile navigation">
        <Link href="/"><span aria-hidden="true">⌕</span>People</Link>
        <Link href="/#posts"><span aria-hidden="true">▤</span>Feed</Link>
        <Link href="/messages" aria-current="page"><span aria-hidden="true">✉</span>Matches</Link>
        <Link href="/profile"><span aria-hidden="true">◉</span>Profile</Link>
      </nav>
    </div>
  );
}
