// Cascade resolver — SERVER-side math (lives here only because the offline
// MockNetworkManager stands in for the server). Drops a seed die; each die's
// face is a fair d6 over its color's faces; a mystery face spawns N dice of a
// sampled color (the cascade). Accumulates winSum × multProduct, capped.
//
// The real game is served by the RGS emulator, which carries its own copy.

import { COLORS, SEED_COLORS } from '@/config/colors';
import type { CascadeDie, Face } from '@/domain/types';

const MAX_DICE = 36;
const CAP = 5000;
/** Color rarity (spawn weight) — how likely a mystery spawns each color. */
const SPAWN: Record<string, number> = { white: 45, green: 30, blue: 15, purple: 8, gold: 2 };
/** P(spawn count = n) for n = 1..6. */
const AMOUNT = [0.35, 0.28, 0.18, 0.1, 0.06, 0.03];

function sampleColor(): string {
  const total = SEED_COLORS.reduce((s, id) => s + (SPAWN[id] ?? 0), 0);
  let r = Math.random() * total;
  for (const id of SEED_COLORS) {
    r -= SPAWN[id] ?? 0;
    if (r <= 0) return id;
  }
  return 'white';
}

function sampleAmount(): number {
  let r = Math.random();
  for (let i = 0; i < 6; i++) {
    r -= AMOUNT[i]!;
    if (r <= 0) return i + 1;
  }
  return 1;
}

function sampleFace(color: string): Face {
  const faces = COLORS[color]?.faces ?? COLORS.white!.faces;
  return faces[Math.floor(Math.random() * 6)]!;
}

export interface CascadeResult {
  dice: CascadeDie[];
  multiplier: number;
}

export function resolveCascade(seed: string): CascadeResult {
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
  return { dice, multiplier };
}

export function randomSeed(): string {
  return SEED_COLORS[Math.floor(Math.random() * SEED_COLORS.length)]!;
}
