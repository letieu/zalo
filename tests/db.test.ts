import { describe, it, expect, beforeEach } from 'vitest';
import { dbQueries, initDB, resetDatabase } from '@/lib/db/sqlite';

beforeEach(() => resetDatabase());

describe('schema + seed', () => {
  it('initDB is idempotent', () => {
    expect(() => initDB()).not.toThrow();
  });

  it('seeds 3 conversations, contacts, memories, tasks', () => {
    expect(dbQueries.getConversations().map(c => c.name)).toEqual([
      'Anh Tuấn (Công ty Tin Học A)',
      'Chị Mai (Shop Thời Trang)',
      'Đức (Designer)',
    ]);
    expect(dbQueries.getContacts().length).toBeGreaterThanOrEqual(3);
    expect(dbQueries.getMemories(999).length).toBeGreaterThanOrEqual(5);
    expect(dbQueries.getTasks().length).toBeGreaterThanOrEqual(3);
  });

  it('conversations carry a computed pending_task_count', () => {
    const conv = dbQueries.getConversations()[0];
    expect(conv.pending_task_count).toBeGreaterThanOrEqual(0);
  });

  it('living-doc fields parse with safe defaults', () => {
    const conv = dbQueries.getConversations()[0];
    const byId = dbQueries.getConversationById(conv.id);
    expect(byId).toBeDefined();
    expect(byId!.summary).toBeUndefined();
    expect(byId!.open_topics).toEqual([]);
    expect(byId!.importance).toBe(0);
  });
});

describe('messages', () => {
  it('addMessage persists and round-trips', () => {
    const conv = dbQueries.getConversations()[0];
    const msg = dbQueries.addMessage({
      id: 'msg_unit_1',
      conversation_id: conv.id,
      zalo_msg_id: 'zm_unit_1',
      sender_id: 'someone',
      sender_name: 'Người gửi',
      is_from_me: false,
      content: 'Nội dung kiểm thử',
      timestamp: new Date().toISOString(),
      ai_processed: false,
    });
    const got = dbQueries.getMessageByZaloMsgId('zm_unit_1');
    expect(got?.id).toBe(msg.id);
    expect(got?.is_from_me).toBe(false);
    expect(dbQueries.getMessageById(msg.id)?.content).toBe('Nội dung kiểm thử');
  });

  it('zalo_msg_id UNIQUE constraint is the last line of dedupe', () => {
    const conv = dbQueries.getConversations()[0];
    const base = {
      conversation_id: conv.id,
      sender_id: 's',
      sender_name: 'S',
      is_from_me: false,
      content: 'x',
      timestamp: new Date().toISOString(),
      ai_processed: false,
    };
    dbQueries.addMessage({ ...base, id: 'a', zalo_msg_id: 'dup' });
    expect(() => dbQueries.addMessage({ ...base, id: 'b', zalo_msg_id: 'dup' })).toThrow();
  });

  it('updates conversation last_message and unread counter', () => {
    const conv = dbQueries.getConversations()[0];
    const before = conv.unread_count || 0;
    dbQueries.addMessage({
      id: 'msg_unit_2',
      conversation_id: conv.id,
      zalo_msg_id: 'zm_unit_2',
      sender_id: 's',
      sender_name: 'S',
      is_from_me: false,
      content: 'tin nhắn mới',
      timestamp: new Date().toISOString(),
      ai_processed: false,
    });
    const after = dbQueries.getConversationById(conv.id);
    expect(after?.last_message).toBe('tin nhắn mới');
    expect(after?.unread_count).toBe(before + 1);
  });
});

describe('withTransaction', () => {
  it('commits all writes atomically', () => {
    const conv = dbQueries.getConversations()[0];
    const msgId = dbQueries.withTransaction(() => {
      const m = dbQueries.addMessage({
        id: 'msg_tx_1', conversation_id: conv.id, zalo_msg_id: 'zm_tx_1',
        sender_id: 's', sender_name: 'S', is_from_me: false,
        content: 'tx', timestamp: new Date().toISOString(), ai_processed: false,
      });
      dbQueries.publishEvent('message.saved', { message_id: m.id, conversation_id: conv.id });
      return m.id;
    });
    expect(dbQueries.getMessageById(msgId)).toBeDefined();
    expect(dbQueries.getPendingEvents()).toHaveLength(1);
  });

  it('rolls back every write when the body throws', () => {
    const conv = dbQueries.getConversations()[0];
    expect(() =>
      dbQueries.withTransaction(() => {
        dbQueries.addMessage({
          id: 'msg_tx_2', conversation_id: conv.id, zalo_msg_id: 'zm_tx_2',
          sender_id: 's', sender_name: 'S', is_from_me: false,
          content: 'tx', timestamp: new Date().toISOString(), ai_processed: false,
        });
        dbQueries.publishEvent('message.saved', { message_id: 'msg_tx_2', conversation_id: conv.id });
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(dbQueries.getMessageById('msg_tx_2')).toBeUndefined();
    expect(dbQueries.getPendingEvents()).toHaveLength(0);
  });
});

describe('outbox (events + deliveries)', () => {
  it('publishEvent → getPendingEvents round-trips payload JSON', () => {
    const evt = dbQueries.publishEvent('message.saved', { message_id: 'm1', conversation_id: 'c1' });
    const pending = dbQueries.getPendingEvents();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(evt.id);
    expect(pending[0].payload).toEqual({ message_id: 'm1', conversation_id: 'c1' });
  });

  it('delivery marking is idempotent and checked per worker', () => {
    const evt = dbQueries.publishEvent('message.saved', { message_id: 'm1' });
    expect(dbQueries.isEventDelivered(evt.id, 'task')).toBe(false);
    dbQueries.markEventDelivered(evt.id, 'task');
    expect(dbQueries.isEventDelivered(evt.id, 'task')).toBe(true);
    expect(dbQueries.isEventDelivered(evt.id, 'memory')).toBe(false);
    dbQueries.markEventDelivered(evt.id, 'task'); // INSERT OR IGNORE
    dbQueries.markEventDelivered(evt.id, 'memory');
    expect(dbQueries.isEventDelivered(evt.id, 'memory')).toBe(true);
  });
});

describe('contacts', () => {
  it('upsertContact creates, then merges by name without duplicates', () => {
    const a = dbQueries.upsertContact({ name: 'Nguyễn Văn A', external_id: 'zid_a', source_provider: 'zalo' });
    const b = dbQueries.upsertContact({ name: 'Nguyễn Văn A', external_id: 'zid_a', phone: '0901', source_provider: 'zalo' });
    expect(b.id).toBe(a.id);
    expect(dbQueries.getContacts().filter(c => c.name === 'Nguyễn Văn A')).toHaveLength(1);
    expect(dbQueries.getContactById(a.id)?.phones).toContain('0901');
  });

  it('updateContactProfile sets fields; touchContactInteraction stamps last_interaction_at', () => {
    const c = dbQueries.getContacts()[0];
    const before = c.last_interaction_at;
    dbQueries.updateContactProfile(c.id, { notes: 'ghi chú' });
    const patched = dbQueries.getContactById(c.id)!;
    expect(patched.notes).toBe('ghi chú');
    expect(patched.last_interaction_at).toBe(before); // profile patch never touches it
    dbQueries.touchContactInteraction(c.id);
    const after = dbQueries.getContactById(c.id)!;
    expect(new Date(after.last_interaction_at!).getTime())
      .toBeGreaterThanOrEqual(new Date(before!).getTime());
  });
});

describe('memories', () => {
  it('dedupes on UNIQUE(contact_id, category, content)', () => {
    const contact = dbQueries.getContacts()[0];
    const m1 = dbQueries.addMemory({ contact_id: contact.id, category: 'email', content: 'x@gmail.com', confidence: 0.9 });
    const m2 = dbQueries.addMemory({ contact_id: contact.id, category: 'email', content: 'x@gmail.com', confidence: 0.9 });
    expect(m1).toBeDefined();
    expect(m2).toBeUndefined(); // conflict → insert refused, no duplicate row
    expect(dbQueries.getMemories(999).filter(m => m.content === 'x@gmail.com')).toHaveLength(1);
  });

  it('filters by limit and contact', () => {
    const contact = dbQueries.getContacts()[0];
    const all = dbQueries.getMemories(999);
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(dbQueries.getMemories(2).length).toBe(2);
    expect(dbQueries.getMemories(999, contact.id).every(m => m.contact_id === contact.id)).toBe(true);
  });
});

describe('tasks', () => {
  it('CRUD + status transitions', () => {
    const conv = dbQueries.getConversations()[0];
    const t = dbQueries.addTask({
      conversation_id: conv.id, title: 'Việc kiểm thử', status: 'pending',
      priority: 'high', deadline: '2026-12-31', ai_created: true, ai_completed: false,
    });
    expect(dbQueries.getTasks(conv.id, 'pending').map(x => x.id)).toContain(t.id);

    const done = dbQueries.updateTaskStatus(t.id, 'completed', 'đã xong', true);
    expect(done?.status).toBe('completed');
    expect(done?.ai_completed).toBe(true);
    expect(done?.completion_reason).toBe('đã xong');
    expect(done?.completed_at).toBeDefined();

    dbQueries.deleteTask(t.id);
    expect(dbQueries.getTasks(conv.id).map(x => x.id)).not.toContain(t.id);
  });
  it('getTasks with no args returns all tasks', () => {
    expect(dbQueries.getTasks().length).toBeGreaterThanOrEqual(3);
  });
});

describe('briefs + settings', () => {
  it('saveBrief is upsert-per-date, getBrief returns latest', () => {
    expect(dbQueries.getBrief('2026-01-01')).toBeNull();
    dbQueries.saveBrief('2026-01-01', 'bản 1');
    expect(dbQueries.getBrief('2026-01-01')).toBe('bản 1');
    dbQueries.saveBrief('2026-01-01', 'bản 2');
    expect(dbQueries.getBrief('2026-01-01')).toBe('bản 2');
  });

  it('auto toggles round-trip as real booleans', () => {
    dbQueries.updateSettings({ auto_task_extraction: false, auto_summary: false, auto_embeddings: true });
    const s = dbQueries.getSettings();
    expect(s.auto_task_extraction).toBe(false);
    expect(s.auto_summary).toBe(false);
    expect(s.auto_embeddings).toBe(true);
    expect(s.ai_provider).toBe('omniroute');
  });
});

describe('updateConversationMeta', () => {
  it('partial update preserves untouched fields', () => {
    const conv = dbQueries.getConversations()[0];
    dbQueries.updateConversationMeta(conv.id, { summary: 'tóm tắt', importance: 77 });
    const after = dbQueries.getConversationById(conv.id)!;
    expect(after.summary).toBe('tóm tắt');
    expect(after.importance).toBe(77);
    expect(after.open_topics).toEqual([]);
  });
});
