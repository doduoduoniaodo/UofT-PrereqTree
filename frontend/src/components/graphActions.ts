import { createContext, useContext } from 'react';

export interface GraphActions {
  onExpand: (code: string) => void;
}

export const GraphActionsContext = createContext<GraphActions>({ onExpand: () => {} });

export const useGraphActions = () => useContext(GraphActionsContext);
