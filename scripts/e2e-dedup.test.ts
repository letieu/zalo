/**
 * LIVE E2E smoke for the duplicate-task fix — requires the in-cluster
 * omniroute LLM gateway, so it is excluded from `npm test` (see
 * vitest.config.ts) and must be run explicitly:
 *
 *   npx vitest run scripts/e2e-dedup.test.ts
 *
 * Reproduces the production bug: customer complaint creates a task, the
 * agent's follow-up reply ("dạ để em check rồi em thêm lại ạ") must fold
 * into that task — exactly ONE open task per issue.
 */
import { describe, it, expect } from 'vitest';
import { handleIncomingMessage } from '@/lib/ai/pipeline';
import { dbQueries, resetDatabase } from '@/lib/db/sqlite';

const INGEST = {
  conversation_id: 'conv_e2e_' + Date.now(),
  sender_id: 'c1',
  sender_name: 'Khách',
};

async function seedConv(): Promise<string> {
  resetDatabase();
  dbQueries.updateSettings({
    auto_task_extraction: true,
    auto_task_completion: true,
    auto_memory_extraction: false,
    auto_summary: false,
    auto_embeddings: false,
    ai_provider: 'omniroute',
  });
  const id = INGEST.conversation_id;
  dbQueries.addConversation({
    id,
    zalo_thread_id: 'zt_e2e_' + Date.now(),
    name: 'E2E Khách',
    avatar: '',
    type: 'individual',
    unread_count: 0,
    updated_at: new Date().toISOString(),
  });
  return id;
}

describe('live dedup E2E (real omniroute LLM)', () => {
  it(
    'complaint + agent follow-up → exactly ONE open task',
    async () => {
      const convId = await seedConv();
      const t0 = Date.now();

      await handleIncomingMessage({
        ...INGEST,
        conversation_id: convId,
        zalo_msg_id: 'e2e_1',
        is_from_me: false,
        content: 'ko thể hiện hoá đơn liên quan',
        timestamp: new Date(t0).toISOString(),
      });
      await handleIncomingMessage({
        ...INGEST,
        conversation_id: convId,
        zalo_msg_id: 'e2e_2',
        sender_id: 'me',
        sender_name: 'Tôi',
        is_from_me: true,
        content: 'dạ để em check rồi em thêm lại ạ',
        timestamp: new Date(t0 + 60_000).toISOString(),
      });

      const pending = dbQueries.getTasks(convId, 'pending');
      expect(pending.length).toBe(1);
      expect(pending[0].title).toMatch(/hóa đơn|hoá đơn/i);
    },
    120_000
  );

  it(
    'a genuinely different request still creates a second task',
    async () => {
      const convId = await seedConv();
      const t0 = Date.now();

      await handleIncomingMessage({
        ...INGEST,
        conversation_id: convId,
        zalo_msg_id: 'e2e_b1',
        is_from_me: false,
        content: 'ko thể hiện hoá đơn liên quan',
        timestamp: new Date(t0).toISOString(),
      });
      await handleIncomingMessage({
        ...INGEST,
        conversation_id: convId,
        zalo_msg_id: 'e2e_b2',
        sender_id: 'me',
        sender_name: 'Tôi',
        is_from_me: true,
        content: 'dạ để em check rồi em thêm lại ạ',
        timestamp: new Date(t0 + 60_000).toISOString(),
      });
      await handleIncomingMessage({
        ...INGEST,
        conversation_id: convId,
        zalo_msg_id: 'e2e_b3',
        is_from_me: false,
        content: 'gửi giúp anh báo giá 5 bộ máy tính Dell trước 4h chiều nay nhé',
        timestamp: new Date(t0 + 120_000).toISOString(),
      });

      const pending = dbQueries.getTasks(convId, 'pending');
      expect(pending.length).toBe(2);
      const titles = pending.map(t => t.title.toLowerCase());
      expect(titles.some(t => t.includes('báo giá') || t.includes('bao gia') || t.includes('dell'))).toBe(true);
    },
    120_000
  );
});
