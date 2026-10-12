import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Session, User } from '@supabase/supabase-js';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, BadgeCheck, ChevronDown, Compass, Flame, Heart, ImagePlus,
  LoaderCircle, LogOut, MapPin, MessageCircle, Navigation, RotateCcw,
  Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Star, Trash2, UserRound, X, Zap,
} from 'lucide-react';
import { APP_NAME } from '@/config';
import { photoUrl, supabase, type SparkProfile } from '@/lib/supabase';
import { compressPhoto, storagePathFromPublicUrl } from '@/lib/photos';
import { syncLocation } from '@/lib/location';
import { errorText, matchIdOf, vibrate, type MatchPopup } from '@/lib/ui';
import { ageFromDate, draftFromProfile, genderOptions, upsertProfile, type ProfileDraft } from '@/lib/profile';
import { activeFilterCount, clampFilters, defaultFilters, initialFilters, saveStoredFilters, type DiscoverFilters } from '@/lib/discover-utils';
import DiscoverPage from '@/components/discover/DiscoverPage';
import { FilterSheet } from '@/components/discover/FilterSheet';
import MatchModal from '@/components/MatchModal';
import { SparksBadge, SparksProvider, useSparks } from '@/components/sparks/SparksProvider';
import { EffectsHost } from '@/components/sparks/Effects';
import SparksPage from '@/components/sparks/SparksPage';
import ChatPage from '@/components/sparks/ChatPage';

const interestOptions = ['Live music', 'Long walks', 'Cooking', 'Art', 'Books', 'Outdoors', 'Film', 'Coffee', 'Travel', 'Design', 'Dance', 'Museums'];
// Drops any stored onboarding flag or cached profile so a stale "no profile" can never be reused.
const clearOnboardingCache = () => {
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      Object.keys(store)
        .filter((key) => !key.startsWith('sb-') && /onboard|profile[-_:.]?cache|cached[-_:.]?profile|has[-_:.]?profile|spark[-_:.]?profile/i.test(key))
        .forEach((key) => store.removeItem(key));
    } catch (error) { console.error('Could not clear cached onboarding data:', error); }
  }
};
function App() {
  const [streakCount, setStreakCount] = useState<number | null>(null);
  const [streakError, setStreakError] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<SparkProfile | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [startupError, setStartupError] = useState('');
  // null = still checking, true/false = known. Only a successful query ever sets false.
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [profileError, setProfileError] = useState('');
  const checkedUser = useRef('');
  const streakUser = useRef('');

  // Loads the full profile for display. It never decides routing and throws real error messages.
  const loadProfile = useCallback(async (user: User) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
      console.error('Could not load profile:', error);
      throw new Error(error.message);
    }
    if (!data) throw new Error('Your profile was saved but could not be read back. Please try again.');
    setProfile(data as SparkProfile);
  }, []);

  const refreshProfile = useCallback(async (user: User) => {
    try {
      await loadProfile(user);
      setProfileError('');
    } catch (error) {
      setProfileError(errorText(error));
    }
  }, [loadProfile]);

  // The single source of truth for "does this user have a profile row?"
  const checkProfile = useCallback(async (session: Session) => {
    setProfileError('');
    setHasProfile(null);
    const { data, error } = await supabase.from('profiles').select('id').eq('id', session.user.id).maybeSingle();
    if (error) {
      console.error('Profile check failed:', error);
      setProfileError(error.message);
      return;
    }
    setHasProfile(!!data);
    if (data) await refreshProfile(session.user);
  }, [refreshProfile]);

  useEffect(() => {
    let alive = true;
    const handle = (next: Session | null) => {
      setSession(next);
      if (next?.user) {
        if (checkedUser.current === next.user.id) return;
        checkedUser.current = next.user.id;
        // Deferred so we never run Supabase calls inside the auth callback itself.
        window.setTimeout(() => { if (alive) void checkProfile(next); }, 0);
      } else {
        checkedUser.current = '';
        streakUser.current = '';
        setProfile(null);
        setHasProfile(null);
        setProfileError('');
        setStreakCount(null);
        setStreakError('');
      }
    };
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) { console.error('Could not read the saved session:', error); setStartupError(error.message); }
      setSessionLoading(false);
      handle(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => handle(next));
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [checkProfile]);

  // Streak only runs once we know the user has a profile.
  useEffect(() => {
    const user = session?.user;
    if (!user || hasProfile !== true || streakUser.current === user.id) return;
    streakUser.current = user.id;
    void supabase.rpc('touch_streak').then(({ data, error }) => {
      if (error) { console.error('Could not update streak:', error); setStreakError(error.message); return; }
      const streak = Array.isArray(data) ? data[0] : data;
      const value = typeof streak === 'number'
        ? streak
        : streak && typeof streak === 'object'
          ? Number((streak as Record<string, unknown>).streak ?? (streak as Record<string, unknown>).current_streak)
          : Number.NaN;
      if (Number.isFinite(value)) { setStreakCount(value); setStreakError(''); }
    });
  }, [session?.user, hasProfile]);

  useEffect(() => { document.title = APP_NAME; }, []);

  // Called right after upsert_my_profile succeeds during onboarding.
  const finishOnboarding = useCallback(() => {
    clearOnboardingCache();
    setHasProfile(true);
    setProfileError('');
    if (session?.user) void refreshProfile(session.user);
    // Location is best effort here and never affects routing; Discover retries and shows a banner.
    void syncLocation().catch((error) => console.error('Location update after saving profile failed:', error));
  }, [session?.user, refreshProfile]);

  const retry = () => {
    if (!session) return;
    if (hasProfile === true) { setProfileError(''); void refreshProfile(session.user); }
    else void checkProfile(session);
  };

  return (
    <HashRouter>
      <Routes>
        <Route path="/auth" element={sessionLoading ? <LoadingScreen label="Opening Spark" /> : session ? <Navigate to="/" replace /> : <AuthScreen initialError={startupError} />} />
        <Route path="/onboarding" element={
          sessionLoading ? <LoadingScreen label="Opening Spark" /> :
            !session ? <Navigate to="/auth" replace /> :
              profileError ? <LoadError message={profileError} retry={retry} /> :
                hasProfile === null ? <LoadingScreen label="Checking your profile" /> :
                  hasProfile ? <Navigate to="/" replace /> :
                    <ProfileEditor initial={null} onSaved={finishOnboarding} mode="onboarding" />
        } />
        <Route path="/*" element={
          sessionLoading ? <LoadingScreen label="Opening Spark" /> :
            !session ? <Navigate to="/auth" replace /> :
              profileError ? <LoadError message={profileError} retry={retry} /> :
                hasProfile === false ? <Navigate to="/onboarding" replace /> :
                  hasProfile && profile ?
                    <AppShell user={session.user} profile={profile} streakCount={streakCount} streakError={streakError} setProfile={setProfile} reloadProfile={() => loadProfile(session.user)} /> :
                    <LoadingScreen label="Opening Spark" />
        } />
      </Routes>
    </HashRouter>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="spark-shell grid min-h-[100dvh] place-items-center px-6"><div className="text-center"><div className="brand-mark mx-auto mb-5"><Sparkles size={22} /></div><LoaderCircle className="mx-auto animate-spin text-rose-300" size={21} /><p className="mt-3 text-sm text-slate-400">{label}</p></div></main>;
}

function AuthScreen({ initialError = '' }: { initialError?: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(initialError);
  const go = useNavigate();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (password.length < 8) { setError('Your password needs at least 8 characters.'); return; }
    setPending(true);
    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (authError) throw authError;
        if (!data.session) {
          setError("Turn OFF 'Confirm email' in Supabase (Authentication > Providers > Email).");
          return;
        }
        go('/onboarding');
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        go('/');
      }
    } catch (err) { console.error('Authentication failed:', err); setError(errorText(err)); }
    finally { setPending(false); }
  };
  return (
    <main className="spark-shell min-h-[100dvh] flex flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-[430px] animate-in">
        <div className="mb-10 text-center">
          <div className="brand-mark mx-auto mb-5"><Sparkles size={23} strokeWidth={2.2} /></div>
          <p className="text-xs font-bold uppercase tracking-[.24em] text-rose-300">A little more real</p>
          <h1 className="display mt-2 text-5xl font-extrabold">Spark</h1>
          <p className="mx-auto mt-3 max-w-[290px] text-sm leading-6 text-slate-400">Meet people who feel like a yes.</p>
        </div>
        <section className="panel p-5 sm:p-7">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-950/50 p-1" role="tablist" aria-label="Account access">
            {(['signup', 'signin'] as const).map((item) => <button type="button" key={item} role="tab" aria-selected={mode === item} className={`rounded-lg px-3 py-2.5 text-sm font-semibold capitalize transition ${mode === item ? 'bg-slate-700/70 text-white' : 'text-slate-400'}`} onClick={() => { setMode(item); setError(''); setMessage(''); }}>{item === 'signup' ? 'Create account' : 'Sign in'}</button>)}
          </div>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-slate-300">Email address
              <input data-testid="input-email" className="field mt-2" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <label className="block text-sm font-medium text-slate-300">Password
              <input data-testid="input-password" className="field mt-2" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </label>
            {error && <p role="alert" data-testid="status-auth-error" className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-3 text-sm leading-5 text-rose-200">{error}</p>}
            {message && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
            <button data-testid="button-auth-submit" className="primary-button flex w-full items-center justify-center gap-2" disabled={pending}>{pending && <LoaderCircle className="animate-spin" size={17} />}{mode === 'signup' ? 'Join Spark' : 'Sign in'} <ArrowRight size={17} /></button>
          </form>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-slate-500"><ShieldCheck size={14} /> Your profile is yours to control.</p>
        </section>
        <p className="mt-7 text-center text-xs text-slate-600">Free to join. Built for meaningful connection.</p>
      </div>
    </main>
  );
}

function ProfileEditor({ initial, onSaved, mode, loadError = '' }: { initial: SparkProfile | null; onSaved: () => void | Promise<void>; mode: 'onboarding' | 'edit'; loadError?: string }) {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(initial));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(loadError);
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { setDraft(draftFromProfile(initial)); }, [initial]);
  const set = <K extends keyof ProfileDraft,>(key: K, value: ProfileDraft[K]) => setDraft((old) => ({ ...old, [key]: value }));
  const addPhoto = async (file?: File) => {
    if (!file || draft.photos.length >= 3) return;
    setUploading(true); setError('');
    try {
      const blob = await compressPhoto(file);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in again before adding a photo.');
      const path = `${user.id}/${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/webp', upsert: false });
      if (uploadError) throw uploadError;
      setDraft((old) => ({ ...old, photos: [...old.photos, path] }));
      vibrate();
    } catch (err) { console.error('Adding photo failed:', err); setError(errorText(err)); }
    finally { setUploading(false); }
  };
  const removePhoto = async (url: string) => {
    const path = storagePathFromPublicUrl(url) ?? url;
    const { error: removeError } = await supabase.storage.from('photos').remove([path]);
    if (removeError) { console.error('Removing photo failed:', removeError); setError(removeError.message); return; }
    setDraft((old) => ({ ...old, photos: old.photos.filter((photo) => photo !== url) }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    if (ageFromDate(draft.birthdate) === undefined || ageFromDate(draft.birthdate)! < 18) {
      setError('You need to be 18 or older to use Spark.'); return;
    }
    if (!draft.gender || draft.interestedIn.length === 0) { setError('Choose your gender and who you would like to meet.'); return; }
    if (draft.minAge < 18 || draft.maxAge < draft.minAge) { setError('Choose an age range starting at 18 or older.'); return; }
    setPending(true);
    try {
      await upsertProfile(draft);
      if (mode === 'onboarding') {
        // Mark the profile as existing right away (no reload, no cached "no profile"), then go to Discover.
        void onSaved();
        navigate('/', { replace: true });
      } else {
        await onSaved();
        setNotice('Your profile is saved.');
      }
    } catch (err) { console.error('Saving profile failed:', err); setError(errorText(err)); }
    finally { setPending(false); }
  };
  const toggleInterest = (interest: string) => setDraft((old) => ({ ...old, interests: old.interests.includes(interest) ? old.interests.filter((item) => item !== interest) : [...old.interests, interest] }));
  return (
    <main className="spark-shell min-h-[100dvh] px-4 pb-10 pt-7">
      <div className="mx-auto max-w-xl animate-in">
        <div className="mb-7 flex items-center justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[.22em] text-rose-300">{mode === 'onboarding' ? 'Your first impression' : 'Profile settings'}</p><h1 className="display mt-1 text-3xl font-extrabold">{mode === 'onboarding' ? 'Make it you.' : 'Your profile'}</h1></div>
          {mode === 'edit' && <button type="button" className="secondary-button p-3" aria-label="Back to Discover" onClick={() => navigate('/')}><ArrowLeft size={18} /></button>}
        </div>
        <form onSubmit={save} className="space-y-5">
          <section className="panel p-5">
            <div className="mb-4"><h2 className="display text-lg font-bold">The essentials</h2><p className="mt-1 text-sm text-slate-400">A few details help the right people find you.</p></div>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-300">Name<input className="field mt-2" required maxLength={60} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="What should we call you?" /></label>
              <label className="block text-sm font-medium text-slate-300">Date of birth<input className="field mt-2" type="date" required max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().slice(0, 10)} value={draft.birthdate} onChange={(e) => set('birthdate', e.target.value)} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-slate-300">I am<select className="field mt-2 capitalize" value={draft.gender} onChange={(e) => set('gender', e.target.value)} required><option value="">Choose</option>{genderOptions.map((option) => <option className="capitalize" key={option} value={option}>{option}</option>)}</select></label>
              </div>
               <fieldset><legend className="text-sm font-medium text-slate-300">Interested in <span className="font-normal text-slate-500">Choose all that fit</span></legend><div className="mt-2 flex flex-wrap gap-2">{genderOptions.map((option) => <button type="button" key={option} aria-pressed={draft.interestedIn.includes(option)} onClick={() => set('interestedIn', draft.interestedIn.includes(option) ? draft.interestedIn.filter((item) => item !== option) : [...draft.interestedIn, option])} className={`rounded-full border px-3 py-2 text-xs capitalize transition ${draft.interestedIn.includes(option) ? 'border-rose-300/70 bg-rose-300/15 text-rose-100' : 'border-slate-700 bg-slate-950/30 text-slate-400'}`}>{option}</button>)}</div></fieldset>
            </div>
          </section>
          <section className="panel p-5">
            <div className="mb-4 flex items-end justify-between"><div><h2 className="display text-lg font-bold">Photos</h2><p className="mt-1 text-sm text-slate-400">Add up to three. Lead with a good one.</p></div><span className="text-xs text-slate-500">{draft.photos.length}/3</span></div>
            <div className="grid grid-cols-3 gap-3">
               {draft.photos.map((photo, index) => <div key={photo} className="relative aspect-[.78] overflow-hidden rounded-2xl bg-slate-900"><img src={photoUrl(photo)} loading="lazy" alt={`Your profile photo ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => void removePhoto(photo)} aria-label={`Remove photo ${index + 1}`} className="absolute right-2 top-2 rounded-full bg-slate-950/80 p-2 text-white"><X size={15} /></button></div>)}
              {draft.photos.length < 3 && <label className="flex aspect-[.78] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 text-center text-xs text-slate-400 transition hover:border-rose-300/60 hover:text-rose-200"><ImagePlus size={22} />{uploading ? 'Preparing…' : 'Add photo'}<input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(e) => { void addPhoto(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>}
            </div>
          </section>
          <section className="panel p-5">
            <div className="mb-4 flex items-end justify-between"><div><h2 className="display text-lg font-bold">A little about you</h2><p className="mt-1 text-sm text-slate-400">Make it easy to start a conversation.</p></div><span className="text-xs text-slate-500">{draft.bio.length}/500</span></div>
            <textarea className="field min-h-28 resize-y" maxLength={500} value={draft.bio} onChange={(e) => set('bio', e.target.value)} placeholder="Your kind of Sunday, what makes you laugh…" />
            <div className="mt-5"><p className="mb-3 text-sm font-medium text-slate-300">Pick the things you’re into</p><div className="flex flex-wrap gap-2">{interestOptions.map((interest) => <button type="button" key={interest} aria-pressed={draft.interests.includes(interest)} onClick={() => toggleInterest(interest)} className={`rounded-full border px-3 py-2 text-xs transition ${draft.interests.includes(interest) ? 'border-rose-300/70 bg-rose-300/15 text-rose-100' : 'border-slate-700 bg-slate-950/30 text-slate-400'}`}>{interest}</button>)}</div></div>
          </section>
          <section className="panel p-5">
            <h2 className="display text-lg font-bold">Your discovery range</h2>
            <p className="mt-1 text-sm text-slate-400">Show me people aged {draft.minAge}–{draft.maxAge}</p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <label className="text-xs text-slate-400">Minimum age<input type="number" className="field mt-2" min={18} max={99} value={draft.minAge} onChange={(e) => set('minAge', Number(e.target.value))} /></label>
              <label className="text-xs text-slate-400">Maximum age<input type="number" className="field mt-2" min={18} max={99} value={draft.maxAge} onChange={(e) => set('maxAge', Number(e.target.value))} /></label>
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-300">Your vibe <span className="font-normal text-slate-500">(optional)</span><input className="field mt-2" value={draft.vibe} onChange={(e) => set('vibe', e.target.value)} placeholder="A word or phrase that feels like you" /></label>
          </section>
          {(error || loadError) && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error || loadError}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p>}
          <button className="primary-button flex w-full items-center justify-center gap-2" disabled={pending || uploading}>{pending && <LoaderCircle size={17} className="animate-spin" />}{mode === 'onboarding' ? 'Finish my profile' : 'Save changes'} <ArrowRight size={17} /></button>
        </form>
      </div>
    </main>
  );
}

type TabKey = 'discover' | 'likes' | 'sparks' | 'profile';
type ShellProps = { user: User; profile: SparkProfile; streakCount: number | null; streakError: string; setProfile: (profile: SparkProfile | null) => void; reloadProfile: () => void | Promise<void> };

function AppShell(props: ShellProps) {
  return (
    <SparksProvider userId={props.user.id} myPhoto={props.profile.photos?.[0]}>
      <ShellBody {...props} />
      <EffectsHost />
    </SparksProvider>
  );
}

function ShellBody({ user, profile, streakCount, streakError, setProfile, reloadProfile }: ShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab: TabKey = location.pathname.startsWith('/likes') ? 'likes' : location.pathname.startsWith('/sparks') ? 'sparks' : location.pathname.startsWith('/profile') ? 'profile' : 'discover';
  const navItems: { key: TabKey; label: string; icon: typeof Compass; path: string }[] = [
    { key: 'discover', label: 'Discover', icon: Compass, path: '/' },
    { key: 'likes', label: 'Likes', icon: Heart, path: '/likes' },
    { key: 'sparks', label: 'Sparks', icon: Zap, path: '/sparks' },
    { key: 'profile', label: 'Profile', icon: UserRound, path: '/profile' },
  ];
  const [filters, setFilters] = useState<DiscoverFilters>(() => initialFilters(profile, user.id));
  const [navOpen, setNavOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [verifiedSeen, setVerifiedSeen] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [filterNotice, setFilterNotice] = useState('');
  const defaults = defaultFilters(profile);
  const filterCount = activeFilterCount(filters, defaults);

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  // Age range and who-to-show live on the profile, so keep the filters in step when the profile changes.
  const interestedKey = JSON.stringify(profile.interested_in ?? null);
  useEffect(() => {
    const base = defaultFilters(profile);
    setFilters((old) => clampFilters({ ...old, minAge: base.minAge, maxAge: base.maxAge, genders: base.genders }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.min_age, profile.max_age, interestedKey]);

  // Real count of people who liked you, for the Likes tab badge.
  useEffect(() => {
    let alive = true;
    const count = async () => {
      const { data, error } = await supabase.rpc('who_liked_me');
      if (!alive) return;
      if (error) { console.error('Could not count likes:', error); return; }
      setLikesCount(Array.isArray(data) ? data.length : 0);
    };
    void count();
    const onVisible = () => { if (document.visibilityState === 'visible') void count(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [user.id]);

  useEffect(() => {
    if (!filterNotice) return;
    const timer = window.setTimeout(() => setFilterNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [filterNotice]);

  const applyFilters = async (next: DiscoverFilters) => {
    // Age range and who you want to see are saved on your profile so discovery itself honours them.
    const profileChanged = next.minAge !== filters.minAge || next.maxAge !== filters.maxAge || [...next.genders].sort().join('|') !== [...filters.genders].sort().join('|');
    if (profileChanged) {
      await upsertProfile({ ...draftFromProfile(profile), minAge: next.minAge, maxAge: next.maxAge, interestedIn: next.genders });
      try { await reloadProfile(); } catch (error) { console.error('Could not refresh your profile after saving filters:', error); }
    }
    saveStoredFilters(user.id, next);
    setFilters(next);
    const count = activeFilterCount(next, defaults);
    setFilterNotice(count > 0 ? `Filters applied · ${count} active` : 'Filters cleared');
  };
  const resetFilters = () => { void applyFilters({ ...defaults, maxKm: 50 }).catch((error) => console.error('Resetting filters failed:', error)); };
  const setRadius = (km: number) => setFilters((old) => { const next = clampFilters({ ...old, maxKm: km }); saveStoredFilters(user.id, next); return next; });
  // A chat is full screen: no header or tab bar.
  if (/^\/sparks\/[^/]+/.test(location.pathname)) {
    return <Routes><Route path="/sparks/:matchId" element={<ChatPage />} /></Routes>;
  }
  return (
    <div className="spark-shell min-h-[100dvh] pb-[calc(78px+env(safe-area-inset-bottom))]">
      <header className={`sticky top-0 z-20 border-b border-white/[.045] bg-[#14141b]/85 px-5 py-3 backdrop-blur-xl ${activeTab === 'discover' ? 'dc-shell-header' : ''}`}>
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2.5"><div className="brand-mark brand-mark-small"><Sparkles size={16} /></div><span className="display text-xl font-extrabold tracking-tight">{APP_NAME}</span></div>
          <p className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Your next hello is out there</p>
          {activeTab === 'discover' && <button onClick={() => setFilterOpen(true)} type="button" aria-label={`Open filters${filterCount ? `, ${filterCount} active` : ''}`} data-testid="open-filters" className="relative inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/[.04] px-3.5 text-xs font-semibold text-slate-200 hover:bg-white/[.07]"><SlidersHorizontal size={15} />Filters{filterCount > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-extrabold text-[#23121a]">{filterCount}</span>}</button>}
        </div>
      </header>
      <div className={`mx-auto max-w-2xl px-4 ${activeTab === 'discover' ? 'overflow-x-clip pb-2 pt-3' : 'pb-7 pt-5'}`}>
        <Routes>
          <Route path="/" element={<DiscoverPage profile={profile} filters={filters} onOpenFilters={() => setFilterOpen(true)} onResetFilters={resetFilters} onVerifiedSeen={setVerifiedSeen} />} />
          <Route path="/likes" element={<Likes onCountChange={setLikesCount} />} />
          <Route path="/sparks" element={<SparksPage />} />
          <Route path="/profile/edit" element={<ProfileEditor initial={profile} onSaved={reloadProfile} mode="edit" />} />
          <Route path="/profile" element={<ProfilePage user={user} profile={profile} streakCount={streakCount} streakError={streakError} setProfile={setProfile} />} />
          <Route path="/settings" element={<SettingsPage profile={profile} radius={filters.maxKm} setRadius={setRadius} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <div className="dc-compass-dock" data-testid="compass-dock">
        <motion.button
          type="button"
          className="dc-compass-trigger"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="spark-discovery-nav"
          onClick={() => setNavOpen((open) => !open)}
          whileTap={{ scale: 0.92 }}
          data-testid="compass-toggle"
        >
          <motion.span animate={{ rotate: navOpen ? 45 : 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
            <Compass size={21} strokeWidth={2.2} />
          </motion.span>
        </motion.button>
        <AnimatePresence initial={false}>
          {navOpen && (
            <motion.nav
              id="spark-discovery-nav"
              aria-label="Main navigation"
              className="dc-compass-links"
              initial={{ opacity: 0, x: -10, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onKeyDown={(event) => { if (event.key === 'Escape') setNavOpen(false); }}
              data-testid="compass-links"
            >
              {navItems.map(({ key, label, icon: Icon, path }) => (
                <NavLink
                  to={path}
                  key={key}
                  end={key === 'discover'}
                  data-testid={`nav-${key}`}
                  title={label}
                  aria-label={label}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive }) => `dc-compass-link ${isActive ? 'is-active' : ''}`}
                >
                  {key === 'profile' && profile.photos?.[0]
                    ? <span className={`grid h-[19px] w-[19px] overflow-hidden rounded-full ring-2 ${activeTab === 'profile' ? 'ring-rose-300' : 'ring-slate-600'}`}><img src={photoUrl(profile.photos[0])} alt="" className="h-full w-full object-cover" /></span>
                    : <Icon size={18} strokeWidth={activeTab === key ? 2.35 : 1.8} />}
                  <span className="dc-compass-label">{label}</span>
                  {key === 'sparks' && <SparksBadge />}
                  {key === 'likes' && likesCount > 0 && <span aria-label={`${likesCount} new likes`} data-testid="likes-badge" className="dc-compass-badge">{likesCount > 9 ? '9+' : likesCount}</span>}
                </NavLink>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
      {filterOpen && <FilterSheet filters={filters} defaults={defaults} hasInterests={Array.isArray(profile.interests) && profile.interests.length > 0} verifiedAvailable={verifiedSeen} onApply={applyFilters} onClose={() => setFilterOpen(false)} onOpenTravel={() => { setFilterOpen(false); navigate('/settings'); }} />}
      {filterNotice && <div role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-40 flex justify-center"><span className="animate-in rounded-full border border-rose-200/25 bg-[#23171d]/95 px-4 py-2 text-xs font-semibold text-rose-100 shadow-xl">{filterNotice}</span></div>}
    </div>
  );
}

function Likes({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [likes, setLikes] = useState<SparkProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchPopup | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: queryError } = await supabase.rpc('who_liked_me');
    if (queryError) { console.error('Could not load likes:', queryError); setError(queryError.message); }
    else setLikes(Array.isArray(data) ? data as SparkProfile[] : []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!loading) onCountChange?.(likes.length); }, [likes, loading, onCountChange]);
  const likeBack = async (person: SparkProfile) => {
    setActing(person.id);
    const { data, error: swipeError } = await supabase.rpc('swipe', { p_target: person.id, p_action: 'like' });
    if (swipeError) { console.error('Like back failed:', swipeError); setError(swipeError.message); }
    else {
      setLikes((old) => old.filter((item) => item.id !== person.id)); vibrate([10, 25, 12]);
      const payload = Array.isArray(data) ? data[0] : data;
      if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).matched === true) {
        const result = payload as Record<string, unknown>;
        setMatch({ person, expires: typeof result.expires_at === 'string' ? result.expires_at : undefined, matchId: matchIdOf(result) });
      }
    }
    setActing(null);
  };
  return <section className="animate-in">
    <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[.2em] text-rose-300">The feeling is mutual?</p><h1 className="display mt-1 text-3xl font-extrabold">Likes</h1><p className="mt-2 text-sm text-slate-400">People who have already shown interest in you.</p></div>
    {error && <InlineError error={error} retry={() => void load()} />}
    {loading ? <div className="grid grid-cols-2 gap-3">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton-card aspect-[.76] rounded-2xl" />)}</div> :
      likes.length === 0 ? <div className="panel flex min-h-[360px] flex-col items-center justify-center px-7 text-center"><div className="empty-orbit mb-5"><Heart size={25} /></div><h2 className="display text-xl font-bold">A little room for a first hello.</h2><p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">When someone likes you, you’ll find them here. In the meantime, keep being you.</p></div> :
        <div className="grid grid-cols-2 gap-3 sm:gap-4">{likes.map((person) => <article key={person.id} className="relative aspect-[.76] overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
          {person.photos?.[0] ? <img loading="lazy" src={photoUrl(person.photos[0])} alt={`${person.name}'s profile`} className="absolute inset-0 h-full w-full object-cover" /> : <div className="profile-fallback absolute inset-0 grid place-items-center"><span className="display text-6xl text-rose-100/20">{String(person.name || '?').slice(0, 1).toUpperCase()}</span></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-[#101016] via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-3"><h2 className="display text-lg font-bold">{person.name}{person.age ? `, ${person.age}` : ''}</h2><button disabled={acting === person.id} onClick={() => void likeBack(person)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-300 px-3 py-2.5 text-xs font-bold text-[#29151b]"><Heart size={14} fill="currentColor" /> Like back</button></div>
        </article>)}</div>}
    {likes.length > 0 && !loading && <button onClick={() => void load()} className="secondary-button mt-5 w-full">Refresh likes</button>}
    {match && <MatchModal match={match} onClose={() => setMatch(null)} />}
  </section>;
}

function ProfilePage({ user, profile, streakCount, streakError, setProfile }: { user: User; profile: SparkProfile; streakCount: number | null; streakError: string; setProfile: (profile: SparkProfile | null) => void }) {
  const [badges, setBadges] = useState<Record<string, unknown>[]>([]);
  const [badgesError, setBadgesError] = useState('');
  const [mood, setMood] = useState(String(profile.mood || ''));
  const [discoverable, setDiscoverable] = useState(profile.discoverable !== false);
  const [showDistance, setShowDistance] = useState(profile.show_distance !== false);
  const [settingsError, setSettingsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    supabase.from('badges').select('*').then(({ data, error }) => {
      if (error) { console.error('Could not load badges:', error); setBadgesError(error.message); return; }
      setBadges((data || []) as Record<string, unknown>[]);
    });
  }, []);
  const saveSettings = async (next: { mood?: string; discoverable?: boolean; showDistance?: boolean }) => {
    const values = { mood: next.mood ?? mood, discoverable: next.discoverable ?? discoverable, showDistance: next.showDistance ?? showDistance };
    setSaving(true); setSettingsError('');
    const { error } = await supabase.rpc('update_settings', { p_mood: values.mood || null, p_discoverable: values.discoverable, p_show_distance: values.showDistance });
    if (error) { console.error('Saving settings failed:', error); setSettingsError(error.message); }
    else { setMood(values.mood); setDiscoverable(values.discoverable); setShowDistance(values.showDistance); setProfile({ ...profile, mood: values.mood, discoverable: values.discoverable, show_distance: values.showDistance }); }
    setSaving(false);
  };
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) { console.error('Sign out failed:', error); setSettingsError(error.message); }
  };
  const deleteAccount = async () => {
    setDeleting(true);
    const { error } = await supabase.rpc('delete_my_account');
    if (error) { console.error('Deleting account failed:', error); setSettingsError(error.message); setDeleting(false); return; }
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) { console.error('Sign out after delete failed:', signOutError); setSettingsError(signOutError.message); setDeleting(false); }
  };
  return <section className="animate-in space-y-5">
    <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-rose-300">Your corner</p><h1 className="display mt-1 text-3xl font-extrabold">Profile</h1></div><button type="button" onClick={() => void signOut()} className="secondary-button flex items-center gap-2 px-3 py-2.5 text-xs"><LogOut size={15} /> Sign out</button></div>
    <section className="panel overflow-hidden">
      <div className="relative h-44 bg-gradient-to-br from-[#38212e] via-[#28202e] to-[#20232c]">
         {profile.photos?.[0] && <img src={photoUrl(profile.photos[0])} alt="" loading="lazy" className="h-full w-full object-cover opacity-80" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#17171f] to-transparent" />
         <div className="absolute bottom-4 left-5 flex items-end gap-3"><div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border-2 border-[#17171f] bg-rose-300/20 text-2xl font-bold text-rose-100">{profile.photos?.[0] ? null : profile.name.slice(0, 1).toUpperCase()}{profile.photos?.[0] && <img src={photoUrl(profile.photos[0])} alt="" className="h-full w-full object-cover" />}</div><div><h2 className="display text-2xl font-extrabold">{profile.name}{profile.age ? `, ${profile.age}` : ageFromDate(profile.birthdate) ? `, ${ageFromDate(profile.birthdate)}` : ''}</h2><p className="text-xs text-white/70">{user.email}</p></div></div>
      </div>
      <div className="p-5"><p className="text-sm leading-6 text-slate-300">{profile.bio || 'Your story begins with a few words.'}</p>{profile.interests?.length ? <div className="mt-3 flex flex-wrap gap-2">{profile.interests.map((interest) => <span key={interest} className="rounded-full bg-white/[.06] px-3 py-1.5 text-xs text-slate-300">{interest}</span>)}</div> : null}
        <button className="secondary-button mt-5 flex w-full items-center justify-center gap-2" onClick={() => navigate('/profile/edit')}><Settings2 size={16} /> Edit profile</button>
      </div>
    </section>
     <section className="panel flex items-center gap-3 p-4"><div className="grid h-11 w-11 place-items-center rounded-full bg-amber-300/10 text-amber-200"><Flame size={21} /></div><div><p className="text-xs font-bold uppercase tracking-[.16em] text-amber-200">Your streak</p><p className="mt-1 text-sm text-slate-300">{streakCount === null ? 'Keep showing up on Spark.' : `${streakCount} ${streakCount === 1 ? 'day' : 'days'} in a row`}</p>{streakError && <p role="alert" className="mt-1 text-xs text-rose-200">{streakError}</p>}</div></section>
     <section className="panel p-5">
      <div className="mb-4"><h2 className="display text-lg font-bold">Your presence</h2><p className="mt-1 text-sm text-slate-400">Set the tone for how you show up.</p></div>
      <label className="block text-sm font-medium text-slate-300">Current mood<select className="field mt-2" value={mood} disabled={saving} onChange={(e) => void saveSettings({ mood: e.target.value })}><option value="">Choose a mood</option>{['Open to anything', 'Looking for a spark', 'Taking it slow', 'Here for the conversations'].map((option) => <option key={option}>{option}</option>)}</select></label>
      <div className="mt-4 divide-y divide-white/[.06]">
        <SettingToggle title="Discoverable" detail="Let people find your profile" value={discoverable} onChange={(value) => void saveSettings({ discoverable: value })} />
        <SettingToggle title="Show my distance" detail="Share approximate distance" value={showDistance} onChange={(value) => void saveSettings({ showDistance: value })} />
      </div>
      {settingsError && <p role="alert" className="mt-3 text-sm text-rose-200">{settingsError}</p>}
      {saving && <p className="mt-3 text-xs text-slate-500">Saving your settings…</p>}
    </section>
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="display text-lg font-bold">Badges</h2><p className="mt-1 text-sm text-slate-400">Little markers of your Spark journey.</p></div><BadgeCheck size={21} className="text-amber-200" /></div>
      {badges.length ? <div className="flex flex-wrap gap-2">{badges.map((badge, i) => <span key={String(badge.id ?? i)} className="flex items-center gap-2 rounded-full border border-amber-200/15 bg-amber-200/[.05] px-3 py-2 text-xs text-amber-100"><Star size={13} />{String(badge.name ?? badge.title ?? badge.badge ?? 'Spark badge')}</span>)}</div> : <p className="text-sm text-slate-500">Your badges will show up here as you use Spark.</p>}
      {badgesError && <p role="alert" className="mt-3 text-sm text-rose-200">{badgesError}</p>}
    </section>
    <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300/15 py-3 text-sm text-rose-200/80 transition hover:bg-rose-300/5" onClick={() => setDeleteOpen(true)}><Trash2 size={15} /> Delete account</button>
    {deleteOpen && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5"><div className="panel w-full max-w-sm p-5"><h2 className="display text-xl font-bold">Delete your account?</h2><p className="mt-2 text-sm leading-6 text-slate-400">This permanently removes your Spark account and profile. This cannot be undone.</p><div className="mt-5 flex gap-3"><button className="secondary-button flex-1" onClick={() => setDeleteOpen(false)}>Keep account</button><button className="flex-1 rounded-xl bg-rose-400 px-3 py-3 text-sm font-bold text-[#26141a]" onClick={() => void deleteAccount()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete account'}</button></div></div></div>}
  </section>;
}

function SettingToggle({ title, detail, value, onChange }: { title: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between py-3"><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><button type="button" role="switch" aria-checked={value} aria-label={title} onClick={() => onChange(!value)} className={`relative h-7 w-12 rounded-full transition ${value ? 'bg-rose-300' : 'bg-slate-700'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>;
}

function SettingsPage({ profile, radius, setRadius }: { profile: SparkProfile; radius: number; setRadius: (radius: number) => void }) {
  const [lat, setLat] = useState(String(profile.travel_lat || ''));
  const [lng, setLng] = useState(String(profile.travel_lng || ''));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const applyTravel = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError(''); setMessage('');
    const latitude = Number(lat), longitude = Number(lng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter valid latitude and longitude coordinates.'); setPending(false); return;
    }
    const { error: locationError } = await supabase.rpc('update_my_location', { p_lat: latitude, p_lng: longitude });
    if (locationError) { console.error('Travel location update failed:', locationError); setError(locationError.message); } else setMessage('Travel location updated.');
    setPending(false);
  };
  return <section className="animate-in">
    <div className="mb-6 flex items-center gap-3"><button className="rounded-full p-2 text-slate-400 hover:bg-white/5" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={19} /></button><div><p className="text-xs font-bold uppercase tracking-[.2em] text-rose-300">Tune your feed</p><h1 className="display mt-1 text-2xl font-extrabold">Discover settings</h1></div></div>
    <div className="space-y-4">
      <section className="panel p-5"><h2 className="display text-lg font-bold">Distance</h2><p className="mt-1 text-sm text-slate-400">Show people within <strong className="text-rose-200">{radius} km</strong></p><input type="range" min={5} max={200} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-5 w-full" /><div className="mt-1 flex justify-between text-[10px] text-slate-600"><span>5 km</span><span>200 km</span></div></section>
      <form onSubmit={applyTravel} className="panel p-5"><div className="mb-4 flex items-center gap-2"><Navigation size={17} className="text-rose-300" /><h2 className="display text-lg font-bold">Travel mode</h2></div><p className="mb-4 text-sm leading-6 text-slate-400">Set a manual location to explore somewhere new.</p><div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">Latitude<input className="field mt-2" value={lat} onChange={(e) => setLat(e.target.value)} type="number" step="any" min="-90" max="90" placeholder="37.7749" /></label><label className="text-xs text-slate-400">Longitude<input className="field mt-2" value={lng} onChange={(e) => setLng(e.target.value)} type="number" step="any" min="-180" max="180" placeholder="-122.4194" /></label></div>{error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-200">{message}</p>}<button className="primary-button mt-4 flex w-full items-center justify-center gap-2" disabled={pending}>{pending && <LoaderCircle size={16} className="animate-spin" />} Save travel location</button></form>
    </div>
  </section>;
}

function InlineError({ error, retry }: { error: string; retry: () => void }) {
  return <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200"><span>{error}</span><button type="button" onClick={retry} className="ml-3 underline">Retry</button></div>;
}
function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <main className="spark-shell grid min-h-[100dvh] place-items-center px-5"><div className="panel max-w-sm p-6 text-center"><p className="text-sm text-rose-200">{message}</p><button onClick={retry} className="primary-button mt-5">Try again</button></div></main>;
}

export { AppShell };
export default App;
