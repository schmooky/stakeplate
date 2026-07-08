// Dice colors + face sets — the visual spec the renderer uses to texture each
// die. The SERVER decides which face lands up; the client fills the other five
// faces from the same color's set. (The server carries its own copy for the
// math; these must agree on the face VALUES per color.)

import type { Face } from '@/domain/types';

const B: Face = { kind: 'blank' };
const P = (v: number): Face => ({ kind: 'pay', v });
const MY: Face = { kind: 'mystery' };
const X = (k: number): Face => ({ kind: 'mult', k });

export interface ColorSpec {
  hex: string;
  faces: Face[]; // exactly 6
}

export const COLORS: Record<string, ColorSpec> = {
  white: { hex: '#e8e6df', faces: [B, P(0.2), MY, P(0.5), B, P(1)] },
  green: { hex: '#5fb87a', faces: [P(0.5), MY, P(1), B, P(2), MY] },
  blue: { hex: '#4aa3e0', faces: [P(1), P(2), MY, P(5), X(2), B] },
  purple: { hex: '#9b7ff0', faces: [P(2), P(5), MY, P(10), X(2), P(25)] },
  gold: { hex: '#e6b34a', faces: [P(25), P(50), P(100), X(2), P(200), MY] },
};

export const SEED_COLORS = ['white', 'green', 'blue', 'purple', 'gold'] as const;

/** Two faces are equal (used when arranging the non-up faces on a die). */
export function faceEq(a: Face, b: Face): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'pay' && b.kind === 'pay') return a.v === b.v;
  if (a.kind === 'mult' && b.kind === 'mult') return a.k === b.k;
  return true;
}
