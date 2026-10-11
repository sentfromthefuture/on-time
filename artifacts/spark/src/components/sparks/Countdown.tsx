import { Flame } from 'lucide-react';
import { useServerNow } from '@/components/sparks/SparksProvider';
import { TIER_COLOR, clockText, msLeft, pulseFor, ringFraction, ringText, speakLeft, tierFor, type MatchRow } from '@/lib/spark-utils';

/** Ring countdown for a Sparks card. A kept spark shows a flame instead of a timer. */
export function CountdownRing({ match, size = 62 }: { match: MatchRow; size?: number }) {
  const serverNow = useServerNow();
  if (match.status === 'kept') return <KeptFlame size={size} />;
  const left = Math.max(0, msLeft(match.expires_at, serverNow));
  const tier = tierFor(left);
  const color = TIER_COLOR[tier];
  const pulse = pulseFor(tier);
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = ringFraction(left, match.matched_at, match.expires_at);
  const { big, small } = ringText(left);
  return (
    <div
      role="timer"
      aria-label={speakLeft(left)}
      data-tier={tier}
      className={`sk-ring ${pulse === 'soft' ? 'sk-pulse-soft' : pulse === 'fast' ? 'sk-pulse-fast' : ''}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke .4s' }}
        />
      </svg>
      <div className="sk-ring-text" style={{ color }}>
        <span className="text-[15px] font-extrabold">{big}</span>
        <span className="text-[9.5px] font-semibold uppercase tracking-wide opacity-75">{small}</span>
      </div>
    </div>
  );
}

export function KeptFlame({ size = 62 }: { size?: number }) {
  return (
    <div className="sk-ring" style={{ width: size, height: size }} role="img" aria-label="Kept">
      <div className="sk-kept-disc" style={{ width: size - 6, height: size - 6 }}>
        <Flame className="sk-flame-idle" size={size * 0.46} strokeWidth={2.2} fill="currentColor" />
      </div>
    </div>
  );
}

/** Big HH:MM:SS countdown for the chat header. */
export function BigCountdown({ match }: { match: MatchRow }) {
  const serverNow = useServerNow();
  const left = Math.max(0, msLeft(match.expires_at, serverNow));
  const tier = tierFor(left);
  const color = TIER_COLOR[tier];
  const pulse = pulseFor(tier);
  return (
    <div role="timer" aria-label={speakLeft(left)} data-tier={tier} className={`text-center ${pulse === 'soft' ? 'sk-pulse-soft' : pulse === 'fast' ? 'sk-pulse-fast' : ''}`}>
      <div className="display text-[34px] font-extrabold leading-none tabular-nums" style={{ color, textShadow: `0 0 22px ${color}55` }}>{clockText(left)}</div>
      <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[.16em] text-slate-400">left in the spark window</p>
    </div>
  );
}
