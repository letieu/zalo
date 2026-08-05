'use client';

import { useState } from 'react';
import { Conversation, ZaloMode } from '@/types';
import { Search, MessageSquare, ListTodo, User, Wifi, WifiOff, QrCode, Settings } from 'lucide-react';

interface SidebarProps {
  conversations: Conversation[];
  activeConvId: string | null;
  onSelectConversation: (id: string) => void;
  onOpenSettings: () => void;
  onOpenSimulator: () => void;
  onConnectZalo: () => void;
  onSwitchToZalo: () => void;
  zaloMode: ZaloMode;
  zaloConnected: boolean;
  zaloUserName: string | null;
}

export function Sidebar({
  conversations,
  activeConvId,
  onSelectConversation,
  onOpenSettings,
  onOpenSimulator,
  onConnectZalo,
  onSwitchToZalo,
  zaloMode,
  zaloConnected,
  zaloUserName,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'has_tasks'>('all');

  const filteredConversations = conversations.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || (c.last_message && c.last_message.toLowerCase().includes(search.toLowerCase()));
    if (!matchesSearch) return false;
    if (filterMode === 'has_tasks') {
      return (c.pending_task_count || 0) > 0;
    }
    return true;
  });

  return (
    <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full select-none">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-sm">
            Z
          </div>
          <div>
            <h1 className="font-bold text-slate-800 text-sm leading-tight">Zalo AI Task Client</h1>
            {zaloMode === 'personal' && zaloConnected ? (
              <button
                onClick={onConnectZalo}
                className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 hover:underline"
                title="Quản lý kết nối Zalo"
              >
                <Wifi className="w-3 h-3" />
                Zalo đã kết nối{zaloUserName ? ` · ${zaloUserName}` : ''}
              </button>
            ) : zaloMode === 'personal' ? (
              <button
                onClick={onConnectZalo}
                className="text-[11px] text-amber-600 font-medium flex items-center gap-1 hover:underline"
                title="Kết nối Zalo bằng mã QR"
              >
                <WifiOff className="w-3 h-3" />
                Zalo chưa kết nối
              </button>
            ) : (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                AI Auto-Task Active
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition"
          title="Cài đặt AI & Zalo"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Search & Filters */}
      <div className="p-3 space-y-2 border-b border-slate-100">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm khách hàng, tin nhắn..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-100 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => setFilterMode('all')}
            className={`flex-1 py-1 text-xs font-medium rounded-md transition ${
              filterMode === 'all' ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Tất cả chat
          </button>
          <button
            onClick={() => setFilterMode('has_tasks')}
            className={`flex-1 py-1 text-xs font-medium rounded-md transition flex items-center justify-center gap-1 ${
              filterMode === 'has_tasks' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ListTodo className="w-3 h-3 text-amber-600" />
            Có công việc
          </button>
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            Không tìm thấy cuộc trò chuyện nào.
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const isActive = conv.id === activeConvId;
            const hasPendingTasks = (conv.pending_task_count || 0) > 0;

            return (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`p-3 cursor-pointer transition flex items-start space-x-3 ${
                  isActive ? 'bg-blue-50/80 border-l-4 border-blue-600' : 'hover:bg-slate-50 active:bg-slate-100'
                }`}
              >
                <div className="relative flex-shrink-0">
                  {conv.avatar ? (
                    <img
                      src={conv.avatar}
                      alt={conv.name}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-semibold">
                      <User className="w-5 h-5" />
                    </div>
                  )}
                  {hasPendingTasks && (
                    <span
                      className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm flex items-center gap-0.5"
                      title={`${conv.pending_task_count} công việc chưa hoàn thành`}
                    >
                      {conv.pending_task_count}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-0.5">
                    <h3 className={`text-xs font-semibold truncate ${isActive ? 'text-blue-900' : 'text-slate-800'}`}>
                      {conv.name}
                    </h3>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">
                      {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 truncate leading-relaxed">
                    {conv.last_message || 'Chưa có tin nhắn'}
                  </p>
                </div>
              </div>
            );
          }))}
        </div>

      {/* Footer actions */}
      <div className="p-3 border-t border-slate-100 bg-slate-50">
        {zaloMode === 'mock' && zaloConnected && (
          <div className="mb-2 p-2.5 rounded-lg bg-blue-50 border border-blue-200 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-blue-800 font-medium">
              <Wifi className="w-3 h-3" />
              Zalo đã kết nối — đang chờ tin nhắn thật
            </div>
            <button
              onClick={onSwitchToZalo}
              className="w-full py-1 px-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-md text-[11px] font-medium transition"
            >
              Chuyển sang chế độ Zalo
            </button>
          </div>
        )}

        {zaloMode === 'mock' ? (
          <button
            onClick={onOpenSimulator}
            className="w-full py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition shadow-sm"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Giả lập tin nhắn khách gửi (test AI)
          </button>
        ) : !zaloConnected ? (
          <button
            onClick={onConnectZalo}
            className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition shadow-sm"
          >
            <QrCode className="w-3.5 h-3.5" />
            Kết nối Zalo bằng mã QR
          </button>
        ) : (
          <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-2 text-center leading-relaxed">
            Đang nhận tin nhắn Zalo thật — AI tự xử lý task
          </p>
        )}
      </div>
    </div>
  );
}
