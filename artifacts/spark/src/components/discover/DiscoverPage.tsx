import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Heart, MapPin, Zap } from 'lucide-react';
import { supabase, photoUrl, type SparkProfile } from '@/lib/supabase';
import { LUSAKA, saveLocation, syncLocation, type Coords } from '@/lib/location';
import { activeFilterCount, defaultFilters, passesFilters, photosOf, type DiscoverFilters } from '@/lib/discover-utils';
import { errorText, matchIdOf, vibrate, type MatchPopup } from '@/lib/ui';
import MatchModal from '@/components/MatchModal';
import { ActionBar } from '@/components/discover/ActionBar';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/discover/DiscoverStates';
import { ProfileCard, ProfileCardPreview, type CardEntry, type CardHandle, type SwipeAction } from '@/components/discover/ProfileCard';
import { ProfileDetail } from '@/components/discover/ProfileDetail';

const PAGE_SIZE = 20;

/** The Discovery tab: header, compact filter control, swipeable card stack, actions, and every empty/error state. */
export default function DiscoverPage({ profile, filters, onOpenFilters, onResetFilters, onVerifiedSeen }: {
  profile: SparkProfile;
  filters: DiscoverFilters;
  onOpenFilters: () => void;
  onResetFilters: () => void;
  onVerifiedSeen: (seen: boolean) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const navigate = useNavigate();
  const [pool, setPool] = useState<SparkProfile[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [swiping, setSwiping] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [entry, setEntry] = useState<CardEntry>('fresh');
  const [match, setMatch] = useState<MatchPopup | null>(null);
  const [detail, setDetail] = useState(false);
  const [burst, setBurst] = useState<{ id: number; kind: 'like' | 'spark' } | null>(null);
  const [wyr, setWyr] = useState<Record<string, unknown> | null>(null);
  const [answering, setAnswering] = useState(false);
  const [locError, setLocError] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const cardRef = useRef<CardHandle>(null);
  const swipingRef = useRef(false);
  const seen = useRef(0);
  const lastAction = useRef<SwipeAction>('pass');
  const fetchingMore = useRef(false);
  const burstId = useRef(0);

  const myInterests = profile.interests;
  const defaults = useMemo(() => defaultFilters(profile), [profile]);
  const filterCount = activeFilterCount(filters, defaults);

  // The server applies distance (and the saved age/gender preferences); the rest is narrowed here.
  const people = useMemo(() => pool.filter((person) => passesFilters(person, filters, myInterests)), [pool, filters, myInterests]);
  const hiddenByFilters = pool.length - people.length;
  const current: SparkProfile | undefined = people[index];
  const next: SparkProfile | undefined = people[index + 1];
  const hiddenRef = useRef(0);
  hiddenRef.current = hiddenByFilters;
  const maxKm = filters.maxKm;

  const load = useCallback(async () => {
    setLoading(true); setLoadError(''); setError(''); setCanUndo(false);
    const { data, error: queryError } = await supabase.rpc('discover', { p_limit: PAGE_SIZE, p_max_km: maxKm });
    if (queryError) { console.error('Discover failed:', queryError); setLoadError(queryError.message); }
    else { setPool(Array.isArray(data) ? data as SparkProfile[] : []); setIndex(0); setEntry('fresh'); }
    setLoading(false);
  }, [maxKm]);

  // Reload when the distance or any filter changes (small delay so dragging a slider does not spam the server).
  const filterKey = JSON.stringify(filters);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load, filterKey]);

  useEffect(() => { onVerifiedSeen(pool.some((person) => typeof person.verified === 'boolean')); }, [pool, onVerifiedSeen]);

  // Location is saved every time Discover opens. A failure only shows a banner; it never affects routing.
  const updateLocation = useCallback(async (coords?: Coords) => {
    setLocBusy(true); setLocError('');
    try {
      await (coords ? saveLocation(coords) : syncLocation());
      if (seen.current === 0) void load();
    } catch (err) {
      console.error('Location update failed:', err);
      setLocError(errorText(err));
    } finally { setLocBusy(false); }
  }, [load]);
  useEffect(() => { void updateLocation(); }, []);

  // A Would You Rather question every ten swipes.
  useEffect(() => {
    if (!current || seen.current === 0 || seen.current % 10 !== 0) return;
    let active = true;
    supabase.rpc('next_wyr', { p_limit: 10 }).then(({ data, error: wyrError }) => {
      if (!active) return;
      if (wyrError) { console.error('Could not load a Would You Rather question:', wyrError); setError(wyrError.message); return; }
      const question = Array.isArray(data) ? data[0] : data;
      if (question && typeof question === 'object') setWyr(question as Record<string, unknown>);
    });
    return () => { active = false; };
  }, [current, index]);

  // Warm the next profile's first photo so the card behind is ready.
  const nextPhoto = next ? photosOf(next)[0] : undefined;
  useEffect(() => { if (nextPhoto) { const image = new Image(); image.src = photoUrl(nextPhoto); } }, [nextPhoto]);

  const fetchMore = useCallback(async () => {
    if (fetchingMore.current) return;
    fetchingMore.current = true;
    try {
      // People hidden by client-side filters come back too, so ask for enough to see past them.
      const limit = Math.min(100, PAGE_SIZE + hiddenRef.current);
      const { data, error: moreError } = await supabase.rpc('discover', { p_limit: limit, p_max_km: maxKm });
      if (moreError) throw moreError;
      if (Array.isArray(data)) {
        setPool((old) => {
          const known = new Set(old.map((person) => person.id));
          const fresh = (data as SparkProfile[]).filter((person) => !known.has(person.id));
          return fresh.length ? [...old, ...fresh] : old;
        });
      }
    } catch (err) { console.error('Loading more profiles failed:', err); setError(errorText(err)); }
    finally { fetchingMore.current = false; }
  }, [maxKm]);

  const act = useCallback(async (action: SwipeAction): Promise<boolean> => {
    const person = current;
    if (!person || swipingRef.current) return false;
    swipingRef.current = true; setSwiping(true); setError('');
    vibrate(action === 'pass' ? 8 : [12, 30, 18]);
    try {
      const { data, error: swipeError } = await supabase.rpc('swipe', { p_target: person.id, p_action: action });
      if (swipeError) throw swipeError;
      const payload = Array.isArray(data) ? data[0] : data;
      if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).matched === true) {
        const record = payload as Record<string, unknown>;
        setMatch({ person, expires: typeof record.expires_at === 'string' ? record.expires_at : undefined, matchId: matchIdOf(record) });
      }
      lastAction.current = action;
      seen.current += 1;
      setCanUndo(true);
      setEntry('fresh');
      setIndex((old) => old + 1);
      if (action !== 'pass' && !reduced) setBurst({ id: ++burstId.current, kind: action === 'spark' ? 'spark' : 'like' });
      if (index >= people.length - 3) void fetchMore();
      return true;
    } catch (err) {
      console.error('Swipe failed:', err);
      setError(errorText(err));
      return false;
    } finally { swipingRef.current = false; setSwiping(false); }
  }, [current, fetchMore, index, people.length, reduced]);

  const trigger = useCallback((action: SwipeAction) => {
    if (cardRef.current) void cardRef.current.act(action);
  }, []);

  const undo = useCallback(async () => {
    if (swipingRef.current || !canUndo) return;
    swipingRef.current = true; setSwiping(true);
    try {
      const { error: undoError } = await supabase.rpc('rewind_last_swipe');
      if (undoError) throw undoError;
      seen.current = Math.max(0, seen.current - 1);
      setEntry(lastAction.current === 'pass' ? 'undo-left' : lastAction.current === 'like' ? 'undo-right' : 'undo-up');
      setIndex((old) => Math.max(0, old - 1));
      setCanUndo(false); vibrate(10);
    } catch (err) { console.error('Rewind failed:', err); setError(errorText(err)); }
    finally { swipingRef.current = false; setSwiping(false); }
  }, [canUndo]);

  const answer = async (choice: 'a' | 'b') => {
    if (!wyr) return;
    const questionId = wyr.id ?? wyr.question_id;
    setAnswering(true);
    const { error: answerError } = await supabase.rpc('answer_wyr', { p_question: questionId, p_choice: choice });
    setAnswering(false);
    if (answerError) { console.error('Answering failed:', answerError); setError(answerError.message); }
    else { setWyr(null); vibrate(); }
  };

  const openDetails = useCallback(() => setDetail(true), []);
  const detailAct = (action: SwipeAction) => { setDetail(false); window.setTimeout(() => trigger(action), 60); };
  const showState = !loading && !current;

  return (
    <section className="dc-page animate-in">
      <div className="dc-head">
        <h1 className="display text-[28px] font-extrabold leading-none tracking-tight">Discover</h1>
        <button type="button" onClick={onOpenFilters} className="dc-pill" aria-label={`Filters. Within ${filters.maxKm} kilometres${filterCount ? `, ${filterCount} active` : ''}`} data-testid="distance-pill">
          <MapPin size={14} className="text-rose-300" />
          Within {filters.maxKm} km
          {filterCount > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-extrabold text-[#23121a]">{filterCount}</span>}
          <ChevronDown size={14} />
        </button>
      </div>

      {locError && (
        <div role="alert" data-testid="banner-location" className="mb-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">
          <p>{locError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={locBusy} onClick={() => void updateLocation()} className="secondary-button px-3 py-2 text-xs">Try again</button>
            <button type="button" disabled={locBusy} onClick={() => void updateLocation(LUSAKA)} className="secondary-button px-3 py-2 text-xs">Use Lusaka ({LUSAKA.lat}, {LUSAKA.lng})</button>
            <button type="button" onClick={() => navigate('/settings')} className="secondary-button px-3 py-2 text-xs">Set a place</button>
          </div>
        </div>
      )}
      {error && !loadError && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="shrink-0 underline">Dismiss</button>
        </div>
      )}

      <div className="dc-stage" data-testid="stage">
        {loading ? <CardSkeleton /> : loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : current ? (
          <>
            {next && <div className="absolute inset-0 opacity-80" style={{ transform: 'translateY(10px) scale(.95)' }}><ProfileCardPreview person={next} /></div>}
            <ProfileCard
              key={current.id}
              ref={cardRef}
              person={current}
              myInterests={myInterests}
              disabled={swiping}
              reduced={reduced}
              entry={entry}
              onAct={act}
              onOpenDetails={openDetails}
            />
            <AnimatePresence>
              {burst && (
                <motion.div key={burst.id} className="dc-burst" aria-hidden="true" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 1, 0], scale: [0.4, 1.25, 1.1] }} transition={{ duration: 0.7, ease: 'easeOut' }} onAnimationComplete={() => setBurst((b) => (b && b.id === burst.id ? null : b))}>
                  {burst.kind === 'like'
                    ? <Heart size={96} fill="currentColor" className="text-rose-400 drop-shadow-[0_0_24px_rgba(251,70,104,.7)]" />
                    : <Zap size={96} fill="currentColor" className="text-amber-300 drop-shadow-[0_0_26px_rgba(251,191,36,.75)]" />}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : null}
        {showState && !loadError && <EmptyState hiddenByFilters={hiddenByFilters} onAdjust={onOpenFilters} onReset={onResetFilters} onRefresh={() => void load()} />}
      </div>

      {current && !loading && !loadError && (
        <>
          <ActionBar canUndo={canUndo} busy={swiping} onUndo={() => void undo()} onAct={trigger} />
          <p className="dc-hint mt-2.5 text-center text-[11px] text-slate-600">Swipe left to pass · right to like · up to spark</p>
        </>
      )}

      {wyr && (
        <div className="mt-4 rounded-2xl border border-amber-200/15 bg-amber-300/[.06] p-4" data-testid="wyr">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-200">While you’re here</p>
            <button type="button" onClick={() => setWyr(null)} className="text-xs text-slate-500 underline">Skip</button>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-100">{String(wyr.question || wyr.prompt || wyr.text || 'Would you rather…')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2"><button className="secondary-button text-xs" disabled={answering} onClick={() => void answer('a')}>{String(wyr.option_a || wyr.a || 'Option A')}</button><button className="secondary-button text-xs" disabled={answering} onClick={() => void answer('b')}>{String(wyr.option_b || wyr.b || 'Option B')}</button></div>
        </div>
      )}

      {detail && current && <ProfileDetail person={current} myInterests={myInterests} busy={swiping} onAct={detailAct} onClose={() => setDetail(false)} />}
      {match && <MatchModal match={match} onClose={() => setMatch(null)} />}
    </section>
  );
}
