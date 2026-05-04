import React from 'react';

export type ViewpointOption = { id: string; label: string };

export const GameLabFlowContext = React.createContext<{
  viewpointOptions: ViewpointOption[];
}>({ viewpointOptions: [] });

export function useGameLabFlowContext() {
  return React.useContext(GameLabFlowContext);
}
