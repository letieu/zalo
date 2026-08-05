export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';
export type ZaloMode = 'mock' | 'personal' | 'oa';
export type AIProvider = 'smart_heuristic' | 'gemini' | 'openai' | 'ollama' | 'omniroute';
export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface Conversation {
  id: string;
  zalo_thread_id: string;
  name: string;
  avatar: string;
  phone?: string;
  type: 'individual' | 'group';
  last_message?: string;
  unread_count: number;
  updated_at: string;
  pending_task_count?: number;
  // Living-document fields (AI-derived, regeneratable — never the source of truth)
  summary?: string;
  open_topics?: string[];
  sentiment?: Sentiment;
  importance?: number;
  contact_id?: string;
  last_ai_summary_at?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  zalo_msg_id: string;
  sender_id: string;
  sender_name: string;
  is_from_me: boolean;
  content: string;
  timestamp: string;
  ai_processed: boolean;
}

export interface Task {
  id: string;
  conversation_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline?: string;
  source_msg_id?: string;
  source_msg_text?: string;
  ai_created: boolean;
  ai_completed: boolean;
  completion_reason?: string;
  created_at: string;
  completed_at?: string;
  conversation_name?: string;
}

/**
 * Contacts are knowledge objects (spec §5): identity + accumulated profile.
 * Every AI-extracted field here is derived from messages and regeneratable.
 */
export interface Contact {
  id: string;
  name: string;
  aliases: string[];
  phones: string[];
  emails: string[];
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

export type MemoryCategory =
  | 'email'
  | 'phone'
  | 'company'
  | 'product'
  | 'preference'
  | 'personal'
  | 'location'
  | 'commitment'
  | 'other';

export interface Memory {
  id: string;
  contact_id?: string;
  contact_name?: string;
  conversation_id?: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
  source_msg_id?: string;
  source_msg_text?: string;
  created_at: string;
}

export type OutboxEventType = 'message.saved' | 'conversation.updated';

export interface OutboxEvent {
  id: string;
  type: OutboxEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AppSettings {
  zalo_mode: ZaloMode;
  ai_provider: AIProvider;
  gemini_api_key?: string;
  gemini_model?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  openai_model?: string;
  ollama_url?: string;
  ollama_model?: string;
  // Local omniroute gateway (OpenAI-compatible), e.g. http://10.43.196.168:20128/v1
  omniroute_base_url?: string;
  omniroute_api_key?: string;
  omniroute_model?: string;
  auto_task_extraction: boolean;
  auto_task_completion: boolean;
  auto_memory_extraction: boolean;
  auto_summary: boolean;
  auto_embeddings: boolean;
}

export interface AIAnalysisResult {
  newTasks: Array<{
    title: string;
    description?: string;
    priority: TaskPriority;
    deadline?: string;
    source_msg_id?: string;
    source_msg_text?: string;
  }>;
  completedTaskIds: Array<{
    task_id: string;
    reason: string;
  }>;
}

export interface ExtractedMemory {
  category: MemoryCategory;
  content: string;
  confidence?: number;
}

export interface ConversationSummaryOutput {
  summary: string;
  open_topics: string[];
  sentiment: Sentiment;
  importance: number;
}

export interface WaitingConversation {
  id: string;
  name: string;
  avatar: string;
  last_message?: string;
  last_sender: string;
  updated_at: string;
  direction: 'awaiting_me' | 'awaiting_them';
  minutes_since_last: number;
}

export interface DashboardData {
  waitingForReply: WaitingConversation[];
  todayTasks: Task[];
  importantContacts: Contact[];
  recentMemories: Memory[];
  upcomingFollowUps: Task[];
  dailyBrief: string | null;
  unreadTotal: number;
  pendingTaskTotal: number;
}

export interface SearchHit {
  kind: 'message' | 'memory';
  id: string;
  conversation_id?: string;
  conversation_name?: string;
  contact_id?: string;
  contact_name?: string;
  content: string;
  sender_name?: string;
  timestamp?: string;
  category?: MemoryCategory;
  score: number;
}
