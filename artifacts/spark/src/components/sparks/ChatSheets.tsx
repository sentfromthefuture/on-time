import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, Loader2, MessageCircle, ShieldCheck, X } from 'lucide-react';
import { getMatchContact, reportUser, shareContact, type ReportReason } from '@/lib/sparks';
import { buzz, messageOf, normalizeContacts, whatsappLink, type Contacts, type MatchRow } from '@/lib/spark-utils';

export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="sk-sheet panel max-h-[88dvh] w-full max-w-lg overflow-y-auto p-5 pb-[max(env(safe-area-inset-bottom),22px)]" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="display text-xl font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full bg-white/[.06] text-slate-300"><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, body, confirmLabel, danger, busy, error, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; danger?: boolean; busy: boolean; error: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-6 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-label={title} onClick={busy ? undefined : onCancel}>
      <div className="panel w-full max-w-sm p-6 text-center" onClick={(event) => event.stopPropagation()}>
        <h2 className="display text-xl font-extrabold">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="secondary-button">Cancel</button>
          <button type="button" disabled={busy} onClick={onConfirm} className={danger ? 'sk-danger-button' : 'primary-button'}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (error) {
      console.error('Copy failed:', error);
      return false;
    }
  }
}

function NumberRow({ label, value, whatsapp }: { label: string; value: string; whatsapp?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(value);
    if (ok) { setCopied(true); buzz(10); window.setTimeout(() => setCopied(false), 1600); }
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4" data-testid="number-row">
      <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-slate-500">{label}</p>
      <p className="mt-1 break-all text-xl font-bold tabular-nums">{value}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className="sk-chip inline-flex items-center gap-1.5">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>
        {whatsapp && (
          <a href={whatsappLink(value)} target="_blank" rel="noopener noreferrer" className="sk-chip inline-flex items-center gap-1.5 !border-emerald-400/30 !text-emerald-200"><MessageCircle size={14} />WhatsApp</a>
        )}
      </div>
    </div>
  );
}

/** Shows both numbers once they have been swapped. */
export function ContactsPanel({ match, myId }: { match: MatchRow; myId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [contacts, setContacts] = useState<Contacts>({});
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setState('loading'); setError('');
    try {
      const data = await getMatchContact(match.match_id);
      const parsed = normalizeContacts(data, myId);
      if (!parsed.mine && !parsed.theirs) {
        console.error('get_match_contact returned an unexpected shape:', data);
        throw new Error('The numbers came back in a format this app could not read.');
      }
      setContacts(parsed);
      setState('ready');
    } catch (err) {
      setError(messageOf(err));
      setState('error');
    }
  }, [match.match_id, myId]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" />Getting the numbers…</p>;
  if (state === 'error') {
    return (
      <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="mt-2 underline">Try again</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {contacts.mine && <NumberRow label="Your number" value={contacts.mine} />}
      {contacts.theirs && <NumberRow label={`${match.display_name}'s number`} value={contacts.theirs} whatsapp />}
      <SafetyNote />
    </div>
  );
}

function SafetyNote() {
  return (
    <div className="flex gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/[.07] p-3.5 text-sm leading-relaxed text-emerald-100/90">
      <ShieldCheck size={19} className="mt-0.5 shrink-0 text-emerald-300" />
      <p>Meet in public, tell a friend, never send money.</p>
    </div>
  );
}

/** Phone input sheet. The server decides when both numbers are revealed. */
export function SwapSheet({ match, onRevealed, onShared }: { match: MatchRow; onRevealed: () => void; onShared: () => void }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(match.i_shared_contact);
  const submit = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) { setError('Enter a valid phone number, with the country code if you can.'); return; }
    setBusy(true); setError('');
    try {
      const result = await shareContact(match.match_id, phone.trim());
      buzz(12);
      if (result === 'revealed') onRevealed();
      else { setWaiting(true); onShared(); }
    } catch (err) {
      setError(messageOf(err));
    } finally { setBusy(false); }
  };
  return (
    <div>
      <SafetyNote />
      {waiting ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[.04] p-4 text-sm leading-relaxed text-slate-300" data-testid="swap-waiting">
          <p className="font-semibold text-slate-100">Your number is shared privately.</p>
          <p className="mt-1 text-slate-400">Waiting… if they share theirs too, you'll both see each other's numbers.</p>
        </div>
      ) : (
        <form className="mt-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="swap-phone" className="text-sm font-semibold text-slate-300">Your phone number</label>
          <input id="swap-phone" className="field mt-2" type="tel" inputMode="tel" autoComplete="tel" placeholder="+260 97 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <p className="mt-2 text-xs leading-relaxed text-slate-500">It stays hidden until you both choose to swap.</p>
          {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
          <button type="submit" disabled={busy} className="primary-button mt-5 w-full">{busy ? 'Sharing…' : 'Share my number'}</button>
        </form>
      )}
    </div>
  );
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'fake', label: 'Fake profile' },
  { value: 'underage', label: 'Underage' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'nudity', label: 'Nudity' },
  { value: 'scam', label: 'Scam' },
  { value: 'other', label: 'Something else' },
];

export function ReportSheet({ match, onDone }: { match: MatchRow; onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async () => {
    if (!reason) { setError('Pick a reason first.'); return; }
    setBusy(true); setError('');
    try {
      await reportUser({ target: match.user_id, reason, details: details.trim(), match: match.match_id });
      setSent(true);
    } catch (err) {
      setError(messageOf(err));
    } finally { setBusy(false); }
  };
  if (sent) {
    return (
      <div className="py-4 text-center">
        <div className="empty-orbit mx-auto"><Check size={26} /></div>
        <h3 className="display mt-4 text-lg font-extrabold">Thanks for telling us</h3>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-400">We'll review this report. You can also block this person from the menu.</p>
        <button type="button" onClick={onDone} className="primary-button mt-6 w-full">Done</button>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm text-slate-400">What's going on with {match.display_name}?</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
        {REASONS.map((item) => (
          <button key={item.value} type="button" role="radio" aria-checked={reason === item.value} onClick={() => setReason(item.value)}
            className={`sk-chip ${reason === item.value ? 'sk-chip-on' : ''}`}>{item.label}</button>
        ))}
      </div>
      <textarea className="field mt-4 min-h-[96px] resize-none" maxLength={500} placeholder="Add details (optional)" value={details} onChange={(event) => setDetails(event.target.value)} />
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void submit()} className="primary-button mt-5 w-full">{busy ? 'Sending…' : 'Send report'}</button>
    </div>
  );
}
