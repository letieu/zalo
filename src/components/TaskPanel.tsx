'use client';

import { useState } from 'react';
import { Task, TaskPriority, TaskStatus } from '@/types';
import {
  CheckCircle2,
  Circle,
  ListTodo,
  Plus,
  Trash2,
  Sparkles,
  AlertCircle,
  Clock,
  MessageCircle,
  X,
  Edit2,
  Check
} from 'lucide-react';

interface TaskPanelProps {
  tasks: Task[];
  conversationName?: string;
  /** Combined view across all conversations — shows conversation + person,
   *  disables manual add. */
  globalMode?: boolean;
  onToggleTaskStatus: (taskId: string, currentStatus: TaskStatus) => void;
  onAddTask: (task: { title: string; description?: string; priority?: TaskPriority; deadline?: string }) => void;
  onDeleteTask: (taskId: string) => void;
  onClose?: () => void;
  onOpenConversation?: (conversationId: string) => void;
}

export function TaskPanel({
  tasks,
  conversationName,
  globalMode = false,
  onToggleTaskStatus,
  onAddTask,
  onDeleteTask,
  onClose,
  onOpenConversation,
}: TaskPanelProps) {
  const [filter, setFilter] = useState<'pending' | 'completed' | 'all'>('pending');
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [isAdding, setIsAdding] = useState(false);


  // New task form state
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newDeadline, setNewDeadline] = useState('');

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'pending') return t.status === 'pending' || t.status === 'in_progress';
    if (filter === 'completed') return t.status === 'completed';
    return true;
  }).filter((t) => !globalMode || personFilter === 'all' || (t.assignee || '') === personFilter);

  const people = globalMode
    ? Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean) as string[])).sort()
    : [];

  const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAddTask({
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      priority: newPriority,
      deadline: newDeadline.trim() || undefined,
    });
    setNewTitle('');
    setNewDesc('');
    setNewDeadline('');
    setIsAdding(false);
  };

  return (
    <div className="w-80 bg-slate-50/80 border-l border-slate-200 flex flex-col h-full select-none shadow-lg">
      {/* Panel Header */}
      <div className="p-4 border-b border-slate-100 bg-white flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-amber-100 text-amber-700 rounded-lg">
            <ListTodo className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800 text-xs uppercase tracking-wider">
              {globalMode ? 'Tất cả việc cần làm' : 'Danh sách Công việc AI'}
            </h2>
            <p className="text-[10px] text-slate-500 truncate max-w-[170px]">
              {globalMode ? 'Tổng hợp mọi hội thoại' : conversationName ? `Hội thoại: ${conversationName}` : 'Tất cả công việc'}
            </p>
          </div>
        </div>

        {!globalMode && (
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 active:bg-blue-200 rounded-md transition text-xs font-semibold flex items-center gap-1"
            title="Tạo việc thủ công"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Manual Task Add Form (Collapsible) */}
      {!globalMode && isAdding && (
        <form onSubmit={handleCreateTask} className="p-3 bg-blue-50/50 border-b border-blue-100 space-y-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-blue-900">Thêm việc mới</span>
            <button type="button" onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <input
            type="text"
            placeholder="Tên công việc cần làm..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />

          <input
            type="text"
            placeholder="Mô tả / ghi chú chi tiết..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <div className="flex gap-2">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
              className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none"
            >
              <option value="high">Độ ưu tiên: Gấp</option>
              <option value="medium">Độ ưu tiên: Bình thường</option>
              <option value="low">Độ ưu tiên: Thấp</option>
            </select>

            <input
              type="text"
              placeholder="Hạn (Hôm nay 16h)"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition"
          >
            Lưu công việc
          </button>
        </form>
      )}

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-200/60 bg-white/50 p-1 gap-1 text-xs">
        <button
          onClick={() => setFilter('pending')}
          className={`flex-1 py-1.5 text-center font-medium rounded-md transition ${
            filter === 'pending' ? 'bg-white text-amber-700 shadow-2xs font-semibold' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'
          }`}
        >
          Cần làm ({pendingCount})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`flex-1 py-1.5 text-center font-medium rounded-md transition ${
            filter === 'completed' ? 'bg-white text-emerald-700 shadow-2xs font-semibold' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'
          }`}
        >
          Đã xong ({completedCount})
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-1.5 text-center font-medium rounded-md transition ${
            filter === 'all' ? 'bg-white text-slate-800 shadow-2xs font-semibold' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'
          }`}
        >
          Tất cả ({tasks.length})
        </button>
      </div>

      {/* Person Filter (global mode only) */}
      {globalMode && people.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200/60 bg-white/50 p-1.5 text-xs">
          <button
            onClick={() => setPersonFilter('all')}
            className={`px-2 py-1 rounded-md font-medium whitespace-nowrap transition ${
              personFilter === 'all' ? 'bg-indigo-100 text-indigo-800 font-semibold' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            Tất cả mọi người
          </button>
          {people.map((p) => (
            <button
              key={p}
              onClick={() => setPersonFilter(p)}
              className={`px-2 py-1 rounded-md font-medium whitespace-nowrap transition ${
                personFilter === p ? 'bg-indigo-100 text-indigo-800 font-semibold' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 px-4 text-slate-400">
            <ListTodo className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-medium">Không có công việc nào.</p>
            <p className="text-[11px] text-slate-400 mt-1">Khi chat với khách, AI sẽ tự động phân tích và tạo công việc tại đây!</p>
          </div>
        ) : (
          filteredTasks.map((t) => {
            const isCompleted = t.status === 'completed';

            return (
              <div
                key={t.id}
                className={`p-3 rounded-xl border transition shadow-2xs ${
                  isCompleted
                    ? 'bg-slate-50 border-slate-200 text-slate-500'
                    : t.priority === 'high'
                    ? 'bg-red-50/40 border-red-200'
                    : 'bg-white border-slate-200'
                }`}
              >
                {/* Header */}
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => onToggleTaskStatus(t.id, t.status)}
                    className="mt-0.5 text-slate-400 hover:text-emerald-600 transition active:scale-90"
                    title={isCompleted ? 'Đánh dấu chưa hoàn thành' : 'Đánh dấu đã hoàn thành'}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Circle className="w-4 h-4 text-slate-400 hover:text-blue-600" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <h3 className={`text-xs font-semibold leading-snug ${isCompleted ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {t.title}
                    </h3>

                    {t.description && (
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        {t.description}
                      </p>
                    )}

                    {/* Metadata & Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {/* Priority */}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        t.priority === 'high'
                          ? 'bg-red-100 text-red-700'
                          : t.priority === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {t.priority === 'high' ? 'GẤP' : t.priority === 'medium' ? 'THƯỜNG' : 'THẤP'}
                      </span>

                      {/* Deadline */}
                      {t.deadline && (
                        <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 text-slate-400" />
                          {t.deadline}
                        </span>
                      )}

                      {/* Requester (who asked) */}
                      {t.requester && (
                        <span className="text-[10px] text-sky-700 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded">
                          Từ: {t.requester}
                        </span>
                      )}

                      {/* Assignee (who must do it) */}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        !t.assignee || t.assignee === 'Tôi'
                          ? 'text-emerald-700 bg-emerald-50 border border-emerald-100'
                          : 'text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-100'
                      }`}>
                        {t.assignee === 'Tôi' || !t.assignee ? 'Làm: Tôi' : `Làm: ${t.assignee}`}
                      </span>

                      {/* Conversation (global mode only) */}
                      {globalMode && t.conversation_id && (
                        <button
                          onClick={() => onOpenConversation?.(t.conversation_id)}
                          className="text-[10px] text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-1.5 py-0.5 rounded flex items-center gap-1 transition"
                          title="Mở hội thoại"
                        >
                          <MessageCircle className="w-2.5 h-2.5 text-slate-400" />
                          {t.conversation_name || 'Hội thoại'}
                        </button>
                      )}
                      {t.ai_created && (
                        <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <Sparkles className="w-2.5 h-2.5 text-indigo-600" />
                          AI Auto
                        </span>
                      )}
                    </div>

                    {/* AI Completion Reason Banner */}
                    {t.ai_completed && t.completion_reason && (
                      <div className="mt-2 p-1.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-800 leading-snug">
                        <span className="font-semibold block flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-600" /> AI phát hiện hoàn thành:
                        </span>
                        {t.completion_reason}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => onDeleteTask(t.id)}
                    className="text-slate-300 hover:text-red-500 active:text-red-700 transition p-1 active:scale-90"
                    title="Xóa công việc"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
