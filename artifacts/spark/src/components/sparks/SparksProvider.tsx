import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { ackSevered, fetchMatches } from '@/lib/sparks';
import { messageOf, msLeft, normalizeStatus, type MatchRow } from '@/lib/spark-utils';

export type SparkEffect = { id: string; type: 'kept' | 'bonus'; match: MatchRow };

type SparksContextValue = {
  matches: MatchRow[];
  loaded: boolean;
  error: string;
  clockOffset: number;
  refresh: () => Promise<MatchRow[]>;
  /** The first severed row whose animation has not played yet. */
  tombstone: MatchRow | null;
  ack: (matchId: string) => Promise<boolean>;
  ackError: string;
  retryAcks: () => Promise<void>;
  effects: SparkEffect[];
  dismissEffect: (id: string) => void;
  clearUnread: (matchId: string) => void;
  myId: string;
  myPhoto?: string;
  unreadTotal: number;
};

const SparksContext = createContext<SparksContextValue | null>(null);

export function useSparks(): SparksContextValue {
  const value = useContext(SparksContext);
  if (!value) throw new Error('useSparks must be used inside SparksProvider');
  return value;
}

// Server-corrected "now", ticking once a second. Only components that read it re-render each second.
const ClockContext = createContext<number>(Date.now());
export const useServerNow = () => useContext(ClockContext);

function ClockProvider({ offset, children }: { offset: number; children: ReactNode }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <ClockContext.Provider value={tick + offset}>{children}</ClockContext.Provider>;
}

export function SparksProvider({ userId, myPhoto, children }: { userId: string; myPhoto?: string; children: ReactNode }) {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [effects, setEffects] = useState<SparkEffect[]>([]);
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [ackError, setAckError] = useState('');

  const matchesRef = useRef<MatchRow[]>([]);
  const offsetRef = useRef(0);
  const firedRef = useRef(new Set<string>());
  const inflight = useRef<Promise<void> | null>(null);
  const rerun = useRef(false);
  const alive = useRef(true);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; window.clearTimeout(debounce.current); };
  }, []);

  /** Stores new rows and detects transitions (kept, bonus round) against what we had before. */
  const applyRows = useCallback((next: MatchRow[]) => {
    const before = new Map(matchesRef.current.map((row) => [row.match_id, row]));
    const fresh: SparkEffect[] = [];
    for (const row of next) {
      const prev = before.get(row.match_id);
      if (!prev) continue;
      const keptKey = `kept:${row.match_id}`;
      if (row.status === 'kept' && prev.status === 'active' && !firedRef.current.has(keptKey)) {
        firedRef.current.add(keptKey);
        fresh.push({ id: keptKey, type: 'kept', match: row });
      }
      const bonusKey = `bonus:${row.match_id}`;
      if (row.extended && !prev.extended && row.status === 'active' && !firedRef.current.has(bonusKey)) {
        firedRef.current.add(bonusKey);
        fresh.push({ id: bonusKey, type: 'bonus', match: row });
      }
    }
    matchesRef.current = next;
    setMatches(next);
    if (fresh.length) setEffects((old) => [...old, ...fresh]);
  }, []);

  const refresh = useCallback(async (): Promise<MatchRow[]> => {
    if (inflight.current) {
      rerun.current = true;
      await inflight.current;
      return matchesRef.current;
    }
    const run = (async () => {
      do {
        rerun.current = false;
        try {
          const { rows, offset: nextOffset } = await fetchMatches();
          if (!alive.current) return;
          if (nextOffset !== null) { offsetRef.current = nextOffset; setOffset(nextOffset); }
          applyRows(rows);
          setError('');
        } catch (err) {
          if (alive.current) setError(messageOf(err));
        } finally {
          if (alive.current) setLoaded(true);
        }
      } while (rerun.current && alive.current);
    })();
    inflight.current = run;
    try { await run; } finally { inflight.current = null; }
    return matchesRef.current;
  }, [applyRows]);

  const scheduleRefresh = useCallback((delay: number) => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void refresh(), delay);
  }, [refresh]);

  // First load.
  useEffect(() => { void refresh(); }, [refresh, userId]);

  // Realtime: matches (kept / bonus / severed) and new messages (unread + previews).
  useEffect(() => {
    const channel = supabase
      .channel(`sparks:${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        const id = typeof row.id === 'string' ? row.id : typeof row.match_id === 'string' ? row.match_id : undefined;
        const current = matchesRef.current;
        const prev = current.find((match) => match.match_id === id);
        if (prev) {
          // Show the change instantly, then let my_matches confirm the details.
          const patched: MatchRow = {
            ...prev,
            status: normalizeStatus(row.status) ?? prev.status,
            extended: typeof row.extended === 'boolean' ? row.extended : prev.extended,
            expires_at: typeof row.expires_at === 'string' ? row.expires_at : prev.expires_at,
            kept_via: typeof row.kept_via === 'string' ? row.kept_via : prev.kept_via,
          };
          applyRows(current.map((match) => (match === prev ? patched : match)));
        }
        scheduleRefresh(120);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, () => scheduleRefresh(150))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matches' }, () => scheduleRefresh(150))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => scheduleRefresh(400))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') void refresh();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Sparks realtime problem:', status, err);
      });
    return () => { void supabase.removeChannel(channel); };
  }, [userId, applyRows, refresh, scheduleRefresh]);

  // Safety net: refetch when the app comes back, the network returns, and once a minute while visible.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onOnline = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [refresh]);

  // When any countdown reaches zero, refetch my_matches (the server severs it instantly).
  useEffect(() => {
    const active = matches.filter((match) => match.status === 'active');
    if (!active.length) return;
    const serverNow = Date.now() + offset;
    const soonest = Math.min(...active.map((match) => msLeft(match.expires_at, serverNow)));
    const wait = soonest <= 0 ? 2000 : Math.min(soonest + 700, 2_000_000_000);
    const timer = window.setTimeout(() => void refresh(), wait);
    return () => window.clearTimeout(timer);
  }, [matches, offset, refresh]);

  const ack = useCallback(async (matchId: string): Promise<boolean> => {
    setHandled((old) => new Set(old).add(matchId));
    try {
      await ackSevered(matchId);
      setAckError('');
    } catch (err) {
      setAckError(messageOf(err));
      return false;
    }
    await refresh();
    return true;
  }, [refresh]);

  const retryAcks = useCallback(async () => {
    for (const match of matchesRef.current.filter((row) => row.status === 'severed')) await ack(match.match_id);
  }, [ack]);

  const dismissEffect = useCallback((id: string) => setEffects((old) => old.filter((effect) => effect.id !== id)), []);

  const clearUnread = useCallback((matchId: string) => {
    const next = matchesRef.current.map((row) => (row.match_id === matchId && row.unread ? { ...row, unread: 0 } : row));
    matchesRef.current = next;
    setMatches(next);
  }, []);

  const tombstone = useMemo(() => matches.find((row) => row.status === 'severed' && !handled.has(row.match_id)) ?? null, [matches, handled]);
  const unreadTotal = useMemo(() => matches.reduce((sum, row) => (row.status === 'severed' ? sum : sum + row.unread), 0), [matches]);

  const value = useMemo<SparksContextValue>(() => ({
    matches, loaded, error, clockOffset: offset, refresh, tombstone, ack, ackError, retryAcks,
    effects, dismissEffect, clearUnread, myId: userId, myPhoto, unreadTotal,
  }), [matches, loaded, error, offset, refresh, tombstone, ack, ackError, retryAcks, effects, dismissEffect, clearUnread, userId, myPhoto, unreadTotal]);

  return (
    <SparksContext.Provider value={value}>
      <ClockProvider offset={offset}>{children}</ClockProvider>
    </SparksContext.Provider>
  );
}

/** Unread count bubble for the Sparks tab. */
export function SparksBadge() {
  const { unreadTotal } = useSparks();
  if (unreadTotal <= 0) return null;
  return (
    <span aria-label={`${unreadTotal} unread`} className="absolute right-[calc(50%-22px)] top-1.5 grid min-w-[17px] place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-extrabold leading-[17px] text-[#23121a]">
      {unreadTotal > 9 ? '9+' : unreadTotal}
    </span>
  );
}
