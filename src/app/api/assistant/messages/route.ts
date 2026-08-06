import { NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';

export async function GET() {
  try {
    const messages = dbQueries.getAssistantMessages(50);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Error fetching assistant messages:', error);
    return NextResponse.json({ error: 'Failed to fetch assistant messages' }, { status: 500 });
  }
}
