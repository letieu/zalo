import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Conversation, Message, Task, AppSettings } from '@/types';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'zalo_tasks.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance
db.pragma('journal_mode = WAL');

// Initialize Database Schema
export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      zalo_thread_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT,
      phone TEXT,
      type TEXT DEFAULT 'individual',
      last_message TEXT,
      unread_count INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      zalo_msg_id TEXT UNIQUE NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      is_from_me INTEGER NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      ai_processed INTEGER DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      deadline TEXT,
      source_msg_id TEXT,
      source_msg_text TEXT,
      ai_created INTEGER DEFAULT 1,
      ai_completed INTEGER DEFAULT 0,
      completion_reason TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed default settings if empty
  const defaultSettings: Record<string, string> = {
    zalo_mode: 'mock',
    ai_provider: 'smart_heuristic',
    gemini_api_key: '',
    gemini_model: 'gemini-2.5-flash',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    ollama_url: 'http://localhost:11434',
    ollama_model: 'llama3',
    auto_task_extraction: 'true',
    auto_task_completion: 'true',
  };

  const checkStmt = db.prepare('SELECT COUNT(*) as count FROM settings');
  const { count } = checkStmt.get() as { count: number };
  if (count === 0) {
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaultSettings)) {
      insertSetting.run(key, value);
    }
  }

  // Seed initial mock conversations if table is empty
  seedMockData();
}

function seedMockData() {
  const checkConvs = db.prepare('SELECT COUNT(*) as count FROM conversations');
  const { count } = checkConvs.get() as { count: number };
  if (count > 0) return;

  const now = new Date().toISOString();
  const conv1Id = 'conv_tuan_01';
  const conv2Id = 'conv_mai_02';
  const conv3Id = 'conv_duc_03';

  // Seed Conversations
  const insertConv = db.prepare(`
    INSERT INTO conversations (id, zalo_thread_id, name, avatar, phone, type, last_message, unread_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertConv.run(
    conv1Id,
    'zt_tuan_01',
    'Anh Tuấn (Công ty Tin Học A)',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    '0908123456',
    'individual',
    'Em gửi cho anh báo giá 5 bộ máy tính Dell nhé',
    1,
    new Date(Date.now() - 5 * 60 * 1000).toISOString()
  );

  insertConv.run(
    conv2Id,
    'zt_mai_02',
    'Chị Mai (Shop Thời Trang)',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    '0912987654',
    'individual',
    'Đổi giúp chị địa chỉ giao hàng sang 123 Nguyễn Trãi Q5 nhé',
    0,
    new Date(Date.now() - 30 * 60 * 1000).toISOString()
  );

  insertConv.run(
    conv3Id,
    'zt_duc_03',
    'Đức (Designer)',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    '0933112233',
    'individual',
    'Em đã sửa xong banner khuyến mãi rồi anh kiểm tra nhé',
    0,
    new Date(Date.now() - 120 * 60 * 1000).toISOString()
  );

  // Seed Messages
  const insertMsg = db.prepare(`
    INSERT INTO messages (id, conversation_id, zalo_msg_id, sender_id, sender_name, is_from_me, content, timestamp, ai_processed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Conv 1 messages
  const msg1Id = 'msg_tuan_1';
  const msg2Id = 'msg_tuan_2';
  insertMsg.run(
    msg1Id,
    conv1Id,
    'zm_tuan_1',
    'user_tuan',
    'Anh Tuấn',
    0,
    'Chào em, bên em có sẵn dòng Dell Optiplex không?',
    new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    1
  );
  insertMsg.run(
    msg2Id,
    conv1Id,
    'zm_tuan_2',
    'user_tuan',
    'Anh Tuấn',
    0,
    'Em gửi cho anh báo giá 5 bộ máy tính Dell sang email tuan@tinhoca.com trước 4h chiều nay nhé.',
    new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    1
  );

  // Conv 2 messages
  const msg3Id = 'msg_mai_1';
  const msg4Id = 'msg_mai_2';
  insertMsg.run(
    msg3Id,
    conv2Id,
    'zm_mai_1',
    'user_mai',
    'Chị Mai',
    0,
    'Đơn hàng 50 áo thun hôm qua em note lại chưa?',
    new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    1
  );
  insertMsg.run(
    msg4Id,
    conv2Id,
    'zm_mai_2',
    'user_mai',
    'Chị Mai',
    0,
    'Nhớ đổi giúp chị địa chỉ giao hàng sang 123 Nguyễn Trãi, Quận 5 nhé, sđt nhận 0912987654.',
    new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    1
  );

  // Conv 3 messages (Task that will be completed)
  const msg5Id = 'msg_duc_1';
  const msg6Id = 'msg_duc_2';
  const msg7Id = 'msg_duc_3';
  insertMsg.run(
    msg5Id,
    conv3Id,
    'zm_duc_1',
    'me',
    'Tôi',
    1,
    'Đức ơi banner Tết bị lệch logo, nhờ em chỉnh lại màu đỏ tươi hơn nhé.',
    new Date(Date.now() - 180 * 60 * 1000).toISOString(),
    1
  );
  insertMsg.run(
    msg6Id,
    conv3Id,
    'zm_duc_2',
    'user_duc',
    'Đức',
    0,
    'Dạ ok anh, để em chỉnh lại ngay.',
    new Date(Date.now() - 150 * 60 * 1000).toISOString(),
    1
  );
  insertMsg.run(
    msg7Id,
    conv3Id,
    'zm_duc_3',
    'user_duc',
    'Đức',
    0,
    'Em đã sửa xong banner khuyến mãi Tết và chỉnh lại logo chuẩn màu đỏ rồi, anh kiểm tra link drive nhé!',
    new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    1
  );

  // Seed Tasks
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, conversation_id, title, description, status, priority, deadline, source_msg_id, source_msg_text, ai_created, ai_completed, completion_reason, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Task 1 (Conv 1 - Pending)
  insertTask.run(
    'task_01',
    conv1Id,
    'Gửi báo giá 5 bộ máy tính Dell cho Anh Tuấn',
    'Gửi sang email tuan@tinhoca.com',
    'pending',
    'high',
    'Hôm nay - 16:00',
    msg2Id,
    'Em gửi cho anh báo giá 5 bộ máy tính Dell sang email tuan@tinhoca.com trước 4h chiều nay nhé.',
    1,
    0,
    null,
    new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    null
  );

  // Task 2 (Conv 2 - Pending)
  insertTask.run(
    'task_02',
    conv2Id,
    'Cập nhật địa chỉ giao hàng đơn Chị Mai',
    'Đổi sang 123 Nguyễn Trãi, Q.5 (SĐT: 0912987654)',
    'pending',
    'medium',
    'Trong ngày',
    msg4Id,
    'Nhớ đổi giúp chị địa chỉ giao hàng sang 123 Nguyễn Trãi, Quận 5 nhé, sđt nhận 0912987654.',
    1,
    0,
    null,
    new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    null
  );

  // Task 3 (Conv 3 - Completed by AI)
  insertTask.run(
    'task_03',
    conv3Id,
    'Chỉnh sửa banner Tết (lệch logo, đổi màu đỏ)',
    'Yêu cầu Đức Designer sửa logo và tông màu banner',
    'completed',
    'medium',
    null,
    msg5Id,
    'Đức ơi banner Tết bị lệch logo, nhờ em chỉnh lại màu đỏ tươi hơn nhé.',
    1,
    1,
    'Phát hiện tin nhắn từ Đức: "Em đã sửa xong banner khuyến mãi Tết và chỉnh lại logo chuẩn màu đỏ rồi..."',
    new Date(Date.now() - 180 * 60 * 1000).toISOString(),
    new Date(Date.now() - 120 * 60 * 1000).toISOString()
  );
}

// Auto-run initDB
initDB();

// Helper Functions
interface DbMessageRow {
  id: string;
  conversation_id: string;
  zalo_msg_id: string;
  sender_id: string;
  sender_name: string;
  is_from_me: number;
  content: string;
  timestamp: string;
  ai_processed: number;
}

interface DbTaskRow {
  id: string;
  conversation_id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  deadline?: string;
  source_msg_id?: string;
  source_msg_text?: string;
  ai_created: number;
  ai_completed: number;
  completion_reason?: string;
  created_at: string;
  completed_at?: string;
  conversation_name?: string;
}

export const dbQueries = {
  // Conversations
  getConversations: (): Conversation[] => {
    const stmt = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM tasks t WHERE t.conversation_id = c.id AND t.status IN ('pending', 'in_progress')) as pending_task_count
      FROM conversations c 
      ORDER BY c.updated_at DESC
    `);
    return stmt.all() as Conversation[];
  },

  getConversationById: (id: string): Conversation | undefined => {
    const stmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
    return stmt.get(id) as Conversation | undefined;
  },

  getConversationByThreadId: (threadId: string): Conversation | undefined => {
    const stmt = db.prepare('SELECT * FROM conversations WHERE zalo_thread_id = ?');
    return stmt.get(threadId) as Conversation | undefined;
  },

  upsertConversation: (thread: {
    zalo_thread_id: string;
    name: string;
    avatar?: string;
    phone?: string;
    type: 'individual' | 'group';
  }): Conversation => {
    const existing = dbQueries.getConversationByThreadId(thread.zalo_thread_id);
    if (existing) {
      db.prepare('UPDATE conversations SET name = ?, avatar = ?, phone = ? WHERE id = ?')
        .run(thread.name, thread.avatar || existing.avatar || '', thread.phone || existing.phone || '', existing.id);
      const refreshed = dbQueries.getConversationById(existing.id);
      if (refreshed) return refreshed;
      return existing;
    }

    const id = 'conv_z_' + thread.zalo_thread_id.replace(/[^a-zA-Z0-9_]/g, '_');
    dbQueries.addConversation({
      id,
      zalo_thread_id: thread.zalo_thread_id,
      name: thread.name,
      avatar: thread.avatar || '',
      phone: thread.phone,
      type: thread.type,
      last_message: '',
      unread_count: 0,
      updated_at: new Date().toISOString(),
    });
    const created = dbQueries.getConversationById(id);
    if (!created) throw new Error('Không thể tạo cuộc trò chuyện Zalo: ' + id);
    return created;
  },

  addConversation: (conv: Omit<Conversation, 'pending_task_count'>) => {
    const stmt = db.prepare(`
      INSERT INTO conversations (id, zalo_thread_id, name, avatar, phone, type, last_message, unread_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(conv.id, conv.zalo_thread_id, conv.name, conv.avatar, conv.phone || '', conv.type, conv.last_message || '', conv.unread_count || 0, conv.updated_at);
  },

  updateConversationLastMsg: (id: string, lastMessage: string, updatedAt: string, resetUnread = false) => {
    if (resetUnread) {
      db.prepare('UPDATE conversations SET last_message = ?, updated_at = ?, unread_count = 0 WHERE id = ?').run(lastMessage, updatedAt, id);
    } else {
      db.prepare('UPDATE conversations SET last_message = ?, updated_at = ?, unread_count = unread_count + 1 WHERE id = ?').run(lastMessage, updatedAt, id);
    }
  },

  // Messages

  // Messages
  getMessagesByConversationId: (conversationId: string): Message[] => {
    const stmt = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC');
    const rows = stmt.all(conversationId) as DbMessageRow[];
    return rows.map(r => ({ ...r, is_from_me: Boolean(r.is_from_me), ai_processed: Boolean(r.ai_processed) }));
  },

  getMessageByZaloMsgId: (zaloMsgId: string): Message | undefined => {
    const row = db.prepare('SELECT * FROM messages WHERE zalo_msg_id = ?').get(zaloMsgId) as DbMessageRow | undefined;
    if (!row) return undefined;
    return { ...row, is_from_me: Boolean(row.is_from_me), ai_processed: Boolean(row.ai_processed) };
  },

  addMessage: (msg: Omit<Message, 'ai_processed'> & { ai_processed?: boolean }): Message => {
    const stmt = db.prepare(`
      INSERT INTO messages (id, conversation_id, zalo_msg_id, sender_id, sender_name, is_from_me, content, timestamp, ai_processed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const isFromMeInt = msg.is_from_me ? 1 : 0;
    const aiProcessedInt = msg.ai_processed ? 1 : 0;
    stmt.run(msg.id, msg.conversation_id, msg.zalo_msg_id, msg.sender_id, msg.sender_name, isFromMeInt, msg.content, msg.timestamp, aiProcessedInt);

    // Update conversation last message
    dbQueries.updateConversationLastMsg(msg.conversation_id, msg.content, msg.timestamp, msg.is_from_me);

    return { ...msg, ai_processed: Boolean(msg.ai_processed) };
  },

  markMessagesProcessed: (msgIds: string[]) => {
    if (msgIds.length === 0) return;
    const placeholders = msgIds.map(() => '?').join(',');
    db.prepare(`UPDATE messages SET ai_processed = 1 WHERE id IN (${placeholders})`).run(...msgIds);
  },

  // Tasks
  getTasks: (conversationId?: string, status?: string): Task[] => {
    let query = `
      SELECT t.*, c.name as conversation_name 
      FROM tasks t 
      LEFT JOIN conversations c ON t.conversation_id = c.id
    `;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (conversationId) {
      conditions.push('t.conversation_id = ?');
      params.push(conversationId);
    }

    if (status) {
      conditions.push('t.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += " ORDER BY CASE WHEN t.status = 'pending' THEN 1 WHEN t.status = 'in_progress' THEN 2 ELSE 3 END, t.created_at DESC";

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as DbTaskRow[];
    return rows.map(r => ({
      ...r,
      status: r.status as Task['status'],
      priority: r.priority as Task['priority'],
      ai_created: Boolean(r.ai_created),
      ai_completed: Boolean(r.ai_completed),
    }));
  },

  addTask: (task: Omit<Task, 'id' | 'created_at'>): Task => {
    const id = 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const createdAt = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO tasks (id, conversation_id, title, description, status, priority, deadline, source_msg_id, source_msg_text, ai_created, ai_completed, completion_reason, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      task.conversation_id,
      task.title,
      task.description || '',
      task.status || 'pending',
      task.priority || 'medium',
      task.deadline || null,
      task.source_msg_id || null,
      task.source_msg_text || null,
      task.ai_created ? 1 : 0,
      task.ai_completed ? 1 : 0,
      task.completion_reason || null,
      createdAt,
      task.completed_at || null
    );

    return {
      id,
      created_at: createdAt,
      ...task,
    };
  },

  updateTaskStatus: (id: string, status: Task['status'], reason?: string, isAiCompleted = false): Task | undefined => {
    const completedAt = status === 'completed' ? new Date().toISOString() : null;
    const stmt = db.prepare(`
      UPDATE tasks 
      SET status = ?, completion_reason = COALESCE(?, completion_reason), ai_completed = CASE WHEN ? = 1 THEN 1 ELSE ai_completed END, completed_at = ?
      WHERE id = ?
    `);
    stmt.run(status, reason || null, isAiCompleted ? 1 : 0, completedAt, id);

    const getStmt = db.prepare('SELECT t.*, c.name as conversation_name FROM tasks t LEFT JOIN conversations c ON t.conversation_id = c.id WHERE t.id = ?');
    const r = getStmt.get(id) as DbTaskRow | undefined;
    if (!r) return undefined;
    return {
      ...r,
      status: r.status as Task['status'],
      priority: r.priority as Task['priority'],
      ai_created: Boolean(r.ai_created),
      ai_completed: Boolean(r.ai_completed),
    };
  },

  updateTask: (id: string, updates: Partial<Task>): Task | undefined => {
    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); params.push(updates.priority); }
    if (updates.deadline !== undefined) { fields.push('deadline = ?'); params.push(updates.deadline); }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
      if (updates.status === 'completed') {
        fields.push('completed_at = ?');
        params.push(new Date().toISOString());
      }
    }

    if (fields.length === 0) return undefined;

    params.push(id);
    const stmt = db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...params);

    const getStmt = db.prepare('SELECT t.*, c.name as conversation_name FROM tasks t LEFT JOIN conversations c ON t.conversation_id = c.id WHERE t.id = ?');
    const r = getStmt.get(id) as DbTaskRow | undefined;
    if (!r) return undefined;
    return {
      ...r,
      status: r.status as Task['status'],
      priority: r.priority as Task['priority'],
      ai_created: Boolean(r.ai_created),
      ai_completed: Boolean(r.ai_completed),
    };
  },

  deleteTask: (id: string) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  },

  // Settings
  getSettings: (): AppSettings => {
    const stmt = db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all() as Array<{ key: string; value: string }>;
    const settingsObj: Record<string, string | boolean> = {};
    for (const row of rows) {
      if (row.key === 'auto_task_extraction' || row.key === 'auto_task_completion') {
        settingsObj[row.key] = row.value === 'true';
      } else {
        settingsObj[row.key] = row.value;
      }
    }
    return settingsObj as unknown as AppSettings;
  },

  updateSettings: (updates: Partial<AppSettings>) => {
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        stmt.run(key, String(value));
      }
    }
  },
};
