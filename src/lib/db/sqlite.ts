import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Conversation, Message, Task, AppSettings, Contact, Memory, Sentiment, OutboxEventType, OutboxEvent, AssistantMessage, AssistantAction, AssistantActionResult } from '@/types';

const dbDir = path.join(process.cwd(), 'data');
// Test/ops hook: point the store at a temp file (vitest sets this).
const dbPath = process.env.ZALO_DB_PATH || path.join(dbDir, 'zalo_tasks.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

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

    -- Personal Communication OS v2: knowledge layer
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT DEFAULT '[]',
      phones TEXT DEFAULT '[]',
      emails TEXT DEFAULT '[]',
      company TEXT,
      relationship TEXT,
      importance INTEGER DEFAULT 0,
      notes TEXT,
      summary TEXT,
      source_provider TEXT DEFAULT 'zalo',
      external_id TEXT,
      last_interaction_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      contact_id TEXT,
      conversation_id TEXT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      source_msg_id TEXT,
      source_msg_text TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (contact_id, category, content)
    );

    -- Outbox: every ingest event published once, workers consume independently
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_deliveries (
      event_id TEXT NOT NULL,
      worker TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY (event_id, worker)
    );

    CREATE TABLE IF NOT EXISTS message_embeddings (
      message_id TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      dims INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS briefs (
      date TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- AI Assistant: the user's chat with the assistant (never auto-sent).
    -- actions holds proposed actions (JSON), action_results holds confirmed
    -- execution outcomes keyed by action id (idempotent).
    CREATE TABLE IF NOT EXISTS assistant_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      actions TEXT NOT NULL DEFAULT '[]',
      action_results TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

   `);

  migrateConversationColumns();
  migrateMessageColumns();
  migrateTaskColumns();

  const defaultSettings: Record<string, string> = {
    zalo_mode: 'mock',
    ai_provider: 'omniroute',
    gemini_api_key: '',
    gemini_model: 'gemini-2.5-flash',
    openai_api_key: '',
    openai_base_url: '',
    openai_model: 'gpt-4o-mini',
    ollama_url: 'http://localhost:11434',
    ollama_model: 'llama3',
    // Local omniroute gateway (k3s). Env can override for non-node hosts.
    omniroute_base_url: process.env.OMNIROUTE_BASE_URL || 'http://10.43.196.168:20128/v1',
    omniroute_api_key: process.env.OMNIROUTE_API_KEY || '',
    omniroute_model: process.env.OMNIROUTE_MODEL || 'auto/best-fast',
    auto_task_extraction: 'true',
    auto_task_completion: 'true',
    auto_memory_extraction: 'true',
    auto_summary: 'true',
    auto_embeddings: 'true',
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


/**
 * Wipe all rows and re-run initDB (schema + seed). Used by tests to get a
 * deterministic starting state; harmless in dev tooling.
 */
export function resetDatabase(): void {
  db.exec(`
    DELETE FROM assistant_messages;
    DELETE FROM event_deliveries;
    DELETE FROM events;
    DELETE FROM message_embeddings;
    DELETE FROM briefs;
    DELETE FROM memories;
    DELETE FROM tasks;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM contacts;
    DELETE FROM settings;
  `);
  initDB();
}

/**
 * v1 → v2: conversations become living documents. ALTER TABLE is not
 * idempotent in SQLite, so add missing columns one by one.
 */
function migrateConversationColumns() {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>).map(c => c.name)
  );
  const additions: Array<[string, string]> = [
    ['summary', 'TEXT'],
    ['open_topics', "TEXT DEFAULT '[]'"],
    ['sentiment', "TEXT DEFAULT 'neutral'"],
    ['importance', 'INTEGER DEFAULT 0'],
    ['contact_id', 'TEXT'],
    ['last_ai_summary_at', 'TEXT'],
  ];
  for (const [name, def] of additions) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${def}`);
    }
  }
}

/** v2 → v3: messages carry parsed Zalo attachments (JSON). */
function migrateMessageColumns() {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(c => c.name)
  );
  if (!cols.has('attachment')) {
    db.exec('ALTER TABLE messages ADD COLUMN attachment TEXT');
  }
}

/** v2 → v3: tasks distinguish who asked (requester) from who must do it (assignee). */
function migrateTaskColumns() {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(c => c.name)
  );
  for (const [name, def] of [['requester', 'TEXT'], ['assignee', 'TEXT']] as Array<[string, string]>) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${def}`);
    }
  }
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
    INSERT INTO tasks (id, conversation_id, title, description, requester, assignee, status, priority, deadline, source_msg_id, source_msg_text, ai_created, ai_completed, completion_reason, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Task 1 (Conv 1 - Pending)
  insertTask.run(
    'task_01',
    conv1Id,
    'Gửi báo giá 5 bộ máy tính Dell cho Anh Tuấn',
    'Gửi sang email tuan@tinhoca.com',
    'Anh Tuấn',
    'Tôi',
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
    'Chị Mai',
    'Tôi',
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
    'Tôi',
    'Đức',
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
  // Seed contacts (knowledge objects) linked to individual conversations
  const insertContact = db.prepare(`
    INSERT INTO contacts (id, name, aliases, phones, emails, company, relationship, importance, notes, summary, source_provider, external_id, last_interaction_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const seedContact = (
    id: string,
    name: string,
    phone: string,
    email: string,
    company: string,
    relationship: string,
    importance: number,
    convId: string
  ) => {
    insertContact.run(
      id, name, JSON.stringify([]), JSON.stringify([phone]), JSON.stringify([email]),
      company, relationship, importance, '', '', 'zalo', name,
      now, now, now
    );
    db.prepare('UPDATE conversations SET contact_id = ? WHERE id = ?').run(id, convId);
  };
  seedContact('ct_tuan', 'Anh Tuấn', '0908123456', 'tuan@tinhoca.com', 'Công ty Tin Học A', 'khách hàng', 90, conv1Id);
  seedContact('ct_mai', 'Chị Mai', '0912987654', '', 'Shop Thời Trang', 'khách hàng', 70, conv2Id);
  seedContact('ct_duc', 'Đức', '0933112233', '', '', 'cộng tác viên', 60, conv3Id);

  // Seed memories from the mock conversations
  const insertMemory = db.prepare(`
    INSERT OR IGNORE INTO memories (id, contact_id, conversation_id, category, content, confidence, source_msg_id, source_msg_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMemory.run('mem_1', 'ct_tuan', conv1Id, 'company', 'Công ty Tin Học A', 0.95, msg2Id, 'Em gửi cho anh báo giá 5 bộ máy tính Dell sang email tuan@tinhoca.com trước 4h chiều nay nhé.', now);
  insertMemory.run('mem_2', 'ct_tuan', conv1Id, 'email', 'tuan@tinhoca.com', 0.95, msg2Id, 'Em gửi cho anh báo giá 5 bộ máy tính Dell sang email tuan@tinhoca.com trước 4h chiều nay nhé.', now);
  insertMemory.run('mem_3', 'ct_mai', conv2Id, 'location', 'Địa chỉ giao hàng: 123 Nguyễn Trãi, Quận 5', 0.9, msg4Id, 'Nhớ đổi giúp chị địa chỉ giao hàng sang 123 Nguyễn Trãi, Quận 5 nhé, sđt nhận 0912987654.', now);
  insertMemory.run('mem_4', 'ct_mai', conv2Id, 'product', 'Khách mua 50 áo thun', 0.9, msg3Id, 'Đơn hàng 50 áo thun hôm qua em note lại chưa?', now);
  insertMemory.run('mem_5', 'ct_duc', conv3Id, 'other', 'Đức là designer, làm banner Tết', 0.85, msg5Id, 'Đức ơi banner Tết bị lệch logo, nhờ em chỉnh lại màu đỏ tươi hơn nhé.', now);
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
  attachment?: string;
  timestamp: string;
  ai_processed: number;
}

interface DbTaskRow {
  id: string;
  conversation_id: string;
  title: string;
  description?: string;
  requester?: string;
  assignee?: string;
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

/** Map a messages row to the app Message, parsing the stored attachment JSON. */
function rowToMessage(row: DbMessageRow): Message {
  return {
    ...row,
    is_from_me: Boolean(row.is_from_me),
    ai_processed: Boolean(row.ai_processed),
    attachment: row.attachment ? (JSON.parse(row.attachment) as Message['attachment']) : null,
  };
}

interface DbContactRow {
  id: string;
  name: string;
  aliases: string;
  phones: string;
  emails: string;
  company?: string;
  relationship?: string;
  importance: number;
  notes?: string;
  summary?: string;
  source_provider: string;
  external_id?: string;
  last_interaction_at?: string;
  created_at: string;
  updated_at: string;
}

function parseContact(row: DbContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    aliases: JSON.parse(row.aliases || '[]') as string[],
    phones: JSON.parse(row.phones || '[]') as string[],
    emails: JSON.parse(row.emails || '[]') as string[],
    company: row.company || undefined,
    relationship: row.relationship || undefined,
    importance: row.importance || 0,
    notes: row.notes || undefined,
    summary: row.summary || undefined,
    source_provider: row.source_provider,
    external_id: row.external_id || undefined,
    last_interaction_at: row.last_interaction_at || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseConversationRow(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    zalo_thread_id: row.zalo_thread_id as string,
    name: row.name as string,
    avatar: (row.avatar as string) || '',
    phone: (row.phone as string) || undefined,
    type: row.type as Conversation['type'],
    last_message: (row.last_message as string) || '',
    unread_count: Number(row.unread_count || 0),
    updated_at: row.updated_at as string,
    pending_task_count: row.pending_task_count !== undefined ? Number(row.pending_task_count) : undefined,
    summary: (row.summary as string) || undefined,
    open_topics: row.open_topics ? (JSON.parse(row.open_topics as string) as string[]) : undefined,
    sentiment: (row.sentiment as Sentiment) || undefined,
    importance: row.importance !== undefined ? Number(row.importance) : undefined,
    contact_id: (row.contact_id as string) || undefined,
    last_ai_summary_at: (row.last_ai_summary_at as string) || undefined,
  };
}

export const dbQueries = {
  // Transactions
  withTransaction: <T>(fn: () => T): T => db.transaction(fn)(),

  // Conversations
  getConversations: (): Conversation[] => {
    const stmt = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM tasks t WHERE t.conversation_id = c.id AND t.status IN ('pending', 'in_progress')) as pending_task_count
      FROM conversations c 
      ORDER BY c.updated_at DESC
    `);
    return (stmt.all() as Array<Record<string, unknown>>).map(parseConversationRow);
  },

  getConversationById: (id: string): Conversation | undefined => {
    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? parseConversationRow(row) : undefined;
  },

  getConversationByThreadId: (threadId: string): Conversation | undefined => {
    const row = db.prepare('SELECT * FROM conversations WHERE zalo_thread_id = ?').get(threadId) as Record<string, unknown> | undefined;
    return row ? parseConversationRow(row) : undefined;
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
    return rows.map(rowToMessage);
  },
 
  getMessageByZaloMsgId: (zaloMsgId: string): Message | undefined => {
    const row = db.prepare('SELECT * FROM messages WHERE zalo_msg_id = ?').get(zaloMsgId) as DbMessageRow | undefined;
    if (!row) return undefined;
    return rowToMessage(row);
  },

  addMessage: (msg: Omit<Message, 'ai_processed'> & { ai_processed?: boolean }): Message => {
    const stmt = db.prepare(`
      INSERT INTO messages (id, conversation_id, zalo_msg_id, sender_id, sender_name, is_from_me, content, attachment, timestamp, ai_processed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const isFromMeInt = msg.is_from_me ? 1 : 0;
    const aiProcessedInt = msg.ai_processed ? 1 : 0;
    stmt.run(
      msg.id,
      msg.conversation_id,
      msg.zalo_msg_id,
      msg.sender_id,
      msg.sender_name,
      isFromMeInt,
      msg.content,
      msg.attachment ? JSON.stringify(msg.attachment) : null,
      msg.timestamp,
      aiProcessedInt
    );

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
      INSERT INTO tasks (id, conversation_id, title, description, requester, assignee, status, priority, deadline, source_msg_id, source_msg_text, ai_created, ai_completed, completion_reason, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      task.conversation_id,
      task.title,
      task.description || '',
      task.requester || null,
      task.assignee || null,
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
    if (updates.requester !== undefined) { fields.push('requester = ?'); params.push(updates.requester); }
    if (updates.assignee !== undefined) { fields.push('assignee = ?'); params.push(updates.assignee); }
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
      if (row.key === 'auto_task_extraction' || row.key === 'auto_task_completion' || row.key === 'auto_memory_extraction' || row.key === 'auto_summary' || row.key === 'auto_embeddings') {
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
  // ===== Personal Communication OS v2: contacts, memories, events, search =====

  // Contacts
  getContacts: (): Contact[] => {
    const stmt = db.prepare('SELECT * FROM contacts ORDER BY importance DESC, updated_at DESC');
    return (stmt.all() as DbContactRow[]).map(parseContact);
  },

  getContactById: (id: string): Contact | undefined => {
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as DbContactRow | undefined;
    return row ? parseContact(row) : undefined;
  },

  /**
   * Resolve a contact for a message sender. Reuses existing contacts by
   * name/phone/external_id, else creates a new knowledge object.
   */
  upsertContact: (input: {
    name: string;
    external_id?: string;
    phone?: string;
    email?: string;
    source_provider?: string;
    aliases?: string[];
  }): Contact => {
    const nowIso = new Date().toISOString();
    const existing = input.external_id
      ? db.prepare('SELECT * FROM contacts WHERE external_id = ? LIMIT 1').get(input.external_id) as DbContactRow | undefined
      : undefined;
    const byName = !existing
      ? db.prepare('SELECT * FROM contacts WHERE name = ? OR aliases LIKE ? LIMIT 1')
          .get(input.name, `%"${input.name}"%`) as DbContactRow | undefined
      : undefined;
    const row = existing || byName;
    if (row) {
      const phones = new Set(JSON.parse(row.phones || '[]') as string[]);
      const emails = new Set(JSON.parse(row.emails || '[]') as string[]);
      const aliases = new Set(JSON.parse(row.aliases || '[]') as string[]);
      if (input.phone && !phones.has(input.phone)) phones.add(input.phone);
      if (input.email && !emails.has(input.email)) emails.add(input.email);
      aliases.add(input.name);
      db.prepare(`
        UPDATE contacts SET name = ?, aliases = ?, phones = ?, emails = ?,
          external_id = COALESCE(?, external_id), updated_at = ?
        WHERE id = ?
      `).run(input.name, JSON.stringify([...aliases]), JSON.stringify([...phones]), JSON.stringify([...emails]), input.external_id || null, nowIso, row.id);
      const refreshed = dbQueries.getContactById(row.id);
      if (refreshed) return refreshed;
      return parseContact(row);
    }
    const id = 'ct_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const phones = input.phone ? JSON.stringify([input.phone]) : '[]';
    const emails = input.email ? JSON.stringify([input.email]) : '[]';
    db.prepare(`
      INSERT INTO contacts (id, name, aliases, phones, emails, company, relationship, importance, notes, summary, source_provider, external_id, last_interaction_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', '', 0, '', '', ?, ?, NULL, ?, ?)
    `).run(id, input.name, '[]', phones, emails, input.source_provider || 'zalo', input.external_id || null, nowIso, nowIso);
    return dbQueries.getContactById(id) as Contact;
  },

  updateContactProfile: (id: string, patch: {
    company?: string;
    relationship?: string;
    importance?: number;
    notes?: string;
    summary?: string;
  }) => {
    const fields: string[] = [];
    const params: (string | number)[] = [];
    if (patch.company !== undefined) { fields.push('company = ?'); params.push(patch.company); }
    if (patch.relationship !== undefined) { fields.push('relationship = ?'); params.push(patch.relationship); }
    if (patch.importance !== undefined) { fields.push('importance = ?'); params.push(patch.importance); }
    if (patch.notes !== undefined) { fields.push('notes = ?'); params.push(patch.notes); }
    if (patch.summary !== undefined) { fields.push('summary = ?'); params.push(patch.summary); }
    if (fields.length === 0) return;
    params.push(new Date().toISOString(), id);
    db.prepare(`UPDATE contacts SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  },

  touchContactInteraction: (id: string) => {
    db.prepare('UPDATE contacts SET last_interaction_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), id);
  },

  // Memories
  getMemories: (limit = 20, contactId?: string): Memory[] => {
    const rows = contactId
      ? db.prepare('SELECT * FROM memories WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?').all(contactId, limit)
      : db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows as Memory[];
  },

  addMemory: (mem: Omit<Memory, 'id' | 'created_at'>): Memory | undefined => {
    const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const created = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO memories (id, contact_id, conversation_id, category, content, confidence, source_msg_id, source_msg_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, mem.contact_id || null, mem.conversation_id || null, mem.category, mem.content, mem.confidence ?? 0.7, mem.source_msg_id || null, mem.source_msg_text || null, created);
      return { ...mem, id, created_at: created } as Memory;
    } catch {
      // UNIQUE(contact_id, category, content) — already known, keep the original
      return undefined;
    }
  },

  // Outbox: events published once, delivered to each worker exactly once
  publishEvent: (type: OutboxEventType, payload: Record<string, unknown>): OutboxEvent => {
    const evt: OutboxEvent = {
      id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      type,
      payload,
      created_at: new Date().toISOString(),
    };
    db.prepare('INSERT INTO events (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(evt.id, evt.type, JSON.stringify(evt.payload), evt.created_at);
    return evt;
  },

  getPendingEvents: (): OutboxEvent[] => {
    const rows = db.prepare('SELECT * FROM events ORDER BY created_at ASC').all() as Array<{
      id: string; type: string; payload: string; created_at: string;
    }>;
    return rows.map(r => ({ id: r.id, type: r.type as OutboxEventType, payload: JSON.parse(r.payload) as Record<string, unknown>, created_at: r.created_at }));
  },

  isEventDelivered: (eventId: string, worker: string): boolean => {
    const row = db.prepare('SELECT 1 FROM event_deliveries WHERE event_id = ? AND worker = ?')
      .get(eventId, worker) as { processed_at: string } | undefined;
    return Boolean(row);
  },

  markEventDelivered: (eventId: string, worker: string) => {
    db.prepare('INSERT OR IGNORE INTO event_deliveries (event_id, worker, processed_at) VALUES (?, ?, ?)')
      .run(eventId, worker, new Date().toISOString());
  },

  // Conversation living-document fields
  updateConversationMeta: (conversationId: string, patch: {
    summary?: string;
    open_topics?: string[];
    sentiment?: Sentiment;
    importance?: number;
    contact_id?: string;
    last_ai_summary_at?: string;
  }) => {
    const fields: string[] = [];
    const params: (string | number)[] = [];
    if (patch.summary !== undefined) { fields.push('summary = ?'); params.push(patch.summary); }
    if (patch.open_topics !== undefined) { fields.push('open_topics = ?'); params.push(JSON.stringify(patch.open_topics)); }
    if (patch.sentiment !== undefined) { fields.push('sentiment = ?'); params.push(patch.sentiment); }
    if (patch.importance !== undefined) { fields.push('importance = ?'); params.push(patch.importance); }
    if (patch.contact_id !== undefined) { fields.push('contact_id = ?'); params.push(patch.contact_id); }
    if (patch.last_ai_summary_at !== undefined) { fields.push('last_ai_summary_at = ?'); params.push(patch.last_ai_summary_at); }
    if (fields.length === 0) return;
    params.push(conversationId);
    db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  },

  getMessageById: (id: string): Message | undefined => {
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as DbMessageRow | undefined;
    if (!row) return undefined;
    return rowToMessage(row);
  },

  // Embeddings (local vectors; identical contract to pgvector later)
  getMessageEmbedding: (messageId: string): number[] | undefined => {
    const row = db.prepare('SELECT embedding FROM message_embeddings WHERE message_id = ?').get(messageId) as { embedding: string } | undefined;
    return row ? (JSON.parse(row.embedding) as number[]) : undefined;
  },

  saveMessageEmbedding: (messageId: string, embedding: number[]) => {
    db.prepare(`
      INSERT INTO message_embeddings (message_id, embedding, dims, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET embedding = excluded.embedding, dims = excluded.dims
    `).run(messageId, JSON.stringify(embedding), embedding.length, new Date().toISOString());
  },

  getAllEmbeddedMessages: (): Array<{ message: Message; embedding: number[] }> => {
    const rows = db.prepare(`
      SELECT m.*, e.embedding FROM messages m
      INNER JOIN message_embeddings e ON e.message_id = m.id
    `).all() as Array<DbMessageRow & { embedding: string }>;
    return rows.map(r => ({
      message: rowToMessage(r),
      embedding: JSON.parse(r.embedding) as number[],
    }));
  },

  // Daily briefs
  getBrief: (date: string): string | null => {
    const row = db.prepare('SELECT content FROM briefs WHERE date = ?').get(date) as { content: string } | undefined;
    return row?.content ?? null;
  },

  saveBrief: (date: string, content: string) => {
    db.prepare('INSERT OR REPLACE INTO briefs (date, content, created_at) VALUES (?, ?, ?)')
      .run(date, content, new Date().toISOString());
  },

  // Recent cross-conversation activity (assistant context + future surfaces)
  getRecentMessages: (limit = 15): Message[] => {
    const rows = db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?').all(limit) as DbMessageRow[];
    return rows.map(rowToMessage).reverse();
  },

  getMessageConversationIds: (): string[] => {
    const rows = db.prepare('SELECT DISTINCT conversation_id FROM messages').all() as Array<{ conversation_id: string }>;
    return rows.map(r => r.conversation_id);
  },

  // ===== AI Assistant =====
  getAssistantMessages: (limit = 50): AssistantMessage[] => {
    const rows = db.prepare(
      'SELECT * FROM (SELECT * FROM assistant_messages ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC'
    ).all(limit) as Array<{
      id: string; role: string; content: string; actions: string; action_results: string; created_at: string;
    }>;
    return rows.map(r => ({
      id: r.id,
      role: r.role as AssistantMessage['role'],
      content: r.content,
      actions: (JSON.parse(r.actions) as AssistantAction[]) || [],
      action_results: (JSON.parse(r.action_results) as AssistantActionResult[]) || [],
      created_at: r.created_at,
    }));
  },

  getAssistantMessageById: (id: string): AssistantMessage | undefined => {
    const row = db.prepare('SELECT * FROM assistant_messages WHERE id = ?').get(id) as {
      id: string; role: string; content: string; actions: string; action_results: string; created_at: string;
    } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      role: row.role as AssistantMessage['role'],
      content: row.content,
      actions: (JSON.parse(row.actions) as AssistantAction[]) || [],
      action_results: (JSON.parse(row.action_results) as AssistantActionResult[]) || [],
      created_at: row.created_at,
    };
  },

  addAssistantMessage: (input: { role: 'user' | 'assistant'; content: string; actions?: AssistantAction[] }): AssistantMessage => {
    const id = 'am_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const last = db.prepare('SELECT created_at FROM assistant_messages ORDER BY created_at DESC LIMIT 1').get() as
      | { created_at: string }
      | undefined;
    let created = new Date().toISOString();
    if (last && last.created_at >= created) {
      created = new Date(new Date(last.created_at).getTime() + 1).toISOString();
    }
    db.prepare(
      'INSERT INTO assistant_messages (id, role, content, actions, action_results, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, input.role, input.content, JSON.stringify(input.actions ?? []), '[]', created);
    return { id, role: input.role, content: input.content, actions: input.actions ?? [], action_results: [], created_at: created };
  },

  /** Attach an execution outcome to an assistant message. Idempotent per action id. */
  attachAssistantActionResult: (messageId: string, result: AssistantActionResult): boolean => {
    const existing = db.prepare('SELECT action_results FROM assistant_messages WHERE id = ?').get(messageId) as
      | { action_results: string }
      | undefined;
    if (!existing) return false;
    const results = (JSON.parse(existing.action_results) as AssistantActionResult[]).filter(r => r.id !== result.id);
    results.push(result);
    db.prepare('UPDATE assistant_messages SET action_results = ? WHERE id = ?')
      .run(JSON.stringify(results), messageId);
    return true;
  },
};
