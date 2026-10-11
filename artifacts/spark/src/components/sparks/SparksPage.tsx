import { useNavigate } from 'react-router-dom';
import { Flame, RefreshCw, Sparkles } from 'lucide-react';
import { CountdownRing } from '@/components/sparks/Countdown';
import { SeveringOverlay } from '@/components/sparks/Effects';
import { SparkAvatar } from '@/components/sparks/SparkAvatar';
import { useServerNow, useSparks } from '@/components/sparks/SparksProvider';
import { HOUR, msLeft, relativeTime, type MatchRow } from '@/lib/spark-utils';

/** "2 sparks fading soon" when any active spark has under 3 hours left. */
function FadingBanner({ matches }: { matches: MatchRow[] }) {
  const serverNow = useServerNow();
  const fading = matches.filter((match) => {
    if (match.status !== 'active') return false;
    const left = msLeft(match.expires_at, serverNow);
    return left > 0 && left < 3 * HOUR;
  }).length;
  if (!fading) return null;
  return (
    <div role="status" data-testid="fading-banner" className="sk-fading mb-4 flex items-center gap-3 rounded-2xl border border-orange-400/25 bg-orange-500/10 p-3.5">
      <Flame size={20} className="shrink-0 text-orange-300" />
      <div>
        <p className="text-sm font-bold text-orange-100">{fading} {fading === 1 ? 'spark' : 'sparks'} fading soon</p>
        <p className="text-xs text-orange-200/70">Keep the connection before the window closes.</p>
      </div>
    </div>
  );
}

function LastLine({ match }: { match: MatchRow }) {
  const serverNow = useServerNow();
  if (!match.last_message) {
    return <p className="truncate text-sm text-slate-500">{match.status === 'kept' ? 'Kept. Say something.' : 'Say hello before the spark fades.'}</p>;
  }
  const when = relativeTime(match.last_message_at, serverNow);
  return (
    <p className={`truncate text-sm ${match.unread > 0 ? 'font-semibold text-slate-100' : 'text-slate-400'}`}>
      {match.last_message}{when && <span className="ml-2 text-xs font-normal text-slate-600">{when}</span>}
    </p>
  );
}

export default function SparksPage() {
  const navigate = useNavigate();
  const { matches, loaded, error, refresh, tombstone, ack, ackError, retryAcks, myPhoto } = useSparks();
  // Order is exactly what my_matches returned (soonest expiry first). Severed rows are tombstones, not cards.
  const visible = matches.filter((match) => match.status !== 'severed');

  return (
    <section className="animate-in">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-extrabold">Sparks</h1>
          <p className="mt-1 text-sm text-slate-400">Every match is a 24-hour spark. Keep it before it fades.</p>
        </div>
        <button type="button" onClick={() => void refresh()} aria-label="Refresh sparks" className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[.04] text-slate-300">
          <RefreshCw size={16} />
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()} className="underline">Retry</button>
        </div>
      )}
      {ackError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">
          <span>Couldn't clear a faded spark: {ackError}</span>
          <button type="button" onClick={() => void retryAcks()} className="underline">Retry</button>
        </div>
      )}

      <FadingBanner matches={visible} />

      {!loaded ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((key) => <div key={key} className="skeleton-card h-[88px] rounded-[22px]" />)}</div>
      ) : visible.length === 0 ? (
        <div className="panel mt-6 p-8 text-center">
          <div className="empty-orbit mx-auto"><Sparkles size={26} /></div>
          <h2 className="display mt-5 text-xl font-extrabold">No sparks yet</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-400">When you and someone like each other, a 24-hour spark starts here.</p>
          <button type="button" onClick={() => navigate('/')} className="primary-button mt-6">Keep discovering</button>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((match) => (
            <li key={match.match_id}>
              <button
                type="button"
                onClick={() => navigate(`/sparks/${match.match_id}`)}
                data-testid="spark-card"
                data-status={match.status}
                className="panel flex w-full items-center gap-3.5 p-3.5 text-left transition active:scale-[.985]"
              >
                <div className="relative shrink-0">
                  <SparkAvatar path={match.photos[0]} name={match.display_name} size={58} />
                  {match.unread > 0 && (
                    <span aria-label={`${match.unread} unread`} className="absolute -right-1 -top-1 grid min-w-[20px] place-items-center rounded-full border-2 border-[#18171f] bg-rose-400 px-1 text-[10.5px] font-extrabold leading-[16px] text-[#23121a]">
                      {match.unread > 9 ? '9+' : match.unread}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h2 className="display truncate text-lg font-extrabold">{match.display_name}</h2>
                    {match.age !== null && <span className="text-sm text-slate-400">{match.age}</span>}
                  </div>
                  <LastLine match={match} />
                  {match.extended && match.status === 'active' && <p className="mt-0.5 text-[11px] font-semibold text-yellow-300/90">Bonus round +24h</p>}
                </div>
                <CountdownRing match={match} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {tombstone && (
        <SeveringOverlay
          key={tombstone.match_id}
          name={tombstone.display_name}
          theirPhoto={tombstone.photos[0]}
          myPhoto={myPhoto}
          onDone={() => void ack(tombstone.match_id)}
        />
      )}
    </section>
  );
}
