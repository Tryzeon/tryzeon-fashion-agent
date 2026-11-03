import type OpenAI from 'openai';
import type { ItemCheck, TryonEvent, TryonRequest, Verification } from '../shared/protocol.js';
import type { Product } from '../shared/types.js';
import { findProduct, productImageDataUrl } from './_lib/catalog.js';
import { generateImage, meta, SPARK_MODEL } from './_lib/meta.js';
import { ndjsonResponse } from './_lib/ndjson.js';

const MAX_ATTEMPTS = 3;
const PASS_SCORE = 7;
const MAX_SWAP_CHANGES = 2;

type ImageInput = OpenAI.Responses.ResponseCreateParams['input'];

interface Attempt {
  responseId: string;
  image: string;
  verification: Verification;
}

function dataUrlFromBase64(base64: string): string {
  const mime = base64.startsWith('UklGR') ? 'image/webp' : base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

function wornAs(product: Product): string {
  switch (product.category) {
    case 'outerwear':
      return 'worn as the outer layer, on the shoulders with arms in the sleeves';
    case 'top':
      return 'worn on the upper body';
    case 'bottom':
      return 'worn on the lower body';
    case 'shoes':
      return 'worn on the feet';
    case 'accessory':
      return 'worn or carried naturally (scarf around the neck, hat on the head, gloves on the hands, bag on the shoulder or in hand)';
  }
}

function describe(product: Product): string {
  return `${product.name} — a ${product.colors.join(' / ')} ${product.garment}, ${wornAs(product)}`;
}

const FIDELITY =
  'Reproduce every piece faithfully: exact color, fabric texture, pattern, length, closures, pockets, stitching and logos as in its product photo.';

const KEEP_PERSON =
  'Keep the face, hair, skin tone, body shape, pose, background, lighting and framing exactly as in the shopper photo.';

async function fullRenderInput(personImage: string, products: Product[]): Promise<ImageInput> {
  const hasShoes = products.some((p) => p.category === 'shoes');
  const lines = products.map((p, i) => `- Image ${i + 2}: ${describe(p)}`);
  const text = [
    'Image 1 is a photo of the shopper. The other images are product photos.',
    'Dress the shopper in this complete outfit, replacing the clothes they are wearing:',
    ...lines,
    hasShoes ? '' : 'Keep the shopper’s own shoes.',
    'Layer naturally: the top tucked or falling naturally over the bottom, any outerwear worn properly over the top.',
    FIDELITY,
    KEEP_PERSON,
    'Photorealistic full-body photo with the same aspect ratio as the shopper photo.',
  ]
    .filter(Boolean)
    .join('\n');
  const productImages = await Promise.all(products.map((p) => productImageDataUrl(p.id)));
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text },
        { type: 'input_image', image_url: personImage, detail: 'auto' },
        ...productImages.map((url) => ({ type: 'input_image' as const, image_url: url, detail: 'auto' as const })),
      ],
    },
  ];
}

interface SwapPlan {
  replaced: { from: Product; to: Product }[];
  added: Product[];
  removed: Product[];
}

function planSwap(previousIds: string[], nextIds: string[]): SwapPlan | null {
  const previous = previousIds.map(findProduct).filter((p): p is Product => Boolean(p));
  const next = nextIds.map(findProduct).filter((p): p is Product => Boolean(p));
  const incoming = next.filter((p) => !previousIds.includes(p.id));
  const outgoing = previous.filter((p) => !nextIds.includes(p.id));
  const plan: SwapPlan = { replaced: [], added: [], removed: [] };
  for (const to of incoming) {
    const index = outgoing.findIndex((p) => p.category === to.category);
    if (index >= 0) plan.replaced.push({ from: outgoing.splice(index, 1)[0]!, to });
    else plan.added.push(to);
  }
  plan.removed = outgoing;
  const changes = plan.replaced.length + plan.added.length + plan.removed.length;
  return changes > 0 && changes <= MAX_SWAP_CHANGES ? plan : null;
}

async function swapInput(plan: SwapPlan): Promise<{ input: ImageInput; detail: string }> {
  const incoming = [...plan.replaced.map((r) => r.to), ...plan.added];
  const instructions = [
    ...plan.replaced.map(
      ({ from, to }, i) => `Replace the ${from.garment} with the ${to.garment} in attached image ${i + 1} (${describe(to)}).`,
    ),
    ...plan.added.map((p, i) => `Add the ${p.garment} in attached image ${plan.replaced.length + i + 1} (${describe(p)}).`),
    ...plan.removed.map((p) => `Remove the ${p.garment}.`),
  ];
  const text = [
    ...instructions,
    'Keep the person and every other piece of clothing exactly as in the previous image.',
    FIDELITY,
    KEEP_PERSON,
  ].join('\n');
  const images = await Promise.all(incoming.map((p) => productImageDataUrl(p.id)));
  const detail = [
    ...plan.replaced.map((r) => `${r.from.garment} → ${r.to.garment}`),
    ...plan.added.map((p) => `+ ${p.garment}`),
    ...plan.removed.map((p) => `− ${p.garment}`),
  ].join(', ');
  return {
    detail,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text },
          ...images.map((url) => ({ type: 'input_image' as const, image_url: url, detail: 'auto' as const })),
        ],
      },
    ],
  };
}

function fixInput(verification: Verification, products: Product[]): ImageInput {
  const problems = verification.items
    .filter((item) => item.score < PASS_SCORE)
    .map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return `- ${product ? product.name : item.productId}: ${item.issue}`;
    });
  if (!verification.identityPreserved) problems.push('- The person no longer looks like the shopper; restore their face and body.');
  return [
    'A quality check of the previous image found these problems:',
    ...problems,
    'Regenerate the image fixing exactly these problems. Keep everything else the same.',
    FIDELITY,
  ].join('\n');
}

const verificationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['identity_preserved', 'items', 'summary'],
  properties: {
    identity_preserved: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['product_id', 'score', 'issue'],
        properties: {
          product_id: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 10 },
          issue: { type: 'string', description: 'Concrete visible mismatch, or "none".' },
        },
      },
    },
    summary: { type: 'string', description: 'One short sentence.' },
  },
} as const;

async function verify(personImage: string, tryonImage: string, products: Product[]): Promise<Verification> {
  const productParts = await Promise.all(
    products.map(async (p): Promise<OpenAI.Chat.ChatCompletionContentPart[]> => [
      { type: 'text', text: `Product ${p.id}: ${p.name} (${p.garment}; ${p.colors.join(', ')}; ${p.material})` },
      { type: 'image_url', image_url: { url: await productImageDataUrl(p.id, 'small') } },
    ]),
  );
  const completion = await meta().chat.completions.create({
    model: SPARK_MODEL,
    reasoning_effort: 'low',
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'tryon_verification', strict: true, schema: verificationSchema },
    },
    messages: [
      {
        role: 'system',
        content: [
          'You are the quality inspector for a virtual try-on. Compare the try-on result against each product photo and the original shopper photo.',
          'Score each product 0-10: 10 = identical color, pattern and construction details; 8 = tiny differences a shopper would not notice;',
          '6 = a noticeable difference (wrong shade, missing pocket or stripe, wrong length); 3 = clearly a different item or worn wrongly (e.g. jacket sliding off the shoulders);',
          '0 = missing. Judge only what is visible; an item partly hidden by a layer on top of it is fine.',
          'identity_preserved is false only if the face, hair or body shape clearly changed.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Original shopper photo:' },
          { type: 'image_url', image_url: { url: personImage } },
          { type: 'text', text: 'Try-on result:' },
          { type: 'image_url', image_url: { url: tryonImage } },
          ...productParts.flat(),
        ],
      },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error('Muse Spark returned no verification');
  const raw = JSON.parse(content) as {
    identity_preserved: boolean;
    items: { product_id: string; score: number; issue: string }[];
    summary: string;
  };
  const items: ItemCheck[] = products.map((p) => {
    const found = raw.items.find((i) => i.product_id === p.id);
    return found ? { productId: p.id, score: found.score, issue: found.issue } : { productId: p.id, score: 0, issue: 'not assessed' };
  });
  return {
    passed: raw.identity_preserved && items.every((i) => i.score >= PASS_SCORE),
    identityPreserved: raw.identity_preserved,
    items,
    summary: raw.summary,
  };
}

function quality(attempt: Attempt): number {
  return (attempt.verification.identityPreserved ? 100 : 0) + Math.min(...attempt.verification.items.map((i) => i.score));
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as TryonRequest;
  return ndjsonResponse<TryonEvent>(async (send) => {
    const products = body.productIds.map(findProduct).filter((p): p is Product => Boolean(p));
    if (!products.length) throw new Error('No known products to try on');

    const attempts: Attempt[] = [];
    const plan = body.previous ? planSwap(body.previous.productIds, body.productIds) : null;

    for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
      const last = attempts.at(-1);
      let input: ImageInput;
      let previousResponseId: string | undefined;
      let mode: 'full' | 'swap' | 'fix';
      let detail: string;
      if (last) {
        mode = 'fix';
        input = fixInput(last.verification, products);
        previousResponseId = last.responseId;
        detail = last.verification.items
          .filter((i) => i.score < PASS_SCORE)
          .map((i) => i.issue)
          .join('; ');
      } else if (plan && body.previous) {
        mode = 'swap';
        const swap = await swapInput(plan);
        input = swap.input;
        detail = swap.detail;
        previousResponseId = body.previous.responseId;
      } else {
        mode = 'full';
        input = await fullRenderInput(body.personImage, products);
        detail = `${products.length} pieces in one render`;
      }

      send({ type: 'stage', stage: 'render', attempt: n, mode, detail });
      const rendered = await generateImage(input, previousResponseId);
      const image = dataUrlFromBase64(rendered.base64);
      send({ type: 'image', attempt: n, image });

      send({ type: 'stage', stage: 'verify', attempt: n, mode, detail: `${products.length} pieces + identity` });
      const verification = await verify(body.personImage, image, products);
      send({ type: 'verification', attempt: n, verification });
      attempts.push({ responseId: rendered.responseId, image, verification });
      if (verification.passed) break;
    }

    const best = attempts.reduce((a, b) => (quality(b) > quality(a) ? b : a));
    send({
      type: 'final',
      image: best.image,
      responseId: best.responseId,
      verified: best.verification.passed,
      attempts: attempts.length,
    });
  });
}
