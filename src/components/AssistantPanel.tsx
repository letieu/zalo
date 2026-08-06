'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Send, X, Loader2, Check, AlertTriangle } from 'lucide-react';
import { AssistantAction, AssistantContext, AssistantMessage } from '@/types';

interface AssistantPanelProps {
  context: AssistantContext;
  onDataChanged: () => void;
}

function screenLabel(context: AssistantContext): string {
  if (context.screen === 'chats') return context.conversation_name ?? 'Hội thoại';
  if (context.screen === 'tasks') return 'Công việc';
  return 'Bảng điều khiển';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function AssistantPanel({ context, onDataChanged }: AssistantPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/assistant/messages');
      const data = await res.json();
      if (data.messages) setMessages(data.messages);
    } catch (err) {
      console.error('Failed to load assistant history:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadHistory();
  }, [isOpen, loadHistory]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Không gửi được yêu cầu. Vui lòng thử lại.');
        return;
      }
      setMessages(prev => [...prev, data.userMessage, data.assistantMessage]);
      setInput('');
    } catch (err) {
      console.error('Assistant chat failed:', err);
      setError('Lỗi mạng khi gọi trợ lý. Vui lòng thử lại.');
    } finally {
      setSending(false);
    }
  };

  const executeAction = async (messageId: string, action: AssistantAction) => {
    if (executingIds.has(action.id)) return;
    setExecutingIds(prev => new Set(prev).add(action.id));
    setError(null);
    try {
      const res = await fetch('/api/assistant/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, action_id: action.id }),
      });
      const data = await res.json();
      if (data.result) {
        setMessages(prev => prev.map(m => {
          if (m.id !== messageId) return m;
          const results = [...m.action_results.filter(r => r.id !== action.id), data.result];
          return { ...m, action_results: results };
        }));
        onDataChanged();
      } else {
        setError(data.error || 'Không thực hiện được hành động.');
      }
    } catch (err) {
      console.error('Assistant action failed:', err);
      setError('Lỗi mạng khi thực hiện hành động.');
    } finally {
      setExecutingIds(prev => {
        const next = new Set(prev);
        next.delete(action.id);
        return next;
      });
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition hover:bg-indigo-700"
        title="Trợ lý AI"
        aria-label="Mở trợ lý AI"
      >
        <Bot className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex h-[min(70vh,640px)] w-[min(92vw,400px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-indigo-600 px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Trợ lý AI</p>
            <p className="truncate text-xs text-indigo-200">Đang xem: {screenLabel(context)}</p>
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="rounded p-1 hover:bg-indigo-500" aria-label="Đóng trợ lý AI">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded-xl bg-white p-3 text-sm text-slate-500">
            Hỏi mình bất cứ điều gì — mình có toàn bộ ngữ cảnh về hội thoại, công việc, khách hàng và ghi chú của bạn.
            Ví dụ: <span className="font-medium text-slate-700">&quot;Trả lời chị Ngân là mai sẽ làm xong&quot;</span>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white' : 'rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-slate-800 shadow-sm'}`}>
              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
              {msg.role === 'assistant' && msg.actions.length > 0 && (
                <div className="mt-2 space-y-2">
                  {msg.actions.map(action => {
                    const result = msg.action_results.find(r => r.id === action.id);
                    const isExecuting = executingIds.has(action.id);
                    return (
                      <div key={action.id} className="rounded-xl border border-indigo-100 bg-indigo-50 p-2">
                        <p className="text-xs font-semibold text-indigo-900">Gửi tin nhắn cho {action.conversation_name ?? action.conversation_id}</p>
                        {action.reason && <p className="mt-0.5 text-xs text-slate-500">{action.reason}</p>}
                        <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-slate-700">{action.content}</p>
                        {!result && (
                          <button
                            onClick={() => void executeAction(msg.id, action)}
                            disabled={isExecuting}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
                          >
                            {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                            {isExecuting ? 'Đang gửi…' : 'Gửi'}
                          </button>
                        )}
                        {result && (
                          <div className="mt-1.5 flex items-center gap-1 text-xs">
                            {result.ok ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="text-emerald-700">
                                  {result.via_zalo ? 'Đã gửi qua Zalo' : 'Đã gửi (đã lưu vào ứng dụng)'}
                                </span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                <span className="text-amber-700">{result.error ?? 'Gửi thất bại'}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className={`mt-1 text-[10px] ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'}`}>{formatTime(msg.created_at)}</p>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Trợ lý đang suy nghĩ…
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{error}</div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder="Hỏi trợ lý… (Enter để gửi)"
          className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-400"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-50"
          aria-label="Gửi yêu cầu"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
