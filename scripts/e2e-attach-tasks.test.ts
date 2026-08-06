/**
 * LIVE smoke (dev server): attachments end-to-end + task requester/assignee
 * attribution through the real event pipeline (omniroute LLM).
 * Run: npx vitest run scripts/e2e-attach-tasks.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// getAllConversations orders by updated_at DESC: sending a message reorders the
// list, so pin ids ONCE and never re-derive indices mid-run.
let convTuan = '';
let convMai = '';

beforeAll(async () => {
  const { body } = await api('/api/conversations');
  convTuan = body.conversations[0].id;
  convMai = body.conversations[1].id;
  expect(convTuan).not.toBe(convMai);
});

describe('live: attachments + task separation', () => {
  it('renders an image attachment through the mock route (no raw JSON blob)', async () => {
    const { status, body } = await api('/api/mock/send-customer-msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: convTuan,
        content: 'Ảnh chụp hàng đã đóng gói đây em',
        customer_name: 'Anh Tuấn',
        attachment: { kind: 'image', url: 'https://picsum.photos/seed/zalo-crm/800/600', thumb: 'https://picsum.photos/seed/zalo-crm/400/300', name: 'hang-dong-goi.jpg' },
      }),
    });
    expect(status).toBe(200);
    expect(body.message.attachment).toMatchObject({ kind: 'image', name: 'hang-dong-goi.jpg' });

    const { body: msgs } = await api(`/api/messages?conversation_id=${convTuan}`);
    const saved = msgs.messages.find((m: { zalo_msg_id: string }) => m.zalo_msg_id === body.message.zalo_msg_id);
    expect(saved).toBeDefined();
    // The UI receives a parsed object, never a JSON string blob.
    expect(typeof saved.attachment).toBe('object');
    expect(saved.attachment.kind).toBe('image');
  }, 120_000);

  it('persists a file attachment with name and size', async () => {
    const { status, body } = await api('/api/mock/send-customer-msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: convMai,
        content: 'File bảng giá mới nhất đây em',
        customer_name: 'Chị Mai',
        attachment: { kind: 'file', url: 'https://example.com/bang-gia-2026.xlsx', name: 'bang-gia-2026.xlsx', size: 153600 },
      }),
    });
    expect(status).toBe(200);
    expect(body.message.attachment).toMatchObject({ kind: 'file', name: 'bang-gia-2026.xlsx', size: 153600 });
  }, 120_000);

  it('creates a task attributed to the requester with an assignee (ingest worker)', async () => {
    const stamp = Date.now();
    const req = `${stamp} nhờ em tạo hợp đồng mẫu`;

    // The event worker drains inline during the POST (pipeline drains the
    // outbox after publish), so the task exists as soon as the POST returns.
    const { status, body: sent } = await api('/api/mock/send-customer-msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: convTuan, content: req, customer_name: 'Anh Tuấn' }),
    });
    expect(status).toBe(200);
    expect(sent.message.zalo_msg_id).toBeTruthy();

    const { body: tasks } = await api(`/api/tasks?conversation_id=${convTuan}`);
    const fromThisRequest = tasks.tasks.find(
      (t: { source_msg_text: string }) => t.source_msg_text && t.source_msg_text.includes(String(stamp))
    );
    expect(fromThisRequest).toBeDefined();
    expect(fromThisRequest.requester).toBe('Anh Tuấn'); // deterministic from source sender
    expect(typeof fromThisRequest.assignee).toBe('string'); // 'Tôi' or the person the LLM saw
  }, 120_000);

  it('keeps identical requests from two different people as separate tasks', async () => {
    const stamp = Date.now();
    const req = `Nhờ em chuyển khoản thanh toán đợt ${stamp} nhé`;

    await api('/api/mock/send-customer-msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: convTuan, content: req, customer_name: 'Anh Tuấn' }),
    });
    await api('/api/mock/send-customer-msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: convMai, content: req, customer_name: 'Chị Mai' }),
    });

    const { body: all } = await api('/api/tasks');
    const matches = all.tasks.filter(
      (t: { title: string; source_msg_text: string }) =>
        t.title.includes(`chuyển khoản thanh toán đợt ${stamp}`) || (t.source_msg_text && t.source_msg_text.includes(String(stamp)))
    );
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const requesters = new Set(matches.map((t: { requester: string }) => t.requester));
    expect(requesters.has('Anh Tuấn')).toBe(true);
    expect(requesters.has('Chị Mai')).toBe(true);
  }, 120_000);

  it('global task list returns conversation_name for every task', async () => {
    const { status, body } = await api('/api/tasks');
    expect(status).toBe(200);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.length).toBeGreaterThan(0);
    for (const t of body.tasks) {
      expect(typeof t.conversation_name).toBe('string');
    }
  });
});
