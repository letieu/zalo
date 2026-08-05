'use client';

import { useState } from 'react';
import { Conversation } from '@/types';
import { X, Send, Sparkles, User, MessageSquare } from 'lucide-react';

interface CustomerSimulatorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConvId: string | null;
  onSendSimulatedMessage: (conversationId: string, content: string) => void;
}

export function CustomerSimulatorDrawer({
  isOpen,
  onClose,
  conversations,
  activeConvId,
  onSendSimulatedMessage,
}: CustomerSimulatorDrawerProps) {
  const [selectedConvId, setSelectedConvId] = useState<string>(activeConvId || (conversations[0]?.id || ''));
  const [customContent, setCustomContent] = useState('');

  if (!isOpen) return null;

  const presets = [
    {
      label: 'Yêu cầu Báo giá Gấp (Tự tạo Task mới)',
      content: 'Nhờ em gửi báo giá 10 bàn phím cơ Logitech sang email hỗ trợ trước 5h chiều nay nhé!',
    },
    {
      label: 'Đổi địa chỉ giao hàng (Tự tạo Task mới)',
      content: 'Giao hàng đợt tới đổi địa chỉ sang 88 Lý Thường Kiệt, Phường 7, Q.10 giúp anh nhé, sđt 0988776655.',
    },
    {
      label: 'Xác nhận Đã nhận hàng & Thanh toán (Tự hoàn thành Task)',
      content: 'Cảm ơn em, anh đã nhận đủ 5 bộ máy tính Dell và đã chuyển khoản xong rồi nhé!',
    },
    {
      label: 'Xác nhận Đã sửa Banner (Tự hoàn thành Task)',
      content: 'Đã nhận được file banner sửa logo đỏ rồi nhé, nhìn đẹp lắm em!',
    },
  ];

  const handleSendPreset = (content: string) => {
    if (!selectedConvId) return;
    onSendSimulatedMessage(selectedConvId, content);
    onClose();
  };

  const handleSendCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConvId || !customContent.trim()) return;
    onSendSimulatedMessage(selectedConvId, customContent.trim());
    setCustomContent('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 modal-pop">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 bg-indigo-50/50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-xs">Giả lập Tin nhắn Khách hàng gửi</h2>
              <p className="text-[11px] text-slate-500">Test tính năng AI tự động đọc tin & quản lý việc</p>
            </div>
          </div>

          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Select Target Conversation */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Chọn Khách hàng đóng vai gửi tin:</label>
            <select
              value={selectedConvId}
              onChange={(e) => setSelectedConvId(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold text-slate-800"
            >
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Preset Buttons */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Kịch bản mẫu nhanh:</label>
            <div className="space-y-2">
              {presets.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendPreset(p.content)}
                  className="w-full p-2.5 bg-slate-50 hover:bg-indigo-50/80 active:bg-indigo-100 border border-slate-200 hover:border-indigo-300 active:border-indigo-400 rounded-xl text-left transition group"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900">{p.label}</span>
                    <Sparkles className="w-3 h-3 text-indigo-500 opacity-0 group-hover:opacity-100 transition" />
                  </div>
                  <p className="text-[11px] text-slate-500 group-hover:text-indigo-700 italic">"{p.content}"</p>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Message Input */}
          <form onSubmit={handleSendCustom} className="pt-2 border-t border-slate-100 space-y-2">
            <label className="block text-xs font-bold text-slate-700">Hoặc soạn tin nhắn tùy ý từ Khách hàng:</label>
            <textarea
              rows={2}
              placeholder="Nhập câu khách hàng sẽ nhắn..."
              value={customContent}
              onChange={(e) => setCustomContent(e.target.value)}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!customContent.trim()}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-xl text-xs transition disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-md"
            >
              <Send className="w-3.5 h-3.5" />
              Gửi Tin Giả Lập & Quét AI
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
