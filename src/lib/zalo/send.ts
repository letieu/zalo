import { dbQueries } from '@/lib/db/sqlite';
import { handleIncomingMessage } from '@/lib/ai/pipeline';
import { getZaloManager } from '@/lib/zalo/zalo-manager';
import { Message } from '@/types';

export interface SendOutgoingResult {
  ok: boolean;
  sent: boolean;
  via_zalo: boolean;
  message?: Message;
  error?: string;
}

/**
 * Send a message as the user. In `personal` mode the message is delivered
 * through the live Zalo connection first (real msgId); otherwise it is
 * persisted locally so the UI still shows it. Shared by the chat composer
 * and the AI assistant action executor so both go through the same path.
 */
export async function sendOutgoingMessage(conversationId: string, content: string): Promise<SendOutgoingResult> {
  const conversation = dbQueries.getConversationById(conversationId);
  if (!conversation) {
    return { ok: false, sent: false, via_zalo: false, error: 'Cuộc trò chuyện không tồn tại' };
  }

  const settings = dbQueries.getSettings();
  let zaloMsgId = 'zm_' + Date.now();
  let viaZalo = false;

  if (settings.zalo_mode === 'personal') {
    if (!conversation.zalo_thread_id) {
      return { ok: false, sent: false, via_zalo: false, error: 'Cuộc trò chuyện này không có thread Zalo' };
    }
    const manager = getZaloManager();
    if (!manager.isConnected()) {
      return {
        ok: false,
        sent: false,
        via_zalo: false,
        error: 'Zalo chưa kết nối. Vào Cài đặt → Zalo Cá Nhân → Đăng nhập bằng QR để kết nối.',
      };
    }
    const sentMsgId = await manager.sendTextMessage(conversation.zalo_thread_id, conversation.type, content);
    if (!sentMsgId) {
      return { ok: false, sent: false, via_zalo: false, error: 'Zalo không xác nhận tin nhắn đã gửi. Hãy thử lại.' };
    }
    zaloMsgId = sentMsgId;
    viaZalo = true;
  }

  const { message } = await handleIncomingMessage({
    conversation_id: conversationId,
    zalo_msg_id: zaloMsgId,
    sender_id: 'me',
    sender_name: 'Tôi',
    is_from_me: true,
    content,
    timestamp: new Date().toISOString(),
  });

  return { ok: true, sent: true, via_zalo: viaZalo, message };
}
