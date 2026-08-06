import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { dbQueries, resetDatabase } from '@/lib/db/sqlite';
import { GET as assistantMessagesGET } from '@/app/api/assistant/messages/route';
import { POST as assistantChatPOST } from '@/app/api/assistant/chat/route';
import { POST as assistantActionsPOST } from '@/app/api/assistant/actions/route';
import {
  actionIdFor,
  buildAssistantContext,
  normalizeKey,
  sanitizeAssistantActions,
} from '@/lib/ai/assistant';
import { AssistantAction } from '@/types';

// Route handlers are exercised directly (no HTTP server). All tests run the
// deterministic `smart_heuristic` provider — no LLM, no network.

function postChat(message: string) {
  return assistantChatPOST(new NextRequest('http://localhost/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }));
}

function postAction(messageId: string, actionId: string) {
  return assistantActionsPOST(new NextRequest('http://localhost/api/assistant/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id: messageId, action_id: actionId }),
  }));
}

beforeEach(() => {
  resetDatabase();
  dbQueries.updateSettings({
    ai_provider: 'smart_heuristic',
    auto_task_extraction: false,
    auto_task_completion: false,
    auto_memory_extraction: false,
    auto_summary: false,
    auto_embeddings: false,
  });
});

describe('AI assistant — context', () => {
  it('normalizeKey folds diacritics and case for name matching', () => {
    expect(normalizeKey('Chị Ngân')).toBe('chi ngan');
    expect(normalizeKey('  ANH   TUẤN ')).toBe('anh tuan');
  });

  it('buildAssistantContext snapshots screen, open chat, tasks and directory', () => {
    const bundle = buildAssistantContext({
      screen: 'chats',
      conversation_id: 'conv_tuan_01',
      conversation_name: 'Anh Tuấn (Công ty Tin Học A)',
    });

    expect(bundle.conversation?.id).toBe('conv_tuan_01');
    expect(bundle.screenLabel).toBe('Hội thoại');
    expect(bundle.currentMessages.some(l => l.includes('báo giá 5 bộ máy tính Dell'))).toBe(true);
    expect(bundle.pendingTasks.some(l => l.includes('Gửi báo giá 5 bộ máy tính Dell'))).toBe(true);
    expect(bundle.directory.some(d => d.id === 'conv_tuan_01')).toBe(true);
    expect(bundle.directory.some(d => d.id === 'conv_mai_02')).toBe(true);
  });

  it('sanitizeAssistantActions drops hallucinated ids, foreign types and duplicates', () => {
    const bundle = buildAssistantContext({ screen: 'dashboard' });
    const goodId = bundle.directory[0].id;
    const raw = [
      { type: 'send_message', conversation_id: goodId, content: 'Xin chào', reason: 'test' },
      { type: 'send_message', conversation_id: 'conv_hallucinated', content: 'spam' },
      { type: 'delete_everything', conversation_id: goodId, content: 'hack' },
      { type: 'send_message', conversation_id: goodId, content: 'Xin chào' },
    ];
    const out = sanitizeAssistantActions(raw, bundle);
    expect(out).toHaveLength(1);
    expect(out[0].conversation_id).toBe(goodId);
    expect(out[0].content).toBe('Xin chào');
    expect(out[0].id).toBe(actionIdFor('send_message', goodId, 'Xin chào'));
  });
});

describe('POST /api/assistant/chat (heuristic provider)', () => {
  it('proposes a send_message action without executing anything (human-first gate)', async () => {
    const res = await postChat('Trả lời chị Mai là mai sẽ làm xong');
    expect(res.status).toBe(200);
    const data = await res.json();

    const actions = data.assistantMessage.actions as AssistantAction[];
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('send_message');
    expect(actions[0].conversation_id).toBe('conv_mai_02');
    expect(actions[0].conversation_name).toContain('Chị Mai');
    expect(actions[0].content).toBe('mai sẽ làm xong');
    expect(data.assistantMessage.content).toContain('Chị Mai');

    // Confirm-gate: the assistant only proposed — no message reached the conversation.
    expect(dbQueries.getMessagesByConversationId('conv_mai_02')).toHaveLength(2);

    // History persisted in order (user then assistant).
    const history = await (await assistantMessagesGET()).json();
    expect(history.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(history.messages[0].content).toBe('Trả lời chị Mai là mai sẽ làm xong');
  });

  it('answers pending-task questions deterministically', async () => {
    const res = await postChat('có việc gì cần làm không');
    const data = await res.json();
    expect(data.assistantMessage.content).toContain('đang chờ');
    expect(data.assistantMessage.content).toContain('Gửi báo giá 5 bộ máy tính Dell cho Anh Tuấn');
    expect(data.assistantMessage.actions).toHaveLength(0);
  });

  it('refuses to invent a conversation when the person is unknown', async () => {
    const res = await postChat('Trả lời anh XYZ là ok');
    const data = await res.json();
    expect(data.assistantMessage.actions).toHaveLength(0);
    expect(data.assistantMessage.content).toContain('không tìm thấy');
  });

  it('rejects empty messages', async () => {
    const res = await postChat('   ');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/assistant/actions', () => {
  it('executes a confirmed send_message and persists the result idempotently', async () => {
    const chatData = await (await postChat('Trả lời chị Mai là mai sẽ làm xong')).json();
    const action = chatData.assistantMessage.actions[0] as AssistantAction;

    const exec1 = await (await postAction(chatData.assistantMessage.id, action.id)).json();
    expect(exec1.result.ok).toBe(true);
    expect(exec1.result.sent).toBe(true);
    expect(exec1.result.via_zalo).toBe(false);
    expect(exec1.result.message_id).toBeTruthy();

    const msgs = dbQueries.getMessagesByConversationId('conv_mai_02');
    expect(msgs).toHaveLength(3);
    expect(msgs[2].is_from_me).toBe(true);
    expect(msgs[2].content).toBe('mai sẽ làm xong');

    // Idempotent: the same action id never executes twice.
    const exec2 = await (await postAction(chatData.assistantMessage.id, action.id)).json();
    expect(exec2.result.id).toBe(action.id);
    expect(dbQueries.getMessagesByConversationId('conv_mai_02')).toHaveLength(3);

    // The result is attached to the assistant message for the UI.
    const stored = dbQueries.getAssistantMessageById(chatData.assistantMessage.id);
    expect(stored?.action_results).toHaveLength(1);
    expect(stored?.action_results[0].sent).toBe(true);
  });

  it('rejects actions that were never proposed', async () => {
    const res = await postAction('am_nope', 'act_nope');
    expect(res.status).toBe(404);
    const noMessage = await postAction('am_nope', 'act_nope');
    expect(noMessage.status).toBe(404);
  });

  it('rejects a missing action id within a real proposal', async () => {
    const chatData = await (await postChat('Trả lời chị Mai là mai sẽ làm xong')).json();
    const res = await postAction(chatData.assistantMessage.id, 'act_other');
    expect(res.status).toBe(404);
    expect(dbQueries.getMessagesByConversationId('conv_mai_02')).toHaveLength(2);
  });
});
