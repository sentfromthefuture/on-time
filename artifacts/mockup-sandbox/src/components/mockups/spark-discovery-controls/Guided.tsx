import { motion } from 'framer-motion';
import { Heart, RotateCcw, X, Zap } from 'lucide-react';
import './_group.css';

/** The same discovery actions, with explicit labels and a direct gesture prompt. */
export function Guided() {
  return (
    <main className="dc-demo">
      <div className="dc-demo-content">
        <p className="dc-demo-person">26 <span>Mysterious</span></p>
        <div className="dc-actions dc-guided-actions" role="group" aria-label="Profile actions">
          <div className="dc-action-item dc-action-item--undo">
            <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Undo last swipe" title="Undo" className="dc-act dc-act-undo" disabled><RotateCcw size={18} /></motion.button>
            <span className="dc-act-label">Undo</span>
          </div>
          <div className="dc-action-item dc-action-item--pass">
            <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Pass" title="Pass" className="dc-act dc-act-pass"><X size={26} strokeWidth={2.4} /></motion.button>
            <span className="dc-act-label">Pass</span>
          </div>
          <div className="dc-action-item dc-action-item--spark">
            <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Send a spark" title="Spark" className="dc-act dc-act-spark"><Zap size={26} fill="currentColor" /></motion.button>
            <span className="dc-act-label">Spark</span>
          </div>
          <div className="dc-action-item dc-action-item--like">
            <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Like" title="Like" className="dc-act dc-act-like"><Heart size={26} fill="currentColor" /></motion.button>
            <span className="dc-act-label">Like</span>
          </div>
        </div>
        <p className="dc-hint dc-guided-hint">Swipe the card left to pass · right to like · up to spark. Tap a button anytime.</p>
      </div>
    </main>
  );
}
