export function ndjsonResponse<Event>(run: (send: (event: Event) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await run(send);
      } catch (error) {
        console.error(error);
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) } as Event);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
