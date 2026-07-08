/**
 * Procedural cascade resolver for Dice Cascade.
 *
 * Drops a seed die; each die's face is a fair d6 over its colour's faces; a
 * mystery face spawns N dice of a sampled colour (the cascade), accumulating
 * winSum × multProduct, capped. Outcomes generated here (local-dev emulator),
 * so RTP is illustrative, not certified.
 */

import { BOOK_AMOUNT_MULTIPLIER } from '@lucky-magnet/stake-protocol';

type Face =
  | { kind: 'blank' }
  | { kind: 'pay'; v: number }
  | { kind: 'mult'; k: number }
  | { kind: 'mystery' };

interface CascadeDie { color: string; face: Face; parent: number }

const B: Face = { kind: 'blank' };
const P = (v: number): Face => ({ kind: 'pay', v });
const MY: Face = { kind: 'mystery' };
const X = (k: number): Face => ({ kind: 'mult', k });

const COLORS: Record<string, { faces: Face[] }> = {
  white: { faces: [B, P(0.2), MY, P(0.5), B, P(1)] },
  green: { faces: [P(0.5), MY, P(1), B, P(2), MY] },
  blue: { faces: [P(1), P(2), MY, P(5), X(2), B] },
  purple: { faces: [P(2), P(5), MY, P(10), X(2), P(25)] },
  gold: { faces: [P(25), P(50), P(100), X(2), P(200), MY] },
};
const SEED_COLORS = ['white', 'green', 'blue', 'purple', 'gold'];
const SPAWN: Record<string, number> = { white: 45, green: 30, blue: 15, purple: 8, gold: 2 };
const AMOUNT = [0.35, 0.28, 0.18, 0.1, 0.06, 0.03];
const MAX_DICE = 36;
const CAP = 5000;

function sampleColor(): string {
  const total = SEED_COLORS.reduce((s, id) => s + (SPAWN[id] ?? 0), 0);
  let r = Math.random() * total;
  for (const id of SEED_COLORS) { r -= SPAWN[id] ?? 0; if (r <= 0) return id; }
  return 'white';
}
function sampleAmount(): number {
  let r = Math.random();
  for (let i = 0; i < 6; i++) { r -= AMOUNT[i]!; if (r <= 0) return i + 1; }
  return 1;
}
function sampleFace(color: string): Face {
  const faces = COLORS[color]?.faces ?? COLORS.white!.faces;
  return faces[Math.floor(Math.random() * 6)]!;
}

export interface DiceBook {
  id: number;
  payoutMultiplier: number; // BOOK units
  events: Array<Record<string, unknown>>;
}

export function genBook(seedRaw: string): DiceBook {
  const seed = SEED_COLORS.includes(seedRaw) ? seedRaw : 'white';
  const dice: CascadeDie[] = [];
  const queue: Array<{ color: string; parent: number }> = [{ color: seed, parent: -1 }];
  let winSum = 0;
  let multProduct = 1;

  while (queue.length && dice.length < MAX_DICE) {
    const { color, parent } = queue.shift()!;
    const face = sampleFace(color);
    const idx = dice.length;
    dice.push({ color, face, parent });
    if (face.kind === 'pay') winSum += face.v;
    else if (face.kind === 'mult') multProduct *= face.k;
    else if (face.kind === 'mystery') {
      const c = sampleColor();
      const n = sampleAmount();
      for (let i = 0; i < n && dice.length + queue.length < MAX_DICE; i++) queue.push({ color: c, parent: idx });
    }
  }

  const multiplier = Math.min(winSum * multProduct, CAP);
  const payoutMultiplier = Math.round(multiplier * BOOK_AMOUNT_MULTIPLIER);
  const events: Array<Record<string, unknown>> = [
    { index: 0, type: 'cascade', dice, multiplier },
    { index: 1, type: 'finalWin', amount: payoutMultiplier },
  ];
  return { id: 0, payoutMultiplier, events };
}
