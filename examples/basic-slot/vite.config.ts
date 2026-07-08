import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Resolve the local core package straight from its TS source (fast HMR, no prebuild).
// We can't do this with a global `source` export condition: the npm-published
// @open-slot-ui/* packages *declare* a `source` entry but only ship `dist`, so a global
// `source` condition would send Vite hunting for a src/ that isn't in their tarball.
const coreSrc = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));

// Stake serves the built game from a deep CDN subpath → assets must be RELATIVE.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: { port: 5280, host: true },
  resolve: {
    // Dev: resolve the core from its TS source (fast HMR). Build: resolve it from the
    // built package (dist, via exports) so the bundle exercises exactly what npm ships.
    ...(command === 'serve' ? { alias: { '@stakeplate/core': coreSrc } } : {}),
    // The core, the example and the HUD libs must share ONE copy of these.
    dedupe: ['pixi.js', 'mobx', '@open-slot-ui/core', '@open-slot-ui/pixi'],
  },
}));
