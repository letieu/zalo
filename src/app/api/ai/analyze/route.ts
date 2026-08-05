import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { AIProcessor } from '@/lib/ai/processor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { conversation_id: string };

    if (!body.conversation_id) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
    }

    const messages = dbQueries.getMessagesByConversationId(body.conversation_id);
    const pendingTasks = dbQueries.getTasks(body.conversation_id);
    const settings = dbQueries.getSettings();

    const aiResult = await AIProcessor.analyzeConversation(messages, pendingTasks, settings);

    let createdCount = 0;
    let completedCount = 0;

    // Create tasks
    for (const taskData of aiResult.newTasks) {
      dbQueries.addTask({
        conversation_id: body.conversation_id,
        title: taskData.title,
        description: taskData.description,
        status: 'pending',
        priority: taskData.priority,
        deadline: taskData.deadline,
        source_msg_id: taskData.source_msg_id,
        source_msg_text: taskData.source_msg_text,
        ai_created: true,
        ai_completed: false,
      });
      createdCount++;
    }

    // Complete tasks
    for (const item of aiResult.completedTaskIds) {
      dbQueries.updateTaskStatus(item.task_id, 'completed', item.reason, true);
      completedCount++;
    }

    return NextResponse.json({
      success: true,
      createdCount,
      completedCount,
      aiResult,
    });
  } catch (error) {
    console.error('Error analyzing conversation:', error);
    return NextResponse.json({ error: 'Failed to analyze conversation' }, { status: 500 });
  }
}
