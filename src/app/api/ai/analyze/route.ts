import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { AIProcessor } from '@/lib/ai/processor';
import { applyTaskAnalysis } from '@/lib/ai/task-apply';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { conversation_id: string };

    if (!body.conversation_id) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
    }

    const messages = dbQueries.getMessagesByConversationId(body.conversation_id);
    const tasks = dbQueries.getTasks(body.conversation_id);
    const settings = dbQueries.getSettings();

    const aiResult = await AIProcessor.analyzeConversation(messages, tasks, settings);

    // Same deterministic application as the event-driven TaskWorker — the
    // manual "Quét AI Task" button must not create duplicates the worker
    // would have merged (one task per issue, per requester/assignee).
    const { created, completed } = applyTaskAnalysis({
      conversationId: body.conversation_id,
      messages,
      tasks,
      result: aiResult,
      autoTaskExtraction: true,
      autoTaskCompletion: true,
    });

    return NextResponse.json({
      success: true,
      createdCount: created,
      completedCount: completed,
      aiResult,
    });
  } catch (error) {
    console.error('Error analyzing conversation:', error);
    return NextResponse.json({ error: 'Failed to analyze conversation' }, { status: 500 });
  }
}
