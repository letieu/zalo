'use client';

import { useState, useEffect } from 'react';
import { AppSettings, AIProvider, ZaloMode } from '@/types';
import { X, Key, Cpu, Zap, Check, ShieldCheck, AlertCircle, RefreshCw, User } from 'lucide-react';

interface ZaloStatusInfo {
  connected: boolean;
  userInfo: { uid: string; name: string; avatar: string } | null;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (newSettings: Partial<AppSettings>) => void;
  zaloStatus: ZaloStatusInfo | null;
  onConnectZalo: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  zaloStatus,
  onConnectZalo,
}: SettingsModalProps) {

  const [zaloMode, setZaloMode] = useState<ZaloMode>('mock');
  const [aiProvider, setAiProvider] = useState<AIProvider>('smart_heuristic');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3');
  const [autoExtraction, setAutoExtraction] = useState(true);
  const [autoCompletion, setAutoCompletion] = useState(true);

  useEffect(() => {
    if (settings) {
      setZaloMode(settings.zalo_mode || 'mock');
      setAiProvider(settings.ai_provider || 'smart_heuristic');
      setGeminiKey(settings.gemini_api_key || '');
      setGeminiModel(settings.gemini_model || 'gemini-2.5-flash');
      setOpenaiKey(settings.openai_api_key || '');
      setOpenaiBaseUrl(settings.openai_base_url || '');
      setOllamaUrl(settings.ollama_url || 'http://localhost:11434');
      setOllamaModel(settings.ollama_model || 'llama3');
      setAutoExtraction(settings.auto_task_extraction ?? true);
      setAutoCompletion(settings.auto_task_completion ?? true);
    }
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      zalo_mode: zaloMode,
      ai_provider: aiProvider,
      gemini_api_key: geminiKey,
      gemini_model: geminiModel,
      openai_api_key: openaiKey,
      openai_base_url: openaiBaseUrl,
      ollama_url: ollamaUrl,
      ollama_model: ollamaModel,
      auto_task_extraction: autoExtraction,
      auto_task_completion: autoCompletion,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 modal-pop">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-sm">Cấu hình Zalo AI Client</h2>
              <p className="text-xs text-slate-500">Tùy chỉnh model AI và kết nối Zalo</p>
            </div>
          </div>

          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Zalo Mode */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Phương thức kết nối Zalo</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setZaloMode('mock')}
                className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition ${
                  zaloMode === 'mock'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100'
                }`}
              >
                Giả lập (Demo)
                <span className="block font-normal text-[10px] text-slate-400 mt-0.5">Test nhanh tức thì</span>
              </button>

              <button
                type="button"
                onClick={() => setZaloMode('personal')}
                className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition ${
                  zaloMode === 'personal'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100'
                }`}
              >
                Zalo Cá Nhân
                <span className="block font-normal text-[10px] text-slate-400 mt-0.5">Cookies / QR Code</span>
              </button>

              <button
                type="button"
                onClick={() => setZaloMode('oa')}
                className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition ${
                  zaloMode === 'oa'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100'
                }`}
              >
                Zalo Official Account
                <span className="block font-normal text-[10px] text-slate-400 mt-0.5">OA Webhook API</span>
              </button>
            </div>

          {zaloMode === 'personal' && (
            <div className={`p-3 rounded-xl border space-y-2.5 ${
              zaloStatus?.connected ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {zaloStatus?.connected ? (
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-4.5 h-4.5" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-4.5 h-4.5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {zaloStatus?.connected ? 'Zalo đã kết nối' : 'Zalo chưa kết nối'}
                    </p>
                    <p className="text-[10px] text-slate-500 flex items-center gap-1 truncate">
                      {zaloStatus?.userInfo?.avatar ? (
                        <img src={zaloStatus.userInfo.avatar} alt="" className="w-3.5 h-3.5 rounded-full" />
                      ) : (
                        <User className="w-3 h-3" />
                      )}
                      {zaloStatus?.connected
                        ? (zaloStatus.userInfo?.name || 'Đang kết nối…')
                        : 'Đăng nhập QR để nhận & gửi tin nhắn Zalo thật'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onConnectZalo}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${
                    zaloStatus?.connected
                      ? 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                  }`}
                >
                  {zaloStatus?.connected ? 'Quản lý kết nối' : 'Đăng nhập bằng QR'}
                </button>
              </div>
              {zaloStatus?.connected && (
                <p className="text-[10px] text-emerald-700 bg-emerald-100/70 rounded-lg px-2.5 py-1.5 leading-relaxed">
                  Tin nhắn Zalo thật sẽ được nhận trực tiếp và AI tự trích xuất / hoàn thành task.
                </p>
              )}
            </div>
          )}
          </div>

          {/* AI Engine Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Mô hình AI xử lý công việc</label>
            <select
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AIProvider)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
            >
              <option value="smart_heuristic">Tự động (Smart Heuristic Parser - Không cần API Key)</option>
              <option value="gemini">Google Gemini AI (Gemini 2.5 Flash / 1.5 Flash)</option>
              <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
              <option value="ollama">Ollama Local AI (Không gửi dữ liệu ra ngoài)</option>
            </select>
          </div>

          {/* Dynamic AI Fields */}
          {aiProvider === 'gemini' && (
            <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 space-y-2">
              <label className="block text-xs font-semibold text-blue-900">Google Gemini API Key</label>
              <input
                type="password"
                placeholder="Nhập Gemini API Key (AIzaSy...)"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Model (gemini-2.5-flash)"
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                className="w-full px-3 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
              />
            </div>
          )}

          {aiProvider === 'openai' && (
            <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-2">
              <label className="block text-xs font-semibold text-indigo-900">OpenAI API Key</label>
              <input
                type="password"
                placeholder="Nhập OpenAI API Key (sk-...)"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Base URL (mặc định api.openai.com)"
                value={openaiBaseUrl}
                onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
              />
              <input
                type="text"
                placeholder="Model (gpt-4o-mini)"
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                className="w-full px-3 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
              />
            </div>
          )}

          {aiProvider === 'ollama' && (
            <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 space-y-2">
              <label className="block text-xs font-semibold text-slate-800">URL Endpoint Ollama</label>
              <input
                type="text"
                placeholder="http://localhost:11434"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
              />
              <input
                type="text"
                placeholder="Model (llama3 / qwen2)"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                className="w-full px-3 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
              />
            </div>
          )}

          {/* Automation Switches */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-xs font-bold text-slate-800 block">Tự động Trích xuất Task mới</span>
                <span className="text-[10px] text-slate-500 block">Tự tạo công việc khi có yêu cầu hoặc lời hứa hẹn trong chat</span>
              </div>
              <input
                type="checkbox"
                checked={autoExtraction}
                onChange={(e) => setAutoExtraction(e.target.checked)}
                className="w-4 h-4 accent-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-xs font-bold text-slate-800 block">Tự động Phát hiện Hoàn thành Task</span>
                <span className="text-[10px] text-slate-500 block">Đánh dấu ĐÃ XONG khi khách hoặc bạn xác nhận trong tin nhắn</span>
              </div>
              <input
                type="checkbox"
                checked={autoCompletion}
                onChange={(e) => setAutoCompletion(e.target.checked)}
                className="w-4 h-4 accent-blue-600 rounded focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="pt-3">
            <button
              type="submit"
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Lưu Cấu Hình
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
