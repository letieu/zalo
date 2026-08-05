'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Inbox, CalendarClock, Star, Brain, Sparkles, Search, RefreshCw, MessageSquare, ChevronRight,
} from 'lucide-react';
import { DashboardData, SearchHit } from '@/types';

interface DashboardViewProps {
  data: DashboardData | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenConversation: (conversationId: string) => void;
}

const MINUTES_IN_HOUR = 60;
const MINUTES_IN_DAY = 24 * 60;

function timeAgo(minutes: number): string {
  if (minutes < 1) return 'vừa xong';
  if (minutes < MINUTES_IN_HOUR) return `${minutes} phút trước`;
  if (minutes < MINUTES_IN_DAY) return `${Math.round(minutes / MINUTES_IN_HOUR)} giờ trước`;
  return `${Math.round(minutes / MINUTES_IN_DAY)} ngày trước`;
}

function formatDeadline(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date().toISOString().slice(0, 10);
  const label = iso.slice(0, 10) === today ? 'Hôm nay' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return `${label} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Dashboard-first home (spec §"Primary Screen is Dashboard"): everything that
 * needs a human — waiting replies, today's tasks, important contacts, recent
 * memories, the daily brief, upcoming follow-ups — plus semantic search.
 */
export default function DashboardView({ data, loading, onRefresh, onOpenConversation }: DashboardViewProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      setHits(body.hits || []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-100">
      {/* Top bar: brand + search + refresh */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <Sparkles className="h-5 w-5 text-indigo-500" />
          <span>Bảng điều khiển</span>
        </div>
        <div className="relative ml-4 flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm kiếm tin nhắn, ghi nhớ… (tìm kiếm ngữ nghĩa)"
            className="w-full rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-4 text-sm outline-none focus:border-indigo-400 focus:bg-white"
          />
          {searching && <span className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />}
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Làm mới
        </button>
      </header>

      {hits !== null && (
        <div className="border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            {hits.length} kết quả cho “{query}”
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {hits.length === 0 && <p className="text-sm text-slate-500">Không tìm thấy kết quả.</p>}
            {hits.map(hit => (
              <button
                key={hit.kind + hit.id}
                onClick={() => {
                  if (hit.conversation_id) onOpenConversation(hit.conversation_id);
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
              >
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${hit.kind === 'memory' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{hit.content}</span>
                  <span className="block text-xs text-slate-400">
                    {hit.kind === 'memory' ? `Ghi nhớ · ${hit.contact_name || 'không rõ'} · ${hit.category}` : `${hit.sender_name || ''} · ${hit.timestamp ? timeAgo(Math.max(0, Math.round((Date.now() - new Date(hit.timestamp).getTime()) / 60000))) : ''}`}
                  </span>
                </span>
                <span className="text-xs text-slate-300">{Math.round(hit.score * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && !data && (
          <div className="flex h-full items-center justify-center text-slate-400">Đang tải…</div>
        )}
        {!loading && !data && (
          <div className="flex h-full items-center justify-center text-slate-400">Chưa có dữ liệu.</div>
        )}

        {data && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Daily brief — full width */}
            <section className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Sparkles className="h-4 w-4 text-indigo-500" /> Tóm tắt hôm nay
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                {data.dailyBrief || 'Chưa có tóm tắt. Hãy bấm “Làm mới” sau khi có tin nhắn mới.'}
              </p>
            </section>

            {/* Waiting for reply */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Inbox className="h-4 w-4 text-amber-500" /> Cần trả lời
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{data.waitingForReply.length}</span>
              </h2>
              <div className="space-y-2">
                {data.waitingForReply.length === 0 && <p className="text-sm text-slate-400">Không có gì đang chờ.</p>}
                {data.waitingForReply.map(w => (
                  <button key={w.id} onClick={() => onOpenConversation(w.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">
                      {w.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center justify-between text-sm font-medium text-slate-800">
                        {w.name}
                        <span className="text-xs font-normal text-slate-400">{timeAgo(w.minutes_since_last)}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">{w.last_message}</p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            </section>

            {/* Today's tasks */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <CalendarClock className="h-4 w-4 text-emerald-500" /> Việc hôm nay
              </h2>
              <div className="space-y-1.5">
                {data.todayTasks.length === 0 && <p className="text-sm text-slate-400">Không có việc hôm nay.</p>}
                {data.todayTasks.map(t => (
                  <div key={t.id} className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-sm text-slate-800">{t.title}</p>
                    <p className="text-xs text-slate-400">{t.deadline ? formatDeadline(t.deadline) : 'Chưa đặt hạn'}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Upcoming follow-ups */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Star className="h-4 w-4 text-violet-500" /> Theo dõi sắp tới
              </h2>
              <div className="space-y-1.5">
                {data.upcomingFollowUps.length === 0 && <p className="text-sm text-slate-400">Không có việc cần theo dõi.</p>}
                {data.upcomingFollowUps.map(t => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg px-2 py-1.5">
                    <p className="truncate text-sm text-slate-700">{t.title}</p>
                    <span className="ml-2 shrink-0 text-xs text-slate-400">{formatDeadline(t.deadline)}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Important contacts */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <MessageSquare className="h-4 w-4 text-sky-500" /> Khách hàng quan trọng
              </h2>
              <div className="space-y-2">
                {data.importantContacts.length === 0 && <p className="text-sm text-slate-400">Chưa có khách hàng nổi bật.</p>}
                {data.importantContacts.map(c => (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-600">
                      {c.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{c.name}</p>
                      <p className="truncate text-xs text-slate-400">{c.company || c.notes || 'Khách hàng'}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{c.importance}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Recent memories */}
            <section className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Brain className="h-4 w-4 text-amber-500" /> Ghi nhớ gần đây
              </h2>
              <div className="space-y-1.5">
                {data.recentMemories.length === 0 && <p className="text-sm text-slate-400">Chưa có ghi nhớ. AI sẽ trích xuất từ tin nhắn mới.</p>}
                {data.recentMemories.map(m => (
                  <div key={m.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
                    <span className="mt-1 shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-600">{m.category}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700">{m.content}</p>
                      <p className="text-xs text-slate-400">{m.contact_name || '—'} · {timeAgo(Math.max(0, Math.round((Date.now() - new Date(m.created_at).getTime()) / 60000)))}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
