import { createContext, useContext } from 'react';

export interface GraphActions {
  onExpand: (code: string) => void;
  onToggleUnlocks: (code: string) => void;
}

export const GraphActionsContext = createContext<GraphActions>({ onExpand: () => {}, onToggleUnlocks: () => {} });

export const useGraphActions = () => useContext(GraphActionsContext);
