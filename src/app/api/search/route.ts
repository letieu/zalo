import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { cosine, embed } from '@/lib/ai/embeddings';
import { SearchHit } from '@/types';

export const dynamic = 'force-dynamic';

const MIN_SCORE = 0.28;
const MAX_HITS = 30;

/**
 * Semantic search over messages and memories. Hybrid: vector similarity for
 * meaning, plus a keyword fallback so short/rare queries still hit.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ hits: [] });

  const queryVec = embed(q);
  const hits: SearchHit[] = [];

  for (const { message, embedding } of dbQueries.getAllEmbeddedMessages()) {
    const score = cosine(queryVec, embedding);
    if (score < MIN_SCORE) continue;
    hits.push({
      kind: 'message',
      id: message.id,
      conversation_id: message.conversation_id,
      content: message.content,
      sender_name: message.sender_name,
      timestamp: message.timestamp,
      score,
    });
  }

  const keywordLower = q.toLowerCase();
  for (const mem of dbQueries.getMemories(200)) {
    const hay = `${mem.content} ${mem.category}`.toLowerCase();
    const score = hay.includes(keywordLower) ? 0.95 : 0;
    if (score === 0) continue;
    const contact = mem.contact_id ? dbQueries.getContactById(mem.contact_id) : undefined;
    hits.push({
      kind: 'memory',
      id: mem.id,
      contact_id: mem.contact_id,
      contact_name: contact?.name,
      content: mem.content,
      category: mem.category,
      timestamp: mem.created_at,
      score,
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return NextResponse.json({ hits: hits.slice(0, MAX_HITS) });
}
