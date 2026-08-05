import { registerWorker } from '@/lib/events/bus';
import { dbQueries } from '@/lib/db/sqlite';
import { chatJSON } from '@/lib/ai/llm';
import { OMNIROUTE_CODING_MODEL } from '@/lib/ai/llm';
import { ConversationSummaryOutput, OutboxEvent, Sentiment } from '@/types';

/**
 * SummaryWorker (spec §6): conversations are living documents. Maintains the
 * AI summary, open topics, sentiment and importance. Runs incrementally once
 * enough new messages have accumulated since the last pass.
 */

const SUMMARY_JSON_SHAPE = `{
  "summary": "tóm tắt ngắn gọn 2-4 câu về nội dung hội thoại",
  "open_topics": ["chủ đề còn dang dở 1", "chủ đề còn dang dở 2"],
  "sentiment": "positive|neutral|negative",
  "importance": 0
}`;

const NEW_MESSAGES_BEFORE_RUN = 3;
const FIRST_SUMMARY_MIN_MESSAGES = 2;
const VALID_SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative'];

async function handleMessageSaved(event: OutboxEvent): Promise<void> {
  const conversationId = event.payload.conversation_id as string;
  if (!conversationId) return;

  const settings = dbQueries.getSettings();
  if (!settings.auto_summary) return;

  const conversation = dbQueries.getConversationById(conversationId);
  if (!conversation) return;

  const allMessages = dbQueries.getMessagesByConversationId(conversationId);
  if (allMessages.length === 0) return;

  const lastSummaryAt = conversation.last_ai_summary_at;
  const newMessages = lastSummaryAt
    ? allMessages.filter(m => m.timestamp > lastSummaryAt)
    : allMessages;

  if (lastSummaryAt && newMessages.length < NEW_MESSAGES_BEFORE_RUN) return;
  if (!lastSummaryAt && allMessages.length < FIRST_SUMMARY_MIN_MESSAGES) return;

  const render = (msgs: typeof allMessages) =>
    msgs.map(m => `[${m.timestamp}] ${m.is_from_me ? 'Tôi' : m.sender_name}: ${m.content}`).join('\n');

  const result = await chatJSON<ConversationSummaryOutput>(settings, {
    system:
      'Bạn là trợ lý duy trì "hồ sơ sống" của một hội thoại Zalo: tóm tắt nội dung, ' +
      'chủ đề còn mở, cảm xúc chung và mức độ quan trọng (0-100). ' +
      'Tóm tắt phải đủ để người đọc không cần đọc lại toàn bộ tin nhắn.',
    user: conversation.summary
      ? `Tóm tắt hiện tại:\n${conversation.summary}\n\nTin nhắn mới kể từ lần tóm tắt trước:\n${render(newMessages)}`
      : `Toàn bộ tin nhắn:\n${render(allMessages)}`,
    jsonShape: SUMMARY_JSON_SHAPE,
    model: OMNIROUTE_CODING_MODEL,
  });

  if (!result || !result.summary) return;

  const sentiment = VALID_SENTIMENTS.includes(result.sentiment as Sentiment) ? result.sentiment : 'neutral';
  const importance = Number.isFinite(result.importance) ? Math.min(100, Math.max(0, Math.round(result.importance))) : 50;

  dbQueries.updateConversationMeta(conversationId, {
    summary: result.summary.slice(0, 2000),
    open_topics: (result.open_topics || []).slice(0, 10),
    sentiment,
    importance,
    last_ai_summary_at: new Date().toISOString(),
  });

  if (conversation.contact_id) {
    const contact = dbQueries.getContactById(conversation.contact_id);
    if (contact && importance > contact.importance) {
      dbQueries.updateContactProfile(conversation.contact_id, { importance });
    }
  }
}

registerWorker('summary', handleMessageSaved);
