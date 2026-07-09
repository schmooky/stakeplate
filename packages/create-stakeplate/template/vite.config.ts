import { defineConfig } from 'vite';

// Stake serves the built game from a deep CDN subpath → assets must be RELATIVE on build.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: { host: true },
  // The game, the core and the HUD libs must share ONE copy of these.
  resolve: { dedupe: ['pixi.js', 'mobx', '@open-slot-ui/core', '@open-slot-ui/pixi'] },
}));
