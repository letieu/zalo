import { registerWorker } from '@/lib/events/bus';
import { dbQueries } from '@/lib/db/sqlite';
import { OutboxEvent } from '@/types';

/**
 * ContactWorker (spec §5): every message keeps the contact knowledge object
 * fresh — identity resolution, linking to the conversation, last interaction.
 * Rich profile enrichment (company, products, preferences) is done by the
 * MemoryWorker; this worker owns identity + recency.
 */
async function handleMessageSaved(event: OutboxEvent): Promise<void> {
  const messageId = event.payload.message_id as string;
  const conversationId = event.payload.conversation_id as string;
  if (!messageId || !conversationId) return;

  const message = dbQueries.getMessageById(messageId);
  const conversation = dbQueries.getConversationById(conversationId);
  if (!message || !conversation || conversation.type !== 'individual') return;

  let contactId = conversation.contact_id;
  if (!contactId) {
    const contact = dbQueries.upsertContact({
      name: message.sender_name || conversation.name,
      external_id: message.sender_id !== 'me' ? message.sender_id : undefined,
      phone: conversation.phone,
      source_provider: 'zalo',
    });
    contactId = contact.id;
    dbQueries.updateConversationMeta(conversationId, { contact_id: contactId });
  }

  dbQueries.touchContactInteraction(contactId);
}

registerWorker('contact', handleMessageSaved);
