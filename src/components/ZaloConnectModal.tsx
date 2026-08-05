'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, CheckCircle2, Smartphone, ShieldAlert, QrCode, Users } from 'lucide-react';

interface ZaloStatusInfo {
  connected: boolean;
  busy: boolean;
  listenerOnline: boolean;
  userInfo: { uid: string; name: string; avatar: string } | null;
  qrState: {
    phase: string;
    imageBase64?: string;
    scannedName?: string;
    scannedAvatar?: string;
    message?: string;
  } | null;
}

interface ZaloConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export function ZaloConnectModal({ isOpen, onClose, onConnected }: ZaloConnectModalProps) {
  const [status, setStatus] = useState<ZaloStatusInfo | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const startLogin = useCallback(async () => {
    setIsStarting(true);
    try {
      await fetch('/api/zalo/login', { method: 'POST' });
    } catch (err) {
      console.error('Failed to start Zalo login:', err);
    } finally {
      setIsStarting(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/zalo/status');
      const data = await res.json();
      if (data.status) setStatus(data.status);
    } catch (err) {
      console.error('Failed to fetch Zalo status:', err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStatus(null);
    setSyncMessage(null);
    void startLogin();
    const pollId = setInterval(() => {
      void fetchStatus();
    }, 1500);
    return () => clearInterval(pollId);
  }, [isOpen, startLogin, fetchStatus]);

  // Notify parent once the connection is established (polling stops when connected)
  useEffect(() => {
    if (status?.connected) {
      onConnected();
    }
  }, [status?.connected, onConnected]);

  const handleSyncContacts = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/zalo/sync', { method: 'POST' });
      const data = await res.json();
      if (data.synced) {
        setSyncMessage('Đã đồng bộ danh bạ Zalo vào danh sách hội thoại.');
      } else {
        setSyncMessage(data.error || 'Đồng bộ chưa hoàn tất. Vui lòng thử lại.');
      }
    } catch (err) {
      console.error('Failed to sync Zalo contacts:', err);
      setSyncMessage('Lỗi mạng khi đồng bộ danh bạ.');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  if (!isOpen) return null;

  const phase = status?.qrState?.phase ?? 'waiting_qr';
  const connected = status?.connected ?? false;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden modal-pop">
        {/* Header */}
        <div className="px-5 py-4 bg-blue-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-tight">Kết nối Zalo Cá Nhân</h2>
              <p className="text-[10px] text-blue-100">Đăng nhập bằng mã QR để nhận & gửi tin nhắn thật</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/20 transition"
            title="Đóng"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {connected ? (
            /* Success state */
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Đã kết nối Zalo thành công!</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {status?.userInfo?.name
                    ? `Đang hoạt động với tài khoản ${status.userInfo.name}`
                    : 'AI sẽ tự động nhận tin nhắn và xử lý task.'}
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={handleSyncContacts}
                  disabled={isSyncing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 shadow-sm"
                >
                  <Users className="w-3.5 h-3.5" />
                  {isSyncing ? 'Đang đồng bộ…' : 'Đồng bộ danh bạ'}
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition"
                >
                  Đóng
                </button>
              </div>
              {syncMessage && (
                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {syncMessage}
                </p>
              )}
            </div>
          ) : phase === 'qr_generated' && status?.qrState?.imageBase64 ? (
            /* QR displayed */
            <div className="text-center space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Dùng app <b>Zalo</b> trên điện thoại mở <b>Quét mã QR</b> và quét mã bên dưới:
              </p>
              <div className="mx-auto w-56 h-56 rounded-xl border-2 border-slate-200 bg-white p-2 shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${status.qrState.imageBase64}`}
                  alt="Zalo QR đăng nhập"
                  className="w-full h-full"
                />
              </div>
              <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Mã QR tự làm mới sau ~60 giây
              </p>
            </div>
          ) : phase === 'qr_scanned' ? (
            /* Scanned, waiting for phone confirmation */
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                <Smartphone className="w-8 h-8" />
              </div>
              <p className="text-sm font-bold text-slate-800">Đã quét mã QR!</p>
              <p className="text-xs text-slate-500">
                {status?.qrState?.scannedName
                  ? `Đang chờ xác nhận từ ${status.qrState.scannedName} trên điện thoại…`
                  : 'Vui lòng xác nhận đăng nhập trên điện thoại…'}
              </p>
              <div className="mx-auto w-14 h-14 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
            </div>
          ) : phase === 'qr_expired' || phase === 'qr_declined' ? (
            /* Expired or declined */
            <div className="text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-slate-800">
                {phase === 'qr_expired' ? 'Mã QR đã hết hạn' : 'Đã từ chối đăng nhập'}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                {status?.qrState?.message ?? 'Vui lòng thử lại.'}
              </p>
              <button
                onClick={startLogin}
                disabled={isStarting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 mx-auto transition disabled:opacity-50 shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isStarting ? 'animate-spin' : ''}`} />
                {isStarting ? 'Đang tạo mã mới…' : 'Tạo mã QR mới'}
              </button>
            </div>
          ) : (
            /* Waiting for QR generation */
            <div className="text-center space-y-3 py-6">
              <div className="mx-auto w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
              <p className="text-xs text-slate-600">
                {status?.qrState?.message ?? 'Đang khởi động Zalo và tạo mã QR…'}
              </p>
            </div>
          )}
        </div>

        {/* Warning footer */}
        <div className="px-5 py-3 bg-amber-50 border-t border-amber-100">
          <p className="text-[10px] text-amber-700 leading-relaxed flex gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            zca-js là API không chính thức — Zalo có thể khóa tài khoản. Khuyến nghị dùng tài khoản riêng / thử nghiệm.
          </p>
        </div>
      </div>
    </div>
  );
}
