import { useCallback, useRef, useState } from 'react';
import type { Outfit, Region, SegmentResponse, TryonEvent, Verification } from '../../shared/protocol';
import { postStream } from '../lib/ndjson';

export interface PipelineRow {
  key: string;
  stage: 'render' | 'verify' | 'shoppable';
  attempt: number;
  mode: 'full' | 'swap' | 'fix' | null;
  detail: string;
  status: 'active' | 'done' | 'failed';
  verification: Verification | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TryonResult {
  image: string;
  responseId: string;
  verified: boolean;
  productIds: string[];
  personKey: string;
}

export interface TryonState {
  status: 'idle' | 'running' | 'done' | 'error';
  outfit: Outfit | null;
  personKey: string | null;
  rows: PipelineRow[];
  preview: string | null;
  result: TryonResult | null;
  regions: Region[] | null;
  error: string | null;
}

const IDLE: TryonState = {
  status: 'idle',
  outfit: null,
  personKey: null,
  rows: [],
  preview: null,
  result: null,
  regions: null,
  error: null,
};

export function useTryon() {
  const [state, setState] = useState<TryonState>(IDLE);
  const run = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    run.current += 1;
    inflight.current?.abort();
    setState(IDLE);
  }, []);

  const start = useCallback(
    async (outfit: Outfit, personImage: string, personKey: string) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      const id = ++run.current;
      const productIds = outfit.items.map((i) => i.productId);
      const previous = state.result && state.result.personKey === personKey ? state.result : null;
      const images = new Map<number, string>();
      const set = (change: (s: TryonState) => TryonState) => {
        if (run.current === id) setState(change);
      };
      const closeActive = (rows: PipelineRow[], status: PipelineRow['status'] = 'done') =>
        rows.map((r) => (r.status === 'active' ? { ...r, status, endedAt: Date.now() } : r));

      set(() => ({ ...IDLE, status: 'running', outfit, personKey, preview: previous?.image ?? null, result: previous }));
      let final: TryonResult | null = null;
      try {
        await postStream<TryonEvent>(
          '/api/tryon',
          {
            personImage,
            productIds,
            previous: previous ? { responseId: previous.responseId, productIds: previous.productIds } : null,
          },
          (event) => {
            switch (event.type) {
              case 'stage':
                set((s) => ({
                  ...s,
                  rows: [
                    ...closeActive(s.rows),
                    {
                      key: `${event.stage}-${event.attempt}`,
                      stage: event.stage,
                      attempt: event.attempt,
                      mode: event.mode,
                      detail: event.detail,
                      status: 'active',
                      verification: null,
                      startedAt: Date.now(),
                      endedAt: null,
                    },
                  ],
                }));
                break;
              case 'image':
                images.set(event.attempt, event.image);
                set((s) => ({ ...s, preview: event.image }));
                break;
              case 'verification':
                set((s) => ({
                  ...s,
                  rows: s.rows.map((r) =>
                    r.key === `verify-${event.attempt}`
                      ? {
                          ...r,
                          status: event.verification.passed ? 'done' : 'failed',
                          verification: event.verification,
                          endedAt: Date.now(),
                        }
                      : r,
                  ),
                }));
                break;
              case 'final': {
                const image = images.get(event.attempt);
                if (!image) throw new Error('The final render was not received');
                const result: TryonResult = { image, responseId: event.responseId, verified: event.verified, productIds, personKey };
                final = result;
                set((s) => ({ ...s, rows: closeActive(s.rows), preview: result.image, result }));
                break;
              }
              case 'error':
                throw new Error(event.message);
            }
          },
          controller.signal,
        );
        if (!final) throw new Error('The try-on ended without an image');
        const result: TryonResult = final;
        set((s) => ({
          ...s,
          rows: [
            ...s.rows,
            {
              key: 'shoppable',
              stage: 'shoppable',
              attempt: 1,
              mode: null,
              detail: `${productIds.length} pieces`,
              status: 'active',
              verification: null,
              startedAt: Date.now(),
              endedAt: null,
            },
          ],
        }));
        const response = await fetch('/api/segment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: result.image, productIds }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`making the photo shoppable failed (${response.status})`);
        const { regions } = (await response.json()) as SegmentResponse;
        const found = new Set(regions.map((r) => r.productId)).size;
        set((s) => ({
          ...s,
          status: 'done',
          regions,
          rows: s.rows.map((r) =>
            r.key === 'shoppable'
              ? { ...r, status: 'done', detail: `${found} of ${productIds.length} pieces tappable`, endedAt: Date.now() }
              : r,
          ),
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        set((s) => ({
          ...s,
          status: final ? 'done' : 'error',
          error: error instanceof Error ? error.message : String(error),
          rows: closeActive(s.rows, 'failed'),
        }));
      }
    },
    [state.result],
  );

  return { tryon: state, start, reset };
}
