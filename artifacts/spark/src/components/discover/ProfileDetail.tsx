import { useRef, useState } from 'react';
import { BadgeCheck, Heart, MapPin, Zap } from 'lucide-react';
import { SparkSheet } from '@/components/ui/SparkSheet';
import { ActionBar } from '@/components/discover/ActionBar';
import type { SwipeAction } from '@/components/discover/ProfileCard';
import { contextLine, distanceText, isVerified, personAge, personDisplayName, photosOf, promptsOf, sharedInterests } from '@/lib/discover-utils';
import { photoUrl, type SparkProfile } from '@/lib/supabase';

/** Full profile in a sheet: every photo, the whole bio, and everything else the profile actually has. */
export function ProfileDetail({ person, myInterests, busy, onAct, onClose }: {
  person: SparkProfile;
  myInterests: unknown;
  busy: boolean;
  onAct: (action: SwipeAction) => void;
  onClose: () => void;
}) {
  const name = personDisplayName(person);
  const age = personAge(person);
  const distance = distanceText(person.distance_km);
  const photos = photosOf(person);
  const bio = typeof person.bio === 'string' ? person.bio.trim() : '';
  const vibe = typeof person.vibe === 'string' ? person.vibe.trim() : '';
  const gender = typeof person.gender === 'string' ? person.gender : '';
  const interests = Array.isArray(person.interests) ? person.interests.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
  const shared = sharedInterests(myInterests, interests);
  const sharedKeys = new Set(shared.map((item) => item.toLowerCase()));
  const context = contextLine(shared);
  const prompts = promptsOf(person);
  const [slide, setSlide] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <SparkSheet
      title={name}
      size="full"
      onClose={onClose}
      footer={<ActionBar canUndo={false} busy={busy} onUndo={() => undefined} onAct={onAct} compact hideUndo />}
    >
      <div data-testid="profile-detail">
        {photos.length > 0 && (
          <div className="-mx-5">
            <div
              ref={scroller}
              role="group"
              aria-label={`${name}'s photos`}
              onScroll={(event) => { const el = event.currentTarget; setSlide(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
              className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
            >
              {photos.map((photo, index) => (
                <div key={photo} className="relative aspect-[4/5] w-full shrink-0 snap-center bg-[#21212a]">
                  {failed.has(photo)
                    ? <div className="profile-fallback grid h-full w-full place-items-center"><span className="display text-8xl font-extrabold text-rose-100/20">{name.slice(0, 1).toUpperCase()}</span></div>
                    : <img src={photoUrl(photo)} alt={`${name}'s photo ${index + 1} of ${photos.length}`} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed((old) => new Set(old).add(photo))} className="h-full w-full object-cover" />}
                </div>
              ))}
            </div>
            {photos.length > 1 && (
              <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true" data-testid="detail-dots">
                {photos.map((photo, index) => <span key={photo} className={`h-1.5 rounded-full transition-all ${index === slide ? 'w-5 bg-rose-300' : 'w-1.5 bg-white/25'}`} />)}
              </div>
            )}
          </div>
        )}

        <div className="mt-5">
          <h3 className="display flex items-center gap-2 text-3xl font-extrabold leading-tight">
            <span>{name}</span>
            {age !== undefined && <span className="font-medium text-white/85">{age}</span>}
            {isVerified(person) && <BadgeCheck role="img" aria-label="Verified profile" size={24} className="text-sky-300" />}
          </h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
            {distance && <span className="inline-flex items-center gap-1"><MapPin size={13} />{distance}</span>}
            {gender && <span className="capitalize">{gender}</span>}
            {person.liked_you === true && <span className="inline-flex items-center gap-1 text-rose-200"><Heart size={13} fill="currentColor" />They liked you</span>}
          </p>
        </div>

        {context && (
          <section className="mt-5 rounded-2xl border border-amber-200/20 bg-amber-300/[.07] p-4" data-testid="why-connect">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-amber-200"><Zap size={13} fill="currentColor" />{shared.length >= 3 ? 'Great interest match' : 'Something in common'}</p>
            <p className="mt-2 text-sm leading-relaxed text-amber-50/90">{context}</p>
          </section>
        )}

        {bio && <section className="mt-6"><h4 className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">About</h4><p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-200">{bio}</p></section>}
        {vibe && <section className="mt-6"><h4 className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">Vibe</h4><p className="mt-2 text-[15px] text-slate-200">{vibe}</p></section>}

        {interests.length > 0 && (
          <section className="mt-6">
            <h4 className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">Interests</h4>
            <ul className="mt-3 flex flex-wrap gap-2">
              {interests.map((interest) => (
                <li key={interest} data-shared={sharedKeys.has(interest.toLowerCase())} className={`rounded-full border px-3 py-1.5 text-xs ${sharedKeys.has(interest.toLowerCase()) ? 'border-rose-300/50 bg-rose-400/20 text-rose-50' : 'border-white/12 bg-white/[.04] text-slate-200'}`}>{interest}</li>
              ))}
            </ul>
          </section>
        )}

        {prompts.length > 0 && (
          <section className="mt-6 space-y-3" data-testid="prompts">
            {prompts.map((prompt) => (
              <div key={prompt.question} className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
                <p className="text-xs font-semibold text-rose-200">{prompt.question}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-slate-100">{prompt.answer}</p>
              </div>
            ))}
          </section>
        )}
      </div>
    </SparkSheet>
  );
}
