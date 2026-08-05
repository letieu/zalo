import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { handleIncomingMessage } from '@/lib/ai/pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      conversation_id: string;
      content: string;
      customer_name?: string;
    };

    if (!body.conversation_id || !body.content) {
      return NextResponse.json({ error: 'conversation_id and content are required' }, { status: 400 });
    }

    const conv = dbQueries.getConversationById(body.conversation_id);
    const customerName = body.customer_name || conv?.name || 'Khách hàng';

    const { message, aiResult } = await handleIncomingMessage({
      conversation_id: body.conversation_id,
      zalo_msg_id: 'zm_sim_' + Date.now(),
      sender_id: 'customer',
      sender_name: customerName,
      is_from_me: false,
      content: body.content,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ message, aiResult });
  } catch (error) {
    console.error('Error simulating customer message:', error);
    return NextResponse.json({ error: 'Failed to simulate message' }, { status: 500 });
  }
}
