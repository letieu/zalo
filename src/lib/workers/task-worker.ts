import { registerWorker } from '@/lib/events/bus';
import { dbQueries } from '@/lib/db/sqlite';
import { AIProcessor } from '@/lib/ai/processor';
import { findMergeTarget, mergeTaskContext } from '@/lib/ai/task-dedup';
import { OutboxEvent } from '@/types';

/**
 * TaskWorker (spec §7): conversations contain hidden work. Detects new task
 * requests and completion confirmations, writing them as tasks. Idempotent —
 * a task is only created once per source message.
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
  const pendingTasks = dbQueries.getTasks(conversationId, 'pending');
  const result = await AIProcessor.analyzeConversation(messages, pendingTasks, settings);

  if (settings.auto_task_extraction && result.newTasks.length > 0) {
    const sourceIds = new Set(pendingTasks.map(t => t.source_msg_id).filter(Boolean) as string[]);
    for (const taskData of result.newTasks) {
      const sourceId = taskData.source_msg_id || messageId;
      if (sourceIds.has(sourceId)) continue;
      // Follow-ups of an already-open task merge into it (one task per issue)
      // instead of creating a duplicate.
      const mergeTarget = findMergeTarget(taskData, messages, pendingTasks);
      if (mergeTarget) {
        dbQueries.updateTask(mergeTarget.id, mergeTaskContext(mergeTarget, taskData));
        sourceIds.add(sourceId);
        continue;
      }
      dbQueries.addTask({
        conversation_id: conversationId,
        title: taskData.title,
        description: taskData.description,
        status: 'pending',
        priority: taskData.priority,
        deadline: taskData.deadline,
        source_msg_id: sourceId,
        source_msg_text: taskData.source_msg_text || message.content,
        ai_created: true,
        ai_completed: false,
      });
      sourceIds.add(sourceId);
    }
  }

  if (settings.auto_task_completion && result.completedTaskIds.length > 0) {
    for (const item of result.completedTaskIds) {
      dbQueries.updateTaskStatus(item.task_id, 'completed', item.reason, true);
    }
  }

  dbQueries.markMessagesProcessed([messageId]);
}

registerWorker('task', handleMessageSaved);
