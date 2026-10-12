import { motion } from 'framer-motion';
import { Heart, RotateCcw, X, Zap } from 'lucide-react';
import './_group.css';

/** Extracted from artifacts/spark/src/components/discover/ActionBar.tsx. */
export function Current() {
  return (
    <main className="dc-demo">
      <div className="dc-demo-content">
        <p className="dc-demo-person">26 <span>Mysterious</span></p>
        <div className="dc-actions" role="group" aria-label="Profile actions">
          <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Undo last swipe" title="Undo" className="dc-act dc-act-undo" disabled><RotateCcw size={18} /></motion.button>
          <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Pass" title="Pass" className="dc-act dc-act-pass"><X size={26} strokeWidth={2.4} /></motion.button>
          <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Send a spark" title="Spark" className="dc-act dc-act-spark"><Zap size={26} fill="currentColor" /></motion.button>
          <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Like" title="Like" className="dc-act dc-act-like"><Heart size={26} fill="currentColor" /></motion.button>
        </div>
        <p className="dc-hint">Swipe left to pass · right to like · up to spark</p>
      </div>
    </main>
  );
}
