import { registerWorker } from '@/lib/events/bus';
import { dbQueries } from '@/lib/db/sqlite';
import { chatJSON } from '@/lib/ai/llm';
import { ExtractedMemory, MemoryCategory, OutboxEvent } from '@/types';

/**
 * MemoryWorker (spec §8): extracts durable facts ("my email is…", "I use a
 * Mac", "I bought Product A") from incoming messages and folds them into the
 * contact knowledge object. Deduped by (contact, category, content).
 */

const FACT_JSON_SHAPE = `{
  "facts": [
    {
      "category": "email|phone|company|product|preference|personal|location|commitment|other",
      "content": "sự thật bền vững, ngắn gọn, đúng ngôn ngữ nguồn",
      "confidence": 0.0
    }
  ]
}`;

const VALID_CATEGORIES: MemoryCategory[] = [
  'email', 'phone', 'company', 'product', 'preference', 'personal', 'location', 'commitment', 'other',
];

const MAX_FACTS_PER_MESSAGE = 8;

async function handleMessageSaved(event: OutboxEvent): Promise<void> {
  const messageId = event.payload.message_id as string;
  const conversationId = event.payload.conversation_id as string;
  if (!messageId || !conversationId) return;

  const settings = dbQueries.getSettings();
  if (!settings.auto_memory_extraction) return;

  const message = dbQueries.getMessageById(messageId);
  if (!message || message.is_from_me) return; // facts are about the other party

  const conversation = dbQueries.getConversationById(conversationId);
  if (!conversation) return;

  const result = await chatJSON<{ facts?: ExtractedMemory[] }>(settings, {
    system:
      'Bạn là trợ lý trích xuất sự thật bền vững về khách hàng / người liên hệ từ tin nhắn Zalo. ' +
      'Chỉ trích xuất sự thật (email, số điện thoại, công ty, sản phẩm đã mua, sở thích, thông tin cá nhân, địa chỉ, cam kết lâu dài). ' +
      'Bỏ qua lời chào, cảm ơn, hẹn gặp tức thời, và thông tin vô nghĩa. Mỗi sự thật phải độc lập và cụ thể.',
    user: `Tin nhắn từ ${message.sender_name}:\n"${message.content}"`,
    jsonShape: FACT_JSON_SHAPE,
  });

  const facts = (result?.facts || []).slice(0, MAX_FACTS_PER_MESSAGE);
  if (facts.length === 0) return;

  let contactId = conversation.contact_id;
  if (!contactId && conversation.type === 'individual') {
    const contact = dbQueries.upsertContact({
      name: message.sender_name || conversation.name,
      source_provider: 'zalo',
    });
    contactId = contact.id;
    dbQueries.updateConversationMeta(conversationId, { contact_id: contactId });
  }

  for (const fact of facts) {
    const content = (fact.content || '').trim();
    if (!content || content.length > 300) continue;
    const category = VALID_CATEGORIES.includes(fact.category as MemoryCategory) ? fact.category : 'other';
    const confidence = typeof fact.confidence === 'number' && Number.isFinite(fact.confidence)
      ? Math.min(1, Math.max(0, fact.confidence))
      : 0.7;
    const created = dbQueries.addMemory({
      contact_id: contactId,
      conversation_id: conversationId,
      category,
      content,
      confidence,
      source_msg_id: messageId,
      source_msg_text: message.content,
    });
    if (created && contactId) {
      foldIntoContact(contactId, message.sender_name || conversation.name, category, content);
    }
  }
}

/** Fold extracted facts into the contact knowledge object (spec §5). */
function foldIntoContact(contactId: string, senderName: string, category: MemoryCategory, content: string): void {
  if (category === 'email' && /@/.test(content)) {
    dbQueries.upsertContact({ name: senderName, email: content });
  } else if (category === 'phone' && /\d{7,}/.test(content)) {
    const digits = content.replace(/[^\d+]/g, '');
    if (digits.length >= 8 && digits.length <= 15) {
      dbQueries.upsertContact({ name: senderName, phone: digits });
    }
  } else if (category === 'company') {
    dbQueries.updateContactProfile(contactId, { company: content });
  } else if (category === 'personal') {
    const existing = dbQueries.getContactById(contactId);
    const notes = existing?.notes ? `${existing.notes}\n• ${content}` : `• ${content}`;
    dbQueries.updateContactProfile(contactId, { notes });
  }
}

registerWorker('memory', handleMessageSaved);
