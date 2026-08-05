import { describe, it, expect, beforeEach } from 'vitest';
import { AIProcessor } from '@/lib/ai/processor';
import { dbQueries, resetDatabase } from '@/lib/db/sqlite';
import { AppSettings, Message, Task, AIAnalysisResult } from '@/types';

beforeEach(() => resetDatabase());

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...dbQueries.getSettings(), ...overrides };
}

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm' + Math.random(),
    conversation_id: 'c1',
    zalo_msg_id: 'z' + Math.random(),
    sender_id: 's',
    sender_name: 'Khách',
    is_from_me: false,
    content: '',
    timestamp: new Date().toISOString(),
    ai_processed: false,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't' + Math.random(),
    conversation_id: 'c1',
    title: 'Gửi báo giá 5 bộ máy tính Dell cho Anh Tuấn',
    status: 'pending',
    priority: 'medium',
    ai_created: true,
    ai_completed: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('analyzeConversation — heuristic engine (no network)', () => {
  it('extracts a high-priority task with deadline from a request message', async () => {
    const result = await AIProcessor.analyzeConversation(
      [msg({ content: 'Em ơi gửi giúp anh báo giá 5 bộ máy tính trước 4h chiều nay nhé!' })],
      [],
      settings({ ai_provider: 'smart_heuristic' })
    );
    expect(result.newTasks.length).toBe(1);
    const t = result.newTasks[0];
    expect(t.priority).toBe('high'); // "trước 4h" → high
    expect(t.deadline).toBeDefined();
    expect(t.source_msg_id).toBeDefined();
  });

  it('skips already-processed messages', async () => {
    const result = await AIProcessor.analyzeConversation(
      [msg({ content: 'gửi giúp anh báo giá nhé', ai_processed: true })],
      [],
      settings({ ai_provider: 'smart_heuristic' })
    );
    expect(result.newTasks).toHaveLength(0);
  });

  it('ignores self completion messages for task creation', async () => {
    const result = await AIProcessor.analyzeConversation(
      [msg({ content: 'Dạ em đã gửi file báo giá cho anh rồi ạ', is_from_me: true })],
      [],
      settings({ ai_provider: 'smart_heuristic' })
    );
    expect(result.newTasks).toHaveLength(0);
  });

  it('matches a completion statement to a pending task', async () => {
    const pending = [task({ id: 'task_9001' })];
    const result = await AIProcessor.analyzeConversation(
      [msg({ content: 'Dạ em đã gửi file báo giá Dell cho anh Tuấn rồi nhé', is_from_me: true })],
      pending,
      settings({ ai_provider: 'smart_heuristic' })
    );
    expect(result.completedTaskIds.map(c => c.task_id)).toContain('task_9001');
  });

  it('does not complete a task on an unrelated confirmation', async () => {
    const pending = [task({ id: 'task_9002', title: 'Đặt 10 thùng nước ngọt' })];
    const result = await AIProcessor.analyzeConversation(
      [msg({ content: 'Dạ em đã gửi báo giá máy tính rồi ạ', is_from_me: true })],
      pending,
      settings({ ai_provider: 'smart_heuristic' })
    );
    expect(result.completedTaskIds).toHaveLength(0);
  });

  it('falls back to heuristics when provider has no credentials (no network calls)', async () => {
    const result = await AIProcessor.analyzeConversation(
      [msg({ content: 'gửi giúp anh báo giá máy in nhé' })],
      [],
      settings({ ai_provider: 'gemini' }) // no gemini_api_key
    );
    expect(result.newTasks.length).toBe(1);

    const viaOpenAI = await AIProcessor.analyzeConversation(
      [msg({ content: 'gửi giúp anh báo giá máy in nhé' })],
      [],
      settings({ ai_provider: 'openai' }) // no openai_api_key
    );
    expect(viaOpenAI.newTasks.length).toBe(1);
  });
});

describe('parseLLMResponse (private, fence-stripping)', () => {
  // Unchecked cast: the method is private and only reachable via network paths;
  // the test pins its exact offline contract (fence stripping, malformed JSON).
  const parse = (AIProcessor as unknown as {
    parseLLMResponse(jsonStr: string): AIAnalysisResult;
  }).parseLLMResponse;

  it('strips ```json fences and parses', () => {
    const r = parse('```json\n{"newTasks":[{"title":"A","priority":"high"}],"completedTaskIds":[]}\n```');
    expect(r.newTasks[0]).toMatchObject({ title: 'A', priority: 'high' });
  });

  it('tolerates malformed JSON → empty result (never throws)', () => {
    expect(() => parse('not json at all')).not.toThrow();
    expect(parse('not json at all')).toEqual({ newTasks: [], completedTaskIds: [] });
  });
});

