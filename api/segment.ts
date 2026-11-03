import { decodeMaskToSVGPath, parseImageStream, recordsOfKind } from '@meta-sam/parser';
import type { Region, SegmentRequest, SegmentResponse } from '../shared/protocol.js';
import { findProduct } from './_lib/catalog.js';
import { meta, SAM_MODEL } from './_lib/meta.js';

// The API streams `response.content_part.done` but not `response.output_text.done`,
// which the parser needs to finalize a text lane, so it is synthesized here.
async function* normalizedEvents(stream: AsyncIterable<unknown>): AsyncIterable<{ type: string }> {
  const completed = new Set<string>();
  for await (const raw of stream) {
    const event = raw as {
      type: string;
      item_id?: unknown;
      output_index?: unknown;
      content_index?: unknown;
      part?: { type?: unknown; text?: unknown } | null;
    };
    const lane = `${String(event.item_id)}:${String(event.output_index)}:${String(event.content_index)}`;
    if (event.type === 'response.output_text.done') {
      if (!completed.has(lane)) {
        completed.add(lane);
        yield event;
      }
      continue;
    }
    yield event;
    if (
      event.type === 'response.content_part.done' &&
      !completed.has(lane) &&
      event.part?.type === 'output_text' &&
      typeof event.part.text === 'string'
    ) {
      completed.add(lane);
      yield {
        type: 'response.output_text.done',
        item_id: event.item_id,
        output_index: event.output_index,
        content_index: event.content_index,
        text: event.part.text,
      } as { type: string };
    }
  }
}

async function segment(image: string, productId: string): Promise<Region[]> {
  const product = findProduct(productId);
  if (!product) return [];
  const stream = await meta().responses.create({
    model: SAM_MODEL,
    stream: true,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: product.garment },
          { type: 'input_image', image_url: image, detail: 'auto' },
        ],
      },
    ],
  });
  const result = await parseImageStream(normalizedEvents(stream)).finalResult;
  return recordsOfKind(result.records, 'mask').map((record) => ({
    productId,
    left: record.bounds.left,
    top: record.bounds.top,
    right: record.bounds.right,
    bottom: record.bounds.bottom,
    maskWidth: record.mask.width,
    maskHeight: record.mask.height,
    path: decodeMaskToSVGPath(record.mask),
  }));
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as SegmentRequest;
  const settled = await Promise.allSettled(body.productIds.map((id) => segment(body.image, id)));
  const regions = settled.flatMap((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    console.error(`segment ${body.productIds[i]} failed`, s.reason);
    return [];
  });
  return Response.json({ regions } satisfies SegmentResponse);
}
