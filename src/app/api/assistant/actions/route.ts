import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { executeAssistantAction } from '@/lib/ai/assistant-actions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      message_id?: string;
      action_id?: string;
    };

    if (!body.message_id || !body.action_id) {
      return NextResponse.json({ error: 'message_id and action_id are required' }, { status: 400 });
    }

    const assistantMessage = dbQueries.getAssistantMessageById(body.message_id);
    if (!assistantMessage) {
      return NextResponse.json({ error: 'Tin nhắn trợ lý không tồn tại' }, { status: 404 });
    }

    const action = assistantMessage.actions.find(a => a.id === body.action_id);
    if (!action) {
      return NextResponse.json({ error: 'Hành động không tồn tại hoặc đã hết hiệu lực' }, { status: 404 });
    }

    // Idempotent: a confirmed action executes exactly once per proposal.
    const existing = assistantMessage.action_results.find(r => r.id === body.action_id);
    if (existing) {
      return NextResponse.json({ result: existing });
    }

    const result = await executeAssistantAction(action);
    dbQueries.attachAssistantActionResult(body.message_id, result);
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Error executing assistant action:', error);
    return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
  }
}
