import { useId, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { SparkSheet } from '@/components/ui/SparkSheet';
import { AGE_MAX, AGE_MIN, KM_MAX, KM_MIN, clampFilters, sameFilters, validateFilters, type DiscoverFilters } from '@/lib/discover-utils';
import { genderOptions } from '@/lib/profile';
import { errorText } from '@/lib/ui';

const GENDER_LABEL: Record<string, string> = { man: 'Men', woman: 'Women', nonbinary: 'Non-binary people', other: 'Other' };

function Switch({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-55' : ''}`}>
      <div className="min-w-0">
        <p id={id} className="text-sm font-semibold text-slate-100">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-8 w-14 shrink-0 rounded-full border transition ${checked ? 'border-rose-300/60 bg-rose-400/80' : 'border-white/15 bg-white/10'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[26px]' : 'left-1'}`} />
      </button>
    </div>
  );
}

/** Mobile-friendly filter sheet with validation, Apply and Reset. Only filters the data can honour are shown. */
export function FilterSheet({ filters, defaults, hasInterests, verifiedAvailable, onApply, onClose, onOpenTravel }: {
  filters: DiscoverFilters;
  defaults: DiscoverFilters;
  hasInterests: boolean;
  verifiedAvailable: boolean;
  onApply: (next: DiscoverFilters) => Promise<void>;
  onClose: () => void;
  onOpenTravel: () => void;
}) {
  const [draft, setDraft] = useState<DiscoverFilters>(filters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validation = validateFilters(draft);
  const set = (patch: Partial<DiscoverFilters>) => { setDraft((old) => ({ ...old, ...patch })); setError(''); };
  const toggleGender = (gender: string) => set({ genders: draft.genders.includes(gender) ? draft.genders.filter((item) => item !== gender) : [...draft.genders, gender] });

  const apply = async (close: () => void) => {
    const next = clampFilters(draft);
    const problem = validateFilters(next);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      await onApply(next);
      close();
    } catch (err) {
      console.error('Applying filters failed:', err);
      setError(errorText(err));
    } finally { setBusy(false); }
  };

  return (
    <SparkSheet
      title="Filters"
      onClose={onClose}
      footer={({ close }) => (
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <button type="button" disabled={busy || sameFilters(draft, { ...defaults, maxKm: 50 })} onClick={() => { setDraft({ ...defaults, maxKm: 50 }); setError(''); }} className="secondary-button px-5">Reset</button>
          <button type="button" disabled={busy || validation !== null} onClick={() => void apply(close)} className="primary-button" data-testid="apply-filters">{busy ? 'Applying…' : 'Apply'}</button>
        </div>
      )}
    >
      <div className="space-y-7 pb-2">
        <section aria-labelledby="f-distance-label">
          <div className="flex items-baseline justify-between"><label id="f-distance-label" htmlFor="f-distance" className="text-sm font-semibold text-slate-100">Maximum distance</label><output htmlFor="f-distance" className="text-sm font-bold text-rose-200">{draft.maxKm} km</output></div>
          <input id="f-distance" type="range" min={KM_MIN} max={KM_MAX} step={5} value={draft.maxKm} onChange={(event) => set({ maxKm: Number(event.target.value) })} className="mt-3 w-full" aria-valuetext={`${draft.maxKm} kilometres`} />
          <div className="mt-1 flex justify-between text-[10px] text-slate-600"><span>{KM_MIN} km</span><span>{KM_MAX} km</span></div>
        </section>

        <section aria-labelledby="f-age-label">
          <div className="flex items-baseline justify-between"><p id="f-age-label" className="text-sm font-semibold text-slate-100">Age range</p><span className="text-sm font-bold text-rose-200">{draft.minAge}–{draft.maxAge}</span></div>
          <div className="mt-3 grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-3">
            <label htmlFor="f-min-age" className="text-xs text-slate-400">Youngest</label>
            <input id="f-min-age" type="range" min={AGE_MIN} max={AGE_MAX} value={draft.minAge} onChange={(event) => { const v = Number(event.target.value); set({ minAge: v, maxAge: Math.max(draft.maxAge, v) }); }} />
            <label htmlFor="f-max-age" className="text-xs text-slate-400">Oldest</label>
            <input id="f-max-age" type="range" min={AGE_MIN} max={AGE_MAX} value={draft.maxAge} onChange={(event) => { const v = Number(event.target.value); set({ maxAge: v, minAge: Math.min(draft.minAge, v) }); }} />
          </div>
        </section>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-100">Show me</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {genderOptions.map((gender) => (
              <button key={gender} type="button" aria-pressed={draft.genders.includes(gender)} onClick={() => toggleGender(gender)} className={`sk-chip ${draft.genders.includes(gender) ? 'sk-chip-on' : ''}`}>{GENDER_LABEL[gender] ?? gender}</button>
            ))}
          </div>
        </fieldset>

        <section className="space-y-5">
          <Switch label="Shared interests only" hint={hasInterests ? 'Only people who like something you like.' : 'Add interests to your profile to use this.'} checked={draft.sharedOnly && hasInterests} disabled={!hasInterests} onChange={(value) => set({ sharedOnly: value })} />
          {verifiedAvailable && <Switch label="Verified profiles only" checked={draft.verifiedOnly} onChange={(value) => set({ verifiedOnly: value })} />}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-100"><MapPin size={15} className="text-rose-300" />Location</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Distances use your device location. You can also set a place by hand.</p>
          <button type="button" onClick={onOpenTravel} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-rose-200"><Navigation size={14} />Travel mode and manual location</button>
        </section>

        <p className="text-xs leading-relaxed text-slate-600">Not available yet: relationship intentions{verifiedAvailable ? '' : ' and verified-only'}. Spark profiles don't have {verifiedAvailable ? 'that field' : 'those fields'} yet.</p>

        {(validation || error) && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error || validation}</p>}
      </div>
    </SparkSheet>
  );
}
