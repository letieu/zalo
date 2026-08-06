import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { sendOutgoingMessage } from '@/lib/zalo/send';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversation_id');

  if (!conversationId) {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
  }

  try {
    const messages = dbQueries.getMessagesByConversationId(conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      conversation_id: string;
      content: string;
      sender_name?: string;
      is_from_me?: boolean;
    };

    if (!body.conversation_id || !body.content) {
      return NextResponse.json({ error: 'conversation_id and content are required' }, { status: 400 });
    }

    const result = await sendOutgoingMessage(body.conversation_id, body.content);
    if (!result.ok || !result.message) {
      const status = result.error?.startsWith('Zalo chưa kết nối') ? 409
        : result.error?.includes('không xác nhận') ? 502
        : 400;
      return NextResponse.json({ error: result.error ?? 'Failed to send message' }, { status });
    }

    return NextResponse.json({ message: result.message, aiResult: null });
  } catch (error) {
    console.error('Error posting message:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
