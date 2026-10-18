import type { ReactNode } from 'react';
import './choice-button.css';

/** One shared surface for player choices, swatches and the color picker preview. */
export default function ChoiceFace({ children }: { children: ReactNode }) {
  return <span className="choice-button-face"><span className="choice-button-label">{children}</span></span>;
}
