import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { runAssistantTurn } from '@/lib/ai/assistant';
import { AssistantContext } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      message?: string;
      context?: Partial<AssistantContext>;
    };

    const userText = body.message?.trim() ?? '';
    if (!userText) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const context: AssistantContext = {
      screen: body.context?.screen === 'chats' || body.context?.screen === 'tasks' ? body.context.screen : 'dashboard',
      conversation_id: body.context?.conversation_id,
      conversation_name: body.context?.conversation_name,
    };

    const settings = dbQueries.getSettings();
    const userMessage = dbQueries.addAssistantMessage({ role: 'user', content: userText });
    const turn = await runAssistantTurn(userText, context, settings);
    const assistantMessage = dbQueries.addAssistantMessage({
      role: 'assistant',
      content: turn.reply,
      actions: turn.actions,
    });

    return NextResponse.json({ userMessage, assistantMessage });
  } catch (error) {
    console.error('Error running assistant chat:', error);
    return NextResponse.json({ error: 'Failed to run assistant chat' }, { status: 500 });
  }
}
