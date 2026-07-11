// @stakeplate/core/vite — a build helper so a game's index.html needs ZERO background setup
// and there's no black flash on first paint.
//
// The problem: the loader (and its backdrop) are created by JS, which only runs after the
// module bundle downloads + parses. Until then the page is blank/black. This plugin bakes a
// tiny BLURRED placeholder of the loader background straight INTO index.html at build time,
// so the very first paint — before any JS — already shows the (blurred) backdrop. The loader
// then fades its full-resolution image up over the same spot: a seamless blur-up, no flash.
//
//   import { stakeplateBoot } from '@stakeplate/core/vite';
//   export default defineConfig({ plugins: [stakeplateBoot({ background: 'src/art/bg.png' })] });
//
// The placeholder is a ~64px image (a few KB, base64-inlined — no extra request) under a CSS
// blur, generated with `sharp` if it's installed (add it as a devDependency for the blur-up).
// Without sharp it still injects the solid `backgroundColor`, so there is never a black flash —
// you just don't get the blurred image until the loader paints it.

import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

export interface StakeplateBootOptions {
  /** Path to the loader background image (the same one you pass to `loader.backgroundImage`),
   *  relative to the Vite project root (or absolute). PNG/JPEG/WebP — anything `sharp` reads. */
  background: string;
  /** Solid colour painted behind the placeholder (and the fallback when `sharp` is absent).
   *  Match `loader.background`. Default `#0b0d12`. */
  backgroundColor?: string;
  /** CSS blur radius (px) applied to the inlined placeholder. Default `28`. */
  blur?: number;
  /** Downscaled placeholder width (px) — smaller = tinier HTML. Default `64`. */
  size?: number;
}

/** A structural Vite `Plugin` (typed here so the core needn't depend on `vite`). */
export interface StakeplateBootPlugin {
  name: string;
  enforce: 'pre';
  configResolved(config: { root: string }): void;
  transformIndexHtml(html: string): Promise<{ html: string; tags: HtmlTag[] }>;
}
interface HtmlTag {
  tag: string;
  attrs?: Record<string, string>;
  children?: string;
  injectTo: 'head' | 'head-prepend' | 'body' | 'body-prepend';
}

/** Generate a tiny blurred base64 placeholder from the image, or `null` if `sharp` is absent. */
async function makeLqip(imgPath: string, size: number): Promise<string | null> {
  try {
    // Non-literal specifier so TS doesn't type-resolve the OPTIONAL `sharp` (games without it
    // still get the solid-colour fallback — never a black flash).
    const spec = 'sharp';
    const mod = (await import(spec)) as { default: (p: string) => SharpLike };
    const buf = await mod.default(imgPath).resize(size, null, { fit: 'inside' }).jpeg({ quality: 55 }).toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null; // sharp not installed / unreadable — caller falls back to the solid colour
  }
}
interface SharpLike {
  resize(w: number, h: null, o: { fit: 'inside' }): SharpLike;
  jpeg(o: { quality: number }): SharpLike;
  toBuffer(): Promise<Buffer>;
}

/**
 * Inline a blurred placeholder of the loader background into index.html so the first paint
 * shows the backdrop (no black flash), then the loader blurs its full image up over it.
 */
export function stakeplateBoot(options: StakeplateBootOptions): StakeplateBootPlugin {
  const color = options.backgroundColor ?? '#0b0d12';
  const blur = options.blur ?? 28;
  const size = options.size ?? 64;
  let root = process.cwd();

  return {
    name: 'stakeplate-boot',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    async transformIndexHtml(html) {
      const imgPath = isAbsolute(options.background) ? options.background : resolve(root, options.background);
      let lqip: string | null = null;
      try {
        await readFile(imgPath); // fail fast with a clear reason if the path is wrong
        lqip = await makeLqip(imgPath, size);
      } catch {
        lqip = null;
      }
      // `html { background }` guarantees no black even before the placeholder decodes; the
      // #sp-bootbg layer carries the blurred image (removed by the loader once it's done).
      const css = lqip
        ? `html{background:${color}}` +
          `#sp-bootbg{position:fixed;inset:0;z-index:0;background:${color} url("${lqip}") center/cover no-repeat;` +
          `filter:blur(${blur}px);transform:scale(1.08);pointer-events:none}`
        : `html{background:${color}}`;
      const tags: HtmlTag[] = [{ tag: 'style', attrs: { id: 'sp-boot-style' }, children: css, injectTo: 'head-prepend' }];
      if (lqip) tags.push({ tag: 'div', attrs: { id: 'sp-bootbg' }, injectTo: 'body-prepend' });
      return { html, tags };
    },
  };
}
