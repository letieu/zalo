'use client';

import { useState, useRef, useEffect } from 'react';
import { Conversation, Message, Task, ZaloMode } from '@/types';
import { Send, Phone, User, Sparkles, CheckCircle, ListTodo, PanelRightOpen, PanelRightClose } from 'lucide-react';

interface ChatWindowProps {
  conversation: Conversation | null;
  zaloMode: ZaloMode;
  messages: Message[];
  tasks: Task[];
  onSendMessage: (text: string) => void;
  onToggleTaskPanel: () => void;
  isTaskPanelOpen: boolean;
  onAnalyzeChat: () => void;
  isAnalyzing: boolean;
  composerError?: string | null;
  onClearComposerError?: () => void;
}

export function ChatWindow({
  conversation,
  zaloMode,
  messages,
  tasks,
  onSendMessage,
  onToggleTaskPanel,
  isTaskPanelOpen,
  onAnalyzeChat,
  isAnalyzing,
  composerError,
  onClearComposerError,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-slate-400 p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-200/60 flex items-center justify-center text-slate-400 mb-3">
          <User className="w-8 h-8" />
        </div>
        <h2 className="text-base font-semibold text-slate-600 mb-1">Chưa chọn cuộc trò chuyện</h2>
        <p className="text-xs max-w-sm">Chọn một khách hàng ở danh sách bên trái để bắt đầu chat và tự động theo dõi công việc bằng AI.</p>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const quickReplies = [
    'Đã ghi nhận yêu cầu của anh/chị',
    'Em đang xử lý và gửi báo giá lại ngay ạ',
    'Đã gửi thông tin qua email rồi ạ',
    'Đã nhận đủ hàng, cảm ơn anh/chị',
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#e4e8ec]">
      {/* Header */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center space-x-3">
          {conversation.avatar ? (
            <img
              src={conversation.avatar}
              alt={conversation.name}
              className="w-9 h-9 rounded-full object-cover border border-slate-200"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-semibold">
              <User className="w-5 h-5" />
            </div>
          )}
          <div>
            <h2 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              {conversation.name}
              {zaloMode === 'mock' ? (
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                  Demo
                </span>
              ) : zaloMode === 'personal' ? (
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                  Zalo
                </span>
              ) : (
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                  OA
                </span>
              )}
            </h2>
            {conversation.phone && (
              <p className="text-[10px] text-slate-500 flex items-center gap-1">
                <Phone className="w-2.5 h-2.5" /> {conversation.phone}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onAnalyzeChat}
            disabled={isAnalyzing}
            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
            title="Quét AI trích xuất task & phát hiện hoàn thành"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
            {isAnalyzing ? 'AI đang quét...' : 'Quét AI Task'}
          </button>

          <button
            onClick={onToggleTaskPanel}
            className={`p-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition ${
              isTaskPanelOpen
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
            title="Mở bảng Công việc AI"
          >
            <ListTodo className="w-4 h-4 text-amber-600" />
            {isTaskPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-500">
            Chưa có tin nhắn trong cuộc trò chuyện này. Hãy gửi tin nhắn đầu tiên!
          </div>
        ) : (
          messages.map((msg) => {
            // Check if this message was a source for any task
            const generatedTasks = tasks.filter(t => t.source_msg_id === msg.id);

            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`flex flex-col ${msg.is_from_me ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-end gap-2 max-w-[80%]">
                  {!msg.is_from_me && (
                    <div className="w-7 h-7 rounded-full bg-slate-300 text-slate-600 text-xs flex items-center justify-center font-bold flex-shrink-0">
                      {msg.sender_name.charAt(0)}
                    </div>
                  )}

                  <div
                    className={`p-3 rounded-2xl shadow-sm text-[13px] leading-relaxed transition ${
                      msg.is_from_me
                        ? 'bg-[#0068ff] text-white rounded-br-none'
                        : 'bg-white text-slate-800 rounded-bl-none border border-slate-200/80'
                    }`}
                  >
                    <p className="whitespace-pre-wrap font-sans">{msg.content}</p>

                    <div className={`flex items-center justify-between mt-1 text-[10px] gap-3 ${msg.is_from_me ? 'text-white/60' : 'text-slate-400'}`}>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {msg.is_from_me && <span>Đã gửi</span>}
                    </div>
                  </div>
                </div>

                {/* AI Detected Task Banner attached under message */}
                {generatedTasks.map((t) => (
                  <div
                    key={t.id}
                    className={`mt-1 text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1.5 max-w-[80%] ${
                      t.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-900'
                    }`}
                  >
                    {t.status === 'completed' ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                    ) : (
                      <ListTodo className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                    )}
                    <span className="font-semibold truncate">AI Task: {t.title}</span>
                    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      t.status === 'completed' ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
                    }`}>
                      {t.status === 'completed' ? 'ĐÃ XONG' : 'ĐANG CHỜ'}
                    </span>
                  </div>
                ))}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Replies Bar */}
      <div className="px-4 py-2 bg-slate-100/90 border-t border-slate-200/60 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap">Trả lời nhanh:</span>
        {quickReplies.map((qr, idx) => (
          <button
            key={idx}
            onClick={() => setInput(qr)}
            className="px-2.5 py-1 bg-white hover:bg-blue-50 hover:border-blue-300 active:bg-blue-100 text-slate-700 hover:text-blue-700 border border-slate-200 rounded-full text-[11px] whitespace-nowrap transition shadow-2xs"
          >
            {qr}
          </button>
        ))}
      </div>
      {composerError && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex items-center gap-2">
          <p className="text-[11px] text-red-700 font-medium flex-1">{composerError}</p>
          {onClearComposerError && (
            <button onClick={onClearComposerError} className="text-[11px] text-red-500 hover:text-red-700 font-bold">
              Ẩn
            </button>
          )}
        </div>
      )}

      {/* Input Composer */}
      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
        <input
          type="text"
          placeholder={zaloMode === 'mock' ? 'Nhập tin nhắn...' : 'Nhập tin nhắn Zalo...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 px-4 py-2 text-xs bg-slate-100 border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />

        <button
          type="submit"
          disabled={!input.trim()}
          className="p-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 text-white rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
          title="Gửi tin nhắn"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
