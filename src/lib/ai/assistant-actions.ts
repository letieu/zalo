import { sendOutgoingMessage } from '@/lib/zalo/send';
import { AssistantAction, AssistantActionResult } from '@/types';

/**
 * Execute a user-confirmed assistant action. Deterministic: no LLM involved.
 * Only the actions the assistant proposed (and the user approved) reach here.
 */
export async function executeAssistantAction(action: AssistantAction): Promise<AssistantActionResult> {
  if (action.type !== 'send_message') {
    return { id: action.id, ok: false, sent: false, via_zalo: false, error: 'Loại hành động không được hỗ trợ' };
  }
  const result = await sendOutgoingMessage(action.conversation_id, action.content);
  return {
    id: action.id,
    ok: result.ok,
    sent: result.sent,
    via_zalo: result.via_zalo,
    message_id: result.message?.id,
    error: result.error,
  };
}
