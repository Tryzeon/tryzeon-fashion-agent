import type { BodyProfile, Category, FitStyle, Product, Size } from './types.js';

type Measure = 'chestCm' | 'waistCm' | 'hipCm';
type Range = readonly [number, number];
type SizeTable = Record<Size, Record<Measure, Range>>;

const WOMEN: SizeTable = {
  XS: { chestCm: [76, 81], waistCm: [58, 63], hipCm: [84, 89] },
  S: { chestCm: [81, 86], waistCm: [63, 68], hipCm: [89, 94] },
  M: { chestCm: [86, 91], waistCm: [68, 73], hipCm: [94, 99] },
  L: { chestCm: [91, 97], waistCm: [73, 79], hipCm: [99, 105] },
  XL: { chestCm: [97, 103], waistCm: [79, 85], hipCm: [105, 111] },
};

const MEN: SizeTable = {
  XS: { chestCm: [82, 87], waistCm: [68, 73], hipCm: [84, 89] },
  S: { chestCm: [87, 92], waistCm: [73, 78], hipCm: [89, 94] },
  M: { chestCm: [92, 98], waistCm: [78, 84], hipCm: [94, 100] },
  L: { chestCm: [98, 104], waistCm: [84, 90], hipCm: [100, 106] },
  XL: { chestCm: [104, 110], waistCm: [90, 96], hipCm: [106, 112] },
};

const EASE: Record<FitStyle, number> = { slim: -1, regular: 0, relaxed: 3, oversized: 6 };

const MEASURES: Partial<Record<Category, Measure[]>> = {
  top: ['chestCm'],
  outerwear: ['chestCm'],
  bottom: ['waistCm', 'hipCm'],
};

const TOLERANCE_CM = 2;

export type Verdict = 'fits' | 'borderline' | 'no';

export interface SizeCheck {
  size: Size;
  verdict: Verdict;
  notes: string[];
  distance: number;
}

export type FitResult =
  | { sizeSensitive: false }
  | { sizeSensitive: true; recommended: Size | null; verdict: Verdict; checks: SizeCheck[] };

function label(measure: Measure): string {
  return measure.replace('Cm', '');
}

function checkSize(table: SizeTable, size: Size, measures: Measure[], ease: number, body: BodyProfile): SizeCheck {
  const notes: string[] = [];
  let verdict: Verdict = 'fits';
  let distance = 0;
  for (const measure of measures) {
    const [min, max] = table[size][measure];
    const value = body[measure];
    distance += Math.abs(value - (min + max) / 2);
    const upper = max + ease;
    if (value >= min && value <= upper) continue;
    const gap = value < min ? min - value : value - upper;
    const direction = value < min ? 'loose' : 'tight';
    if (gap <= TOLERANCE_CM) {
      if (verdict === 'fits') verdict = 'borderline';
      notes.push(`${label(measure)} ${value}cm is slightly ${direction} (${min}–${upper}cm)`);
    } else {
      verdict = 'no';
      notes.push(`${label(measure)} ${value}cm is too ${direction} (${min}–${upper}cm)`);
    }
  }
  if (verdict === 'fits') {
    notes.push(measures.map((m) => `${label(m)} ${body[m]}cm within ${table[size][m][0]}–${table[size][m][1] + ease}cm`).join(', '));
  }
  return { size, verdict, notes, distance };
}

const RANK: Record<Verdict, number> = { fits: 0, borderline: 1, no: 2 };

export function checkFit(product: Product, body: BodyProfile): FitResult {
  const measures = MEASURES[product.category];
  if (!measures) return { sizeSensitive: false };
  const table = product.gender === 'women' ? WOMEN : product.gender === 'men' ? MEN : body.gender === 'women' ? WOMEN : MEN;
  const checks = product.sizes.map((size) => checkSize(table, size, measures, EASE[product.fit], body));
  const best = [...checks].sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || a.distance - b.distance)[0];
  if (!best || best.verdict === 'no') return { sizeSensitive: true, recommended: null, verdict: 'no', checks };
  return { sizeSensitive: true, recommended: best.size, verdict: best.verdict, checks };
}
