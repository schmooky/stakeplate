import { compose } from './composition';

async function boot() {
  const sceneHost = document.getElementById('scene');
  const hudHost = document.getElementById('hud');
  if (!sceneHost || !hudHost) throw new Error('[main] #scene or #hud missing in index.html');
  const app = await compose({ sceneHost, hudHost });
  await app.start();
}

boot().catch((err) => {
  console.error('[main] boot failed', err);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'BOOT FAILED — ' + (err instanceof Error ? err.message : String(err));
});
