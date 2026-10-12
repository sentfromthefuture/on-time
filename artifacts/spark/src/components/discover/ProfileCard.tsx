import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useAnimationControls, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { BadgeCheck, ChevronUp, Heart, MapPin, Sparkles, X, Zap } from 'lucide-react';
import { photoUrl, type SparkProfile } from '@/lib/supabase';
import { distanceText, isVerified, personAge, photosOf, sharedInterests } from '@/lib/discover-utils';

export type SwipeAction = 'pass' | 'like' | 'spark';
export type CardHandle = { act: (action: SwipeAction) => Promise<void> };
export type CardEntry = 'fresh' | 'undo-left' | 'undo-right' | 'undo-up';

type CardProps = {
  person: SparkProfile;
  myInterests: unknown;
  disabled: boolean;
  reduced: boolean;
  entry: CardEntry;
  /** Resolves true when the server accepted the action. The card flies out first and returns if it failed. */
  onAct: (action: SwipeAction) => Promise<boolean>;
  onOpenDetails: () => void;
};

const FLING_DISTANCE = 110;
const FLING_VELOCITY = 650;

export function CardFallback({ name }: { name: string }) {
  return (
    <div className="profile-fallback absolute inset-0 grid place-items-center" data-testid="photo-fallback">
      <span className="display text-8xl font-extrabold text-rose-100/20">{String(name || '?').slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

/** A quiet card shown behind the current one so the next profile is already on screen. */
export function ProfileCardPreview({ person }: { person: SparkProfile }) {
  const first = photosOf(person)[0];
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-[28px] border border-white/10 bg-[#21212a]" data-testid="next-card">
      {first ? <img src={photoUrl(first)} alt="" decoding="async" className="h-full w-full object-cover" /> : <div className="profile-fallback h-full w-full" />}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
}

export const ProfileCard = memo(forwardRef<CardHandle, CardProps>(function ProfileCard({ person, myInterests, disabled, reduced, entry, onAct, onOpenDetails }, ref) {
  const photos = photosOf(person);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const name = String(person.name || 'Someone');
  const age = personAge(person);
  const distance = distanceText(person.distance_km);
  const verified = isVerified(person);
  const bio = typeof person.bio === 'string' ? person.bio.trim() : '';
  const interests = Array.isArray(person.interests) ? person.interests.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
  const shared = sharedInterests(myInterests, interests);
  const sharedKeys = new Set(shared.map((item) => item.toLowerCase()));

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], reduced ? [0, 0, 0] : [-9, 0, 9]);
  const likeOpacity = useTransform(x, [30, 130], [0, 1]);
  const passOpacity = useTransform(x, [-130, -30], [1, 0]);
  const sparkOpacity = useTransform(y, [-130, -30], [1, 0]);
  const controls = useAnimationControls();
  const dragged = useRef(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const onActRef = useRef(onAct);
  onActRef.current = onAct;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const detailsRef = useRef(onOpenDetails);
  detailsRef.current = onOpenDetails;

  useEffect(() => {
    alive.current = true;
    if (!reduced) void controls.start({ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.26, ease: 'easeOut' } });
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm the next photo so tapping through is instant.
  const nextPhoto = photos[photoIndex + 1];
  useEffect(() => {
    if (!nextPhoto) return;
    const image = new Image();
    image.src = photoUrl(nextPhoto);
  }, [nextPhoto]);

  const run = useCallback(async (action: SwipeAction) => {
    if (busy.current || disabledRef.current) return;
    busy.current = true;
    if (!reduced) {
      const target = action === 'pass' ? { x: -window.innerWidth, opacity: 0.4 } : action === 'like' ? { x: window.innerWidth, opacity: 0.4 } : { y: -window.innerHeight, opacity: 0.4 };
      void controls.start({ ...target, transition: { duration: 0.24, ease: 'easeIn' } });
    }
    let accepted = false;
    try { accepted = await onActRef.current(action); } finally { busy.current = false; }
    if (!accepted && alive.current) void controls.start({ x: 0, y: 0, opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 320, damping: 26 } });
  }, [controls, reduced]);

  useImperativeHandle(ref, () => ({ act: run }), [run]);

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    // A drag must never also count as a tap on a photo zone.
    dragged.current = true;
    window.setTimeout(() => { dragged.current = false; }, 80);
    const { offset, velocity } = info;
    const horizontal = Math.abs(offset.x) >= Math.abs(offset.y);
    if (!horizontal && (offset.y < -FLING_DISTANCE || velocity.y < -FLING_VELOCITY)) void run('spark');
    else if (horizontal && (offset.x > FLING_DISTANCE || velocity.x > FLING_VELOCITY)) void run('like');
    else if (horizontal && (offset.x < -FLING_DISTANCE || velocity.x < -FLING_VELOCITY)) void run('pass');
    // otherwise dragSnapToOrigin eases the card back
  };

  const prevPhoto = () => { if (!dragged.current) setPhotoIndex((i) => Math.max(0, i - 1)); };
  const nextPhotoTap = () => { if (!dragged.current) setPhotoIndex((i) => Math.min(photos.length - 1, i + 1)); };
  const openDetails = () => { if (!dragged.current) detailsRef.current(); };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight' && photos.length > 1) { event.preventDefault(); setPhotoIndex((i) => Math.min(photos.length - 1, i + 1)); }
    else if (event.key === 'ArrowLeft' && photos.length > 1) { event.preventDefault(); setPhotoIndex((i) => Math.max(0, i - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); detailsRef.current(); }
  };

  const initial = reduced
    ? false
    : entry === 'fresh'
      ? { opacity: 0, scale: 0.96, y: 12 }
      : { opacity: 0, x: entry === 'undo-left' ? -140 : entry === 'undo-right' ? 140 : 0, y: entry === 'undo-up' ? -140 : 0 };

  const currentPhoto = photos[photoIndex];
  const showPhoto = currentPhoto && !failed.has(currentPhoto);
  const topOffset = photos.length > 1 ? 'top-8' : 'top-3.5';
  const visibleInterests = interests.slice(0, 4);
  const hiddenInterests = interests.length - visibleInterests.length;

  return (
    <motion.article
      aria-label={`Profile of ${name}${age ? `, ${age}` : ''}`}
      tabIndex={0}
      initial={initial}
      animate={controls}
      style={{ x, y, rotate, touchAction: 'none' }}
      drag={!disabled}
      dragSnapToOrigin
      dragElastic={0.85}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      data-testid="profile-card"
      className="dc-card relative isolate h-full w-full select-none overflow-hidden rounded-[28px] border border-white/10 bg-[#21212a] shadow-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
    >
      {showPhoto
        ? <img key={currentPhoto} src={photoUrl(currentPhoto)} alt={`${name}'s photo ${photoIndex + 1} of ${photos.length}`} draggable={false} decoding="async" loading="eager" fetchPriority="high" onError={() => setFailed((old) => new Set(old).add(currentPhoto))} className="absolute inset-0 -z-10 h-full w-full object-cover" />
        : <CardFallback name={name} />}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[64%] bg-gradient-to-t from-[#0c0c11] via-[#0c0c11]/70 to-transparent" />

      {photos.length > 1 && (
        <>
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex gap-1.5" aria-hidden="true" data-testid="photo-indicators">
            {photos.map((photo, i) => <span key={photo} data-active={i === photoIndex} className={`h-1 flex-1 rounded-full ${i === photoIndex ? 'bg-white' : i < photoIndex ? 'bg-white/60' : 'bg-white/30'}`} />)}
          </div>
          <span className="sr-only" aria-live="polite">Photo {photoIndex + 1} of {photos.length}</span>
        </>
      )}

      <div className={`pointer-events-none absolute left-3 z-10 flex flex-wrap gap-2 ${topOffset}`}>
        {person.liked_you === true && <span className="rounded-full border border-rose-200/30 bg-[#21171d]/80 px-3 py-1.5 text-xs font-bold text-rose-100"><Heart className="mr-1 inline" size={13} fill="currentColor" /> They liked you</span>}
        {typeof person.vibe_score === 'number' && <span className="rounded-full bg-slate-950/65 px-3 py-1.5 text-xs font-semibold text-amber-100"><Sparkles className="mr-1 inline" size={13} /> {Math.round(person.vibe_score)} vibe</span>}
      </div>

      {photos.length > 1 ? (
        <>
          <button type="button" aria-label="Previous photo" onClick={prevPhoto} className="absolute left-0 top-0 z-10 h-[56%] w-[30%] outline-none focus-visible:bg-white/10" />
          <button type="button" aria-label={`View ${name}'s full profile`} onClick={openDetails} className="absolute left-[30%] top-0 z-10 h-[56%] w-[40%] outline-none focus-visible:bg-white/10" />
          <button type="button" aria-label="Next photo" onClick={nextPhotoTap} className="absolute right-0 top-0 z-10 h-[56%] w-[30%] outline-none focus-visible:bg-white/10" />
        </>
      ) : (
        <button type="button" aria-label={`View ${name}'s full profile`} onClick={openDetails} className="absolute inset-x-0 top-0 z-10 h-[56%] outline-none focus-visible:bg-white/10" />
      )}

      <motion.div aria-hidden="true" style={{ opacity: likeOpacity }} className="pointer-events-none absolute right-5 top-14 z-20 -rotate-12 rounded-xl border-2 border-rose-300 px-3 py-1.5 text-lg font-extrabold uppercase tracking-wider text-rose-300"><Heart className="mr-1 inline" size={18} fill="currentColor" />Like</motion.div>
      <motion.div aria-hidden="true" style={{ opacity: passOpacity }} className="pointer-events-none absolute left-5 top-14 z-20 rotate-12 rounded-xl border-2 border-slate-300 px-3 py-1.5 text-lg font-extrabold uppercase tracking-wider text-slate-200"><X className="mr-1 inline" size={18} />Pass</motion.div>
      <motion.div aria-hidden="true" style={{ opacity: sparkOpacity }} className="pointer-events-none absolute left-1/2 top-1/3 z-20 -translate-x-1/2 rounded-xl border-2 border-amber-300 px-3 py-1.5 text-lg font-extrabold uppercase tracking-wider text-amber-200"><Zap className="mr-1 inline" size={18} fill="currentColor" />Spark</motion.div>

      <div className="absolute inset-x-0 bottom-0 z-10 p-5 pt-10" onClick={openDetails}>
        {shared.length > 0 && (
          <p data-testid="shared-pill" className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200/25 bg-amber-300/15 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
            <Zap size={11} fill="currentColor" />
            {shared.length >= 3 ? `Great interest match · ${shared.length} shared` : `${shared.length} shared ${shared.length === 1 ? 'interest' : 'interests'}`}
          </p>
        )}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="display flex items-center gap-2 text-[30px] font-extrabold leading-[1.05] tracking-tight">
              <span className="truncate">{name}</span>
              {age !== undefined && <span className="shrink-0 font-medium text-white/85">{age}</span>}
              {verified && <BadgeCheck data-testid="verified-badge" aria-label="Verified profile" role="img" size={21} className="shrink-0 text-sky-300" />}
            </h2>
            {distance && <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-white/75"><MapPin size={12} />{distance}</p>}
          </div>
          <button type="button" aria-label={`View ${name}'s full profile`} onClick={(event) => { event.stopPropagation(); openDetails(); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-sm"><ChevronUp size={18} /></button>
        </div>
        {bio && <p className="dc-bio mt-3 line-clamp-2 text-[14px] leading-[1.45] text-white/85">{bio}</p>}
        {visibleInterests.length > 0 && (
          <ul className="dc-chips mt-3 flex flex-wrap gap-1.5" aria-label="Interests">
            {visibleInterests.map((interest) => (
              <li key={interest} data-shared={sharedKeys.has(interest.toLowerCase())} className={`max-w-[10rem] truncate rounded-full border px-2.5 py-1 text-[11px] ${sharedKeys.has(interest.toLowerCase()) ? 'border-rose-300/50 bg-rose-400/20 text-rose-50' : 'border-white/15 bg-black/25 text-white/90'}`}>{interest}</li>
            ))}
            {hiddenInterests > 0 && <li className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/70">+{hiddenInterests}</li>}
          </ul>
        )}
      </div>
    </motion.article>
  );
}));
