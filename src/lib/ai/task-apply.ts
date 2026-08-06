import { dbQueries } from '@/lib/db/sqlite';
import { findMergeTarget, mergeTaskContext, NewTaskCandidate } from '@/lib/ai/task-dedup';
import { AIAnalysisResult, Message, Task } from '@/types';

/**
 * Deterministic application of an AI analysis result (spec §7, §8):
 * one task per issue, per requester/assignee; a source message never births
 * two tasks; follow-ups fold into the open task instead of duplicating it.
 * Shared by the event-driven TaskWorker and the manual "Quét AI Task" route
 * so both paths behave identically.
 */

export interface ApplyTaskAnalysisOptions {
  conversationId: string;
  /** The triggering message (worker path). Analyze path passes undefined. */
  message?: Message;
  /** Full conversation history, newest last. */
  messages: Message[];
  /** All tasks in the conversation — any status (re-extraction guard). */
  tasks: Task[];
  result: AIAnalysisResult;
  autoTaskExtraction: boolean;
  autoTaskCompletion: boolean;
}

export function applyTaskAnalysis(opts: ApplyTaskAnalysisOptions): { created: number; completed: number } {
  const { conversationId, message, messages, tasks, result, autoTaskExtraction, autoTaskCompletion } = opts;
  let created = 0;
  let completed = 0;

  if (autoTaskExtraction && result.newTasks.length > 0) {
    // Guard against re-extracting a request already turned into a task —
    // the LLM re-reads old messages on every analysis and would re-propose
    // them (sourceIds alone on pending tasks missed completed ones).
    const sourceIds = new Set(tasks.map(t => t.source_msg_id).filter(Boolean) as string[]);
    const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');

    for (const taskData of result.newTasks) {
      const sourceId = taskData.source_msg_id || message?.id;
      if (!sourceId || sourceIds.has(sourceId)) continue;

      const sourceMessage = sourceId ? dbQueries.getMessageById(sourceId) || message : undefined;
      // Who asked is deterministic — the sender of the source message. Never
      // trust the LLM for attribution of the request.
      const requester = !sourceMessage
        ? 'Khách hàng'
        : sourceMessage.is_from_me
          ? 'Tôi'
          : sourceMessage.sender_name;
      const assignee = taskData.assignee || 'Tôi';

      const candidate: NewTaskCandidate = { ...taskData, requester, assignee };
      const mergeTarget = findMergeTarget(candidate, messages, pendingTasks);
      if (mergeTarget) {
        dbQueries.updateTask(mergeTarget.id, mergeTaskContext(mergeTarget, candidate));
        sourceIds.add(sourceId);
        continue;
      }

      dbQueries.addTask({
        conversation_id: conversationId,
        title: taskData.title,
        description: taskData.description,
        requester,
        assignee,
        status: 'pending',
        priority: taskData.priority,
        deadline: taskData.deadline,
        source_msg_id: sourceId,
        source_msg_text: taskData.source_msg_text || sourceMessage?.content || '',
        ai_created: true,
        ai_completed: false,
      });
      sourceIds.add(sourceId);
      created++;
    }
  }

  if (autoTaskCompletion && result.completedTaskIds.length > 0) {
    for (const item of result.completedTaskIds) {
      dbQueries.updateTaskStatus(item.task_id, 'completed', item.reason, true);
      completed++;
    }
  }

  return { created, completed };
}
