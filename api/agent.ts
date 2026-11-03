import type OpenAI from 'openai';
import { checkFit } from '../shared/fit.js';
import type { AgentEvent, AgentRequest, Outfit, OutfitItem } from '../shared/protocol.js';
import { CATEGORIES, type BodyProfile, type Category, type Product, type Size } from '../shared/types.js';
import { brandName, catalog, findProduct } from './_lib/catalog.js';
import { meta, SPARK_MODEL } from './_lib/meta.js';
import { ndjsonResponse } from './_lib/ndjson.js';

const MAX_TURNS = 10;
const SEARCH_LIMIT = 6;

type Message = OpenAI.Chat.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.ChatCompletionTool;

const TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description:
        "Search the partner brands' live catalog. Results are already limited to the shopper's gender (plus unisex). Call once per category you need; calls run in parallel.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'query'],
        properties: {
          category: { type: 'string', enum: [...CATEGORIES] },
          query: { type: 'string', description: 'Style, color, material, occasion or garment keywords.' },
          min_warmth: { type: 'integer', minimum: 1, maximum: 5, description: 'Warmth 1 (summer) to 5 (sub-zero).' },
          max_price: { type: 'number', description: 'USD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_fit',
      description:
        "Run Tryzeon's body-fit check: compares the shopper's chest/waist/hip against each product's size chart and in-stock sizes. Returns the recommended size or that no stocked size fits.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['product_ids'],
        properties: { product_ids: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_outfit',
      description:
        'Show the shopper a complete outfit. Rejected unless every apparel item passed check_fit. Include a top or outerwear, a bottom, shoes, and at most one accessory.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'rationale', 'items'],
        properties: {
          title: { type: 'string', description: 'Short outfit name.' },
          rationale: { type: 'string', description: 'One or two sentences on why this works for the request.' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['product_id', 'reason'],
              properties: {
                product_id: { type: 'string' },
                reason: { type: 'string', description: 'Why this piece, in under 12 words.' },
              },
            },
          },
        },
      },
    },
  },
];

function describeProfile(profile: BodyProfile): string {
  return `${profile.gender}, ${profile.heightCm}cm, chest ${profile.chestCm}cm, waist ${profile.waistCm}cm, hip ${profile.hipCm}cm`;
}

function describeOutfit(outfit: Outfit): string {
  return outfit.items
    .map((item) => {
      const p = findProduct(item.productId);
      return p ? `- ${p.id}: ${p.name} (${p.category}, ${brandName(p)})` : `- ${item.productId}`;
    })
    .join('\n');
}

function systemPrompt(request: AgentRequest): string {
  return [
    "You are Tryzeon's AI Fashion Agent, embedded on fashion brands' websites. You style shoppers with real, in-stock products from partner brands and only recommend pieces that fit their body.",
    '',
    'How you work:',
    '1. Understand the request. If the shopper attached a photo, read it as inspiration: name the key pieces, colors and silhouette you will match.',
    '2. Call search_catalog for each category you need, in parallel.',
    '3. Call check_fit on every top, bottom and outerwear candidate you want to use. Never propose a piece whose fit is "no".',
    '4. Call propose_outfit with one complete outfit. If it is rejected, fix the problem and propose again.',
    '5. Finish with a reply of at most two short sentences. Do not list the items again; the shopper sees the outfit card.',
    '',
    'Before each tool call, write one short line of what you are doing, in the language the shopper writes in.',
    'When the shopper asks to change part of the current outfit, keep every other piece and swap only what they asked for.',
    'Never invent products or product ids.',
    '',
    `Shopper body profile: ${describeProfile(request.profile)}.`,
    request.currentOutfit
      ? `Outfit the shopper is currently trying on:\n${describeOutfit(request.currentOutfit)}`
      : 'The shopper has not tried on an outfit yet.',
  ].join('\n');
}

function toMessages(request: AgentRequest): Message[] {
  return [
    { role: 'system', content: systemPrompt(request) },
    ...request.messages.map((turn): Message => {
      if (turn.role === 'assistant') return { role: 'assistant', content: turn.text };
      if (!turn.imageDataUrl) return { role: 'user', content: turn.text };
      return {
        role: 'user',
        content: [
          { type: 'text', text: turn.text },
          { type: 'image_url', image_url: { url: turn.imageDataUrl } },
        ],
      };
    }),
  ];
}

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'of', 'to', 'on']);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function searchableText(p: Product): string {
  return [p.name, p.garment, p.look, p.description, p.material, ...p.colors, ...p.styleTags, ...p.occasions, brandName(p)].join(' ');
}

interface SearchArgs {
  category: Category;
  query: string;
  min_warmth?: number;
  max_price?: number;
}

function searchCatalog(args: SearchArgs, profile: BodyProfile): Product[] {
  const queryTokens = tokens(args.query ?? '');
  return catalog.products
    .filter((p) => p.category === args.category)
    .filter((p) => p.gender === 'unisex' || p.gender === profile.gender)
    .filter((p) => args.min_warmth === undefined || p.warmth >= args.min_warmth)
    .filter((p) => args.max_price === undefined || p.price <= args.max_price)
    .map((p) => {
      const haystack = new Set(tokens(searchableText(p)));
      const score = queryTokens.reduce((sum, t) => sum + (haystack.has(t) ? 1 : 0), 0);
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_LIMIT)
    .map(({ p }) => p);
}

function productSummary(p: Product) {
  return {
    id: p.id,
    name: p.name,
    brand: brandName(p),
    price: p.price,
    colors: p.colors,
    material: p.material,
    fit: p.fit,
    warmth: p.warmth,
    style: p.styleTags,
    look: p.look,
  };
}

interface ToolOutcome {
  content: unknown;
  summary: string;
  ok: boolean;
  productIds?: string[];
}

function fitSummary(product: Product, profile: BodyProfile) {
  const result = checkFit(product, profile);
  if (!result.sizeSensitive) return { id: product.id, fit: 'one size', recommended_size: null as Size | null, verdict: null };
  const best = result.checks.find((c) => c.size === result.recommended) ?? result.checks[0];
  return {
    id: product.id,
    fit: result.verdict,
    recommended_size: result.recommended,
    verdict: result.verdict,
    in_stock: product.sizes,
    note: best?.notes.join('; ') ?? '',
  };
}

function proposeOutfit(
  args: { title: string; rationale: string; items: { product_id: string; reason: string }[] },
  profile: BodyProfile,
): { outfit: Outfit | null; problems: string[] } {
  if (!Array.isArray(args.items) || args.items.length === 0) {
    return { outfit: null, problems: ['items must be a non-empty array of {product_id, reason}'] };
  }
  const problems: string[] = [];
  const items: OutfitItem[] = [];
  const perCategory = new Map<Category, number>();
  for (const { product_id, reason } of args.items) {
    const product = findProduct(product_id);
    if (!product) {
      problems.push(`${product_id} is not in the catalog`);
      continue;
    }
    if (product.gender !== 'unisex' && product.gender !== profile.gender) {
      problems.push(`${product_id} is a ${product.gender} item`);
    }
    perCategory.set(product.category, (perCategory.get(product.category) ?? 0) + 1);
    const fit = checkFit(product, profile);
    if (fit.sizeSensitive && fit.verdict === 'no') {
      problems.push(`${product_id} has no in-stock size that fits (${fit.checks.map((c) => `${c.size}: ${c.notes.join(', ')}`).join(' | ')})`);
    }
    items.push({
      productId: product.id,
      size: fit.sizeSensitive ? fit.recommended : null,
      fit: fit.sizeSensitive ? fit.verdict : null,
      reason,
    });
  }
  if (!perCategory.has('bottom')) problems.push('the outfit needs a bottom');
  if (!perCategory.has('top') && !perCategory.has('outerwear')) problems.push('the outfit needs a top or outerwear');
  if (!perCategory.has('shoes')) problems.push('the outfit needs shoes');
  for (const [category, count] of perCategory) {
    if (count > 1) problems.push(`only one ${category} allowed, got ${count}`);
  }
  if (problems.length) return { outfit: null, problems };
  const order = (id: string) => CATEGORIES.indexOf(findProduct(id)!.category);
  items.sort((a, b) => order(a.productId) - order(b.productId));
  return { outfit: { title: args.title, rationale: args.rationale, items }, problems };
}

function runTool(
  name: string,
  args: Record<string, unknown>,
  profile: BodyProfile,
  send: (event: AgentEvent) => void,
): ToolOutcome {
  switch (name) {
    case 'search_catalog': {
      const results = searchCatalog(args as unknown as SearchArgs, profile);
      return {
        content: results.map(productSummary),
        summary: `${results.length} ${args.category as string} found`,
        ok: results.length > 0,
        productIds: results.map((p) => p.id),
      };
    }
    case 'check_fit': {
      const ids = (args.product_ids as string[] | undefined) ?? [];
      const results = ids.map((id) => {
        const product = findProduct(id);
        return product ? fitSummary(product, profile) : { id, fit: 'unknown product' };
      });
      const passing = results.filter((r) => r.fit === 'fits' || r.fit === 'borderline' || r.fit === 'one size');
      return {
        content: results,
        summary: `${passing.length}/${results.length} fit your body`,
        ok: true,
        productIds: ids,
      };
    }
    case 'propose_outfit': {
      const { outfit, problems } = proposeOutfit(args as Parameters<typeof proposeOutfit>[0], profile);
      if (!outfit) {
        return { content: { accepted: false, problems }, summary: `Rejected: ${problems.join('; ')}`, ok: false };
      }
      send({ type: 'outfit', outfit });
      return {
        content: { accepted: true, shown_to_shopper: true },
        summary: `Outfit verified: ${outfit.items.length} pieces, all in stock and fitting`,
        ok: true,
        productIds: outfit.items.map((i) => i.productId),
      };
    }
    default:
      return { content: { error: `unknown tool ${name}` }, summary: `Unknown tool ${name}`, ok: false };
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as AgentRequest;
  return ndjsonResponse<AgentEvent>(async (send) => {
    const messages = toMessages(body);
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const completion = await meta().chat.completions.create({
        model: SPARK_MODEL,
        messages,
        tools: TOOLS,
        reasoning_effort: 'low',
      });
      const message = completion.choices[0]?.message;
      if (!message) throw new Error('Muse Spark returned no message');
      const calls = message.tool_calls ?? [];
      const text = message.content?.trim();
      if (!calls.length) {
        if (text) send({ type: 'message', text });
        send({ type: 'done' });
        return;
      }
      if (text) send({ type: 'narration', text: text.replace(/([.!?])(?=[A-Z][a-z])/g, '$1 ') });
      messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls });
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch (error) {
          console.error('bad tool arguments', call.function.arguments, error);
        }
        send({ type: 'tool_call', id: call.id, name: call.function.name, args });
        const outcome = runTool(call.function.name, args, body.profile, send);
        send({
          type: 'tool_result',
          id: call.id,
          name: call.function.name,
          summary: outcome.summary,
          ok: outcome.ok,
          productIds: outcome.productIds,
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.content) });
      }
    }
    send({ type: 'message', text: 'I ran out of steps while styling this look. Please try rephrasing your request.' });
    send({ type: 'done' });
  });
}
