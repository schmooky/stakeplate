#!/usr/bin/env node
// create-stakeplate — scaffolds a Stake Engine slot game on @stakeplate/core.
//   npm create stakeplate@latest my-game
//   pnpm create stakeplate my-game
// Zero dependencies (Node built-ins only). Copies `template/` → the target dir, substitutes
// the project name, and prints next steps.

import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = join(here, 'template');

// Minimal ANSI (no deps). Disabled when not a TTY / NO_COLOR.
const useColor = stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `[${code}m${s}[0m` : s);
const bold = c('1'), dim = c('2'), green = c('32'), cyan = c('36'), red = c('31'), yellow = c('33');

function packageManager() {
  const ua = process.env.npm_config_user_agent || '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

/** npm-safe package name from a directory name. */
function sanitizeName(input) {
  const n = input
    .trim()
    .toLowerCase()
    .replace(/^[._]+/, '')
    .replace(/[^a-z0-9-~]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return n || 'stake-game';
}

async function copyDir(src, dest, name) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d, name);
    } else {
      const content = (await readFile(s, 'utf8')).replaceAll('{{name}}', name);
      await writeFile(d, content);
    }
  }
}

function printHelp() {
  console.log(`
${bold('create-stakeplate')} — scaffold a Stake Engine slot on @stakeplate/core

${bold('Usage')}
  npm create stakeplate@latest ${cyan('<dir>')}
  pnpm create stakeplate ${cyan('<dir>')}

${bold('Options')}
  -y, --yes     Skip the prompt (use the given dir, or "stake-game")
  -h, --help    Show this help
`);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { yes: { type: 'boolean', short: 'y' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) return printHelp();

  let target = positionals[0];
  if (!target && !values.yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    target = (await rl.question(`${bold('Project directory')} ${dim('(stake-game)')}: `)).trim();
    rl.close();
  }
  target = target || 'stake-game';

  const dir = resolve(process.cwd(), target);
  const name = sanitizeName(basename(dir));

  if (existsSync(dir) && (await readdir(dir).catch(() => [])).length > 0) {
    console.error(red(`\n✖ ${target} already exists and is not empty. Choose another directory.\n`));
    process.exit(1);
  }

  console.log(`\n${dim('Scaffolding')} ${bold(name)} ${dim('in')} ${target}${dim('…')}`);
  await copyDir(templateDir, dir, name);
  // npm strips a published .gitignore, so the template ships it as _gitignore.
  if (existsSync(join(dir, '_gitignore'))) await rename(join(dir, '_gitignore'), join(dir, '.gitignore'));

  const pm = packageManager();
  const run = pm === 'npm' ? 'npm run' : pm;
  const rel = target === '.' ? '' : `  cd ${target}\n`;
  console.log(`
${green('✔ Done!')} Your compliant Stake game is ready.

${bold('Next steps')}
${rel}  ${pm} install
  ${run} dev        ${dim('# open the preview + spin')}

${bold('What you got')}
  ${dim('•')} A working slot booting on a local mock RGS (delete ${cyan('src/demoNetwork.ts')} for prod)
  ${dim('•')} ${cyan('src/main.ts')}   — the whole game: config + interpretBook + Present phase
  ${dim('•')} ${cyan('src/Scene.ts')}  — your pixi scene (swap the emoji for pixi-reels + art)
  ${dim('•')} The open-slot-ui HUD, currency, jurisdiction, replay + audio — all from the core

${dim('Docs: https://github.com/schmooky/stakeplate')}
`);
}

main().catch((err) => {
  console.error(red(`\n✖ ${err?.message || err}\n`));
  process.exit(1);
});
