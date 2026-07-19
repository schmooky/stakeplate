#!/usr/bin/env node
/**
 * stakeplate-rules — the npx-runnable RULES DOCUMENT editor.
 *
 *   npx @stakeplate/rules-editor [rules.doc.json] [--facts facts.json] [--port 4977] [--no-open]
 *
 * Serves a local visual editor (drag blocks · edit interpolatable, localizable copy ·
 * live compliance audit) over ONE portable JSON file in the open-slot-ui RulesDoc
 * format. The game consumes the saved file with `applyRulesDoc(spec, doc)`.
 * Validation is the REAL library code (`auditRulesDoc` / `validateSpec` /
 * `factsVars` from @open-slot-ui/core) running server-side — what the editor
 * approves is exactly what the in-game info menu will accept.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { auditRulesDoc, validateSpec, factsVars, mergeFacts, isRulesDoc } from '@open-slot-ui/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);
if (has('--help') || has('-h')) {
  console.log(`stakeplate-rules — visual editor for open-slot-ui rules documents

Usage: npx @stakeplate/rules-editor [file] [options]

  file            the rules document to edit (default rules.doc.json; created if missing)
  --facts <file>  merge external game facts (JSON GameFacts) into the audit + tokens
  --port <n>      port to serve on (default 4977)
  --no-open       don't open the browser automatically`);
  process.exit(0);
}
const file = resolve(args.find((a) => !a.startsWith('--') && a !== flag('--facts') && a !== flag('--port')) ?? 'rules.doc.json');
const factsFile = flag('--facts') ? resolve(flag('--facts')) : undefined;
const port = Number(flag('--port')) || 4977;

// ── starter document (created when the file doesn't exist yet) ───────────────
const STARTER = {
  version: 1,
  facts: {
    modes: [
      { id: 'base', name: 'Base game', kind: 'base', rtp: 96.0, maxWinX: 5000 },
      { id: 'bonus', name: 'Bonus', kind: 'buy', cost: 100, rtp: 96.0, maxWinX: 5000 },
    ],
    freeSpins: { count: 10, retrigger: false },
    volatility: 'High',
    maxWinCapX: 5000,
  },
  // EVERY declared mode gets its OWN section (a heading naming it, or blocks tagged
  // `explains: '<modeId>'`) — the audit requires an explicit explanation per mode,
  // with the cost stated inside a feature's section.
  blocks: [
    { kind: 'heading', id: 'r-h-about', text: 'About the game' },
    { kind: 'text', id: 'r-about', text: 'The base game pays to an RTP of {{rtp.base}} with wins up to {{maxWin.base}} in a single round.' },
    { kind: 'heading', id: 'r-h-bonus', text: 'The Bonus' },
    { kind: 'text', id: 'r-bonus', text: 'Buy the **Bonus** for {{cost.bonus}} your bet. It awards exactly {{freeSpins.count}} free spins; free spins {{freeSpins.retrigger}} be retriggered.' },
    { kind: 'heading', id: 'r-h-controls', text: 'Controls' },
    { kind: 'steps', id: 'r-controls', ordered: false, items: [
      '**SPIN** — plays one round at the current bet.',
      '**− / +** — lower or raise your bet.',
      '**Menu (☰)** — opens settings, the paytable and these rules.',
    ] },
    { kind: 'mode-stats', id: 'r-stats' },
    { kind: 'legal', id: 'r-legal', text: 'Malfunction voids all wins and plays.' },
  ],
  messages: { en: {} },
};

// ── document IO ──────────────────────────────────────────────────────────────
function loadDoc() {
  if (!existsSync(file)) return { doc: STARTER, created: true };
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRulesDoc(doc)) throw new Error('not a RulesDoc (need { version: 1, blocks: [...] })');
    return { doc, created: false };
  } catch (e) {
    console.error(`✖ ${file}: ${e.message}`);
    process.exit(1);
  }
}
function saveDoc(doc) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  renameSync(tmp, file); // atomic-ish: never leave a half-written document
}
function externalFacts() {
  if (!factsFile) return undefined;
  try {
    return JSON.parse(readFileSync(factsFile, 'utf8'));
  } catch (e) {
    console.error(`⚠ --facts ${factsFile}: ${e.message} (ignored)`);
    return undefined;
  }
}

/** Everything the client needs to validate/render: real library results, one place. */
function analyze(doc, locale = 'en') {
  const ext = externalFacts();
  const facts = ext ? mergeFacts(doc.facts ?? {}, ext) : (doc.facts ?? {});
  const audit = auditRulesDoc(doc, { locale, facts: ext });
  const spec = validateSpec({ menu: { rules: doc.blocks }, facts });
  return { audit, specIssues: spec.issues, vars: factsVars(facts), facts };
}

// ── server ───────────────────────────────────────────────────────────────────
const html = readFileSync(join(__dirname, 'editor.html'), 'utf8');
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const body = (req) =>
  new Promise((done, fail) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        done(s ? JSON.parse(s) : {});
      } catch (e) {
        fail(e);
      }
    });
  });

const { doc: initialDoc, created } = loadDoc();
if (created) console.log(`• ${file} doesn't exist yet — starting from the template (saved on first Save)`);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (req.method === 'GET' && url.pathname === '/api/state') {
      const { doc } = loadDoc();
      json(res, 200, { path: file, doc, ...analyze(doc, url.searchParams.get('locale') ?? 'en') });
    } else if (req.method === 'POST' && url.pathname === '/api/audit') {
      const { doc, locale } = await body(req);
      if (!isRulesDoc(doc)) return json(res, 400, { error: 'not a RulesDoc' });
      json(res, 200, analyze(doc, locale ?? 'en'));
    } else if (req.method === 'POST' && url.pathname === '/api/save') {
      const { doc } = await body(req);
      if (!isRulesDoc(doc)) return json(res, 400, { error: 'not a RulesDoc' });
      saveDoc(doc);
      console.log(`✓ saved ${file}`);
      json(res, 200, { ok: true });
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(port, () => {
  const addr = `http://localhost:${port}`;
  console.log(`stakeplate-rules editing ${file}`);
  if (factsFile) console.log(`  external facts: ${factsFile}`);
  console.log(`  ${addr}`);
  if (!has('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(cmd, [addr], { shell: process.platform === 'win32', stdio: 'ignore', detached: true }).unref();
  }
});
