import { AlertTriangle, Compass, SlidersHorizontal } from 'lucide-react';

export function CardSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[28px] border border-white/10 bg-[#1b1b23]" aria-busy="true" aria-label="Loading profiles" role="status" data-testid="card-skeleton">
      <div className="skeleton-card absolute inset-0 opacity-60" />
      <div className="absolute inset-x-0 bottom-0 space-y-3 p-5">
        <div className="skeleton-line h-7 w-44" />
        <div className="skeleton-line w-28" />
        <div className="skeleton-line w-full" />
        <div className="skeleton-line w-2/3" />
        <div className="flex gap-2 pt-1"><div className="skeleton-line h-7 w-20" /><div className="skeleton-line h-7 w-16" /><div className="skeleton-line h-7 w-24" /></div>
      </div>
      <span className="sr-only">Finding your kind of people…</span>
    </div>
  );
}

function StateShell({ icon, title, body, children, testId }: { icon: React.ReactNode; title: string; body: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="panel absolute inset-0 flex flex-col items-center justify-center px-7 text-center" data-testid={testId}>
      <div className="empty-orbit mb-6">{icon}</div>
      <h2 className="display text-2xl font-bold">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">{body}</p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-3">{children}</div>
    </div>
  );
}

/** Nothing to show: either the queue is finished, or the filters hide everyone who was found. */
export function EmptyState({ hiddenByFilters, onAdjust, onReset, onRefresh }: { hiddenByFilters: number; onAdjust: () => void; onReset: () => void; onRefresh: () => void }) {
  if (hiddenByFilters > 0) {
    return (
      <StateShell testId="empty-filtered" icon={<SlidersHorizontal size={26} />} title="No one matches your filters" body={`${hiddenByFilters} ${hiddenByFilters === 1 ? 'person is' : 'people are'} hidden by your current filters. Loosen them to see more.`}>
        <button type="button" onClick={onReset} className="primary-button">Reset filters</button>
        <button type="button" onClick={onAdjust} className="secondary-button">Adjust filters</button>
      </StateShell>
    );
  }
  return (
    <StateShell testId="empty-caught-up" icon={<Compass size={27} />} title="You're all caught up." body="Try expanding your distance or adjusting your filters.">
      <button type="button" onClick={onAdjust} className="primary-button">Adjust filters</button>
      <button type="button" onClick={onRefresh} className="secondary-button">Look again</button>
    </StateShell>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StateShell testId="load-error" icon={<AlertTriangle size={26} />} title="Couldn't load profiles" body={message}>
      <button type="button" onClick={onRetry} className="primary-button">Try again</button>
    </StateShell>
  );
}
