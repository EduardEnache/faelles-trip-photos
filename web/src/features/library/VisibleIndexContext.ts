/**
 * maps item id -> index in the current visible (filtered) order,
 * so a tile can do shift-click range selection without prop-drilling the
 * whole list through every day section.
 */
import { createContext, useContext } from 'react';

export interface VisibleIndex {
  orderedIds: string[];
  indexOf: Map<string, number>;
}

const EMPTY: VisibleIndex = { orderedIds: [], indexOf: new Map() };

export const VisibleIndexContext = createContext<VisibleIndex>(EMPTY);

export function useVisibleIndex(): VisibleIndex {
  return useContext(VisibleIndexContext);
}
