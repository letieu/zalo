import { Message, Task, TaskPriority } from '@/types';

/**
 * Deterministic duplicate-task guard (spec §7: one task per issue).
 *
 * The LLM/heuristic workers may propose a new task from a follow-up message
 * that actually belongs to an already-open task in the same conversation
 * (e.g. customer complains → task created → agent replies "để em check"
 * → a second, near-identical task). AI outputs are regeneratable, so we
 * resolve this deterministically here instead of relying on the LLM alone:
 *  - rule 1: title similarity (Dice over normalized significant tokens)
 *  - rule 2: the new task's source message is the agent's reply to a
 *            customer message that already birthed a pending task
 */

/** Dice coefficient above which two task titles are the same issue. */
export const MERGE_SIMILARITY_THRESHOLD = 0.5;

/** Vietnamese function words / pronouns / politeness particles that carry no task identity. */
const STOPWORDS = new Set([
  'khong', 'co', 'cua', 'la', 'va', 'cac', 'nhung', 'voi', 'da', 'dang', 'se',
  'lai', 'roi', 'thi', 'ma', 'cho', 'khi', 've', 'theo', 'vao', 'ra', 'len',
  'xuong', 'toi', 'anh', 'chi', 'ban', 'oi', 'duoc', 'cung', 'nen', 'bi', 'do',
  'tu', 'trong', 'ngoai', 'giua', 'sau', 'nay', 'do', 'kia', 'xin', 'hay',
  'hoac', 'nhu', 'vay', 'the', 'luon', 'thoi', 'nhe', 'giup', 'lam',
]);

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip Vietnamese diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));
}

/** Dice coefficient over the normalized significant-token sets of two titles. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTokens(a));
  const tb = new Set(normalizeTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

export interface NewTaskCandidate {
  title: string;
  description?: string;
  priority: TaskPriority;
  deadline?: string;
  source_msg_id?: string;
  source_msg_text?: string;
}

/**
 * Returns the open task this new task is really a follow-up of, or undefined
 * if it is genuinely new.
 */
export function findMergeTarget(
  newTask: NewTaskCandidate,
  messages: Message[],
  pendingTasks: Task[]
): Task | undefined {
  if (pendingTasks.length === 0) return undefined;

  // Rule 1: title-level overlap (catches LLM paraphrases, e.g. the second
  // task "Kiểm tra và thêm lại hóa đơn liên quan" vs the first
  // "Xử lý hóa đơn liên quan không hiển thị" → Dice 0.62).
  for (const t of pendingTasks) {
    if (titleSimilarity(t.title, newTask.title) >= MERGE_SIMILARITY_THRESHOLD) return t;
  }

  // Rule 2: the new task was born from the agent's reply to a customer
  // message that already created a pending task (verbatim titles share no
  // tokens, so rule 1 can't see it). Only the immediate predecessor counts —
  // that is the message the reply actually answers.
  if (!newTask.source_msg_id) return undefined;
  const srcIdx = messages.findIndex(m => m.id === newTask.source_msg_id);
  if (srcIdx <= 0 || !messages[srcIdx].is_from_me) return undefined;
  const prev = messages[srcIdx - 1];
  if (prev.is_from_me) return undefined;
  return pendingTasks.find(t => t.source_msg_id === prev.id);
}

/** Fold a follow-up into the existing task: enrich, keep one task. */
export function mergeTaskContext(existing: Task, followUp: NewTaskCandidate): Partial<Task> {
  const updates: Partial<Task> = {};
  const note = followUp.source_msg_text;
  if (note && !(existing.description || '').includes(note)) {
    updates.description = [existing.description, `[Bổ sung] "${note}"`].filter(Boolean).join('\n');
  }
  if (followUp.deadline && !existing.deadline) {
    updates.deadline = followUp.deadline;
  }
  const rank: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 };
  if (rank[followUp.priority] > rank[existing.priority]) {
    updates.priority = followUp.priority;
  }
  return updates;
}
