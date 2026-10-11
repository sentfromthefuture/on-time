import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Session, User } from '@supabase/supabase-js';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, BadgeCheck, ChevronDown, Compass, Flame, Heart, ImagePlus,
  LoaderCircle, LogOut, MapPin, MessageCircle, Navigation, RotateCcw,
  Settings2, ShieldCheck, Sparkles, Star, Trash2, UserRound, X, Zap,
} from 'lucide-react';
import { APP_NAME } from '@/config';
import { photoUrl, supabase, type SparkProfile } from '@/lib/supabase';
import { compressPhoto, storagePathFromPublicUrl } from '@/lib/photos';
import { LUSAKA, saveLocation, syncLocation, type Coords } from '@/lib/location';
import { SparksBadge, SparksProvider, useSparks } from '@/components/sparks/SparksProvider';
import { EffectsHost } from '@/components/sparks/Effects';
import SparksPage from '@/components/sparks/SparksPage';
import ChatPage from '@/components/sparks/ChatPage';

const genderOptions = ['man', 'woman', 'nonbinary', 'other'];
const interestOptions = ['Live music', 'Long walks', 'Cooking', 'Art', 'Books', 'Outdoors', 'Film', 'Coffee', 'Travel', 'Design', 'Dance', 'Museums'];
const errorText = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' && (error as { message: string }).message) {
    return (error as { message: string }).message;
  }
  return 'Something went wrong. Please try again.';
};
type MatchPopup = { person?: SparkProfile; expires?: string; matchId?: string };
const matchIdOf = (record: Record<string, unknown>) => (typeof record.match_id === 'string' ? record.match_id : typeof record.id === 'string' ? record.id : undefined);
// Always hand Supabase a real array, never a JSON string such as "[]".
const asArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* not JSON, fall through */ }
  }
  return [];
};
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
const ageFromDate = (value?: string) => {
  if (!value) return undefined;
  const born = new Date(`${value}T00:00:00`);
  const now = new Date();
  return now.getFullYear() - born.getFullYear() - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
};
const vibrate = (pattern: number | number[] = 14) => {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
};

type ProfileDraft = {
  name: string;
  birthdate: string;
  gender: string;
  interestedIn: string[];
  bio: string;
  photos: string[];
  interests: string[];
  vibe: string;
  minAge: number;
  maxAge: number;
  prompts: unknown[];
};
const blankDraft: ProfileDraft = {
  name: '', birthdate: '', gender: '', interestedIn: [], bio: '', photos: [], interests: [],
  vibe: '', minAge: 22, maxAge: 36, prompts: [],
};

function draftFromProfile(profile?: SparkProfile | null): ProfileDraft {
  if (!profile) return blankDraft;
  return {
    ...blankDraft,
    name: String(profile.name || ''),
    birthdate: String(profile.birthdate || ''),
    gender: String(profile.gender || ''),
    interestedIn: Array.isArray(profile.interested_in)
      ? profile.interested_in.map(String)
      : profile.interested_in ? [String(profile.interested_in)] : [],
    bio: String(profile.bio || ''),
    photos: Array.isArray(profile.photos) ? profile.photos.map(String) : [],
    interests: Array.isArray(profile.interests) ? profile.interests.map(String) : [],
    vibe: String(profile.vibe || ''),
    minAge: Number(profile.min_age || 22),
    maxAge: Number(profile.max_age || 36),
    prompts: asArray(profile.prompts),
  };
}

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
      const { error: saveError } = await supabase.rpc('upsert_my_profile', {
        p_name: draft.name.trim(),
        p_birthdate: draft.birthdate,
        p_gender: draft.gender,
        p_interested_in: draft.interestedIn,
        p_bio: draft.bio.slice(0, 500),
        p_photos: draft.photos,
        p_interests: draft.interests,
        p_vibe: draft.vibe || null,
        p_min_age: draft.minAge,
        p_max_age: draft.maxAge,
        p_prompts: asArray(draft.prompts),
      });
      if (saveError) throw saveError;
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
  const [radius, setRadius] = useState(Number(profile.max_km || 50));
  // A chat is full screen: no header or tab bar.
  if (/^\/sparks\/[^/]+/.test(location.pathname)) {
    return <Routes><Route path="/sparks/:matchId" element={<ChatPage />} /></Routes>;
  }
  return (
    <div className="spark-shell min-h-[100dvh] pb-[calc(78px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-white/[.045] bg-[#14141b]/85 px-5 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2.5"><div className="brand-mark brand-mark-small"><Sparkles size={16} /></div><span className="display text-xl font-extrabold tracking-tight">{APP_NAME}</span></div>
          <p className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Your next hello is out there</p>
          {activeTab === 'discover' && <button onClick={() => navigate('/settings')} type="button" aria-label="Open discovery settings" className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white"><Settings2 size={18} /></button>}
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 pb-7 pt-5">
        <Routes>
          <Route path="/" element={<Discover radius={radius} setRadius={setRadius} />} />
          <Route path="/likes" element={<Likes />} />
          <Route path="/sparks" element={<SparksPage />} />
          <Route path="/profile/edit" element={<ProfileEditor initial={profile} onSaved={reloadProfile} mode="edit" />} />
          <Route path="/profile" element={<ProfilePage user={user} profile={profile} streakCount={streakCount} streakError={streakError} setProfile={setProfile} />} />
          <Route path="/settings" element={<SettingsPage profile={profile} radius={radius} setRadius={setRadius} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <nav aria-label="Main navigation" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-white/[.07] bg-[#17171f]/95 px-3 pt-2 backdrop-blur-xl">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {navItems.map(({ key, label, icon: Icon, path }) => <NavLink to={path} key={key} end={key === 'discover'} data-testid={`nav-${key}`} className={({ isActive }) => `relative flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition ${isActive ? 'text-rose-300' : 'text-slate-500 hover:text-slate-300'}`}><Icon size={20} strokeWidth={activeTab === key ? 2.35 : 1.8} /><span>{label}</span>{key === 'sparks' && <SparksBadge />}{activeTab === key && <span className="absolute -top-[9px] h-0.5 w-7 rounded-full bg-rose-300" />}</NavLink>)}
        </div>
      </nav>
    </div>
  );
}

function Discover({ radius, setRadius }: { radius: number; setRadius: (radius: number) => void }) {
  const [people, setPeople] = useState<SparkProfile[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [swiping, setSwiping] = useState(false);
  const [match, setMatch] = useState<MatchPopup | null>(null);
  const [wyr, setWyr] = useState<Record<string, unknown> | null>(null);
  const [answering, setAnswering] = useState(false);
  const [locError, setLocError] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const seen = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const current = people[index];
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: queryError } = await supabase.rpc('discover', { p_limit: 20, p_max_km: radius });
    if (queryError) { console.error('Discover failed:', queryError); setError(queryError.message); }
    else { setPeople(Array.isArray(data) ? data as SparkProfile[] : []); setIndex(0); }
    setLoading(false);
  }, [radius]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 240); return () => window.clearTimeout(timer); }, [load]);
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
  useEffect(() => { void updateLocation();
  }, []);
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
  const act = async (action: 'pass' | 'like' | 'spark', person = current) => {
    if (!person || swiping) return;
    setSwiping(true); vibrate(action === 'pass' ? 8 : [12, 30, 18]);
    try {
      const { data, error: swipeError } = await supabase.rpc('swipe', { p_target: person.id, p_action: action });
      if (swipeError) throw swipeError;
      const payload = Array.isArray(data) ? data[0] : data;
      if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).matched === true) {
        const record = payload as Record<string, unknown>;
        setMatch({ person, expires: typeof record.expires_at === 'string' ? record.expires_at : undefined, matchId: matchIdOf(record) });
      }
      setCanUndo(true);
      seen.current += 1;
      setIndex((old) => old + 1);
      if (index >= people.length - 2) {
        const { data: more, error: moreError } = await supabase.rpc('discover', { p_limit: 20, p_max_km: radius });
        if (moreError) throw moreError;
        if (Array.isArray(more) && more.length > 0) { setPeople((old) => [...old, ...(more as SparkProfile[])]); }
      }
    } catch (err) { console.error('Swipe failed:', err); setError(errorText(err)); }
    finally { setSwiping(false); }
  };
  const undo = async () => {
    try {
      const { error: undoError } = await supabase.rpc('rewind_last_swipe');
      if (undoError) throw undoError;
      setIndex((old) => Math.max(0, old - 1)); setCanUndo(false); vibrate(10);
    } catch (err) { console.error('Rewind failed:', err); setError(errorText(err)); }
  };
  const answer = async (choice: 'a' | 'b') => {
    if (!wyr) return;
    const questionId = wyr.id ?? wyr.question_id;
    setAnswering(true);
    const { error: answerError } = await supabase.rpc('answer_wyr', { p_question: questionId, p_choice: choice });
    setAnswering(false);
    if (answerError) { console.error('Answering failed:', answerError); setError(answerError.message); }
    else { setWyr(null); vibrate(); }
  };
  const swipePointer = (event: PointerEvent<HTMLElement>) => {
    const origin = drag.current;
    drag.current = null;
    if (!origin || !current) return;
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
    if (Math.abs(dx) < 65 && Math.abs(dy) < 70) return;
    if (Math.abs(dy) > Math.abs(dx) && dy < -65) void act('spark');
    else if (dx > 65) void act('like');
    else if (dx < -65) void act('pass');
  };
  return (
    <section className="animate-in">
      <div className="mb-4 flex items-end justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-rose-300">A fresh face</p><h1 className="display mt-1 text-3xl font-extrabold">Discover</h1></div>
        <button onClick={() => navigate('/settings')} type="button" className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-300"><MapPin size={14} /> Up to {radius} km <ChevronDown size={13} /></button>
      </div>
      <label className="mb-4 flex items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.025] px-4 py-3 text-xs text-slate-400">Distance <input aria-label="Maximum distance in kilometers" type="range" min={5} max={200} step={5} value={radius} onChange={(event) => setRadius(Number(event.target.value))} className="flex-1" /><span className="min-w-12 text-right text-slate-300">{radius} km</span></label>
      {locError && <div role="alert" data-testid="banner-location" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200"><p>{locError}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={locBusy} onClick={() => void updateLocation()} className="secondary-button px-3 py-2 text-xs">Try again</button><button type="button" disabled={locBusy} onClick={() => void updateLocation(LUSAKA)} className="secondary-button px-3 py-2 text-xs">Use Lusaka ({LUSAKA.lat}, {LUSAKA.lng})</button></div></div>}
      {error && <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200"><span>{error}</span><button onClick={() => void load()} className="underline">Retry</button></div>}
      {loading ? <div className="panel flex min-h-[440px] flex-col items-center justify-center"><div className="skeleton-card mb-5 h-16 w-16 rounded-full" /><div className="skeleton-line w-36" /><div className="skeleton-line mt-2 w-24" /><p className="mt-5 text-sm text-slate-500">Finding your kind of people…</p></div> :
        current ? <div className="mx-auto max-w-[440px]">
          <motion.article initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, ease: 'easeOut' }} whileTap={{ scale: 0.995 }} onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={swipePointer} onPointerCancel={() => { drag.current = null; }} className="profile-card relative isolate flex min-h-[480px] select-none touch-none flex-col justify-end overflow-hidden rounded-[28px] border border-white/10 bg-[#21212a] shadow-2xl sm:min-h-[550px]" aria-label={`Profile of ${current.name}`}>
             {current.photos?.[0] ? <img src={photoUrl(current.photos[0])} alt={`${current.name}'s profile`} loading="lazy" draggable={false} className="absolute inset-0 -z-10 h-full w-full object-cover" /> : <div className="profile-fallback absolute inset-0 -z-10 grid place-items-center"><span className="display text-8xl font-extrabold text-rose-100/20">{String(current.name || '?').slice(0, 1).toUpperCase()}</span></div>}
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#121218] via-[#15151a]/20 to-black/5" />
             <div className="absolute left-4 top-4 flex gap-2">{current.liked_you && <span className="rounded-full border border-rose-200/30 bg-[#21171d]/80 px-3 py-1.5 text-xs font-bold text-rose-100"><Heart className="mr-1 inline" size={13} fill="currentColor" /> They liked you</span>}{typeof current.vibe_score === 'number' && <span className="rounded-full bg-slate-950/65 px-3 py-1.5 text-xs font-semibold text-amber-100"><Sparkles className="mr-1 inline" size={13} /> {Math.round(current.vibe_score)} vibe</span>}</div>
            <div className="p-5 sm:p-6">
              <div className="mb-3 flex items-end justify-between"><h2 className="display text-3xl font-extrabold">{current.name}{current.age ? <span className="ml-2 font-medium text-white/85">{current.age}</span> : ageFromDate(String(current.birthdate || '')) ? <span className="ml-2 font-medium text-white/85">{ageFromDate(String(current.birthdate))}</span> : null}</h2>{typeof current.distance_km === 'number' && <span className="mb-1 flex items-center gap-1 text-xs text-white/70"><MapPin size={12} />{current.distance_km.toFixed(1)} km away</span>}</div>
              {current.bio && <p className="line-clamp-3 text-sm leading-6 text-white/85">{current.bio}</p>}
              {current.interests?.length ? <div className="mt-3 flex flex-wrap gap-2">{current.interests.slice(0, 5).map((interest) => <span key={interest} className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-[11px] text-white/90">{interest}</span>)}</div> : null}
              {current.photos && current.photos.length > 1 && <div className="mt-4 flex gap-1.5" aria-label={`${current.photos.length} photos`}>{current.photos.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/30'}`} />)}</div>}
            </div>
          </motion.article>
          <div className="mt-4 flex items-center justify-center gap-3">
             <button type="button" onClick={() => void undo()} disabled={!canUndo} aria-label="Undo last swipe" className="action-orbit action-muted"><RotateCcw size={18} /></button>
            <button type="button" onClick={() => void act('pass')} aria-label="Pass" disabled={swiping} className="action-orbit action-pass"><X size={25} /></button>
            <button type="button" onClick={() => void act('spark')} aria-label="Send a spark" disabled={swiping} className="action-orbit action-spark"><Zap size={22} fill="currentColor" /></button>
            <button type="button" onClick={() => void act('like')} aria-label="Like" disabled={swiping} className="action-orbit action-like"><Heart size={24} fill="currentColor" /></button>
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-600">Swipe left to pass · right to like · up to spark</p>
          {wyr && <div className="mt-5 rounded-2xl border border-amber-200/15 bg-amber-300/[.06] p-4"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-200">While you’re here</p><p className="mt-2 text-sm font-semibold text-slate-100">{String(wyr.question || wyr.prompt || wyr.text || 'Would you rather…')}</p><div className="mt-3 grid grid-cols-2 gap-2"><button className="secondary-button text-xs" disabled={answering} onClick={() => void answer('a')}>{String(wyr.option_a || wyr.a || 'Option A')}</button><button className="secondary-button text-xs" disabled={answering} onClick={() => void answer('b')}>{String(wyr.option_b || wyr.b || 'Option B')}</button></div></div>}
        </div> :
          <div className="panel mx-auto flex min-h-[390px] max-w-[440px] flex-col items-center justify-center px-7 text-center">
            <div className="empty-orbit mb-6"><Compass size={27} /></div><h2 className="display text-2xl font-bold">That’s everyone for now.</h2><p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">Try widening your distance, or check back when more people are around.</p>
            <label className="mt-7 w-full max-w-xs text-left text-xs font-semibold text-slate-400">Search radius <span className="float-right text-rose-200">{radius} km</span><input type="range" min={5} max={200} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-3 w-full" /></label>
            <button onClick={() => void load()} className="primary-button mt-5 px-7">Look again</button>
            <button onClick={() => navigate('/settings')} className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"><Navigation size={13} /> Set a travel location</button>
          </div>}
      <div className="mt-7 rounded-2xl border border-white/[.06] bg-white/[.025] px-4 py-3 text-center"><p className="text-xs text-slate-400"><span className="mr-1.5 text-rose-300">01</span>Real people. Thoughtful introductions. Your pace.</p></div>
      {match && <MatchModal match={match} onClose={() => setMatch(null)} />}
    </section>
  );
}

function MatchModal({ match, onClose }: { match: MatchPopup; onClose: () => void }) {
  const [remaining, setRemaining] = useState('');
  const [opening, setOpening] = useState(false);
  const navigate = useNavigate();
  const { matches, clockOffset, refresh } = useSparks();
  const findRow = (rows: typeof matches) => rows.find((item) => (match.matchId ? item.match_id === match.matchId : item.user_id === match.person?.id));
  const row = findRow(matches);
  const expires = row?.expires_at ?? match.expires;
  // Pull the brand-new match (and the server clock) into the Sparks list.
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const update = () => {
      if (!expires) { setRemaining('24 hours'); return; }
      const ms = Math.max(0, Date.parse(expires) - (Date.now() + clockOffset));
      setRemaining(`${Math.floor(ms / 3_600_000)}h ${Math.floor(ms % 3_600_000 / 60_000)}m`);
    };
    update(); const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [expires, clockOffset]);
  const openChat = async () => {
    setOpening(true);
    let id = row?.match_id;
    if (!id) id = findRow(await refresh())?.match_id;
    onClose();
    navigate(id ? `/sparks/${id}` : '/sparks');
  };
  return <div role="dialog" aria-modal="true" aria-labelledby="match-title" className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[#0e0e14]/90 p-5 backdrop-blur-md">
    <div className="confetti" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * .16}s`, background: i % 3 === 0 ? '#f39aab' : i % 3 === 1 ? '#f3c575' : '#b1d3ca' }} />)}</div>
    <div className="relative z-10 w-full max-w-sm animate-in text-center">
      <div className="mx-auto mb-7 flex justify-center -space-x-5">{[match.person?.photos?.[0], null].map((image, index) => <div key={index} className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-[#18171f] bg-[#30222b]">{image ? <img src={photoUrl(image)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Sparkles className="text-rose-200" size={28} />}</div>)}</div>
      <p className="text-xs font-bold uppercase tracking-[.24em] text-rose-300">Good feeling, confirmed</p><h2 id="match-title" className="display mt-3 text-4xl font-extrabold">Your spark starts now</h2><p className="mt-3 text-sm text-slate-400">{match.person?.name ? `You and ${match.person.name} liked each other.` : 'A new connection is waiting.'}</p>
      <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full border border-amber-200/15 bg-amber-200/[.06] px-4 py-2 text-xs text-amber-100"><Zap size={13} /> This spark is live for {remaining}</div>
      <button disabled={opening} data-testid="match-open-chat" className="primary-button mt-7 flex w-full items-center justify-center gap-2" onClick={() => void openChat()}>{opening ? 'Opening…' : 'Open chat'} <ArrowRight size={17} /></button>
      <button onClick={onClose} className="mt-4 text-sm text-slate-500 hover:text-slate-300">Keep discovering</button>
    </div>
  </div>;
}

function Likes() {
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

export default App;
