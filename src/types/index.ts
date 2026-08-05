export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';
export type ZaloMode = 'mock' | 'personal' | 'oa';
export type AIProvider = 'smart_heuristic' | 'gemini' | 'openai' | 'ollama';

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

export interface AppSettings {
  zalo_mode: ZaloMode;
  ai_provider: AIProvider;
  gemini_api_key?: string;
  gemini_model?: string;
  openai_api_key?: string;
  openai_model?: string;
  ollama_url?: string;
  ollama_model?: string;
  auto_task_extraction: boolean;
  auto_task_completion: boolean;
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
