import { defineConfig } from 'tsdown';

// @stakeplate/core ships one entry per public subpath — ESM ONLY (the games + Stake are
// all ESM/Vite) + rolled-up .d.ts. tsdown auto-externalizes every dependency +
// peerDependency (and their subpaths, e.g. `@open-slot-ui/pixi/art`), so nothing here
// bundles the peers — the game supplies pixi/@open-slot-ui/zvuk.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    rgs: 'src/rgs/index.ts',
    stores: 'src/stores/index.ts',
    audio: 'src/audio/index.ts',
    testing: 'src/testing/index.ts',
    rules: 'src/rules/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
});
