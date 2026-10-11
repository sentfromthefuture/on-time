import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, EllipsisVertical, Flag, Flame, Send, UserMinus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { BigCountdown } from '@/components/sparks/Countdown';
import { SeveringOverlay } from '@/components/sparks/Effects';
import { BottomSheet, ConfirmDialog, ContactsPanel, ReportSheet, SwapSheet } from '@/components/sparks/ChatSheets';
import { SparkAvatar } from '@/components/sparks/SparkAvatar';
import { useSparks } from '@/components/sparks/SparksProvider';
import { blockUser, fetchMessages, markRead, sendMessage, tapConnection, unmatch } from '@/lib/sparks';
import { ICEBREAKERS, buzz, isNumbersKeep, looksLikeClosedWindow, messageOf, msLeft, type ChatMessage } from '@/lib/spark-utils';

const MessageList = memo(function MessageList({ messages, myId }: { messages: ChatMessage[]; myId: string }) {
  return (
    <div className="space-y-1.5">
      {messages.map((message) => {
        if (message.kind && message.kind !== 'text') {
          return <p key={String(message.id)} className="my-3 text-center text-xs text-slate-500">{message.body}</p>;
        }
        const mine = message.sender_id === myId;
        const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return (
          <div key={String(message.id)} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`pop-in max-w-[80%] px-3.5 py-2 text-[15px] leading-snug ${mine ? 'sk-bubble-me' : 'sk-bubble-them'}`} data-mine={mine}>
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p className="mt-0.5 text-right text-[10px] opacity-60">{time}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default function ChatPage() {
  const { matchId = '' } = useParams();
  const navigate = useNavigate();
  const { matches, loaded, refresh, myId, myPhoto, tombstone, ack, clockOffset, clearUnread } = useSparks();
  const match = matches.find((row) => row.match_id === matchId) ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<'loading' | 'ready' | 'error'>('loading');
  const [historyError, setHistoryError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [closedNotice, setClosedNotice] = useState('');
  const [expired, setExpired] = useState(false);
  const [sheet, setSheet] = useState<null | 'swap' | 'contacts' | 'report'>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<null | 'unmatch' | 'block'>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [tapBusy, setTapBusy] = useState(false);
  const [tapWaiting, setTapWaiting] = useState(false);
  const [tapError, setTapError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstScroll = useRef(true);
  const readTimer = useRef<number | undefined>(undefined);

  const markNow = useCallback(() => {
    if (!matchId) return;
    markRead(matchId).then(() => clearUnread(matchId)).catch((error) => console.error('Could not mark messages as read:', error));
  }, [matchId, clearUnread]);

  const loadHistory = useCallback(async (quiet: boolean) => {
    if (!matchId) return;
    if (!quiet) { setHistory('loading'); setHistoryError(''); }
    try {
      const rows = await fetchMessages(matchId);
      setMessages(rows);
      setHistory('ready');
      markNow();
    } catch (error) {
      if (!quiet) { setHistoryError(messageOf(error)); setHistory('error'); }
    }
  }, [matchId, markNow]);

  // History + mark_read on open.
  useEffect(() => {
    firstScroll.current = true;
    setMessages([]);
    void loadHistory(false);
  }, [matchId, loadHistory]);

  // Realtime INSERT subscription for this match only.
  useEffect(() => {
    if (!matchId) return;
    let first = true;
    const channel = supabase
      .channel(`chat:${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, (payload) => {
        const row = payload.new as ChatMessage;
        setMessages((old) => (old.some((message) => String(message.id) === String(row.id)) ? old : [...old, row]));
        if (row.sender_id !== myId) {
          window.clearTimeout(readTimer.current);
          readTimer.current = window.setTimeout(markNow, 300);
        }
      })
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          if (!first) void loadHistory(true); // fill any gap after a reconnect
          first = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Chat realtime problem:', status, error);
        }
      });
    return () => { window.clearTimeout(readTimer.current); void supabase.removeChannel(channel); };
  }, [matchId, myId, markNow, loadHistory]);

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: firstScroll.current ? 'auto' : 'smooth' });
    if (messages.length) firstScroll.current = false;
  }, [messages.length]);

  // Close the composer the moment the server clock says the window is over, then re-check with the server.
  const expiresAt = match?.expires_at;
  const status = match?.status;
  useEffect(() => {
    if (!expiresAt || status !== 'active') { setExpired(false); return; }
    const left = msLeft(expiresAt, Date.now() + clockOffset);
    if (left <= 0) { setExpired(true); return; }
    setExpired(false);
    const timer = window.setTimeout(() => { setExpired(true); void refresh(); }, Math.min(left + 250, 2_000_000_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt, status, clockOffset, refresh]);

  if (!loaded) {
    return <div className="spark-shell fixed inset-0 z-40 grid place-items-center text-sm text-slate-400" aria-busy="true">Opening your spark…</div>;
  }
  if (!match) {
    return (
      <div className="spark-shell fixed inset-0 z-40 grid place-items-center p-8 text-center">
        <div>
          <h1 className="display text-2xl font-extrabold">This spark isn't here anymore</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-slate-400">It may have faded or been closed.</p>
          <button type="button" onClick={() => navigate('/sparks', { replace: true })} className="primary-button mt-6">Back to Sparks</button>
        </div>
      </div>
    );
  }

  const closed = match.status === 'severed' || (match.status === 'active' && expired);
  const kept = match.status === 'kept';
  const numbersRevealed = isNumbersKeep(match);
  const iTapped = match.i_tapped || tapWaiting;
  const canSend = !closed && !sending && draft.trim().length > 0;

  const handleClosed = () => {
    setClosedNotice("This spark's window just closed.");
    void refresh();
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || closed) return;
    setSending(true); setSendError('');
    try {
      const row = await sendMessage(matchId, myId, body);
      setMessages((old) => (old.some((message) => String(message.id) === String(row.id)) ? old : [...old, row]));
      setDraft('');
      buzz(8);
    } catch (error) {
      if (looksLikeClosedWindow(error as { message?: string; code?: string })) handleClosed();
      else setSendError(messageOf(error));
    } finally { setSending(false); }
  };

  const tap = async () => {
    if (tapBusy || closed || kept || iTapped) return;
    setTapBusy(true); setTapError('');
    try {
      const result = await tapConnection(matchId);
      buzz(12);
      if (result === 'kept') await refresh(); // the keep animation plays when the row flips to 'kept'
      else { setTapWaiting(true); void refresh(); }
    } catch (error) {
      if (looksLikeClosedWindow(error as { message?: string; code?: string })) handleClosed();
      else setTapError(messageOf(error));
    } finally { setTapBusy(false); }
  };

  const runAction = async (action: 'unmatch' | 'block') => {
    setActionBusy(true); setActionError('');
    try {
      if (action === 'unmatch') await unmatch(matchId);
      else await blockUser(match.user_id);
      setConfirm(null);
      navigate('/sparks', { replace: true });
      void refresh();
    } catch (error) {
      setActionError(messageOf(error));
    } finally { setActionBusy(false); }
  };

  const openSwap = () => setSheet(numbersRevealed ? 'contacts' : 'swap');

  return (
    <div className="spark-shell fixed inset-0 z-40 flex flex-col" data-testid="chat">
      <header className="border-b border-white/[.06] bg-[#14141b]/90 px-3 pb-3 pt-[max(env(safe-area-inset-top),12px)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/sparks')} aria-label="Back to Sparks" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[.05] text-slate-200"><ArrowLeft size={19} /></button>
          <SparkAvatar path={match.photos[0]} name={match.display_name} size={42} />
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-lg font-extrabold leading-tight">{match.display_name}{match.age !== null && <span className="ml-1.5 text-sm font-semibold text-slate-400">{match.age}</span>}</h1>
            {match.distance_km !== null && <p className="text-[11px] text-slate-500">{match.distance_km < 1 ? 'Less than 1 km away' : `${Math.round(match.distance_km)} km away`}</p>}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setMenu((open) => !open)} aria-label="More options" aria-expanded={menu} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05] text-slate-200"><EllipsisVertical size={19} /></button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div role="menu" className="panel absolute right-0 top-12 z-20 w-52 p-1.5 shadow-2xl">
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); setSheet('report'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold hover:bg-white/5"><Flag size={16} />Report</button>
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); setActionError(''); setConfirm('block'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold hover:bg-white/5"><Ban size={16} />Block</button>
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); setActionError(''); setConfirm('unmatch'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-rose-300 hover:bg-white/5"><UserMinus size={16} />Unmatch</button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex min-h-[58px] items-center justify-center">
          {kept ? (
            <div className="flex items-center gap-2 text-amber-200" data-testid="kept-label"><Flame className="sk-flame-idle" size={26} fill="currentColor" /><span className="display text-xl font-extrabold">Kept</span></div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <BigCountdown match={match} />
              {match.extended && <span className="rounded-full bg-yellow-300/15 px-2.5 py-0.5 text-[10.5px] font-bold text-yellow-200">Bonus round +24h</span>}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="messages">
        {history === 'loading' && <p className="py-8 text-center text-sm text-slate-500">Loading messages…</p>}
        {history === 'error' && (
          <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">
            <p>{historyError}</p>
            <button type="button" onClick={() => void loadHistory(false)} className="mt-2 underline">Try again</button>
          </div>
        )}
        {history === 'ready' && messages.length === 0 && (
          <div className="mx-auto mt-6 max-w-sm text-center">
            <h2 className="display text-xl font-extrabold">Break the ice</h2>
            <p className="mt-1 text-sm text-slate-400">The clock is running. Start with something fun.</p>
            {!closed && (
              <div className="mt-5 flex flex-wrap justify-center gap-2" data-testid="icebreakers">
                {ICEBREAKERS.map((text) => (
                  <button key={text} type="button" className="sk-chip" onClick={() => { setDraft(text); inputRef.current?.focus(); }}>{text}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <MessageList messages={messages} myId={myId} />
        <div ref={endRef} />
      </div>

      <footer className="border-t border-white/[.06] bg-[#14141b]/95 px-3 pt-3 safe-bottom">
        <div className="flex gap-2.5">
          <button type="button" onClick={() => void tap()} disabled={tapBusy || closed || kept || iTapped} data-testid="btn-connection" className={`sk-action sk-action-love ${iTapped || kept ? 'sk-action-on' : ''}`}>
            <span aria-hidden="true">💚</span>Genuine connection
          </button>
          <button type="button" onClick={openSwap} disabled={closed && !numbersRevealed} data-testid="btn-swap" className="sk-action sk-action-phone">
            <span aria-hidden="true">📱</span>{numbersRevealed ? 'View numbers' : 'Swap numbers'}
          </button>
        </div>
        {iTapped && !kept && !closed && <p role="status" data-testid="tap-waiting" className="mt-2 text-center text-xs text-emerald-200/80">Waiting... if they feel it too, it's a keep.</p>}
        {match.i_shared_contact && !numbersRevealed && !closed && <p className="mt-1.5 text-center text-xs text-sky-200/70">Your number is waiting for theirs.</p>}
        {tapError && <p role="alert" className="mt-2 text-center text-xs text-rose-300">{tapError}</p>}
        {closedNotice && <p role="alert" className="mt-2 text-center text-xs text-orange-200">{closedNotice} Checking where things stand…</p>}
        {sendError && <p role="alert" className="mt-2 text-center text-xs text-rose-300">{sendError}</p>}

        {closed ? (
          <p className="my-3 rounded-2xl bg-white/[.04] p-3 text-center text-sm text-slate-400" data-testid="closed-note">The spark window has closed.</p>
        ) : (
          <form className="mt-3 flex items-center gap-2.5 pb-1" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <input ref={inputRef} className="field !rounded-full !py-3" placeholder="Say something…" value={draft} maxLength={1000} onChange={(event) => setDraft(event.target.value)} aria-label="Message" autoComplete="off" enterKeyHint="send" />
            <button type="submit" disabled={!canSend} aria-label="Send" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[#23121a]"><Send size={19} /></button>
          </form>
        )}
      </footer>

      {sheet === 'swap' && (
        <BottomSheet title="Swap numbers" onClose={() => setSheet(null)}>
          <SwapSheet match={match} onRevealed={() => { setSheet('contacts'); void refresh(); }} onShared={() => void refresh()} />
        </BottomSheet>
      )}
      {sheet === 'contacts' && (
        <BottomSheet title="Your numbers" onClose={() => setSheet(null)}>
          <ContactsPanel match={match} myId={myId} />
        </BottomSheet>
      )}
      {sheet === 'report' && (
        <BottomSheet title={`Report ${match.display_name}`} onClose={() => setSheet(null)}>
          <ReportSheet match={match} onDone={() => setSheet(null)} />
        </BottomSheet>
      )}
      {confirm === 'unmatch' && (
        <ConfirmDialog title={`Unmatch ${match.display_name}?`} body="This ends the spark and removes the chat for both of you." confirmLabel="Unmatch" danger busy={actionBusy} error={actionError} onConfirm={() => void runAction('unmatch')} onCancel={() => setConfirm(null)} />
      )}
      {confirm === 'block' && (
        <ConfirmDialog title={`Block ${match.display_name}?`} body="You won't see each other again, and the chat will close." confirmLabel="Block" danger busy={actionBusy} error={actionError} onConfirm={() => void runAction('block')} onCancel={() => setConfirm(null)} />
      )}

      {tombstone && tombstone.match_id === matchId && (
        <SeveringOverlay
          key={tombstone.match_id}
          name={tombstone.display_name}
          theirPhoto={tombstone.photos[0]}
          myPhoto={myPhoto}
          onDone={() => { navigate('/sparks', { replace: true }); void ack(tombstone.match_id); }}
        />
      )}
    </div>
  );
}
