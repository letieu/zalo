import { NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { DashboardData, WaitingConversation } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Dashboard aggregate: everything the home screen needs in one round trip.
 * Derived data only — all fields are read from the SQLite store.
 */
export async function GET(): Promise<NextResponse> {
  const conversations = dbQueries.getConversations();
  const tasks = dbQueries.getTasks();
  const contacts = dbQueries.getContacts();
  const memories = dbQueries.getMemories(10);

  const now = Date.now();
  const waitingForReply: WaitingConversation[] = [];
  const awaitingMeCutoff = now - 2 * 60 * 60 * 1000; // outstanding for >2h

  for (const conv of conversations) {
    const msgs = dbQueries.getMessagesByConversationId(conv.id);
    if (msgs.length === 0) continue;
    const last = msgs[msgs.length - 1];
    const minutes = Math.max(0, Math.round((now - new Date(last.timestamp).getTime()) / 60000));

    if (!last.is_from_me) {
      const lastReply = [...msgs].reverse().find(m => m.is_from_me);
      const awaiting = !lastReply || new Date(lastReply.timestamp).getTime() < new Date(last.timestamp).getTime();
      if (awaiting && (minutes > 60 || (conv.pending_task_count || 0) > 0)) {
        waitingForReply.push({
          id: conv.id,
          name: conv.name,
          avatar: conv.avatar || '',
          last_message: last.content,
          last_sender: last.sender_name,
          updated_at: last.timestamp,
          direction: 'awaiting_me',
          minutes_since_last: minutes,
        });
      }
    } else if ((conv.pending_task_count || 0) > 0 && new Date(last.timestamp).getTime() > now - awaitingMeCutoff) {
      waitingForReply.push({
        id: conv.id,
        name: conv.name,
        avatar: conv.avatar || '',
        last_message: last.content,
        last_sender: last.sender_name,
        updated_at: last.timestamp,
        direction: 'awaiting_them',
        minutes_since_last: minutes,
      });
    }
  }
  waitingForReply.sort((a, b) => a.minutes_since_last - b.minutes_since_last);

  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = tasks.filter(t =>
    t.status === 'pending' && t.deadline && t.deadline.slice(0, 10) === today
  );

  const upcomingFollowUps = tasks
    .filter(t => t.status === 'pending' && !!t.deadline)
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .slice(0, 10);

  const unreadTotal = conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0);
  const pendingTaskTotal = conversations.reduce((acc, c) => acc + (c.pending_task_count || 0), 0);

  const data: DashboardData = {
    waitingForReply,
    todayTasks,
    importantContacts: contacts.filter(c => c.importance >= 40).slice(0, 5),
    recentMemories: memories.map(m => ({
      ...m,
      contact_name: m.contact_id ? dbQueries.getContactById(m.contact_id)?.name : undefined,
    })),
    upcomingFollowUps,
    dailyBrief: dbQueries.getBrief(today),
    unreadTotal,
    pendingTaskTotal,
  };

  return NextResponse.json(data);
}
