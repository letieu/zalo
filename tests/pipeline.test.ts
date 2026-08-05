import { describe, it, expect, beforeEach } from 'vitest';
import { handleIncomingMessage } from '@/lib/ai/pipeline';
import { dbQueries, resetDatabase } from '@/lib/db/sqlite';

// Importing pipeline pulls in workers/index → all 5 workers self-register.
// With every auto_* toggle off the drain stays deterministic (no LLM calls).
// NOTE: `events` is a durable log — rows persist after delivery; delivery is
// tracked in `event_deliveries`. Assert on log size (publish-once) and on
// per-worker delivery rows, never on "empty" event tables.

const noLLM = {
  auto_task_extraction: false,
  auto_task_completion: false,
  auto_memory_extraction: false,
  auto_summary: false,
  auto_embeddings: false,
};

const ALL_WORKERS = ['task', 'memory', 'summary', 'contact', 'embedding'];

function freshConv() {
  const id = 'conv_test_' + Date.now();
  dbQueries.addConversation({
    id,
    zalo_thread_id: 'zt_' + Date.now(),
    name: 'Người Mới',
    avatar: '',
    type: 'individual',
    unread_count: 0,
    updated_at: new Date().toISOString(),
  });
  return dbQueries.getConversationById(id)!;
}

beforeEach(() => {
  resetDatabase();
  dbQueries.updateSettings(noLLM);
});

describe('handleIncomingMessage (outbox-driven ingestion)', () => {
  it('persists the message and returns aiResult: null (AI runs worker-side)', async () => {
    const conv = freshConv();
    const res = await handleIncomingMessage({
      conversation_id: conv.id,
      zalo_msg_id: 'zm_p_1',
      sender_id: 'zid_new',
      sender_name: 'Người Mới',
      is_from_me: false,
      content: 'Chào em, báo giá giúp anh nhé',
      timestamp: new Date().toISOString(),
    });
    expect(res.aiResult).toBeNull();
    expect(dbQueries.getMessageByZaloMsgId('zm_p_1')?.content).toBe('Chào em, báo giá giúp anh nhé');
  });

  it('publishes exactly one event; all 5 workers confirm delivery', async () => {
    const conv = freshConv();
    const res = await handleIncomingMessage({
      conversation_id: conv.id,
      zalo_msg_id: 'zm_p_5',
      sender_id: 'zid',
      sender_name: 'N',
      is_from_me: false,
      content: 'tin nhắn',
      timestamp: new Date().toISOString(),
    });

    const events = dbQueries.getPendingEvents();
    expect(events).toHaveLength(1); // published once
    expect(events[0].payload.message_id).toBe(res.message.id);
    for (const w of ALL_WORKERS) {
      expect(dbQueries.isEventDelivered(events[0].id, w), `worker '${w}' must deliver`).toBe(true);
    }
  });

  it('dedupes identical zalo_msg_id deliveries (no second publish)', async () => {
    const conv = freshConv();
    const input = {
      conversation_id: conv.id,
      zalo_msg_id: 'zm_p_dup',
      sender_id: 'zid',
      sender_name: 'N',
      is_from_me: false,
      content: 'lần 1',
      timestamp: new Date().toISOString(),
    };
    const a = await handleIncomingMessage(input);
    const b = await handleIncomingMessage({ ...input, content: 'lần 2' });
    expect(b.message.id).toBe(a.message.id);
    expect(dbQueries.getMessagesByConversationId(conv.id)).toHaveLength(1);
    expect(dbQueries.getPendingEvents()).toHaveLength(1); // still just the one
  });

  it('contact worker links an individual conversation to a contact', async () => {
    const conv = freshConv();
    expect(conv.contact_id).toBeUndefined();
    await handleIncomingMessage({
      conversation_id: conv.id,
      zalo_msg_id: 'zm_p_contact',
      sender_id: 'zid_new',
      sender_name: 'Người Mới',
      is_from_me: false,
      content: 'xin chào',
      timestamp: new Date().toISOString(),
    });
    const after = dbQueries.getConversationById(conv.id)!;
    expect(after.contact_id).toBeDefined();
    const contact = dbQueries.getContactById(after.contact_id!)!;
    expect(contact.name).toBe('Người Mới');
    expect(contact.last_interaction_at).toBeDefined();
  });

  it('embedding worker stores a vector when auto_embeddings is on', async () => {
    dbQueries.updateSettings({ auto_embeddings: true });
    const conv = freshConv();
    const res = await handleIncomingMessage({
      conversation_id: conv.id,
      zalo_msg_id: 'zm_p_emb',
      sender_id: 'zid',
      sender_name: 'N',
      is_from_me: false,
      content: 'em cần 10 thùng nước ngọt giao ngày mai',
      timestamp: new Date().toISOString(),
    });
    const emb = dbQueries.getMessageEmbedding(res.message.id);
    expect(emb).toBeDefined();
    expect(emb!.length).toBe(384);
  });

  it('disabled workers produce no tasks, memories, summaries', async () => {
    const conv = freshConv();
    const memBefore = dbQueries.getMemories(999).length;
    await handleIncomingMessage({
      conversation_id: conv.id,
      zalo_msg_id: 'zm_p_off',
      sender_id: 'zid',
      sender_name: 'N',
      is_from_me: false,
      content: 'Em ơi gửi giúp anh báo giá trước 5h nhé, địa chỉ mới của em là 99 Lê Lợi',
      timestamp: new Date().toISOString(),
    });
    expect(dbQueries.getMemories(999).length).toBe(memBefore);
    expect(dbQueries.getTasks(conv.id, 'pending')).toEqual([]);
    expect(dbQueries.getConversationById(conv.id)?.summary).toBeUndefined();
  });
});
