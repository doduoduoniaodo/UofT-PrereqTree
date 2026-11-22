import { createContext, useContext } from 'react';

export interface GraphActions {
  onExpand: (code: string) => void;
  onCollapse: (code: string) => void;
  onToggleUnlocks: (code: string) => void;
}

export const GraphActionsContext = createContext<GraphActions>({ onExpand: () => {}, onCollapse: () => {}, onToggleUnlocks: () => {} });

export const useGraphActions = () => useContext(GraphActionsContext);
