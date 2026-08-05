import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { Task, TaskPriority, TaskStatus } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversation_id') || undefined;
  const status = searchParams.get('status') || undefined;

  try {
    const tasks = dbQueries.getTasks(conversationId, status);
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      conversation_id: string;
      title: string;
      description?: string;
      priority?: TaskPriority;
      deadline?: string;
    };

    if (!body.conversation_id || !body.title) {
      return NextResponse.json({ error: 'conversation_id and title are required' }, { status: 400 });
    }

    const newTask = dbQueries.addTask({
      conversation_id: body.conversation_id,
      title: body.title,
      description: body.description || '',
      status: 'pending',
      priority: body.priority || 'medium',
      deadline: body.deadline || undefined,
      ai_created: false,
      ai_completed: false,
    });

    return NextResponse.json({ task: newTask });
  } catch (error) {
    console.error('Error adding task:', error);
    return NextResponse.json({ error: 'Failed to add task' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as {
      id: string;
      status?: TaskStatus;
      title?: string;
      description?: string;
      priority?: TaskPriority;
      deadline?: string;
      reason?: string;
    };

    if (!body.id) {
      return NextResponse.json({ error: 'task id is required' }, { status: 400 });
    }

    let updatedTask: Task | undefined;

    if (body.status) {
      updatedTask = dbQueries.updateTaskStatus(body.id, body.status, body.reason, false);
    } else {
      updatedTask = dbQueries.updateTask(body.id, {
        title: body.title,
        description: body.description,
        priority: body.priority,
        deadline: body.deadline,
      });
    }

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    dbQueries.deleteTask(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
