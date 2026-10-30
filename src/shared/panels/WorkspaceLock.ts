import { createContext, useContext } from 'react';

export const WorkspaceLockContext=createContext(false);
export const useWorkspaceLocked=()=>useContext(WorkspaceLockContext);
