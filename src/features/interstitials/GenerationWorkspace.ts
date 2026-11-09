import { createContext, useContext } from 'react';

export const GenerationWorkspaceContext = createContext<{ open: (id: string) => void; close: () => void } | null>(null);
export const useGenerationWorkspace = () => useContext(GenerationWorkspaceContext);
