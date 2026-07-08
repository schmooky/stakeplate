import { compose } from './composition';

async function boot() {
  const host = document.getElementById('pixi');
  if (!host) throw new Error('[main] #pixi missing in index.html');
  const app = await compose({ host });
  await app.start();
}

boot().catch((err) => {
  console.error('[main] boot failed', err);
});
