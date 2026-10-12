import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Renders full-screen layers (sheets, dialogs, celebrations) directly under <body>.
 * A parent with a CSS transform or animation would otherwise become the containing block for
 * `position: fixed`, which pushes the layer under the header and tab bar.
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
