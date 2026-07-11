// The boot experience — a single overlay that carries the player from LOADING straight into
// an optional FEATURES splash and then out of the way, all in one continuous element (no
// flash between screens). `createStakeGame({ loader })` shows it the instant boot starts:
//
//   LOADING  — logo (pulsing) + a progress bar the core advances across the boot milestones
//              (init → auth → HUD → view), over an optional blurred cover image + vignette.
//   FEATURES — (if `features` are configured) once boot is ready the SAME logo glides up to
//              the top, the bar fades out, and 2–3 feature tiles (image + short caption, all
//              scaled to one size) fade + scale in with a "press to continue" prompt.
//   REVEAL   — a tap / key press (or auto, with no features) fades the overlay away to the
//              game, which is already booted + idle behind it.
//
// So the game gets a `loader → features → idle` flow for free — it only writes its `present`
// phase. Pure DOM + CSS: it paints before pixi/zvuk load and removes itself when done.

let seq = 0;

/** One feature card on the intro splash — an image with a short (may be multi-line) caption. */
export interface FeatureItem {
  /** Image URL / data-URI. Rendered at a uniform height so mismatched art still lines up. */
  image: string;
  /** Short caption under the image. `\n` for line breaks. */
  text: string;
}

export interface LoaderConfig {
  /** Big title under the logo (LOADING phase only). Defaults to the game title. */
  title?: string;
  /** Small line under the title (LOADING phase). */
  subtitle?: string;
  /** URL/data-URI of the logo. Pulses while loading; glides to the top for the features
   *  splash. Omit for a CSS ring spinner (and no move-up). */
  logo?: string;
  /** Solid colour behind everything. Default `#0b0d12`. */
  background?: string;
  /** Optional cover image (ideally the game's own backdrop, for a seamless reveal). */
  backgroundImage?: string;
  /** Blur the cover image. Default `true`. */
  blur?: boolean;
  /** Accent colour — progress fill + title glow + caption text. Default `#d99000`. */
  accent?: string;
  /** Minimum time the LOADING phase stays up, so the bar always fills. Default `1200`ms. */
  minDurationMs?: number;
  /** Stacking order. Default a very high value so it sits over the game. */
  zIndex?: number;
  /**
   * If `true`, the core shows the loader + advances progress but does NOT auto-advance past
   * LOADING — the game calls `ctx.loader.done()` itself (e.g. after its scene finishes loading
   * art). Default `false`. (The FEATURES splash always waits for the player regardless.)
   */
  manual?: boolean;
  /** 2–3 feature cards → show a FEATURES splash after loading. Omit for a plain loader. */
  features?: FeatureItem[];
  /** The dismiss prompt under the feature cards. Default `PRESS TO CONTINUE`. */
  continueText?: string;
}

export interface GameLoader {
  /** The overlay element (already in the document). */
  readonly el: HTMLElement;
  /** Drive the progress bar. Clamped to the range it has already reached (never goes back). */
  setProgress(p: number): void;
  /** Advance out of LOADING: fill to 100%, honour `minDurationMs`, then either show the
   *  FEATURES splash (waiting for the player to continue) or — with no features — pop away.
   *  Resolves once the overlay is fully gone. Idempotent (first call wins). */
  done(): Promise<void>;
  /** Remove immediately without any outro (used on a boot error). */
  remove(): void;
}

const isBrowser = (): boolean => typeof document !== 'undefined' && !!document.body;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Create + mount the boot overlay. Safe to call before anything else in boot. */
export function createLoader(config: LoaderConfig = {}): GameLoader {
  const startedAt = Date.now();
  const minMs = config.minDurationMs ?? 1200;
  const accent = config.accent ?? '#d99000';
  const bg = config.background ?? '#0b0d12';
  const z = config.zIndex ?? 2147483000;
  const blur = config.blur ?? true;
  const features = config.features ?? [];
  const hasLogo = !!config.logo;
  let progress = 0;
  let donePromise: Promise<void> | null = null;

  // Headless / SSR guard — a no-op handle so callers needn't branch.
  if (!isBrowser()) {
    return { el: null as unknown as HTMLElement, setProgress() {}, done: () => Promise.resolve(), remove() {} };
  }

  const id = `sp-loader-${++seq}`;
  const root = document.createElement('div');
  root.id = id;
  root.className = 'sp-loader phase-loading';

  const style = document.createElement('style');
  style.textContent = `
    #${id}{position:fixed;inset:0;z-index:${z};background:${bg};overflow:hidden;
      font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
      opacity:1;transition:opacity .5s ease}
    #${id}.sp-done{opacity:0}
    #${id} .sp-bgimg{position:absolute;inset:-8%;background-position:center;background-size:cover;
      ${blur ? 'filter:blur(6px);' : ''}transform:scale(1.06)}
    #${id} .sp-vign{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 42%,transparent 40%,rgba(0,0,0,.62) 100%)}
    /* Logo — same element in both phases; glides + shrinks from centre to the top. */
    #${id} .sp-logo{position:absolute;left:50%;top:36%;transform:translate(-50%,-50%);
      width:min(42vw,240px);height:auto;filter:drop-shadow(0 14px 24px rgba(0,0,0,.55));
      animation:sp-pulse 1.5s ease-in-out infinite;
      transition:top .6s cubic-bezier(.5,0,.2,1),width .6s cubic-bezier(.5,0,.2,1)}
    #${id}.phase-features .sp-logo{top:15%;width:min(30vw,180px);animation:none}
    /* LOADING group (title/subtitle + bar) — fades out on the way to features. */
    #${id} .sp-load{position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);
      display:flex;flex-direction:column;align-items:center;gap:14px;
      transition:opacity .35s ease}
    #${id}.phase-features .sp-load{opacity:0;pointer-events:none}
    #${id} .sp-spin{width:60px;height:60px;border-radius:50%;border:5px solid rgba(255,255,255,.18);
      border-top-color:${accent};animation:sp-rot .8s linear infinite}
    #${id} .sp-title{margin:0;color:#fff;font-weight:800;letter-spacing:.02em;
      font-size:clamp(20px,3.6vw,36px);text-align:center;text-shadow:0 3px 10px rgba(0,0,0,.55),0 0 22px ${accent}55}
    #${id} .sp-sub{margin:0;color:#ffffffcc;font-size:clamp(12px,2vw,16px);text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.5)}
    #${id} .sp-bar{position:relative;width:min(60vw,260px);height:8px;border-radius:99px;background:rgba(255,255,255,.16);overflow:hidden}
    #${id} .sp-fill{position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:99px;background:${accent};transition:width .35s ease}
    /* FEATURES splash — tiles + prompt; scales/fades in once boot is ready. */
    #${id} .sp-feat{position:absolute;left:0;right:0;top:30%;bottom:0;display:flex;flex-direction:column;
      align-items:center;justify-content:flex-start;gap:5vh;padding:0 4vw;
      opacity:0;transform:scale(.94);pointer-events:none;transition:opacity .5s ease,transform .5s ease}
    #${id}.phase-features .sp-feat{opacity:1;transform:scale(1);pointer-events:auto}
    #${id} .sp-tiles{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:center;
      gap:clamp(18px,5vw,64px);max-width:94vw}
    #${id} .sp-tile{display:flex;flex-direction:column;align-items:center;gap:14px;
      width:clamp(110px,22vw,210px);opacity:0;transform:translateY(16px) scale(.9);
      transition:opacity .45s ease,transform .45s cubic-bezier(.34,1.56,.64,1)}
    #${id}.phase-features .sp-tile{opacity:1;transform:none}
    #${id} .sp-tile img{height:clamp(66px,13vh,150px);width:auto;max-width:100%;object-fit:contain;
      filter:drop-shadow(0 8px 14px rgba(0,0,0,.45))}
    #${id} .sp-tile span{color:${accent};font-weight:800;text-transform:uppercase;letter-spacing:.02em;
      text-align:center;white-space:pre-line;line-height:1.15;font-size:clamp(13px,2.1vw,21px);
      text-shadow:0 2px 6px rgba(0,0,0,.6)}
    #${id} .sp-cont{margin-top:auto;margin-bottom:5vh;color:#ffffffcc;text-transform:uppercase;
      letter-spacing:.16em;font-size:clamp(11px,1.6vw,15px);animation:sp-blink 1.7s ease-in-out infinite}
    @keyframes sp-pulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.06)}}
    @keyframes sp-rot{to{transform:rotate(360deg)}}
    @keyframes sp-blink{0%,100%{opacity:.4}50%{opacity:1}}
    @media (prefers-reduced-motion:reduce){#${id} .sp-logo,#${id} .sp-spin,#${id} .sp-cont{animation:none}}
  `;

  if (config.backgroundImage) {
    const img = document.createElement('div');
    img.className = 'sp-bgimg';
    img.style.backgroundImage = `url(${config.backgroundImage})`;
    root.appendChild(img);
    const vign = document.createElement('div');
    vign.className = 'sp-vign';
    root.appendChild(vign);
  }

  if (hasLogo) {
    const logo = document.createElement('img');
    logo.className = 'sp-logo';
    logo.src = config.logo!;
    logo.alt = '';
    root.appendChild(logo);
  }

  // LOADING group.
  const load = document.createElement('div');
  load.className = 'sp-load';
  if (!hasLogo) {
    const spin = document.createElement('div');
    spin.className = 'sp-spin';
    load.appendChild(spin);
  }
  if (config.title) {
    const h = document.createElement('h1');
    h.className = 'sp-title';
    h.textContent = config.title;
    load.appendChild(h);
  }
  if (config.subtitle) {
    const p = document.createElement('p');
    p.className = 'sp-sub';
    p.textContent = config.subtitle;
    load.appendChild(p);
  }
  const bar = document.createElement('div');
  bar.className = 'sp-bar';
  const fill = document.createElement('div');
  fill.className = 'sp-fill';
  bar.appendChild(fill);
  load.appendChild(bar);
  root.appendChild(load);

  // FEATURES group (built only when configured).
  if (features.length) {
    const feat = document.createElement('div');
    feat.className = 'sp-feat';
    const tiles = document.createElement('div');
    tiles.className = 'sp-tiles';
    features.forEach((f, i) => {
      const tile = document.createElement('div');
      tile.className = 'sp-tile';
      tile.style.transitionDelay = `${0.12 + i * 0.12}s`; // staggered entrance
      const img = document.createElement('img');
      img.src = f.image;
      img.alt = '';
      const cap = document.createElement('span');
      cap.textContent = f.text;
      tile.append(img, cap);
      tiles.appendChild(tile);
    });
    const cont = document.createElement('div');
    cont.className = 'sp-cont';
    cont.textContent = config.continueText ?? 'PRESS TO CONTINUE';
    feat.append(tiles, cont);
    root.appendChild(feat);
  }

  root.appendChild(style);
  document.body.appendChild(root);

  const setProgress = (p: number): void => {
    const next = Math.max(progress, Math.min(1, Number.isFinite(p) ? p : 0));
    progress = next;
    fill.style.width = `${Math.round(next * 100)}%`;
  };

  const remove = (): void => {
    root.remove();
    style.remove();
  };

  // Transition LOADING → FEATURES, then resolve once the player dismisses it.
  const runFeatures = (): Promise<void> =>
    new Promise((resolve) => {
      root.classList.remove('phase-loading');
      root.classList.add('phase-features');
      const dismiss = (): void => {
        root.removeEventListener('pointerdown', dismiss);
        window.removeEventListener('keydown', onKey);
        resolve();
      };
      const onKey = (e: KeyboardEvent): void => { if (e.key === ' ' || e.key === 'Enter') dismiss(); };
      // Arm dismissal only after the splash has animated in (so a stray click can't skip it).
      setTimeout(() => {
        root.addEventListener('pointerdown', dismiss);
        window.addEventListener('keydown', onKey);
      }, 500);
    });

  const done = (): Promise<void> => {
    if (donePromise) return donePromise;
    donePromise = (async () => {
      setProgress(1);
      const wait = minMs - (Date.now() - startedAt);
      if (wait > 0) await sleep(wait);
      if (features.length) await runFeatures(); // hold on the splash until the player continues
      root.classList.add('sp-done'); // fade the whole overlay out
      await sleep(520);
      remove();
    })();
    return donePromise;
  };

  return { el: root, setProgress, done, remove };
}
