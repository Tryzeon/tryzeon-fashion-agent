import { readFileSync, writeFileSync } from 'node:fs';
import { POST as agent } from '../api/agent.js';
import { POST as tryon } from '../api/tryon.js';
import { checkFit } from '../shared/fit.js';
import type { AgentEvent, Outfit, TryonEvent } from '../shared/protocol.js';
import type { BodyProfile, Catalog } from '../shared/types.js';

const catalog = JSON.parse(readFileSync('shared/catalog.json', 'utf8')) as Catalog;

const SHOPPERS: Record<string, { photo: string; profile: BodyProfile }> = {
  mina: { photo: 'public/demo/shopper-mina.webp', profile: { gender: 'women', heightCm: 163, chestCm: 84, waistCm: 66, hipCm: 91 } },
  leo: { photo: 'public/demo/shopper-leo.webp', profile: { gender: 'men', heightCm: 178, chestCm: 96, waistCm: 81, hipCm: 97 } },
};

interface AgentCase {
  shopper: keyof typeof SHOPPERS;
  text: string;
  expect: { minWarmth?: number; brand?: string; maxTotal?: number; mustInclude?: string[] };
}

const AGENT_CASES: AgentCase[] = [
  { shopper: 'mina', text: 'Seoul next week, around 0°C. Cozy street style.', expect: { minWarmth: 4 } },
  { shopper: 'mina', text: 'Client dinner in Taipei, rainy 14°C. Smart and minimal.', expect: {} },
  { shopper: 'mina', text: 'Weekend hike then coffee. Practical but cute.', expect: {} },
  { shopper: 'mina', text: 'Office outfit only from Atelier Lune, please.', expect: { brand: 'lune' } },
  { shopper: 'mina', text: 'Full winter outfit under $600 total.', expect: { maxTotal: 600 } },
  { shopper: 'leo', text: 'Ski trip in Hokkaido, -5°C. Keep me warm.', expect: { minWarmth: 4 } },
  { shopper: 'leo', text: 'Smart casual for a gallery opening in December.', expect: {} },
  { shopper: 'leo', text: 'Streetwear look for Hongdae on a cold night.', expect: { minWarmth: 3 } },
  { shopper: 'leo', text: 'I want a wool overcoat look for work. Build around a navy coat.', expect: { mustInclude: ['outerwear'] } },
  { shopper: 'leo', text: 'Outfit with a beanie and boots for snowy weather.', expect: { mustInclude: ['accessory', 'shoes'] } },
];

async function* events<T>(response: Response): AsyncIterable<T> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      yield JSON.parse(buffer.slice(0, i)) as T;
      buffer = buffer.slice(i + 1);
    }
  }
}

const product = (id: string) => catalog.products.find((p) => p.id === id)!;

async function runAgentCase(c: AgentCase) {
  const started = Date.now();
  const profile = SHOPPERS[c.shopper]!.profile;
  let outfit: Outfit | null = null;
  let rejections = 0;
  let toolCalls = 0;
  const request = new Request('http://eval/api/agent', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', text: c.text }], profile, currentOutfit: null }),
  });
  for await (const e of events<AgentEvent>(await agent(request))) {
    if (e.type === 'tool_call') toolCalls += 1;
    if (e.type === 'tool_result' && e.name === 'propose_outfit' && !e.ok) rejections += 1;
    if (e.type === 'outfit') outfit = e.outfit;
  }
  const seconds = (Date.now() - started) / 1000;
  const items = outfit?.items.map((i) => product(i.productId)) ?? [];
  const fitsBody = items.every((p) => {
    const fit = checkFit(p, profile);
    return !fit.sizeSensitive || fit.verdict !== 'no';
  });
  const constraints: boolean[] = [];
  if (c.expect.minWarmth) {
    const outer = items.filter((p) => p.category === 'outerwear' || p.category === 'top');
    constraints.push(outer.some((p) => p.warmth >= c.expect.minWarmth!));
  }
  if (c.expect.brand) constraints.push(items.filter((p) => p.category !== 'accessory').every((p) => p.brandId === c.expect.brand));
  if (c.expect.maxTotal) constraints.push(items.reduce((s, p) => s + p.price, 0) <= c.expect.maxTotal);
  if (c.expect.mustInclude) constraints.push(c.expect.mustInclude.every((cat) => items.some((p) => p.category === cat)));
  return {
    text: c.text,
    shopper: c.shopper,
    outfit: Boolean(outfit),
    fitsBody,
    constraintsMet: constraints.every(Boolean),
    rejections,
    toolCalls,
    seconds,
    items: items.map((p) => p.id),
  };
}

async function runTryonCase(shopper: keyof typeof SHOPPERS, productIds: string[]) {
  const started = Date.now();
  const photo = `data:image/webp;base64,${readFileSync(SHOPPERS[shopper]!.photo).toString('base64')}`;
  const verifications: boolean[] = [];
  let firstImageAt = 0;
  let final: Extract<TryonEvent, { type: 'final' }> | null = null;
  const request = new Request('http://eval/api/tryon', {
    method: 'POST',
    body: JSON.stringify({ personImage: photo, productIds, previous: null }),
  });
  for await (const e of events<TryonEvent>(await tryon(request))) {
    if (e.type === 'image' && !firstImageAt) firstImageAt = Date.now();
    if (e.type === 'verification') verifications.push(e.verification.passed);
    if (e.type === 'final') final = e;
    if (e.type === 'error') throw new Error(e.message);
  }
  return {
    shopper,
    productIds,
    firstPass: verifications[0] ?? false,
    finalPass: final?.verified ?? false,
    attempts: verifications.length,
    firstImageSeconds: (firstImageAt - started) / 1000,
    totalSeconds: (Date.now() - started) / 1000,
  };
}

async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const queue = items.map((item, index) => ({ item, index }));
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          results[next.index] = await worker(next.item);
        } catch (error) {
          console.error('case failed', error);
        }
      }
    }),
  );
  return results;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0;
};

const agentResults = (await pool(AGENT_CASES, 4, runAgentCase)).filter(Boolean);
console.table(agentResults.map(({ items: _items, ...r }) => r));

const tryonCases = agentResults.filter((r) => r.outfit).map((r) => [r.shopper, r.items] as const);
const tryonResults = (await pool(tryonCases, 3, ([s, ids]) => runTryonCase(s, ids))).filter(Boolean);
console.table(tryonResults.map(({ productIds: _ids, ...r }) => r));

const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(d, 1))}%`;
const summary = {
  date: new Date().toISOString(),
  agent: {
    cases: agentResults.length,
    validOutfit: pct(agentResults.filter((r) => r.outfit).length, agentResults.length),
    fitsBody: pct(agentResults.filter((r) => r.outfit && r.fitsBody).length, agentResults.length),
    constraintsMet: pct(agentResults.filter((r) => r.outfit && r.constraintsMet).length, agentResults.length),
    proposalsRejectedByValidator: agentResults.reduce((s, r) => s + r.rejections, 0),
    medianToolCalls: median(agentResults.map((r) => r.toolCalls)),
    medianSeconds: median(agentResults.map((r) => r.seconds)),
  },
  tryon: {
    cases: tryonResults.length,
    passOnFirstRender: pct(tryonResults.filter((r) => r.firstPass).length, tryonResults.length),
    passAfterSelfCheck: pct(tryonResults.filter((r) => r.finalPass).length, tryonResults.length),
    medianAttempts: median(tryonResults.map((r) => r.attempts)),
    medianFirstImageSeconds: median(tryonResults.map((r) => r.firstImageSeconds)),
    medianTotalSeconds: median(tryonResults.map((r) => r.totalSeconds)),
  },
};
console.log(JSON.stringify(summary, null, 2));
writeFileSync('eval/results.json', `${JSON.stringify({ summary, agentResults, tryonResults }, null, 2)}\n`);
