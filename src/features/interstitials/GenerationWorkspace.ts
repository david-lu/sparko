import { createContext, useContext } from 'react';
import type { PromptFrameCapture } from '../player/promptFrame';

/** Share a read-only snapshot operation, never either timeline's transport. */
export function createGenerationWorkspace(open: (id: string) => void, close: () => void) {
  let capture: PromptFrameCapture | undefined;
  let currentId: string | undefined;
  return {
    open: (id: string) => { if (id !== currentId) capture = undefined; currentId = id; open(id); },
    close: () => { capture = undefined; currentId = undefined; close(); },
    getFrameCapture: () => capture,
    registerFrameCapture: (next: PromptFrameCapture) => {
      capture = next;
      return () => { if (capture === next) capture = undefined; };
    },
  };
}

export const GenerationWorkspaceContext = createContext<ReturnType<typeof createGenerationWorkspace> | null>(null);
export const useGenerationWorkspace = () => useContext(GenerationWorkspaceContext);
