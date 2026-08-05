import { NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { chatJSON } from '@/lib/ai/llm';

export const dynamic = 'force-dynamic';

const BRIEF_JSON_SHAPE = `{
  "brief": "3-6 câu tóm tắt ngày hôm nay bằng tiếng Việt"
}`;

/**
 * Daily brief: an AI-generated morning summary of what needs attention,
 * cached per day in `briefs`. Regeneratable derived data — if the LLM is
 * down we degrade to a deterministic template so the UI always has content.
 */
export async function GET(): Promise<NextResponse> {
  const today = new Date().toISOString().slice(0, 10);

  const cached = dbQueries.getBrief(today);
  if (cached) return NextResponse.json({ date: today, brief: cached, cached: true });

  const settings = dbQueries.getSettings();
  const context = buildContext();

  let brief: string;
  let aiGenerated = false;
  try {
    const result = await chatJSON<{ brief?: string }>(settings, {
      system:
        'Bạn là trợ lý chuẩn bị tóm tắt buổi sáng cho người dùng: ' +
        'những hội thoại cần trả lời, công việc hôm nay, khách hàng quan trọng và việc cần theo dõi. ' +
        'Viết bằng tiếng Việt, ngắn gọn, ưu tiên hành động.',
      user: context,
      jsonShape: BRIEF_JSON_SHAPE,
    });
    brief = result?.brief?.trim() || fallbackBrief(context);
    aiGenerated = !!result?.brief?.trim();
  } catch {
    brief = fallbackBrief(context);
  }

  dbQueries.saveBrief(today, brief);
  return NextResponse.json({ date: today, brief, cached: false, ai_generated: aiGenerated });
}

function buildContext(): string {
  const conversations = dbQueries.getConversations();
  const tasks = dbQueries.getTasks();
  const contacts = dbQueries.getContacts();
  const memories = dbQueries.getMemories(5);

  const waiting = conversations
    .map(c => ({ c, last: dbQueries.getMessagesByConversationId(c.id).at(-1) }))
    .filter(x => x.last && !x.last.is_from_me)
    .slice(0, 8)
    .map(x => `- [${x.c.name}] ${x.last!.content.slice(0, 140)}`)
    .join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = tasks
    .filter(t => t.status === 'pending' && t.deadline?.slice(0, 10) === today)
    .map(t => `- ${t.title} (${t.deadline})`)
    .join('\n');
  const upcoming = tasks
    .filter(t => t.status === 'pending' && !!t.deadline)
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .slice(0, 8)
    .map(t => `- ${t.title} — hạn ${t.deadline}`)
    .join('\n');

  const important = contacts.filter(c => c.importance >= 40).slice(0, 5)
    .map(c => `- ${c.name} (${c.company || 'chưa rõ'})`)
    .join('\n');

  const recentMemories = memories.map(m => `- [${m.category}] ${m.content}`).join('\n');

  return [
    'Hội thoại cần trả lời:',
    waiting || '- (không có)',
    '',
    'Công việc hôm nay:',
    todayTasks || '- (không có)',
    '',
    'Việc theo dõi sắp tới:',
    upcoming || '- (không có)',
    '',
    'Khách hàng quan trọng:',
    important || '- (không có)',
    '',
    'Ghi nhớ gần đây:',
    recentMemories || '- (không có)',
  ].join('\n');
}

function fallbackBrief(context: string): string {
  // Deterministic template so the dashboard never depends on the LLM being up.
  return context;
}
