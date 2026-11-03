import type { BodyProfile, Size } from './types.js';
import type { Verdict } from './fit.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  imageDataUrl?: string;
}

export interface OutfitItem {
  productId: string;
  size: Size | null;
  fit: Verdict | null;
  reason: string;
}

export interface Outfit {
  title: string;
  rationale: string;
  items: OutfitItem[];
}

export interface AgentRequest {
  messages: ChatTurn[];
  profile: BodyProfile;
  currentOutfit: Outfit | null;
}

export type AgentEvent =
  | { type: 'narration'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; summary: string; ok: boolean; productIds?: string[] }
  | { type: 'outfit'; outfit: Outfit }
  | { type: 'message'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface TryonRequest {
  personImage: string;
  productIds: string[];
  previous: { responseId: string; productIds: string[] } | null;
}

export interface ItemCheck {
  productId: string;
  score: number;
  issue: string;
}

export interface Verification {
  passed: boolean;
  identityPreserved: boolean;
  items: ItemCheck[];
  summary: string;
}

export type TryonEvent =
  | { type: 'stage'; stage: 'render' | 'verify'; attempt: number; mode: 'full' | 'swap' | 'fix'; detail: string }
  | { type: 'image'; attempt: number; image: string }
  | { type: 'verification'; attempt: number; verification: Verification }
  | { type: 'final'; image: string; responseId: string; verified: boolean; attempts: number }
  | { type: 'error'; message: string };

export interface SegmentRequest {
  image: string;
  productIds: string[];
}

export interface Region {
  productId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  maskWidth: number;
  maskHeight: number;
  path: string;
}

export interface SegmentResponse {
  regions: Region[];
}
