import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { embed } from '@/lib/ai/embeddings';
import { dbQueries, resetDatabase } from '@/lib/db/sqlite';
import { GET as getDashboard } from '@/app/api/dashboard/route';
import { GET as getSearch } from '@/app/api/search/route';
import { GET as getBrief } from '@/app/api/ai/brief/route';

// Route handlers are exercised directly (no HTTP server): they are pure
// request → NextResponse functions over the shared temp SQLite.

beforeEach(() => resetDatabase());

describe('GET /api/dashboard', () => {
  it('returns the full seeded aggregate shape', async () => {
    const res = await getDashboard();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data.waitingForReply)).toBe(true);
    for (const w of data.waitingForReply) {
      expect(typeof w.name).toBe('string');
      expect(['awaiting_me', 'awaiting_them']).toContain(w.direction);
      expect(typeof w.minutes_since_last).toBe('number');
    }
    expect(Array.isArray(data.todayTasks)).toBe(true);
    expect(data.importantContacts.length).toBeGreaterThanOrEqual(3); // 90/70/85 seeds
    expect(data.recentMemories.length).toBeGreaterThanOrEqual(5);    // mem_1..5
    expect(Array.isArray(data.upcomingFollowUps)).toBe(true);
    expect(data.dailyBrief).toBeNull();
    expect(typeof data.unreadTotal).toBe('number');
    expect(data.pendingTaskTotal).toBeGreaterThanOrEqual(2); // task_01/02 seeds
  });

  it('recomputes todayTasks, pendingTaskTotal and dailyBrief from fresh writes', async () => {
    const before = await (await getDashboard()).json();
    const today = new Date().toISOString().slice(0, 10);
    const conv = dbQueries.getConversations()[0];

    dbQueries.addTask({
      conversation_id: conv.id, title: 'Việc hôm nay', status: 'pending',
      priority: 'high', deadline: `${today}T23:59:59Z`, ai_created: true, ai_completed: false,
    });
    dbQueries.saveBrief(today, 'tóm tắt buổi sáng');

    const after = await (await getDashboard()).json();
    expect(after.todayTasks.map((t: { title: string }) => t.title)).toContain('Việc hôm nay');
    expect(after.pendingTaskTotal).toBe(before.pendingTaskTotal + 1);
    expect(after.dailyBrief).toBe('tóm tắt buổi sáng');
  });
});

describe('GET /api/search', () => {
  function req(q: string): NextRequest {
    return new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}`);
  }

  it('empty query returns no hits', async () => {
    const res = await getSearch(req(''));
    expect(await res.json()).toEqual({ hits: [] });
  });

  it('semantic hit: embedded message matches a query with the same meaning', async () => {
    const conv = dbQueries.getConversations()[0];
    const content = 'em cần 10 thùng nước ngọt giao ngày mai';
    const msg = dbQueries.addMessage({
      id: 'msg_search_1', conversation_id: conv.id, zalo_msg_id: 'zm_search_1',
      sender_id: 's', sender_name: 'Khách hàng', is_from_me: false,
      content, timestamp: new Date().toISOString(), ai_processed: true,
    });
    dbQueries.saveMessageEmbedding(msg.id, embed(content));

    const res = await getSearch(req('10 thùng nước ngọt ngày mai'));
    const { hits } = await res.json();
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top.kind).toBe('message');
    expect(top.id).toBe(msg.id);
    expect(top.score).toBeGreaterThan(0.28);
  });

  it('keyword fallback: memory hit at fixed 0.95', async () => {
    const contact = dbQueries.getContacts()[0];
    dbQueries.addMemory({ contact_id: contact.id, category: 'preference', content: 'khách thích bánh mì chả cá', confidence: 0.8 });

    const res = await getSearch(req('bánh mì chả cá'));
    const { hits } = await res.json();
    const memHit = hits.find((h: { kind: string }) => h.kind === 'memory');
    expect(memHit).toBeDefined();
    expect(memHit.score).toBe(0.95);
    expect(memHit.contact_name).toBe(contact.name);
  });

  it('never returns more than MAX_HITS entries', async () => {
    const conv = dbQueries.getConversations()[0];
    const content = 'đơn hàng 1 thùng nước ngọt';
    for (let i = 0; i < 40; i++) {
      const m = dbQueries.addMessage({
        id: `msg_search_${i}`, conversation_id: conv.id, zalo_msg_id: `zm_search_${i}`,
        sender_id: 's', sender_name: 'S', is_from_me: false,
        content: `${content} ${i}`, timestamp: new Date().toISOString(), ai_processed: true,
      });
      dbQueries.saveMessageEmbedding(m.id, embed(`${content} ${i}`));
    }
    const res = await getSearch(req('nước ngọt'));
    const { hits } = await res.json();
    expect(hits.length).toBeLessThanOrEqual(30);
  });
});

describe('GET /api/ai/brief', () => {
  it('degrades to a deterministic fallback when the LLM is unreachable, then caches', async () => {
    // Point the provider at a guaranteed-dead port so chatJSON returns null.
    dbQueries.updateSettings({ omniroute_base_url: 'http://127.0.0.1:1/v1' });

    const first = await getBrief();
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.cached).toBe(false);
    expect(firstBody.ai_generated).toBe(false);
    expect(typeof firstBody.brief).toBe('string');
    expect(firstBody.brief.length).toBeGreaterThan(0); // fallbackBrief(context)

    // Second call serves the persisted brief without touching the LLM.
    const second = await getBrief();
    const secondBody = await second.json();
    expect(secondBody.cached).toBe(true);
    expect(secondBody.brief).toBe(firstBody.brief);
  });

  it('serves an existing cached brief for today directly', async () => {
    const today = new Date().toISOString().slice(0, 10);
    dbQueries.saveBrief(today, 'brief đã có sẵn');
    const res = await getBrief();
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.brief).toBe('brief đã có sẵn');
  });
});
