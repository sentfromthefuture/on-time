import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Portal } from '@/components/ui/Portal';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal sheet: focus moves in, Tab stays inside, Escape and the backdrop close it,
 * focus returns to where it came from, the page behind does not scroll, and it animates in and out.
 */
type SheetApi = { close: () => void };
type SheetSlot = ReactNode | ((api: SheetApi) => ReactNode);

export function SparkSheet({ title, onClose, children, footer, size = 'sheet', hideTitle = false }: {
  title: string;
  onClose: () => void;
  children: SheetSlot;
  footer?: SheetSlot;
  size?: 'sheet' | 'full';
  hideTitle?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), 170);
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
      if (items.length === 0) { event.preventDefault(); panel.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [close]);

  const full = size === 'full';
  return (
    <Portal>
    <div
      className={`fixed inset-0 z-[60] flex ${full ? 'items-stretch' : 'items-end'} justify-center bg-black/70 backdrop-blur-sm ${closing ? 'sk-backdrop-out' : 'sk-backdrop-in'}`}
      onClick={close}
      data-testid="sheet-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`panel flex w-full flex-col outline-none ${full ? 'sk-sheet-full h-[100dvh] max-w-lg' : 'sk-sheet max-h-[90dvh] max-w-lg'} ${closing ? 'sk-sheet-out' : ''}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h2 id={titleId} className={`display text-xl font-extrabold ${hideTitle ? 'sr-only' : ''}`}>{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-white/[.07] text-slate-200"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{typeof children === 'function' ? children({ close }) : children}</div>
        {footer && <div className="shrink-0 border-t border-white/[.07] px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3.5">{typeof footer === 'function' ? footer({ close }) : footer}</div>}
      </div>
    </div>
    </Portal>
  );
}
