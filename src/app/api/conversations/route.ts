import { NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';

export async function GET() {
  try {
    const conversations = dbQueries.getConversations();
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}
