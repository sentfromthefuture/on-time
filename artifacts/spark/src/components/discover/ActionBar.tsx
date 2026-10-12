import { motion } from 'framer-motion';
import { Heart, RotateCcw, X, Zap } from 'lucide-react';
import type { SwipeAction } from '@/components/discover/ProfileCard';

/** Undo, Pass, Spark, Like. Icon-only buttons with accessible names and clear disabled states. */
export function ActionBar({ canUndo, busy, onUndo, onAct, compact = false, hideUndo = false }: {
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
  onAct: (action: SwipeAction) => void;
  compact?: boolean;
  hideUndo?: boolean;
}) {
  const size = compact ? 'dc-act-compact' : '';
  return (
    <div className={`dc-actions ${compact ? 'dc-actions-compact' : ''}`} role="group" aria-label="Profile actions" data-testid="action-bar">
      {!hideUndo && (
        <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={onUndo} disabled={!canUndo || busy} aria-label="Undo last swipe" title="Undo" className={`dc-act dc-act-undo ${size}`}><RotateCcw size={18} /></motion.button>
      )}
      <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => onAct('pass')} disabled={busy} aria-label="Pass" title="Pass" className={`dc-act dc-act-pass ${size}`}><X size={26} strokeWidth={2.4} /></motion.button>
      <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => onAct('spark')} disabled={busy} aria-label="Send a spark" title="Spark" className={`dc-act dc-act-spark ${size}`}><Zap size={26} fill="currentColor" /></motion.button>
      <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => onAct('like')} disabled={busy} aria-label="Like" title="Like" className={`dc-act dc-act-like ${size}`}><Heart size={26} fill="currentColor" /></motion.button>
    </div>
  );
}
