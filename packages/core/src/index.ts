// @stakeplate/core — the batteries-included Stake Engine game core.
//
// The one-call `createStakeGame(...)` façade lands here next; today the building blocks
// (RGS transport, the round engine, base stores, game config) are exported from the root
// and at their tree-shakeable subpaths (`/rgs`, `/stores`, `/testing`).
export * from './rgs';
export * from './engine';
export * from './stores';
export * from './game';
export * from './currency';
