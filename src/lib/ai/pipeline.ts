import { dbQueries } from '@/lib/db/sqlite';
import { AIProcessor } from '@/lib/ai/processor';
import { AIAnalysisResult, Message } from '@/types';

export interface IncomingMessageInput {
  conversation_id: string;
  zalo_msg_id: string;
  sender_id: string;
  sender_name: string;
  is_from_me: boolean;
  content: string;
  timestamp: string;
}

export interface IncomingMessageResult {
  message: Message;
  aiResult: AIAnalysisResult | null;
}

/**
 * Persist an incoming/outgoing message, then run the AI auto-task pipeline
 * (extraction + completion) when either toggle is enabled.
 */
export async function handleIncomingMessage(input: IncomingMessageInput): Promise<IncomingMessageResult> {
  // Zalo can deliver the same msgId twice: echoes of our own sends (selfListen)
  // and WS reconnect replays. Keep exactly one row per zalo_msg_id.
  const existing = dbQueries.getMessageByZaloMsgId(input.zalo_msg_id);
  if (existing) {
    return { message: existing, aiResult: null };
  }
  const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const message = dbQueries.addMessage({
    id: msgId,
    conversation_id: input.conversation_id,
    zalo_msg_id: input.zalo_msg_id,
    sender_id: input.sender_id,
    sender_name: input.sender_name,
    is_from_me: input.is_from_me,
    content: input.content,
    timestamp: input.timestamp,
    ai_processed: false,
  });

  const settings = dbQueries.getSettings();
  let aiResult: AIAnalysisResult | null = null;

  if (settings.auto_task_extraction || settings.auto_task_completion) {
    const messages = dbQueries.getMessagesByConversationId(input.conversation_id);
    const pendingTasks = dbQueries.getTasks(input.conversation_id, 'pending');
    aiResult = await AIProcessor.analyzeConversation(messages, pendingTasks, settings);

    if (settings.auto_task_extraction && aiResult.newTasks.length > 0) {
      for (const taskData of aiResult.newTasks) {
        dbQueries.addTask({
          conversation_id: input.conversation_id,
          title: taskData.title,
          description: taskData.description,
          status: 'pending',
          priority: taskData.priority,
          deadline: taskData.deadline,
          source_msg_id: taskData.source_msg_id || msgId,
          source_msg_text: taskData.source_msg_text || input.content,
          ai_created: true,
          ai_completed: false,
        });
      }
    }

    if (settings.auto_task_completion && aiResult.completedTaskIds.length > 0) {
      for (const item of aiResult.completedTaskIds) {
        dbQueries.updateTaskStatus(item.task_id, 'completed', item.reason, true);
      }
    }

    dbQueries.markMessagesProcessed([msgId]);
  }

  return { message, aiResult };
}
