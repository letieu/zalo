'use client';

import { useState, useEffect, useCallback } from 'react';
import { Conversation, Message, Task, MessageAttachment, AppSettings, TaskStatus, TaskPriority, DashboardData } from '@/types';
import { Sidebar } from '@/components/Sidebar';
import { LayoutDashboard, MessageSquareText, ListTodo } from 'lucide-react';
import DashboardView from '@/components/DashboardView';
import { ChatWindow } from '@/components/ChatWindow';
import { TaskPanel } from '@/components/TaskPanel';
import { SettingsModal } from '@/components/SettingsModal';
import { CustomerSimulatorDrawer } from '@/components/CustomerSimulatorDrawer';
import { ZaloConnectModal } from '@/components/ZaloConnectModal';
import { AssistantPanel } from '@/components/AssistantPanel';
import { AssistantContext } from '@/types';

interface ZaloStatusInfo {
  connected: boolean;
  busy: boolean;
  listenerOnline: boolean;
  userInfo: { uid: string; name: string; avatar: string } | null;
  qrState: { phase: string; imageBase64?: string; message?: string } | null;
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    zalo_mode: 'mock',
    ai_provider: 'omniroute',
    auto_task_extraction: true,
    auto_task_completion: true,
    auto_memory_extraction: true,
    auto_summary: true,
    auto_embeddings: true,
  });

  // UI state
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [view, setView] = useState<'dashboard' | 'chats' | 'tasks'>('dashboard');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [zaloStatus, setZaloStatus] = useState<ZaloStatusInfo | null>(null);
  const [isZaloConnectOpen, setIsZaloConnectOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Load Conversations & Settings on mount
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (data.conversations) {
        setConversations(data.conversations);
        if (!activeConvId && data.conversations.length > 0) {
          setActiveConvId(data.conversations[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, [activeConvId]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.settings) {
        setSettings(data.settings);
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  }, []);

  const fetchZaloStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/zalo/status');
      const data = await res.json();
      if (data.status) {
        setZaloStatus(data.status);
      }
    } catch (err) {
      console.error('Failed to fetch Zalo status:', err);
    }
  }, []);

  const fetchDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      setDashboardData(data);
    } catch {
      setDashboardData(null);
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const fetchAllTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.tasks) setAllTasks(data.tasks);
    } catch (err) {
      console.error('Failed to fetch all tasks:', err);
    }
  }, []);

  const handleSwitchToZalo = useCallback(async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zalo_mode: 'personal' }),
      });
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
      await fetchConversations();
    } catch (err) {
      console.error('Switch to Zalo mode failed:', err);
    }
  }, [fetchConversations]);

  // Fetch messages & tasks for active conversation
  const fetchMessagesAndTasks = useCallback(async (convId: string) => {
    try {
      const [msgRes, taskRes] = await Promise.all([
        fetch(`/api/messages?conversation_id=${convId}`),
        fetch(`/api/tasks?conversation_id=${convId}`),
      ]);

      const msgData = await msgRes.json();
      const taskData = await taskRes.json();

      if (msgData.messages) setMessages(msgData.messages);
      if (taskData.tasks) setTasks(taskData.tasks);
    } catch (err) {
      console.error('Failed to fetch messages & tasks:', err);
    }
  }, []);
  const openConversationFromDashboard = useCallback((conversationId: string) => {
    setView('chats');
    setActiveConvId(conversationId);
    fetchMessagesAndTasks(conversationId);
  }, [fetchMessagesAndTasks]);

  useEffect(() => {
    fetchConversations();
    fetchSettings();
    fetchZaloStatus();
    fetchDashboard();
  }, [fetchConversations, fetchSettings, fetchZaloStatus, fetchDashboard]);

  // Poll Zalo status unconditionally so a lazy cookie auto-login (fired
  // asynchronously by /api/zalo/status) is observed when `connected` flips.
  useEffect(() => {
    const pollId = setInterval(() => {
      void fetchZaloStatus();
    }, 4000);
    return () => clearInterval(pollId);
  }, [fetchZaloStatus]);

  // While connected to real Zalo, refresh conversations + active chat messages.
  useEffect(() => {
    if (settings.zalo_mode !== 'personal' || !zaloStatus?.connected) return;
    const pollId = setInterval(() => {
      void fetchConversations();
      if (activeConvId) {
        void fetchMessagesAndTasks(activeConvId);
      }
    }, 4000);
    return () => clearInterval(pollId);
  }, [settings.zalo_mode, zaloStatus?.connected, fetchConversations, fetchMessagesAndTasks, activeConvId]);

  useEffect(() => {
    if (view === 'tasks') fetchAllTasks();
  }, [view, fetchAllTasks]);

  useEffect(() => {
    if (activeConvId) {
      fetchMessagesAndTasks(activeConvId);
    }
  }, [activeConvId, fetchMessagesAndTasks]);

  // Auto refresh when Zalo connection is established
  useEffect(() => {
    if (zaloStatus?.connected) {
      fetchConversations();
    }
  }, [zaloStatus?.connected, fetchConversations]);

  const handleZaloConnected = useCallback(async () => {
    try {
      await fetch('/api/zalo/sync', { method: 'POST' });
    } catch (err) {
      console.error('Failed to sync Zalo conversations:', err);
    }
    await fetchZaloStatus();
    await fetchConversations();
  }, [fetchZaloStatus, fetchConversations]);


  // Handle Send Message (User Outgoing)
  const handleSendMessage = async (text: string) => {
    if (!activeConvId) return;

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: activeConvId,
          content: text,
          is_from_me: true,
          sender_name: 'Tôi',
        }),
      });

      const data = await res.json();
      if (data.message) {
        setMessages(prev => [...prev, data.message]);
        // Refresh tasks & conversation list
        fetchMessagesAndTasks(activeConvId);
        fetchConversations();
        setSendError(null);
      } else if (!res.ok) {
        setSendError(data.error || 'Không gửi được tin nhắn. Vui lòng thử lại.');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setSendError('Lỗi mạng khi gửi tin nhắn. Vui lòng thử lại.');
    }
  };

  // Auto-clear send error after 4 seconds
  useEffect(() => {
    if (!sendError) return;
    const clearId = setTimeout(() => setSendError(null), 4000);
    return () => clearTimeout(clearId);
  }, [sendError]);

  // Handle Simulate Customer Message (Incoming)
  const handleSimulateCustomerMessage = async (convId: string, content: string, attachment?: MessageAttachment) => {
    try {
      const res = await fetch('/api/mock/send-customer-msg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: convId,
          content,
          attachment: attachment ?? null,
        }),
      });

      const data = await res.json();
      if (data.message) {
        if (convId === activeConvId) {
          setMessages(prev => [...prev, data.message]);
          fetchMessagesAndTasks(convId);
        }
        fetchConversations();
      }
    } catch (err) {
      console.error('Error simulating customer message:', err);
    }
  };

  // Handle AI Analyze Chat Manually
  const handleAnalyzeChat = async () => {
    if (!activeConvId) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: activeConvId }),
      });

      const data = await res.json();
      if (data.success) {
        fetchMessagesAndTasks(activeConvId);
        fetchConversations();
      }
    } catch (err) {
      console.error('Failed to analyze chat:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Task Actions
  const handleToggleTaskStatus = async (taskId: string, currentStatus: TaskStatus) => {
    const nextStatus: TaskStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    try {
      const res = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          status: nextStatus,
        }),
      });

      const data = await res.json();
      if (data.task) {
        setTasks(prev => prev.map(t => (t.id === taskId ? data.task : t)));
        fetchConversations();
      }
    } catch (err) {
      console.error('Failed to update task status:', err);
    }
  };

  const handleAddTask = async (taskData: { title: string; description?: string; priority?: TaskPriority; deadline?: string }) => {
    if (!activeConvId) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: activeConvId,
          ...taskData,
        }),
      });

      const data = await res.json();
      if (data.task) {
        setTasks(prev => [data.task, ...prev]);
        fetchConversations();
      }
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await fetch(`/api/tasks?id=${taskId}`, { method: 'DELETE' });
      setTasks(prev => prev.filter(t => t.id !== taskId));
      fetchConversations();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  // Refresh every surface the AI assistant may have touched (messages,
  // conversation list, tasks, dashboard) after a confirmed action runs.
  const refreshAfterAssistantAction = useCallback(async () => {
    fetchConversations();
    if (activeConvId) {
      fetchMessagesAndTasks(activeConvId);
    }
    if (view === 'tasks') {
      fetchAllTasks();
    }
    fetchDashboard();
  }, [fetchConversations, fetchMessagesAndTasks, fetchAllTasks, fetchDashboard, activeConvId, view]);



  const activeConversation = conversations.find(c => c.id === activeConvId) || null;

  const assistantContext: AssistantContext = {
    screen: view,
    conversation_id: view === 'chats' && activeConvId ? activeConvId : undefined,
    conversation_name: view === 'chats' ? activeConversation?.name : undefined,
  };

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans antialiased text-slate-800">
      {/* Left Sidebar */}
      <Sidebar
        conversations={conversations}
        activeConvId={activeConvId}
        onSelectConversation={(id) => {
          setActiveConvId(id);
          setView('chats');
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenSimulator={() => setIsSimulatorOpen(true)}
        zaloMode={settings.zalo_mode}
        zaloConnected={zaloStatus?.connected ?? false}
        zaloUserName={zaloStatus?.userInfo?.name ?? null}
        onConnectZalo={() => setIsZaloConnectOpen(true)}
        onSwitchToZalo={handleSwitchToZalo}
      />

      {/* Main column: view toggle + active view */}
      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 py-2">
          <button
            onClick={() => setView('dashboard')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === 'dashboard' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" /> Bảng điều khiển
          </button>
          <button
            onClick={() => setView('chats')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === 'chats' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <MessageSquareText className="h-4 w-4" /> Trò chuyện
          </button>
          <button
            onClick={() => setView('tasks')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === 'tasks' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <ListTodo className="h-4 w-4" /> Tất cả việc cần làm
          </button>
        </nav>

        {view === 'tasks' ? (
          <TaskPanel
            tasks={allTasks}
            globalMode
            onToggleTaskStatus={handleToggleTaskStatus}
            onAddTask={handleAddTask}
            onDeleteTask={handleDeleteTask}
            onClose={() => setIsTaskPanelOpen(false)}
            onOpenConversation={openConversationFromDashboard}
          />
        ) : view === 'dashboard' ? (
          <DashboardView
            data={dashboardData}
            loading={dashboardLoading}
            onRefresh={fetchDashboard}
            onOpenConversation={openConversationFromDashboard}
          />
        ) : (
          <div className="flex min-h-0 flex-1">
            <ChatWindow
              conversation={activeConversation}
              zaloMode={settings.zalo_mode}
              messages={messages}
              tasks={tasks}
              onSendMessage={handleSendMessage}
              onToggleTaskPanel={() => setIsTaskPanelOpen(!isTaskPanelOpen)}
              isTaskPanelOpen={isTaskPanelOpen}
              onAnalyzeChat={handleAnalyzeChat}
              isAnalyzing={isAnalyzing}
              composerError={sendError}
              onClearComposerError={() => setSendError(null)}
            />

            {isTaskPanelOpen && (
              <TaskPanel
                tasks={tasks}
                conversationName={activeConversation?.name}
                onToggleTaskStatus={handleToggleTaskStatus}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                onClose={() => setIsTaskPanelOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Modals & Drawers */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        zaloStatus={zaloStatus}
        onConnectZalo={() => setIsZaloConnectOpen(true)}
      />

      <CustomerSimulatorDrawer
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        conversations={conversations}
        activeConvId={activeConvId}
        onSendSimulatedMessage={handleSimulateCustomerMessage}
      />

      <ZaloConnectModal
        isOpen={isZaloConnectOpen}
        onClose={() => setIsZaloConnectOpen(false)}

        onConnected={handleZaloConnected}
      />

      <AssistantPanel context={assistantContext} onDataChanged={refreshAfterAssistantAction} />
    </main>
  );
}
