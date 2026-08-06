import { registerWorker } from '@/lib/events/bus';
import { dbQueries } from '@/lib/db/sqlite';
import { AIProcessor } from '@/lib/ai/processor';
import { applyTaskAnalysis } from '@/lib/ai/task-apply';
import { OutboxEvent } from '@/types';

/**
 * TaskWorker (spec §7): conversations contain hidden work. Detects new task
 * requests and completion confirmations, writing them as tasks. Idempotent —
 * a task is only created once per source message, and follow-ups of an open
 * task merge into it deterministically (see task-apply / task-dedup).
 */
async function handleMessageSaved(event: OutboxEvent): Promise<void> {
  const messageId = event.payload.message_id as string;
  const conversationId = event.payload.conversation_id as string;
  if (!messageId || !conversationId) return;

  const settings = dbQueries.getSettings();
  if (!settings.auto_task_extraction && !settings.auto_task_completion) return;

  const message = dbQueries.getMessageById(messageId);
  if (!message) return;

  const messages = dbQueries.getMessagesByConversationId(conversationId);
  const tasks = dbQueries.getTasks(conversationId);
  const result = await AIProcessor.analyzeConversation(messages, tasks, settings);

  applyTaskAnalysis({
    conversationId,
    message,
    messages,
    tasks,
    result,
    autoTaskExtraction: settings.auto_task_extraction,
    autoTaskCompletion: settings.auto_task_completion,
  });

  dbQueries.markMessagesProcessed([messageId]);
}

registerWorker('task', handleMessageSaved);
