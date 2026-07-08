/**
 * Loads the math-sdk's generated publish_files (index.json + lookUpTable + books)
 * and provides a weighted outcome draw — exactly what the Carrot RGS does at runtime.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decompress } from 'fzstd';
import type { Book } from '@lucky-magnet/stake-protocol';

export interface ModeData {
  name: string;
  cost: number;
  books: Map<number, Book>;
  ids: number[]; // simulation id per lookup-table row
  cum: Float64Array; // cumulative weight, parallel to ids
  total: number; // total weight
}

export interface Library {
  gameID: string;
  rtp: number;
  modes: Map<string, ModeData>;
}

interface IndexFile {
  // The real Stake manifest is just { modes }. gameID/rtp are optional extras.
  gameID?: string;
  rtp?: number;
  modes: Array<{ name: string; cost: number; events: string; weights: string }>;
}

export function loadLibrary(dir: string): Library {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexFile;
  const modes = new Map<string, ModeData>();
  let weightedPayout = 0;
  let totalWeight = 0;

  for (const m of index.modes) {
    // Books: decompress the .jsonl.zst and index by id.
    const compressed = readFileSync(join(dir, m.events));
    const text = new TextDecoder().decode(decompress(new Uint8Array(compressed)));
    const books = new Map<number, Book>();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const book = JSON.parse(line) as Book;
      books.set(book.id, book);
    }

    // Lookup table rows: simId, weight, payoutMultiplier.
    const lut = readFileSync(join(dir, m.weights), 'utf8');
    const ids: number[] = [];
    const weights: number[] = [];
    for (const line of lut.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.split(',');
      ids.push(Number(cols[0]));
      weights.push(Number(cols[1]));
      weightedPayout += Number(cols[1]) * Number(cols[2]); // weight * payoutMultiplier (book units)
      totalWeight += Number(cols[1]);
    }
    const cum = new Float64Array(weights.length);
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i] ?? 0;
      cum[i] = acc;
    }

    modes.set(m.name, { name: m.name, cost: m.cost, books, ids, cum, total: acc });
    console.log(`[rgs] mode "${m.name}": ${books.size} books, ${ids.length} lookup rows`);
  }

  // The real manifest omits gameID/rtp; default them (rtp computed from weights).
  const rtp = index.rtp ?? (totalWeight ? weightedPayout / totalWeight / 100 : 0);
  return { gameID: index.gameID ?? 'lucky_magnet', rtp, modes };
}

/** Weighted-random draw of a pre-generated outcome (binary search over cumulative weights). */
export function drawBook(mode: ModeData): Book {
  const r = Math.random() * mode.total;
  let lo = 0;
  let hi = mode.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((mode.cum[mid] ?? 0) < r) lo = mid + 1;
    else hi = mid;
  }
  const id = mode.ids[lo] ?? mode.ids[0]!;
  const book = mode.books.get(id);
  if (!book) throw new Error(`[rgs] drawn simulation id ${id} has no book`);
  return book;
}
