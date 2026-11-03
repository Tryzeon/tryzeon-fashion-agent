import { useCallback, useRef, useState } from 'react';
import type { AgentEvent, ChatTurn, Outfit } from '../../shared/protocol';
import type { BodyProfile } from '../../shared/types';
import { product } from '../lib/catalog';
import { postStream } from '../lib/ndjson';

export type Step =
  | { kind: 'narration'; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      args: Record<string, unknown>;
      result: { summary: string; ok: boolean; productIds: string[] } | null;
    };

export interface Turn {
  id: number;
  text: string;
  image: string | null;
  steps: Step[];
  outfit: Outfit | null;
  reply: string | null;
  status: 'running' | 'done' | 'error';
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

const HISTORY_TURNS = 6;

function assistantText(turn: Turn): string {
  const outfit = turn.outfit
    ? `\n[Proposed outfit "${turn.outfit.title}": ${turn.outfit.items
        .map((i) => `${i.productId} ${product(i.productId)?.name ?? ''}`)
        .join(', ')}]`
    : '';
  return `${turn.reply ?? ''}${outfit}`.trim();
}

function toHistory(turns: Turn[], text: string, image: string | null): ChatTurn[] {
  const history: ChatTurn[] = turns.slice(-HISTORY_TURNS).flatMap((t) => [
    { role: 'user' as const, text: t.image ? `${t.text}\n(I attached a photo earlier.)` : t.text },
    { role: 'assistant' as const, text: assistantText(t) || '(no reply)' },
  ]);
  history.push({ role: 'user', text, ...(image ? { imageDataUrl: image } : {}) });
  return history;
}

export function latestOutfit(turns: Turn[]): Outfit | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const outfit = turns[i]?.outfit;
    if (outfit) return outfit;
  }
  return null;
}

export function useAgent(profile: BodyProfile) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(1);
  const running = turns.at(-1)?.status === 'running';

  const update = (id: number, change: (turn: Turn) => Turn) =>
    setTurns((all) => all.map((t) => (t.id === id ? change(t) : t)));

  const send = useCallback(
    async (text: string, image: string | null) => {
      const id = nextId.current++;
      const turn: Turn = {
        id,
        text,
        image,
        steps: [],
        outfit: null,
        reply: null,
        status: 'running',
        error: null,
        startedAt: Date.now(),
        endedAt: null,
      };
      const previous = turns;
      setTurns((all) => [...all, turn]);
      try {
        await postStream<AgentEvent>(
          '/api/agent',
          { messages: toHistory(previous, text, image), profile, currentOutfit: latestOutfit(previous) },
          (event) => {
            switch (event.type) {
              case 'narration':
                update(id, (t) => ({ ...t, steps: [...t.steps, { kind: 'narration', text: event.text }] }));
                break;
              case 'tool_call':
                update(id, (t) => ({
                  ...t,
                  steps: [...t.steps, { kind: 'tool', id: event.id, name: event.name, args: event.args, result: null }],
                }));
                break;
              case 'tool_result':
                update(id, (t) => ({
                  ...t,
                  steps: t.steps.map((s) =>
                    s.kind === 'tool' && s.id === event.id
                      ? { ...s, result: { summary: event.summary, ok: event.ok, productIds: event.productIds ?? [] } }
                      : s,
                  ),
                }));
                break;
              case 'outfit':
                update(id, (t) => ({ ...t, outfit: event.outfit }));
                break;
              case 'message':
                update(id, (t) => ({ ...t, reply: event.text }));
                break;
              case 'error':
                update(id, (t) => ({ ...t, status: 'error', error: event.message, endedAt: Date.now() }));
                break;
              case 'done':
                update(id, (t) => ({ ...t, status: 'done', endedAt: Date.now() }));
                break;
            }
          },
        );
        update(id, (t) => (t.status === 'running' ? { ...t, status: 'done', endedAt: Date.now() } : t));
      } catch (error) {
        update(id, (t) => ({ ...t, status: 'error', error: String(error), endedAt: Date.now() }));
      }
    },
    [turns, profile],
  );

  const reset = useCallback(() => setTurns([]), []);

  return { turns, running, send, reset };
}
