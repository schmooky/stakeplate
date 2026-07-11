// A configurable boot loader — the "LOADING…" screen every game otherwise hand-rolls in
// its index.html. `createStakeGame({ loader })` shows it the instant boot starts, advances
// its progress bar across the boot milestones (init → auth → HUD → view), then fills it to
// 100%, holds briefly (so it reads even on an instant load), and pops + cross-dissolves
// away to reveal the game. Pure DOM + CSS — it paints before pixi/zvuk ever load, and it's
// removed from the document when done.
//
// Everything is optional and easy to theme: a pulsating logo (or a CSS ring spinner),
// a title/subtitle, a solid colour and/or a cover image (blurred, with a vignette) that
// matches the game background so the reveal is seamless, and an accent colour for the bar.

let seq = 0;

export interface LoaderConfig {
  /** Big title under the logo. Defaults to the game title. */
  title?: string;
  /** Small line under the title. */
  subtitle?: string;
  /** URL/data-URI of a logo image that gently pulses. Omit for a CSS ring spinner. */
  logo?: string;
  /** Solid colour behind everything. Default `#0b0d12`. */
  background?: string;
  /** Optional cover image (ideally the game's own backdrop, for a seamless reveal). */
  backgroundImage?: string;
  /** Blur the cover image. Default `true`. */
  blur?: boolean;
  /** Accent colour — progress fill + title glow. Default `#d99000`. */
  accent?: string;
  /** Minimum time the loader stays up, so the bar always fills. Default `1200`ms. */
  minDurationMs?: number;
  /** Stacking order. Default a very high value so it sits over the game. */
  zIndex?: number;
  /**
   * If `true`, the core shows the loader + advances progress but does NOT auto-hide it —
   * the game calls `ctx.loader.done()` itself (e.g. after its scene finishes loading art).
   * Default `false` (hidden automatically once boot completes).
   */
  manual?: boolean;
}

export interface GameLoader {
  /** The overlay element (already in the document). */
  readonly el: HTMLElement;
  /** Drive the progress bar. Clamped to the range it has already reached (never goes back). */
  setProgress(p: number): void;
  /** Fill to 100%, honour `minDurationMs`, pop + fade, then remove. Idempotent — the first
   *  call wins and later calls return the same promise. */
  done(): Promise<void>;
  /** Remove immediately without the outro (used on a boot error). */
  remove(): void;
}

const isBrowser = (): boolean => typeof document !== 'undefined' && !!document.body;

/** Create + mount the loader overlay. Safe to call before anything else in boot. */
export function createLoader(config: LoaderConfig = {}): GameLoader {
  const startedAt = Date.now();
  const minMs = config.minDurationMs ?? 1200;
  const accent = config.accent ?? '#d99000';
  const bg = config.background ?? '#0b0d12';
  const z = config.zIndex ?? 2147483000;
  const blur = config.blur ?? true;
  let progress = 0;
  let donePromise: Promise<void> | null = null;

  // Headless / SSR guard — return a no-op handle so callers needn't branch.
  if (!isBrowser()) {
    const noop = { el: null as unknown as HTMLElement, setProgress() {}, done: () => Promise.resolve(), remove() {} };
    return noop;
  }

  const id = `sp-loader-${++seq}`;
  const root = document.createElement('div');
  root.id = id;
  root.className = 'sp-loader';

  const style = document.createElement('style');
  style.textContent = `
    #${id}{position:fixed;inset:0;z-index:${z};display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:22px;background:${bg};
      font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
      opacity:1;transition:opacity .45s ease;overflow:hidden}
    #${id}.sp-done{opacity:0}
    #${id} .sp-bgimg{position:absolute;inset:-8%;background-position:center;background-size:cover;
      ${blur ? 'filter:blur(6px);' : ''}transform:scale(1.06)}
    #${id} .sp-vign{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 42%,transparent 40%,rgba(0,0,0,.6) 100%)}
    #${id} .sp-stack{position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;
      transition:transform .4s cubic-bezier(.34,1.56,.64,1),opacity .4s ease}
    #${id}.sp-done .sp-stack{transform:scale(1.12);opacity:0}
    #${id} .sp-logo{width:min(38vw,180px);height:auto;filter:drop-shadow(0 14px 22px rgba(0,0,0,.5));
      animation:sp-pulse 1.4s ease-in-out infinite}
    #${id} .sp-spin{width:64px;height:64px;border-radius:50%;border:5px solid rgba(255,255,255,.18);
      border-top-color:${accent};animation:sp-rot .8s linear infinite}
    #${id} .sp-title{margin:0;color:#fff;font-weight:800;letter-spacing:.02em;
      font-size:clamp(22px,4vw,40px);text-align:center;text-shadow:0 3px 10px rgba(0,0,0,.55),0 0 22px ${accent}55}
    #${id} .sp-sub{margin:0;color:#ffffffcc;font-size:clamp(12px,2vw,16px);text-align:center;
      text-shadow:0 2px 6px rgba(0,0,0,.5)}
    #${id} .sp-bar{position:relative;width:min(60vw,260px);height:8px;border-radius:99px;
      background:rgba(255,255,255,.16);overflow:hidden}
    #${id} .sp-fill{position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:99px;
      background:${accent};transition:width .35s ease}
    @keyframes sp-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
    @keyframes sp-rot{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){#${id} .sp-logo,#${id} .sp-spin{animation:none}}
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

  const stack = document.createElement('div');
  stack.className = 'sp-stack';
  if (config.logo) {
    const logo = document.createElement('img');
    logo.className = 'sp-logo';
    logo.src = config.logo;
    logo.alt = '';
    stack.appendChild(logo);
  } else {
    const spin = document.createElement('div');
    spin.className = 'sp-spin';
    stack.appendChild(spin);
  }
  if (config.title) {
    const h = document.createElement('h1');
    h.className = 'sp-title';
    h.textContent = config.title;
    stack.appendChild(h);
  }
  if (config.subtitle) {
    const p = document.createElement('p');
    p.className = 'sp-sub';
    p.textContent = config.subtitle;
    stack.appendChild(p);
  }
  const bar = document.createElement('div');
  bar.className = 'sp-bar';
  const fill = document.createElement('div');
  fill.className = 'sp-fill';
  bar.appendChild(fill);
  stack.appendChild(bar);

  root.appendChild(style);
  root.appendChild(stack);
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

  const done = (): Promise<void> => {
    if (donePromise) return donePromise;
    donePromise = (async () => {
      setProgress(1);
      const wait = minMs - (Date.now() - startedAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      root.classList.add('sp-done'); // pop the stack + fade the overlay
      await new Promise((r) => setTimeout(r, 480)); // let the .45s transition finish
      remove();
    })();
    return donePromise;
  };

  return { el: root, setProgress, done, remove };
}
