import { registerWorker } from '@/lib/events/bus';
import { dbQueries } from '@/lib/db/sqlite';
import { embed } from '@/lib/ai/embeddings';
import { OutboxEvent } from '@/types';

/**
 * EmbeddingWorker (spec §9): every message gets a vector so search is
 * semantic, not just keyword. Idempotent per message (PK upsert).
 */
async function handleMessageSaved(event: OutboxEvent): Promise<void> {
  const messageId = event.payload.message_id as string;
  if (!messageId) return;

  const settings = dbQueries.getSettings();
  if (!settings.auto_embeddings) return;

  const message = dbQueries.getMessageById(messageId);
  if (!message || !message.content.trim()) return;

  dbQueries.saveMessageEmbedding(messageId, embed(message.content));
}

registerWorker('embedding', handleMessageSaved);
