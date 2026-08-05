import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { handleIncomingMessage } from '@/lib/ai/pipeline';
import { getZaloManager } from '@/lib/zalo/zalo-manager';

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

    const settings = dbQueries.getSettings();
    let zaloMsgId = 'zm_' + Date.now();

    // Real Zalo mode: deliver the message through the live connection first
    if (settings.zalo_mode === 'personal') {
      const conversation = dbQueries.getConversationById(body.conversation_id);
      if (!conversation || !conversation.zalo_thread_id) {
        return NextResponse.json({ error: 'Cuộc trò chuyện này không có thread Zalo' }, { status: 400 });
      }

      const manager = getZaloManager();
      if (!manager.isConnected()) {
        return NextResponse.json(
          { error: 'Zalo chưa kết nối. Vào Cài đặt → Zalo Cá Nhân → Đăng nhập bằng QR để kết nối.' },
          { status: 409 }
        );
      }

      const sentMsgId = await manager.sendTextMessage(conversation.zalo_thread_id, conversation.type, body.content);
      if (!sentMsgId) {
        return NextResponse.json({ error: 'Zalo không xác nhận tin nhắn đã gửi. Hãy thử lại.' }, { status: 502 });
      }
      zaloMsgId = sentMsgId;
    }

    const { message, aiResult } = await handleIncomingMessage({
      conversation_id: body.conversation_id,
      zalo_msg_id: zaloMsgId,
      sender_id: 'me',
      sender_name: body.sender_name || 'Tôi',
      is_from_me: true,
      content: body.content,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ message, aiResult });
  } catch (error) {
    console.error('Error posting message:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
