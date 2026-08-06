import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type MutableModels } from '@earendil-works/pi-ai';
import { AppSettings, AssistantMessage } from '@/types';
import { OMNIROUTE_DEFAULT_MODEL } from './llm';
import { getPiModels } from './pi-provider';

// Polyfill for Promise.withResolvers (Node 22+, TS 5.5+ lib).
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
/**
 * Pi framework integration — assistant agent loop.
 *
 * Each chat turn runs through `@earendil-works/pi-agent-core`: assistant
 * history hydrates the agent state and actions (send_message) are declared
 * as AgentTools. Human-first rule preserved: `beforeToolCall` blocks every
 * call — nothing ever executes inside the loop. The caller maps captured
 * tool calls into proposals and runs confirmed actions via the existing
 * `/api/assistant/actions` path.
 */

/** Timeout for one agent turn (mirrors the old chatJSON client timeout). */
export const PI_TURN_TIMEOUT_MS = 120_000;

/** A captured send_message proposal, pre-sanitization (caller validates against the directory). */
export interface PiSendMessageCall {
  conversation_id: string;
  content: string;
  reason?: string;
}

export interface PiTurnResult {
  reply: string;
  toolCalls: PiSendMessageCall[];
}

export interface PiAssistantTurnOptions {
  systemPrompt: string;
  /** Override the model registry (tests inject a faux provider). */
  models?: MutableModels;
}

const sendMessageTool: AgentTool = {
  name: 'send_message',
  label: 'Gửi tin nhắn Zalo',
  description:
    'Đề xuất gửi một tin nhắn Zalo tới hội thoại. Chỉ là đề xuất — hệ thống chặn thực thi; người dùng xác nhận trước khi gửi.',
  parameters: Type.Object({
    conversation_id: Type.String({
      description: 'ID hội thoại, lấy chính xác từ danh sách hội thoại trong ngữ cảnh',
    }),
    content: Type.String({ description: 'Nội dung tin nhắn, tiếng Việt, giọng tự nhiên của người dùng' }),
    reason: Type.Optional(Type.String({ description: 'Lý do ngắn gọn' })),
  }),
  // Unreachable in normal operation: beforeToolCall always blocks. Defense in
  // depth so a misconfigured agent can never auto-send.
  execute: async () => {
    throw new Error('send_message chỉ được thực thi sau khi người dùng xác nhận');
  },
};

/** Map stored assistant messages to a pi AgentMessage transcript (text-only). */
export function hydrateMessages(history: AssistantMessage[], userText: string): AgentMessage[] {
  const out: AgentMessage[] = [];
  // The chat route saves the user turn before running the agent; drop that
  // trailing copy — agent.prompt() appends it again.
  const trimmed = history.slice();
  const last = trimmed[trimmed.length - 1];
  if (last?.role === 'user' && last.content.trim() === userText.trim()) {
    trimmed.pop();
  }
  for (const m of trimmed) {
    const text = m.content.trim();
    if (!text) continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
    } else if (m.role === 'assistant') {
      // Historical assistant turns: real text content; metadata is unknown, so
      // fill neutral placeholders pi requires on every assistant message.
      out.push({
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: 'openai-completions',
        provider: 'omniroute',
        model: '',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      });
    }
  }
  return out;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Extract reply text + send_message tool calls from the final assistant message. */
export function extractTurnResult(agent: Agent): PiTurnResult | null {
  const last = [...agent.state.messages].reverse().find((m) => m.role === 'assistant');
  if (!last) return null;
  const reply = last.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (!reply) return null;

  const toolCalls: PiSendMessageCall[] = [];
  for (const c of last.content) {
    if (c.type !== 'toolCall' || c.name !== 'send_message') continue;
    const conversationId = asString(c.arguments.conversation_id);
    const content = asString(c.arguments.content);
    if (!conversationId || !content) continue;
    const reason = asString(c.arguments.reason);
    toolCalls.push({ conversation_id: conversationId, content, reason: reason || undefined });
  }

  return { reply, toolCalls };
}

/**
 * Run one assistant turn through the pi agent loop. Returns null on any
 * failure (timeout, network, empty reply) so callers fall back to the
 * deterministic heuristic — AI output is derived data, never a dependency.
 */
export async function runPiAssistantTurn(
  userText: string,
  history: AssistantMessage[],
  settings: AppSettings,
  options: PiAssistantTurnOptions
): Promise<PiTurnResult | null> {
  const models = options.models ?? getPiModels(settings);
  const model = models.getModel('omniroute', settings.omniroute_model || OMNIROUTE_DEFAULT_MODEL);
  if (!model) return null;

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model,
      tools: [sendMessageTool],
      messages: hydrateMessages(history, userText),
    },
    streamFn: (m, context, streamOptions) => models.streamSimple(m, context, streamOptions),
    beforeToolCall: async () => {
      // Human-first gate: capture the proposal, never execute.
      return { block: true, reason: 'Đề xuất đã được ghi nhận — người dùng xác nhận trước khi gửi' };
    },
    shouldStopAfterTurn: async () => true,
  });

  try {
    const { promise, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(
      () => reject(new Error(`pi agent turn timed out after ${PI_TURN_TIMEOUT_MS}ms`)),
      PI_TURN_TIMEOUT_MS
    );
    try {
      await Promise.race([agent.prompt(userText), promise]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('[pi-agent] turn failed:', err instanceof Error ? err.message : err);
    return null;
  }

  return extractTurnResult(agent);
}
