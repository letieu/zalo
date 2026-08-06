import { dbQueries } from '@/lib/db/sqlite';
import { drainOutbox } from '@/lib/events/bus';
import { ensureWorkersRegistered } from '@/lib/workers';
import { AIAnalysisResult, Message } from '@/types';

export interface IncomingMessageInput {
  conversation_id: string;
  zalo_msg_id: string;
  sender_id: string;
  sender_name: string;
  is_from_me: boolean;
  content: string;
  attachment?: Message['attachment'];
  timestamp: string;
}

export interface IncomingMessageResult {
  message: Message;
  aiResult: AIAnalysisResult | null;
}

/**
 * Persist an incoming/outgoing message, then publish `message.saved` so the
 * independent AI workers (task, memory, summary, contact, embedding) run.
 * The outbox is drained synchronously here so callers can rely on side
 * effects being complete; workers never block ingestion (a failed worker
 * leaves its event in the outbox for the next drain).
 */
export async function handleIncomingMessage(input: IncomingMessageInput): Promise<IncomingMessageResult> {
  // Zalo can deliver the same msgId twice: echoes of our own sends (selfListen)
  // and WS reconnect replays. Keep exactly one row per zalo_msg_id.
  const existing = dbQueries.getMessageByZaloMsgId(input.zalo_msg_id);
  if (existing) {
    return { message: existing, aiResult: null };
  }
  const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  // Message + outbox event land atomically — no message without its event.
  const message = dbQueries.withTransaction(() => {
    const saved = dbQueries.addMessage({
      id: msgId,
      conversation_id: input.conversation_id,
      zalo_msg_id: input.zalo_msg_id,
      sender_id: input.sender_id,
      sender_name: input.sender_name,
      is_from_me: input.is_from_me,
      content: input.content,
      attachment: input.attachment,
      timestamp: input.timestamp,
      ai_processed: false,
    });
    dbQueries.publishEvent('message.saved', {
      message_id: saved.id,
      conversation_id: input.conversation_id,
    });
    return saved;
  });

  ensureWorkersRegistered();
  await drainOutbox();

  return { message, aiResult: null };
}
