import { dbQueries } from '@/lib/db/sqlite';
import { OMNIROUTE_DEFAULT_MODEL } from '@/lib/ai/llm';
import { runPiAssistantTurn } from '@/lib/ai/pi-agent';
import {
  AppSettings,
  AssistantAction,
  AssistantContext,
  Contact,
  Memory,
  Task,
} from '@/types';

/**
 * AI Assistant (Trợ lý AI) — a chat with the assistant that has full app
 * context: conversations, messages, tasks, contacts, notes and the current
 * screen. The assistant only PROPOSES actions (currently `send_message`);
 * the user confirms in the UI before anything is executed. This keeps the
 * spec's human-first principle: the AI never messages anyone unprompted.
 */

export const ASSISTANT_MAX_ACTIONS = 3;
const DIRECTORY_LIMIT = 60;
const HISTORY_LIMIT = 12;
const CURRENT_CHAT_LIMIT = 20;
const RECENT_ACTIVITY_LIMIT = 15;
const MEMORY_LIMIT = 15;
const TASK_LIMIT = 25;

export interface AssistantContextBundle {
  screenLabel: string;
  conversation: { id: string; name: string } | null;
  /** name → id for the assistant's action targeting (deduped, normalized key). */
  directory: Array<{ id: string; name: string; key: string }>;
  directoryById: Map<string, string>;
  currentMessages: string[];
  pendingTasks: string[];
  contacts: string[];
  memories: string[];
  recentActivity: string[];
}

export interface AssistantTurnResult {
  reply: string;
  actions: AssistantAction[];
}

/** Fold a name for fuzzy matching: strip diacritics, lowercase, collapse spaces. */
export function normalizeKey(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable deterministic id for a proposed action (idempotent proposals → same id). */
export function actionIdFor(type: string, conversationId: string, content: string): string {
  const raw = `${type}|${conversationId}|${content}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return 'act_' + hash.toString(16).padStart(8, '0');
}

function screenLabelFor(context: AssistantContext): string {
  if (context.screen === 'chats') return 'Hội thoại';
  if (context.screen === 'tasks') return 'Công việc';
  return 'Bảng điều khiển';
}

function formatMessageLine(sender: string, content: string, timestamp: string): string {
  const time = timestamp.slice(11, 16) || timestamp;
  const body = content.length > 140 ? content.slice(0, 140) + '…' : content;
  return `[${time}] ${sender}: ${body}`;
}

/**
 * Deterministic snapshot of everything the assistant may need: current screen,
 * open conversation + its recent messages, the conversation directory
 * (name → id, so "chị Ngân" can be resolved), open tasks, contacts, notes and
 * recent activity across all conversations. No LLM involved.
 */
export function buildAssistantContext(context: AssistantContext): AssistantContextBundle {
  const conversations = dbQueries.getConversations();
  const withMessages = new Set(dbQueries.getMessageConversationIds());
  const directory: AssistantContextBundle['directory'] = [];
  const seenKeys = new Set<string>();

  for (const conv of conversations) {
    if (!withMessages.has(conv.id) && conv.id !== context.conversation_id) continue;
    if (conv.name === 'Tôi') continue;
    const key = normalizeKey(conv.name);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    directory.push({ id: conv.id, name: conv.name, key });
    if (directory.length >= DIRECTORY_LIMIT) break;
  }
  if (context.conversation_id && context.conversation_name && !seenKeys.has(normalizeKey(context.conversation_name))) {
    directory.push({
      id: context.conversation_id,
      name: context.conversation_name,
      key: normalizeKey(context.conversation_name),
    });
  }

  const directoryById = new Map(directory.map(d => [d.id, d.name]));
  const conversation = context.conversation_id
    ? { id: context.conversation_id, name: context.conversation_name ?? directoryById.get(context.conversation_id) ?? 'Hội thoại' }
    : null;

  let currentMessages: string[] = [];
  if (conversation) {
    currentMessages = dbQueries
      .getMessagesByConversationId(conversation.id)
      .slice(-CURRENT_CHAT_LIMIT)
      .map(m => formatMessageLine(m.sender_name, m.content, m.timestamp));
  }

  const allTasks = dbQueries.getTasks();
  const openTasks = allTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').slice(0, TASK_LIMIT);
  const pendingTasks = openTasks.map(t => {
    const owner = t.assignee ? `, người làm: ${t.assignee}` : '';
    const deadline = t.deadline ? `, hạn: ${t.deadline.slice(0, 10)}` : '';
    return `- "${t.title}" (khách: ${t.requester ?? '?'}${owner}${deadline})`;
  });

  const contacts = dbQueries.getContacts();
  const contactById = new Map(contacts.map(c => [c.id, c.name]));
  const memories = dbQueries.getMemories(MEMORY_LIMIT).map((mem: Memory) => {
    const owner = mem.contact_id ? contactById.get(mem.contact_id) : null;
    const who = owner ? `${owner}: ` : '';
    return `- ${who}${mem.category}: ${mem.content}`;
  });

  const recentActivity = dbQueries.getRecentMessages(RECENT_ACTIVITY_LIMIT).map(m => {
    const convName = directoryById.get(m.conversation_id) ?? m.conversation_id;
    return formatMessageLine(`[${convName}] ${m.sender_name}`, m.content, m.timestamp);
  });

  return {
    screenLabel: screenLabelFor(context),
    conversation,
    directory,
    directoryById,
    currentMessages,
    pendingTasks,
    contacts: contacts.map((c: Contact) => {
      const bits = [c.name];
      if (c.company) bits.push(`công ty ${c.company}`);
      if (c.relationship) bits.push(`quan hệ: ${c.relationship}`);
      if (c.importance > 0) bits.push(`mức ưu tiên ${c.importance}`);
      if (c.notes) bits.push(`ghi chú: ${c.notes}`);
      return `- ${bits.join(', ')}`;
    }),
    memories,
    recentActivity,
  };
}

function directoryMatch(person: string, bundle: AssistantContextBundle): { id: string; name: string } | null {
  const personKey = normalizeKey(person);
  if (!personKey) return null;
  let best: { id: string; name: string } | null = null;
  let bestScore = 0;
  for (const entry of bundle.directory) {
    // Names keep honorifics ("Chị Mai (Shop Thời Trang)"), so compare the
    // person reference against both the full name and the honorific-stripped
    // form — "Mai" and "Chị Mai" must both resolve.
    const bareKey = entry.key.replace(/^(?:chi|anh|em|ban|co|chu|thay|bac|di|ong|ba)\s+/, '');
    let score = 0;
    if (entry.key === personKey || bareKey === personKey) {
      score = 3;
    } else if (personKey.length >= 2 && (entry.key.startsWith(personKey) || bareKey.startsWith(personKey))) {
      score = 2;
    } else if (entry.key.length >= 3 && (personKey.startsWith(entry.key) || personKey.startsWith(bareKey))) {
      score = 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { id: entry.id, name: entry.name };
    }
  }
  return best;
}

const SEND_INTENT =
  /^(?:trả lời(?: cho| tới)?|reply|nhắn(?: tin)?(?: cho| tới)?|soạn(?: tin nhắn)?(?: cho| tới)?|gửi tin nhắn(?: cho| tới)?|gửi cho|gửi tới|nhắn tin(?: cho| tới)?)\s+/i;
const HONORIFIC = /^(?:chị|anh|em|bạn|cô|chú|thầy|bác|dì|ông|bà)\s+/i;
const CONTENT_SEPARATOR = /(?:\s+(?:là|rằng)\s+|\s+nội dung\s*[:：]\s*|\s*[:：]\s*)/i;

/**
 * Deterministic fallback responder: parses "trả lời <tên> là <nội dung>"
 * against the conversation directory and proposes a send_message action.
 * Used for the `smart_heuristic` provider and whenever the LLM is unreachable,
 * so tests and degraded mode behave predictably.
 */
export function heuristicRespond(userText: string, bundle: AssistantContextBundle): AssistantTurnResult {
  const text = userText.trim();

  if (SEND_INTENT.test(text)) {
    const rest = text.replace(SEND_INTENT, '').replace(HONORIFIC, '').trim();
    // Boundary = the FIRST separator ("là"/"rằng"/":"/nội dung) after the
    // person reference; everything before is the name, everything after is
    // the message draft.
    const sep = rest.match(CONTENT_SEPARATOR);
    const person = (sep && sep.index !== undefined ? rest.slice(0, sep.index) : rest).trim();
    const content = (sep && sep.index !== undefined ? rest.slice(sep.index + sep[0].length) : '').trim();

    const match = directoryMatch(person, bundle);
    if (!match) {
      const who = person || 'người nhận';
      return { reply: `Mình không tìm thấy hội thoại của "${who}" trong danh sách.`, actions: [] };
    }
    if (!content) {
      return { reply: `Mình đã tìm thấy hội thoại "${match.name}" nhưng chưa rõ nội dung cần gửi. Bạn hãy nói rõ hơn nhé.`, actions: [] };
    }

    const action: AssistantAction = {
      id: actionIdFor('send_message', match.id, content),
      type: 'send_message',
      conversation_id: match.id,
      conversation_name: match.name,
      content,
      reason: `Người dùng yêu cầu trả lời ${match.name}`,
    };
    return {
      reply: `Mình đã soạn tin nhắn cho ${match.name}: "${content}". Bấm "Gửi" bên dưới để xác nhận gửi nhé.`,
      actions: [action],
    };
  }

  if (/(?:việc|task|công việc|hạn|deadline)/i.test(text) && bundle.pendingTasks.length > 0) {
    const list = bundle.pendingTasks.slice(0, 5).join('\n');
    return {
      reply: `Bạn có ${bundle.pendingTasks.length} việc đang chờ:\n${list}`,
      actions: [],
    };
  }

  if (/(?:tóm tắt|summary|nhắc lại|vừa nói)/i.test(text) && bundle.currentMessages.length > 0) {
    const last = bundle.currentMessages.slice(-3).join('\n');
    return { reply: `Tin nhắn gần nhất trong hội thoại này:\n${last}`, actions: [] };
  }

  const convHint = bundle.conversation ? ` Mình đang xem hội thoại "${bundle.conversation.name}".` : '';
  return {
    reply: `Mình sẵn sàng giúp bạn với hội thoại, công việc và khách hàng của bạn. Bạn có thể hỏi về việc cần làm hoặc nhờ mình soạn tin nhắn trả lời khách hàng (ví dụ: "Trả lời chị Ngân là mai sẽ làm xong").${convHint}`,
    actions: [],
  };
}

/**
 * Validate and normalize LLM-proposed actions: only send_message, only
 * conversation ids that exist in the directory (never hallucinated), stable
 * ids, deduped, capped.
 */
export function sanitizeAssistantActions(raw: unknown, bundle: AssistantContextBundle): AssistantAction[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AssistantAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const cand = item as Record<string, unknown>;
    if (cand.type !== 'send_message') continue;
    const conversationId = typeof cand.conversation_id === 'string' ? cand.conversation_id.trim() : '';
    const content = typeof cand.content === 'string' ? cand.content.trim() : '';
    if (!conversationId || !content) continue;
    if (!bundle.directoryById.has(conversationId)) continue;
    const id = actionIdFor('send_message', conversationId, content);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      type: 'send_message',
      conversation_id: conversationId,
      conversation_name: bundle.directoryById.get(conversationId),
      content,
      reason: typeof cand.reason === 'string' && cand.reason.trim() ? cand.reason.trim() : undefined,
    });
    if (out.length >= ASSISTANT_MAX_ACTIONS) break;
  }
  return out;
}

/** Context snapshot injected into the agent system prompt (the "context file"). */
export function buildAssistantContextPrompt(bundle: AssistantContextBundle): string {
  return [
    `## MÀN HÌNH HIỆN TẠI\nĐang xem: ${bundle.screenLabel}` +
      (bundle.conversation ? `\nHội thoại đang mở: ${bundle.conversation.name} (${bundle.conversation.id})` : ''),
    `## HỘI THOẠI ĐANG MỞ (tin nhắn gần nhất)\n${bundle.currentMessages.join('\n') || '(không có tin nhắn)'}`,
    `## DANH SÁCH HỘI THOẠI (tên → id)\n${bundle.directory.map((d) => `${d.name} → ${d.id}`).join('\n') || '(trống)'}`,
    `## CÔNG VIỆC ĐANG CHỜ\n${bundle.pendingTasks.join('\n') || '(không có)'}`,
    `## KHÁCH HÀNG\n${bundle.contacts.join('\n') || '(trống)'}`,
    `## GHI CHÚ / KÝ ỨC\n${bundle.memories.join('\n') || '(trống)'}`,
    `## HOẠT ĐỘNG GẦN ĐÂY\n${bundle.recentActivity.join('\n') || '(trống)'}`,
  ].join('\n\n');
}

/** System prompt for the pi-agent-core path — same rules, tool-based proposals (no JSON blob). */
export const PI_ASSISTANT_SYSTEM_PROMPT = `Bạn là Trợ lý AI cá nhân của người dùng trong ứng dụng Personal Communication OS (Zalo). Bạn có toàn bộ ngữ cảnh: hội thoại Zalo, tin nhắn, công việc, khách hàng, ghi chú và màn hình hiện tại của người dùng.

Quy tắc:
1. Trả lời bằng tiếng Việt, ngắn gọn, chính xác. Chỉ dùng thông tin có trong ngữ cảnh được cung cấp. KHÔNG bịa chuyện, không đoán thông tin không có.
2. Nếu người dùng yêu cầu gửi tin nhắn cho ai đó (ví dụ "trả lời chị Ngân là mai sẽ làm xong", "nhắn cho anh Tuấn hẹn gặp chiều nay"): soạn nội dung tin nhắn bằng giọng của người dùng (tự nhiên, lịch sự) và GỌI TOOL send_message với conversation_id LẤY CHÍNH XÁC TỪ DANH SÁCH HỘI THOẠI bên dưới. Không bịa conversation_id.
3. send_message CHỈ LÀ ĐỀ XUẤT: hệ thống chặn thực thi và người dùng xác nhận trước khi gửi. Bạn KHÔNG BAO GIỜ tự gửi tin nhắn và không nói "đã gửi" — nói "đã đề xuất".
4. Không tìm thấy hội thoại phù hợp trong danh sách? Nói rõ điều đó, đừng đoán.
5. Nếu yêu cầu không cần hành động, chỉ trả lời bằng văn bản, không gọi tool.
6. Chỉ gọi send_message khi người dùng thực sự yêu cầu gửi tin nhắn; mỗi lượt gọi tối đa 3 lần.`;


/**
 * Run one assistant turn. LLM path runs through the pi agent loop
 * (`@earendil-works/pi-agent-core`: tools-as-proposals, human-first gate);
 * the deterministic heuristic responder is the fallback on any failure and
 * the `smart_heuristic` provider. Never executes anything — only proposes.
 */
export async function runAssistantTurn(
  userText: string,
  context: AssistantContext,
  settings: AppSettings
): Promise<AssistantTurnResult> {
  const bundle = buildAssistantContext(context);

  if (settings.ai_provider === 'smart_heuristic') {
    return heuristicRespond(userText, bundle);
  }

  try {
    const history = dbQueries.getAssistantMessages(HISTORY_LIMIT);
    const result = await runPiAssistantTurn(userText, history, settings, {
      systemPrompt: `${PI_ASSISTANT_SYSTEM_PROMPT}\n\n## NGỮ CẢNH ỨNG DỤNG HIỆN TẠI\n${buildAssistantContextPrompt(bundle)}`,
    });
    if (result) {
      return {
        reply: result.reply,
        actions: sanitizeAssistantActions(
          result.toolCalls.map((tc) => ({ type: 'send_message' as const, ...tc })),
          bundle
        ),
      };
    }
  } catch (err) {
    console.error(
      '[assistant] pi agent turn failed, falling back to heuristic:',
      err instanceof Error ? err.message : err
    );
  }

  return heuristicRespond(userText, bundle);
}
