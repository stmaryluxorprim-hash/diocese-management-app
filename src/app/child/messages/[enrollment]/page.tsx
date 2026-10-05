'use client';

// ---------- Child portal — محادثة الفصل ----------
// The child's conversation for one enrollment: his messages + replies of
// every servant of the tenant + the announcements sent to his scope.
// Realtime on chat_messages (debounced refetch through the anon RPC),
// paged upwards, marks read on open.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, ChevronUp, Church, Users } from 'lucide-react';
import Image from 'next/image';
import ChildShell, { useChildMessages } from '@/components/child/ChildShell';
import { MessagesHeader, MessageBubble, DayDivider, Composer, ImageViewer, EmptyChat, Toast } from '@/components/messages/ChatBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { uniqueTopic, LIVE_POLL_MS } from '@/lib/realtime';
import {
  fetchChildChatMessages, childSendMessage, childMarkRead, chatErrorMessage, groupByDay, type ChatMessage,
} from '@/lib/chat';

export default function ChildThreadPage() {
  return (
    <ChildShell>
      <ThreadContent />
    </ChildShell>
  );
}

function ThreadContent() {
  const params = useParams<{ enrollment: string }>();
  const enrollmentId = params.enrollment;
  const { token, profile } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const { reload: reloadOverview } = useChildMessages();

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const enrollment = profile?.enrollments.find((e) => e.id === enrollmentId);

  const load = useCallback(async () => {
    if (!token || !enrollmentId) return;
    try {
      const r = await fetchChildChatMessages(supabase, token, enrollmentId);
      setMessages(r.messages);
      setHasMore(r.has_more);
      setError(null);
      childMarkRead(supabase, token, enrollmentId).then(reloadOverview).catch(() => {});
    } catch (e) {
      setError(chatErrorMessage(e, 'تعذر تحميل المحادثة'));
      setMessages([]);
    }
  }, [supabase, token, enrollmentId, reloadOverview]);

  useEffect(() => { load(); }, [load]);

  // 0046: chat_messages left the postgres_changes publication and the child
  // portal has no session for the private broadcast topics → an open thread
  // polls while visible (cheap RPC, one child) + refresh on focus.
  // 20261011120000: the ONE place in the portal that still polls — the child
  // is reading this thread right now. Visible-only, stops when he leaves.
  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, LIVE_POLL_MS.thread);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [supabase, token, enrollmentId, load]);

  const all = useMemo(() => [...older, ...(messages ?? [])], [older, messages]);
  const groups = useMemo(() => groupByDay(all), [all]);

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [all.length]);

  const loadMore = async () => {
    const first = all[0];
    if (!first || !token || loadingMore) return;
    setLoadingMore(true);
    stickToBottom.current = false;
    try {
      const r = await fetchChildChatMessages(supabase, token, enrollmentId, { before: first.created_at });
      setOlder((o) => [...r.messages, ...o]);
      if (r.messages.length === 0) setHasMore(false);
    } catch (e) {
      setToast(chatErrorMessage(e)); setTimeout(() => setToast(null), 2800);
    } finally {
      setLoadingMore(false);
    }
  };

  const onSend = async (body: string, imageUrl: string | null) => {
    if (!token) return;
    stickToBottom.current = true;
    try {
      await childSendMessage(supabase, token, enrollmentId, body, imageUrl);
      await load();
    } catch (e) {
      throw new Error(chatErrorMessage(e, 'تعذر الإرسال'));
    }
  };

  return (
    <>
      <MessagesHeader
        back="/child/messages"
        title={enrollment ? `${enrollment.class_name} · ${enrollment.service_name}` : 'المحادثة'}
        sub={enrollment?.church_name}
        icon={
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-sky-200">
            {enrollment?.church_logo ? (
              <Image src={enrollment.church_logo} alt="" fill sizes="40px" className="object-cover" />
            ) : (
              <Church className="absolute inset-0 m-auto h-5 w-5 text-sky-400" />
            )}
          </div>
        }
      />

      <p className="mb-2 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800">
        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        رسالتك يقرأها كل خدام فصلك وخدمتك وكنيستك، ويردّون عليك هنا.
      </p>

      {error && <div className="card mb-3 text-center text-sm font-bold text-red-600">{error}</div>}

      <section id="child-chat-thread" className="min-h-[50vh]">
        {messages === null ? (
          <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-sky-500" /></div>
        ) : all.length === 0 ? (
          <EmptyChat text="ابدأ المحادثة" sub="اكتب رسالتك لخدامك في الأسفل" />
        ) : (
          <>
            {hasMore && (
              <div className="mb-2 flex justify-center">
                <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary flex items-center gap-1 !py-1.5 !px-3 text-xs">
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronUp className="h-4 w-4" />} رسائل أقدم
                </button>
              </div>
            )}
            {groups.map((g) => (
              <div key={g.key}>
                <DayDivider label={g.heading} />
                <div className="space-y-2">
                  {g.items.map((m) => <MessageBubble key={m.id} m={m} onImage={setViewer} />)}
                </div>
              </div>
            ))}
            <div ref={bottomRef} className="h-2" />
          </>
        )}
      </section>

      <Composer supabase={supabase} folder="child-messages" onSend={onSend} disabled={!!error} placeholder="اكتب لخدامك…" />

      <ImageViewer url={viewer} onClose={() => setViewer(null)} />
      <Toast msg={toast} />
    </>
  );
}
