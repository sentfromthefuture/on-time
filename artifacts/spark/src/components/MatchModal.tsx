import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles, Zap } from 'lucide-react';
import { Portal } from '@/components/ui/Portal';
import { useSparks } from '@/components/sparks/SparksProvider';
import { photoUrl } from '@/lib/supabase';
import type { MatchPopup } from '@/lib/ui';

/** Celebration shown when a like or spark turns into a match. The button opens the new chat. */
export default function MatchModal({ match, onClose }: { match: MatchPopup; onClose: () => void }) {
  const [remaining, setRemaining] = useState('');
  const [opening, setOpening] = useState(false);
  const navigate = useNavigate();
  const { matches, clockOffset, refresh, myPhoto } = useSparks();
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const openChat = async () => {
    setOpening(true);
    let id = row?.match_id;
    if (!id) id = findRow(await refresh())?.match_id;
    onClose();
    navigate(id ? `/sparks/${id}` : '/sparks');
  };
  return <Portal><div role="dialog" aria-modal="true" aria-labelledby="match-title" className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[#0e0e14]/90 p-5 backdrop-blur-md">
    <div className="confetti" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * .16}s`, background: i % 3 === 0 ? '#f39aab' : i % 3 === 1 ? '#f3c575' : '#b1d3ca' }} />)}</div>
    <div className="relative z-10 w-full max-w-sm animate-in text-center">
      <div className="mx-auto mb-7 flex justify-center -space-x-5">{[match.person?.photos?.[0], myPhoto].map((image, index) => <div key={index} className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-[#18171f] bg-[#30222b]">{image ? <img src={photoUrl(image)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Sparkles className="text-rose-200" size={28} />}</div>)}</div>
      <p className="text-xs font-bold uppercase tracking-[.24em] text-rose-300">Good feeling, confirmed</p><h2 id="match-title" className="display mt-3 text-4xl font-extrabold">Your spark starts now</h2><p className="mt-3 text-sm text-slate-400">{match.person?.name ? `You and ${match.person.name} liked each other.` : 'A new connection is waiting.'}</p>
      <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full border border-amber-200/15 bg-amber-200/[.06] px-4 py-2 text-xs text-amber-100"><Zap size={13} /> This spark is live for {remaining}</div>
      <button autoFocus disabled={opening} data-testid="match-open-chat" className="primary-button mt-7 flex w-full items-center justify-center gap-2" onClick={() => void openChat()}>{opening ? 'Opening…' : 'Open chat'} <ArrowRight size={17} /></button>
      <button onClick={onClose} className="mt-4 text-sm text-slate-500 hover:text-slate-300">Keep discovering</button>
    </div>
  </div></Portal>;
}
