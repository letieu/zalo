import { describe, it, expect, beforeEach } from 'vitest';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { dbQueries, resetDatabase } from '@/lib/db/sqlite';
import { extractTurnResult, hydrateMessages, runPiAssistantTurn } from '@/lib/ai/pi-agent';
import { AssistantMessage } from '@/types';

// Deterministic pi-agent tests: the LLM is a scripted fauxProvider inside a
// `createModels()` registry injected via options.models — no network, no
// real LLM. The registered provider id is `omniroute` and the model id is
// `auto/best-fast`, mirroring what runPiAssistantTurn looks up.

const MODEL_ID = 'auto/best-fast';
const BLOCK_REASON = 'Đề xuất đã được ghi nhận — người dùng xác nhận trước khi gửi';

function assistantMessage(partial: Partial<AssistantMessage>): AssistantMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: '',
    actions: [],
    action_results: [],
    created_at: new Date().toISOString(),
    ...partial,
  };
}

function registerFaux() {
  const faux = fauxProvider({ provider: 'omniroute', models: [{ id: MODEL_ID }] });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

beforeEach(() => {
  resetDatabase();
});

describe('pi-agent — hydrateMessages', () => {
  it('drops the trailing duplicate user message the chat route already saved', () => {
    const history = [
      assistantMessage({ role: 'user', content: 'chào' }),
      assistantMessage({ role: 'assistant', content: 'xin chào' }),
      assistantMessage({ role: 'user', content: 'chào' }),
    ];
    const out = hydrateMessages(history, 'chào');
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('user');
    expect(out[1].role).toBe('assistant');
  });

  it('maps text-only content and keeps the transcript order', () => {
    const history = [
      assistantMessage({ role: 'user', content: '  gửi báo giá  ' }),
      assistantMessage({ role: 'assistant', content: 'Đã đề xuất.' }),
    ];
    const out = hydrateMessages(history, 'tin nhắn khác');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'gửi báo giá' }] });
    expect(out[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Đã đề xuất.' }] });
    // Every message carries the metadata pi requires.
    expect(out[1]).toHaveProperty('api');
    expect(out[1]).toHaveProperty('usage.totalTokens');
    expect(out[1]).toHaveProperty('stopReason');
  });

  it('skips empty assistant messages', () => {
    const history = [assistantMessage({ role: 'user', content: 'x' }), assistantMessage({ role: 'assistant', content: '   ' })];
    expect(hydrateMessages(history, 'y')).toHaveLength(1);
  });
});

describe('pi-agent — extractTurnResult', () => {
  it('joins text parts and maps valid send_message tool calls', () => {
    const { faux, models } = registerFaux();
    const agent = new Agent({
      initialState: {
        systemPrompt: 'test',
        model: faux.models[0],
        tools: [],
        messages: [
          fauxAssistantMessage([
            fauxText('Đã đề xuất.'),
            fauxToolCall(
              'send_message',
              { conversation_id: 'conv_mai_02', content: '  xong nhé  ', reason: 'khách nhờ' },
              { id: 'call_1' }
            ),
            fauxToolCall('other_tool', { foo: 'bar' }),
          ]),
        ],
      },
      streamFn: async () => {
        throw new Error('not used in this test');
      },
    });

    const result = extractTurnResult(agent);
    expect(result?.reply).toBe('Đã đề xuất.');
    expect(result?.toolCalls).toEqual([{ conversation_id: 'conv_mai_02', content: 'xong nhé', reason: 'khách nhờ' }]);
  });

  it('trims args and drops tool calls with missing/blank fields', () => {
    const { faux } = registerFaux();
    const agent = new Agent({
      initialState: {
        systemPrompt: 'test',
        model: faux.models[0],
        tools: [],
        messages: [
          fauxAssistantMessage([
            fauxText('ok'),
            fauxToolCall('send_message', { conversation_id: '  ', content: 'x' }),
            fauxToolCall('send_message', { conversation_id: 'conv_1', content: '' }),
            fauxToolCall('send_message', { conversation_id: 'conv_1', content: 'ok' }),
          ]),
        ],
      },
      streamFn: async () => {
        throw new Error('not used in this test');
      },
    });

    const result = extractTurnResult(agent);
    expect(result?.toolCalls).toEqual([{ conversation_id: 'conv_1', content: 'ok' }]);
  });

  it('returns null without an assistant message or reply text', () => {
    const { faux } = registerFaux();
    const empty = new Agent({
      initialState: { systemPrompt: 'test', model: faux.models[0], tools: [], messages: [] },
      streamFn: async () => {
        throw new Error('not used in this test');
      },
    });
    expect(extractTurnResult(empty)).toBeNull();

    const toolOnly = new Agent({
      initialState: {
        systemPrompt: 'test',
        model: faux.models[0],
        tools: [],
        messages: [fauxAssistantMessage([fauxToolCall('send_message', { conversation_id: 'c', content: 'x' })])],
      },
      streamFn: async () => {
        throw new Error('not used in this test');
      },
    });
    expect(extractTurnResult(toolOnly)).toBeNull();
  });
});

describe('pi-agent — runPiAssistantTurn', () => {
  it('proposes send_message via a tool call and returns the mapped result', async () => {
    const { faux, models } = registerFaux();
    faux.setResponses([
      fauxAssistantMessage([
        fauxText('Đã đề xuất.'),
        fauxToolCall(
          'send_message',
          { conversation_id: 'conv_mai_02', content: 'xong nhé', reason: 'khách nhờ' },
          { id: 'call_1' }
        ),
      ]),
    ]);

    const settings = dbQueries.getSettings();
    settings.omniroute_model = MODEL_ID;
    const result = await runPiAssistantTurn('trả lời chị Mai là xong nhé', [], settings, {
      systemPrompt: 'Bạn là trợ lý.',
      models,
    });

    expect(result?.reply).toBe('Đã đề xuất.');
    expect(result?.toolCalls).toEqual([{ conversation_id: 'conv_mai_02', content: 'xong nhé', reason: 'khách nhờ' }]);
    // Exactly one model turn was consumed — the loop stopped after the proposal.
    expect(faux.state.callCount).toBe(1);
    expect(faux.getPendingResponseCount()).toBe(0);
  });

  it('keeps the human-first gate: blocked tool calls never execute', async () => {
    const { faux, models } = registerFaux();
    let executed = 0;
    const tool: AgentTool = {
      name: 'send_message',
      label: 'Gửi tin nhắn Zalo',
      description: 'Đề xuất gửi tin nhắn',
      parameters: Type.Object({ conversation_id: Type.String(), content: Type.String() }),
      execute: async () => {
        executed += 1;
        return { content: [{ type: 'text' as const, text: 'đã gửi' }], details: undefined };
      },
    };

    const agent = new Agent({
      initialState: {
        systemPrompt: 'Bạn là trợ lý.',
        model: faux.models[0],
        tools: [tool],
        messages: [],
      },
      streamFn: (m, context, streamOptions) => models.streamSimple(m, context, streamOptions),
      beforeToolCall: async () => ({ block: true, reason: BLOCK_REASON }),
      shouldStopAfterTurn: async () => true,
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('send_message', { conversation_id: 'conv_1', content: 'xong nhé' }),
        fauxText('Đã đề xuất.'),
      ]),
    ]);

    await agent.prompt('gửi tin nhắn');

    expect(executed).toBe(0);
    const toolResult = agent.state.messages.find((m) => m.role === 'toolResult');
    expect(toolResult?.isError).toBe(true);
    expect(JSON.stringify(toolResult?.content)).toContain('người dùng xác nhận');
  });

  it('returns null when the model is not registered (fallback trigger)', async () => {
    const { faux, models } = registerFaux();
    const settings = dbQueries.getSettings();
    settings.omniroute_model = 'missing-model';
    const result = await runPiAssistantTurn('x', [], settings, {
      systemPrompt: 'Bạn là trợ lý.',
      models,
    });
    expect(result).toBeNull();
    expect(faux.state.callCount).toBe(0);
  });

  it('returns null when the provider stream fails (fallback trigger)', async () => {
    const { faux, models } = registerFaux();
    faux.setResponses([
      () => {
        throw new Error('network down');
      },
    ]);
    const settings = dbQueries.getSettings();
    settings.omniroute_model = MODEL_ID;
    const result = await runPiAssistantTurn('x', [], settings, {
      systemPrompt: 'Bạn là trợ lý.',
      models,
    });
    expect(result).toBeNull();
  });
});
