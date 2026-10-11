import { useEffect, useRef } from 'react';
import { Flame, Zap } from 'lucide-react';
import { SparkAvatar } from '@/components/sparks/SparkAvatar';
import { useSparks } from '@/components/sparks/SparksProvider';
import { buzz } from '@/lib/spark-utils';

// Fixed particle layouts so every playback looks the same and nothing random runs during render.
const ASH = Array.from({ length: 32 }, (_, i) => ({
  x: ((i * 47) % 150) - 55,
  y: -(50 + ((i * 29) % 140)),
  delay: (i % 11) * 0.085,
  size: 2 + (i % 4),
}));
const BURST = Array.from({ length: 22 }, (_, i) => {
  const angle = (i * 137.5 * Math.PI) / 180;
  const distance = 55 + ((i * 41) % 70);
  return { x: Math.round(Math.cos(angle) * distance), y: Math.round(Math.sin(angle) * distance), delay: (i % 7) * 0.05, size: 3 + (i % 3) };
});

/** The spark was severed: ember flickers, thread snaps, ash drifts away, the chat dissolves. */
export function SeveringOverlay({ name, theirPhoto, myPhoto, onDone }: { name: string; theirPhoto?: string; myPhoto?: string; onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current();
  };
  useEffect(() => {
    const snap = window.setTimeout(() => buzz([40, 30, 90]), 1800);
    const auto = window.setTimeout(finish, 11_000);
    return () => { window.clearTimeout(snap); window.clearTimeout(auto); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="sk-overlay" role="dialog" aria-modal="true" aria-label={`Your spark with ${name} faded`} data-testid="severing">
      <div className="sk-stage">
        <div className="sk-av sk-av-l"><SparkAvatar path={myPhoto} name="You" size={76} /></div>
        <div className="sk-av sk-av-r"><SparkAvatar path={theirPhoto} name={name} size={76} /></div>
        <div className="sk-thread sk-thread-l" />
        <div className="sk-thread sk-thread-r" />
        <div className="sk-ember" />
        {ASH.map((ash, index) => (
          <i key={index} className="sk-ash" style={{ ['--x' as string]: `${ash.x}px`, ['--y' as string]: `${ash.y}px`, ['--d' as string]: `${ash.delay}s`, ['--s' as string]: `${ash.size}px` }} />
        ))}
      </div>
      <div className="sk-ghost" aria-hidden="true">
        {[68, 52, 60].map((width, index) => (
          <i key={index} style={{ width: `${width}%`, marginLeft: index === 1 ? 'auto' : 0, ['--i' as string]: index }} />
        ))}
      </div>
      <h2 className="display sk-late sk-title mt-8 text-3xl font-extrabold text-orange-50" style={{ ['--at' as string]: '4s' }}>The spark faded.</h2>
      <p className="sk-late mt-2 max-w-xs text-sm leading-relaxed text-slate-400" style={{ ['--at' as string]: '4.4s' }}>You won't see each other again.</p>
      <button type="button" onClick={finish} className="primary-button sk-late mt-8 min-w-[160px]" style={{ ['--at' as string]: '5.2s' }}>Continue</button>
    </div>
  );
}

/** Both people kept it: two embers merge into one flame. */
export function KeepOverlay({ name, theirPhoto, myPhoto, onDone }: { name: string; theirPhoto?: string; myPhoto?: string; onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const merge = window.setTimeout(() => buzz([18, 40, 18, 40, 160]), 1500);
    const auto = window.setTimeout(() => onDoneRef.current(), 5200);
    return () => { window.clearTimeout(merge); window.clearTimeout(auto); };
  }, []);
  return (
    <div className="sk-overlay sk-overlay-warm" role="dialog" aria-modal="true" aria-label={`Your spark with ${name} was kept`} onClick={() => onDoneRef.current()} data-testid="keep">
      <div className="sk-stage sk-stage-keep">
        <div className="sk-keep-av sk-keep-av-l"><SparkAvatar path={myPhoto} name="You" size={56} /></div>
        <div className="sk-keep-av sk-keep-av-r"><SparkAvatar path={theirPhoto} name={name} size={56} /></div>
        <div className="sk-em sk-em-l" />
        <div className="sk-em sk-em-r" />
        <div className="sk-merge-ring" />
        <Flame className="sk-flame-big" size={96} strokeWidth={1.8} fill="currentColor" />
        {BURST.map((spark, index) => (
          <i key={index} className="sk-burst" style={{ ['--x' as string]: `${spark.x}px`, ['--y' as string]: `${spark.y}px`, ['--d' as string]: `${spark.delay}s`, ['--s' as string]: `${spark.size}px` }} />
        ))}
      </div>
      <h2 className="display sk-late mt-6 text-3xl font-extrabold text-amber-50" style={{ ['--at' as string]: '2.1s' }}>Kept.</h2>
      <p className="sk-late mt-2 max-w-xs text-sm leading-relaxed text-amber-100/70" style={{ ['--at' as string]: '2.5s' }}>This spark is now a flame. No more countdown.</p>
      <p className="sk-late mt-8 text-xs text-slate-500" style={{ ['--at' as string]: '3.4s' }}>Tap anywhere to continue</p>
    </div>
  );
}

/** The window was extended by 24 hours. */
export function BonusOverlay({ name, onDone }: { name: string; onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    buzz([30, 25, 30, 25, 90]);
    const auto = window.setTimeout(() => onDoneRef.current(), 3600);
    return () => window.clearTimeout(auto);
  }, []);
  return (
    <div className="sk-overlay sk-overlay-bolt" role="dialog" aria-modal="true" aria-label={`Bonus round with ${name}`} onClick={() => onDoneRef.current()} data-testid="bonus">
      <div className="sk-strobe" />
      <Zap className="sk-bolt" size={104} strokeWidth={1.6} fill="currentColor" />
      <h2 className="display sk-late mt-6 text-4xl font-extrabold text-yellow-100" style={{ ['--at' as string]: '.5s' }}>Bonus round: +24h</h2>
      <p className="sk-late mt-2 max-w-xs text-sm leading-relaxed text-slate-300" style={{ ['--at' as string]: '.9s' }}>The window just got longer. Make it count.</p>
    </div>
  );
}

/** Plays kept / bonus effects one at a time, wherever the person is in the app. */
export function EffectsHost() {
  const { effects, dismissEffect, myPhoto } = useSparks();
  const current = effects[0];
  if (!current) return null;
  const { match } = current;
  const done = () => dismissEffect(current.id);
  if (current.type === 'kept') {
    return <KeepOverlay key={current.id} name={match.display_name} theirPhoto={match.photos[0]} myPhoto={myPhoto} onDone={done} />;
  }
  return <BonusOverlay key={current.id} name={match.display_name} onDone={done} />;
}
