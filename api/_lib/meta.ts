import OpenAI from 'openai';

export const SPARK_MODEL = 'muse-spark-1.3';
export const IMAGE_MODEL = 'muse-image-1.0';
export const SAM_MODEL = 'sam-3.1';

let client: OpenAI | undefined;

export function meta(): OpenAI {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) throw new Error('META_API_KEY is not set');
  client ??= new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey, maxRetries: 2 });
  return client;
}

interface ImageOutput {
  responseId: string;
  base64: string;
}

export async function generateImage(
  input: OpenAI.Responses.ResponseCreateParams['input'],
  previousResponseId?: string,
): Promise<ImageOutput> {
  const response = await meta().responses.create({
    model: IMAGE_MODEL,
    input,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  });
  const call = response.output.find((item) => item.type === 'image_generation_call');
  if (!call || call.type !== 'image_generation_call' || !call.result) {
    throw new Error(`Muse Image returned no image (status ${response.status})`);
  }
  return { responseId: response.id, base64: call.result };
}
