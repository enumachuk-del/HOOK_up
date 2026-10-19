"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { recordProfileAction } from "@/app/actions/discovery";
import { sendDirectMessageAction, unmatchProfileAction } from "@/app/actions/social";

export type ConversationPreview = {
  peer_id: string;
  peer_name: string;
  peer_photo_url: string | null;
  is_matched: boolean;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type ConversationMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  is_intro: boolean;
  created_at: string;
  read_at: string | null;
};

export function MessageCenter({
  currentUserId,
  conversations,
  selected,
  messages,
}: {
  currentUserId: string;
  conversations: ConversationPreview[];
  selected: ConversationPreview | null;
  messages: ConversationMessage[];
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedPeerId = selected?.peer_id;

  useEffect(() => {
    if (!selectedPeerId) return;
    const interval = window.setInterval(() => router.refresh(), 10000);
    return () => window.clearInterval(interval);
  }, [router, selectedPeerId]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !content.trim() || pending || !selected.is_matched) return;
    startTransition(async () => {
      try {
        const result = await sendDirectMessageAction(selected.peer_id, content);
        setNotice(result.message);
        if (result.ok) {
          setContent("");
          router.refresh();
        }
      } catch {
        setNotice("We couldn’t send your message. Refresh and try again.");
      }
    });
  }

  async function likeBack() {
    if (!selected || pending) return;
    startTransition(async () => {
      try {
        const result = await recordProfileAction(selected.peer_id, "like");
        setNotice(result.ok && result.matched ? "It’s a match! You can now message each other." : result.message);
        if (result.ok) router.refresh();
      } catch {
        setNotice("We couldn’t save your like. Refresh and try again.");
      }
    });
  }

  async function unmatch() {
    if (!selected || !window.confirm(`Unmatch from ${selected.peer_name}? This closes your conversation.`)) return;
    startTransition(async () => {
      try {
        const result = await unmatchProfileAction(selected.peer_id);
        setNotice(result.message);
        if (result.ok) router.push("/messages");
      } catch {
        setNotice("We couldn’t end this match. Refresh and try again.");
      }
    });
  }

  const incomingIntro = selected
    ? messages.some((message) => message.is_intro && message.sender_id === selected.peer_id)
    : false;

  return (
    <div className="message-center">
      <aside className="conversation-list" aria-label="Your matches and message requests">
        <div className="conversation-list-heading"><p className="eyebrow">Stay connected</p><h1>Matches & messages</h1></div>
        {conversations.length ? conversations.map((conversation) => (
          <Link
            key={conversation.peer_id}
            href={`/messages?with=${conversation.peer_id}`}
            className={`conversation-preview ${selected?.peer_id === conversation.peer_id ? "selected" : ""}`}
          >
            {conversation.peer_photo_url
              ? <Image src={conversation.peer_photo_url} alt="" width={48} height={48} unoptimized />
              : <span className="conversation-avatar-fallback">{conversation.peer_name.slice(0, 1).toUpperCase()}</span>}
            <span className="conversation-preview-copy">
              <strong>{conversation.peer_name}{conversation.is_matched && <span className="conversation-match-mark"> ♥</span>}</strong>
              <span>{conversation.last_message ?? (conversation.is_matched ? "You matched — say hello!" : "An introduction is waiting")}</span>
            </span>
            {conversation.unread_count > 0 && <span className="conversation-unread">{conversation.unread_count}</span>}
          </Link>
        )) : (
          <div className="conversation-empty"><p>Your conversations will appear here.</p><Link href="/#people">Discover people</Link></div>
        )}
      </aside>

      <section className="conversation-panel" aria-label="Conversation">
        {selected ? (
          <>
            <header className="conversation-header">
              <div>
                {selected.peer_photo_url
                  ? <Image src={selected.peer_photo_url} alt="" width={48} height={48} unoptimized />
                  : <span className="conversation-avatar-fallback">{selected.peer_name.slice(0, 1).toUpperCase()}</span>}
                <div><h2>{selected.peer_name}</h2><p>{selected.is_matched ? "You matched" : incomingIntro ? "Message request" : "Introduction sent"}</p></div>
              </div>
              {selected.is_matched && <button type="button" onClick={() => void unmatch()} disabled={pending}>Unmatch</button>}
            </header>
            <div className="conversation-messages" aria-live="polite">
              {!selected.is_matched && incomingIntro && (
                <div className="intro-notice"><strong>Message request</strong><p>Like them back to match and continue the conversation.</p><button type="button" onClick={() => void likeBack()} disabled={pending}>Like back & match ♥</button></div>
              )}
              {messages.map((message) => (
                <article className={`message-bubble ${message.sender_id === currentUserId ? "mine" : "theirs"}`} key={message.id}>
                  {message.is_intro && <span className="message-intro-label">First message</span>}
                  <p>{message.content}</p>
                  <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
                </article>
              ))}
              {!messages.length && selected.is_matched && <p className="conversation-first-message">A match is a lovely place to start. Say hello when you’re ready.</p>}
            </div>
            {!selected.is_matched && !incomingIntro && (
              <div className="intro-notice"><strong>Introduction sent</strong><p>Your first note is waiting for a reply. A mutual like will open the conversation.</p></div>
            )}
            {selected.is_matched ? (
              <form className="conversation-compose" onSubmit={send}>
                <input value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} placeholder="Write a message…" aria-label="Write a message" />
                <button type="submit" disabled={pending || !content.trim()}>{pending ? "Sending…" : "Send"}</button>
              </form>
            ) : <p className="conversation-locked">Ongoing messages unlock when you both like each other.</p>}
          </>
        ) : (
          <div className="conversation-placeholder"><span aria-hidden="true">♡</span><h2>Good things start with hello.</h2><p>Choose a match or message request to open the conversation.</p></div>
        )}
      </section>
      {notice && <div className="feed-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
    </div>
  );
}
