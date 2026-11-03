import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { POST as agent } from '../api/agent.js';
import { POST as tryon } from '../api/tryon.js';
import { POST as segment } from '../api/segment.js';
import type { AgentEvent, Outfit, TryonEvent } from '../shared/protocol.js';
import type { BodyProfile } from '../shared/types.js';

const OUT = process.argv[3] ?? 'smoke-out';
mkdirSync(OUT, { recursive: true });
const MINA: BodyProfile = { gender: 'women', heightCm: 163, chestCm: 84, waistCm: 66, hipCm: 91 };
const dataUrl = (path: string) => `data:image/webp;base64,${readFileSync(path).toString('base64')}`;

async function* lines(response: Response) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      yield JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
  }
}

const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
let outfit: Outfit | null = null;
const req = new Request('http://x/api/agent', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', text: 'Going to Seoul next week, around 0°C. I want to dress like this photo.', imageDataUrl: dataUrl('public/demo/inspo-seoul.webp') }],
    profile: MINA,
    currentOutfit: null,
  }),
});
for await (const e of lines(await agent(req)) as AsyncIterable<AgentEvent>) {
  if (e.type === 'outfit') outfit = e.outfit;
  console.log(secs(), e.type, JSON.stringify(e.type === 'outfit' ? e.outfit : e).slice(0, 300));
}
if (!outfit || process.argv[2] === 'agent') process.exit(0);

const person = dataUrl('public/demo/shopper-mina.webp');
let final: Extract<TryonEvent, { type: 'final' }> | null = null;
const treq = new Request('http://x/api/tryon', { method: 'POST', body: JSON.stringify({ personImage: person, productIds: outfit.items.map((i) => i.productId), previous: null }) });
for await (const e of lines(await tryon(treq)) as AsyncIterable<TryonEvent>) {
  if (e.type === 'image') writeFileSync(`${OUT}/attempt-${e.attempt}.webp`, Buffer.from(e.image.split(',')[1]!, 'base64'));
  if (e.type === 'final') final = e;
  console.log(secs(), e.type, JSON.stringify({ ...e, image: undefined }).slice(0, 600));
}
if (!final) process.exit(1);

const sreq = new Request('http://x/api/segment', { method: 'POST', body: JSON.stringify({ image: final.image, productIds: outfit.items.map((i) => i.productId) }) });
const seg = await (await segment(sreq)).json() as { regions: { productId: string; left: number; top: number; right: number; bottom: number }[] };
console.log(secs(), 'segment', JSON.stringify(seg.regions.map(({ productId, left, top, right, bottom }) => ({ productId, left, top, right, bottom }))));
writeFileSync(`${OUT}/segment.json`, JSON.stringify(seg));
