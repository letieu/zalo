import { describe, it, expect } from 'vitest';
import {
  findMergeTarget,
  mergeTaskContext,
  titleSimilarity,
  NewTaskCandidate,
} from '@/lib/ai/task-dedup';
import { Message, Task } from '@/types';

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm' + Math.random(),
    conversation_id: 'c1',
    zalo_msg_id: 'z' + Math.random(),
    sender_id: 's',
    sender_name: 'Khách',
    is_from_me: false,
    content: '',
    timestamp: new Date().toISOString(),
    ai_processed: true,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't' + Math.random(),
    conversation_id: 'c1',
    title: 'Xử lý hóa đơn liên quan không hiển thị',
    description: 'Khách báo hóa đơn không hiển thị',
    status: 'pending',
    priority: 'medium',
    ai_created: true,
    ai_completed: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function candidate(overrides: Partial<NewTaskCandidate> = {}): NewTaskCandidate {
  return {
    title: 'Kiểm tra và thêm lại hóa đơn liên quan',
    priority: 'medium',
    ...overrides,
  };
}

describe('titleSimilarity', () => {
  it('merges the customer complaint and the agent follow-up titles (user case, Dice ≥ 0.5)', () => {
    // LLM paraphrased the follow-up, keeping the two key terms.
    expect(
      titleSimilarity(
        'Xử lý hóa đơn liên quan không hiển thị',
        'Kiểm tra và thêm lại hóa đơn liên quan'
      )
    ).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps genuinely different tasks apart', () => {
    expect(titleSimilarity('Gửi báo giá 5 bộ máy tính Dell', 'Sửa máy tính bị lỗi màn hình')).toBeLessThan(0.5);
  });

  it('is invariant to case and Vietnamese diacritics', () => {
    const exact = titleSimilarity('Gửi hóa đơn cho Anh Tuấn', 'Gửi hóa đơn cho Anh Tuấn');
    const accented = titleSimilarity('HÓA ĐƠN', 'hóa đơn');
    expect(exact).toBe(1);
    expect(accented).toBeGreaterThanOrEqual(0.9);
  });

  it('returns 0 when either side has no significant tokens', () => {
    expect(titleSimilarity('ok ạ', 'để em check')).toBe(0);
  });
});

describe('findMergeTarget', () => {
  it('rule 1: matches a paraphrased follow-up to the open task by title', () => {
    const pending = [task({ source_msg_id: 'm1' })];
    const followUp = candidate({
      title: 'Kiểm tra và thêm lại hóa đơn liên quan',
      source_msg_id: 'm2',
    });
    const target = findMergeTarget(followUp, [msg({ id: 'm1' }), msg({ id: 'm2' })], pending);
    expect(target?.id).toBe(pending[0].id);
  });

  it('rule 2: merges an agent reply that answers the customer message which birthed the task', () => {
    const complaint = msg({ id: 'm1', is_from_me: false, content: 'ko thể hiện hoá đơn liên quan' });
    const agentReply = msg({ id: 'm2', is_from_me: true, content: 'dạ để em check rồi em thêm lại ạ' });
    const pending = [task({ title: 'Gửi báo giá máy in', source_msg_id: 'm1' })];
    const followUp = candidate({ source_msg_id: 'm2' });
    const target = findMergeTarget(followUp, [complaint, agentReply], pending);
    expect(target?.id).toBe(pending[0].id);
  });

  it('rule 2: does not merge when the follow-up source is a customer message', () => {
    const pending = [task({ title: 'Gửi báo giá máy in', source_msg_id: 'm1' })];
    const followUp = candidate({ source_msg_id: 'm2' });
    const target = findMergeTarget(
      followUp,
      [msg({ id: 'm1' }), msg({ id: 'm2', is_from_me: false })],
      pending
    );
    expect(target).toBeUndefined();
  });

  it('rule 2: does not merge an agent message that follows an unrelated customer message', () => {
    const pending = [task({ title: 'Gửi báo giá máy in', source_msg_id: 'm1' })];
    const followUp = candidate({ source_msg_id: 'm3' });
    const target = findMergeTarget(
      followUp,
      [
        msg({ id: 'm1', content: 'ko thể hiện hoá đơn' }),
        msg({ id: 'm2', is_from_me: false, content: 'cho hỏi giá 10 cái áo' }),
        msg({ id: 'm3', is_from_me: true, content: 'để em gửi báo giá áo nhé' }),
      ],
      pending
    );
    expect(target).toBeUndefined();
  });

  it('returns undefined when there are no open tasks', () => {
    expect(findMergeTarget(candidate(), [msg({ id: 'm1' })], [])).toBeUndefined();
  });
});

describe('mergeTaskContext', () => {
  it('appends the follow-up message and keeps a single task', () => {
    const existing = task({ description: 'Khách báo hóa đơn không hiển thị' });
    const updates = mergeTaskContext(existing, candidate({ source_msg_text: 'dạ để em check rồi em thêm lại ạ' }));
    expect(updates.description).toContain('Khách báo hóa đơn không hiển thị');
    expect(updates.description).toContain('dạ để em check rồi em thêm lại ạ');
  });

  it('carries a deadline and upgrades priority from the follow-up', () => {
    const existing = task({ priority: 'low' });
    const updates = mergeTaskContext(existing, candidate({ priority: 'high', deadline: '16:00 hôm nay' }));
    expect(updates.priority).toBe('high');
    expect(updates.deadline).toBe('16:00 hôm nay');
  });

  it('does not downgrade priority or overwrite an existing deadline', () => {
    const existing = task({ priority: 'high', deadline: 'hôm nay' });
    const updates = mergeTaskContext(existing, candidate({ priority: 'low', deadline: 'tuần sau' }));
    expect(updates.priority).toBeUndefined();
    expect(updates.deadline).toBeUndefined();
  });
});
