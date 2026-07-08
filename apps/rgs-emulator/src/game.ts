/**
 * Procedural outcome generator for the "Vortex Digits" game.
 *
 * The board is 3×3 of a blank DOT or a digit D0–D9. A win is a run of ≥2
 * CONSECUTIVE digits on one of the 5 lines (3 columns + 2 diagonals) that forms a
 * number with no leading zero — you "win the number". The VORTEX feature fills a
 * full column with random digits, so a number is near-guaranteed on that column:
 *
 *   - mode "base"   → a vortex spawns at random (BASE_VORTEX_CHANCE).
 *   - mode "vortex" → a vortex is guaranteed every spin (the paid ante).
 *
 * This is a local-dev emulator: outcomes are generated here in TS rather than
 * served from math-sdk books, so the RTP is illustrative, not certified. The
 * client never knows the difference — it renders the same book events.
 */

import { BOOK_AMOUNT_MULTIPLIER, type BoardCell, type Book, type BookEvent, type WinEntry } from '@lucky-magnet/stake-protocol';

const COLS = 3;
const ROWS = 3;

/** Per-cell base-game digit chance (each of the 10 digits is equally likely). */
const DIGIT_CHANCE = Number(process.env.RGS_DIGIT_CHANCE ?? 0.1);
/** Base mode: chance a free vortex spawns on a spin. */
export const BASE_VORTEX_CHANCE = Number(process.env.RGS_BASE_VORTEX_CHANCE ?? 0.12);

/** Pay table by length of the number formed (× stake). */
const PAY_BY_LEN: Record<number, number> = { 2: 2, 3: 10 };

/** The 5 win lines as ordered [reel,row] cells (3 columns + 2 diagonals).
 *  A column is one reel read top→bottom; the vortex fills one of these. */
const LINES: Array<Array<[number, number]>> = [
  [[0, 0], [0, 1], [0, 2]], // column 0
  [[1, 0], [1, 1], [1, 2]], // column 1
  [[2, 0], [2, 1], [2, 2]], // column 2
  [[0, 0], [1, 1], [2, 2]], // diagonal ↘
  [[0, 2], [1, 1], [2, 0]], // diagonal ↗
];

const randInt = (n: number): number => Math.floor(Math.random() * n);
const randDigit = (): string => `D${randInt(10)}`;

/** One board cell: a digit with DIGIT_CHANCE, otherwise a blank DOT. */
function randomCell(): string {
  return Math.random() < DIGIT_CHANCE ? randDigit() : 'DOT';
}

/** Numeric value of a digit symbol id ("D7" → 7), or null for a DOT/anything else. */
function digitValue(name: string): number | null {
  return /^D[0-9]$/.test(name) ? Number(name.slice(1)) : null;
}

/**
 * Evaluate one line: find the longest run of consecutive digits, strip any
 * leading zeros, and (if ≥2 digits remain) score it as that number. Returns the
 * win or null.
 */
function evalLine(
  board: string[][],
  cells: Array<[number, number]>,
  lineIndex: number,
): WinEntry | null {
  // Walk the line collecting maximal runs of digit cells.
  let best: { value: number; cells: Array<[number, number]> } | null = null;
  let run: Array<{ v: number; pos: [number, number] }> = [];
  const flush = (): void => {
    // Strip leading zeros (a number can't start with 0), need ≥2 digits left.
    let i = 0;
    while (i < run.length && run[i]!.v === 0) i++;
    const kept = run.slice(i);
    if (kept.length >= 2) {
      const value = Number(kept.map((d) => d.v).join(''));
      if (!best || value > best.value) best = { value, cells: kept.map((d) => d.pos) };
    }
    run = [];
  };
  for (const [reel, row] of cells) {
    const v = digitValue(board[reel]![row]!);
    if (v === null) flush();
    else run.push({ v, pos: [reel, row] });
  }
  flush();
  if (!best) return null;

  const len = (best as { value: number; cells: Array<[number, number]> }).cells.length;
  const bestVal = (best as { value: number; cells: Array<[number, number]> }).value;
  const bestCells = (best as { value: number; cells: Array<[number, number]> }).cells;
  const mult = PAY_BY_LEN[len] ?? 0;
  if (mult <= 0) return null;
  return {
    symbol: `D${bestCells[0]![0]}`, // nominal — the win is the number, not a symbol
    kind: 'line',
    win: Math.round(mult * BOOK_AMOUNT_MULTIPLIER),
    positions: bestCells.map(([reel, row]) => ({ reel, row })),
    meta: { winWithoutMult: Math.round(mult * BOOK_AMOUNT_MULTIPLIER), lineIndex, number: bestVal },
  };
}

/** Generate a book (ordered events + payout) for one spin in the given mode. */
export function genBook(mode: string): Book {
  // 1) Random board.
  const board: string[][] = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, randomCell));

  // 2) Vortex: guaranteed in "vortex" mode, random in "base". Fills a full
  //    COLUMN (one reel, top→bottom) with digits so its number is near-certain.
  const vortex = mode === 'vortex' || Math.random() < BASE_VORTEX_CHANCE;
  let vortexCol: number | null = null;
  if (vortex) {
    vortexCol = randInt(COLS);
    for (let row = 0; row < ROWS; row++) board[vortexCol]![row] = randDigit();
  }

  // 3) Score every line.
  const wins: WinEntry[] = [];
  let totalMult = 0;
  for (let i = 0; i < LINES.length; i++) {
    const w = evalLine(board, LINES[i]!, i);
    if (w) {
      wins.push(w);
      totalMult += w.win / BOOK_AMOUNT_MULTIPLIER;
    }
  }
  const payoutMultiplier = Math.round(totalMult * BOOK_AMOUNT_MULTIPLIER);

  // 4) Build the ordered book events.
  const boardCells: BoardCell[][] = board.map((reel) => reel.map((name) => ({ name })));
  const events: BookEvent[] = [];
  let index = 0;
  events.push({ index: index++, type: 'reveal', board: boardCells, paddingPositions: [0, 0, 0], gameType: 'basegame', anticipation: [0, 0, 0] });
  if (vortexCol !== null) events.push({ index: index++, type: 'vortex', col: vortexCol });
  if (wins.length) events.push({ index: index++, type: 'winInfo', totalWin: payoutMultiplier, wins });
  events.push({ index: index++, type: 'finalWin', amount: payoutMultiplier });

  return { id: 0, payoutMultiplier, events };
}
