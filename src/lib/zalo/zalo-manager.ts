import fs from 'fs';
import path from 'path';
import { Zalo, ThreadType, LoginQRCallbackEventType } from 'zca-js';
import { API, Credentials, Message, LoginQRCallbackEvent } from 'zca-js';
import { dbQueries } from '@/lib/db/sqlite';
import { handleIncomingMessage } from '@/lib/ai/pipeline';
import { Conversation } from '@/types';
import { parseZaloContent } from '@/lib/zalo/attachments';

export interface ZaloUserInfo {
  uid: string;
  name: string;
  avatar: string;
}

export type ZaloQRPhase =
  | 'waiting_qr'
  | 'qr_generated'
  | 'qr_scanned'
  | 'qr_expired'
  | 'qr_declined'
  | 'logged_in';

export interface ZaloQRState {
  phase: ZaloQRPhase;
  imageBase64?: string;
  scannedName?: string;
  scannedAvatar?: string;
  message?: string;
}

export interface ZaloStatus {
  connected: boolean;
  busy: boolean;
  listenerOnline: boolean;
  userInfo: ZaloUserInfo | null;
  qrState: ZaloQRState | null;
}

/**
 * Singleton managing the zca-js connection: QR login, cookie re-login,
 * live message listener, and sending. Lives on the server process
 * (survives Next.js dev hot-reload via globalThis).
 */
export class ZaloManager {
  private api: API | null = null;
  private credentials: Credentials | null = null;
  private userInfo: ZaloUserInfo | null = null;
  private qrState: ZaloQRState | null = null;
  private loginPromise: Promise<boolean> | null = null;
  private autoLoginStarted = false;
  private listenerOnline = false;

  private get credentialPath(): string {
    return path.join(process.cwd(), 'data', 'zalo_credentials.json');
  }

  isConnected(): boolean {
    return this.api !== null;
  }

  isBusy(): boolean {
    return this.loginPromise !== null;
  }

  getStatus(): ZaloStatus {
    return {
      connected: this.isConnected(),
      busy: this.isBusy(),
      listenerOnline: this.listenerOnline,
      userInfo: this.userInfo,
      qrState: this.qrState,
    };
  }

  /**
   * Auto re-login with saved credentials (called lazily by status/sync routes).
   */
  async tryAutoLogin(): Promise<boolean> {
    if (this.api) return true;
    if (this.loginPromise) return this.loginPromise;
    if (this.autoLoginStarted) return false;
    this.autoLoginStarted = true;

    this.credentials = this.loadCredentials();
    if (!this.credentials) return false;

    this.loginPromise = this.performLogin(this.credentials);
    return this.loginPromise;
  }

  /**
   * Start the QR login flow. Never rejects — failures are surfaced via getStatus().
   */
  async startQRLogin(): Promise<{ ok: boolean; error?: string }> {
    if (this.api) return { ok: true };
    if (this.loginPromise) {
      await this.loginPromise;
      return { ok: this.api !== null };
    }

    this.qrState = { phase: 'waiting_qr' };
    const zalo = new Zalo({ selfListen: true, checkUpdate: false, logging: false });

    this.loginPromise = zalo
      .loginQR({}, (event) => this.handleQRCallback(event))
      .then((api) => {
        this.onLoginSuccess(api);
        return true;
      })
      .catch((err: unknown) => {
        console.error('Zalo QR login failed:', err);
        if (this.qrState && this.qrState.phase !== 'logged_in') {
          this.qrState = {
            ...this.qrState,
            phase: 'waiting_qr',
            message: 'Đăng nhập thất bại: ' + (err instanceof Error ? err.message : String(err)),
          };
        }
        this.loginPromise = null;
        return false;
      });

    await this.loginPromise;
    return { ok: this.api !== null };
  }

  /**
   * Send a text message to a Zalo thread.
   * Returns the real Zalo msgId when sent, null otherwise.
   */
  async sendTextMessage(
    threadId: string,
    threadType: 'individual' | 'group',
    text: string
  ): Promise<string | null> {
    if (!this.api) return null;
    const type = threadType === 'group' ? ThreadType.Group : ThreadType.User;
    const result = await this.api.sendMessage({ msg: text }, threadId, type);
    const msgId = result.message?.msgId;
    return msgId != null ? String(msgId) : null;
  }

  /**
   * Upsert all friends into the conversations table (name/avatar/phone cache).
   */
  async syncConversations(): Promise<{ synced: number }> {
    if (!this.api) return { synced: 0 };
    const friends = await this.api.getAllFriends(2000, 0);
    let synced = 0;
    for (const friend of friends) {
      dbQueries.upsertConversation({
        zalo_thread_id: friend.userId,
        name: friend.displayName || friend.zaloName || friend.username || friend.userId,
        avatar: friend.avatar,
        phone: friend.phoneNumber,
        type: 'individual',
      });
      synced++;
    }
    return { synced };
  }

  async logout(): Promise<void> {
    try {
      this.api?.listener.stop();
    } catch (err) {
      console.error('Zalo listener stop failed:', err);
    }
    this.api = null;
    this.credentials = null;
    this.userInfo = null;
    this.qrState = null;
    this.loginPromise = null;
    this.listenerOnline = false;
    this.clearCredentials();
  }

  private handleQRCallback(event: LoginQRCallbackEvent): void {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        this.qrState = { phase: 'qr_generated', imageBase64: event.data.image };
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        this.qrState = {
          phase: 'qr_scanned',
          scannedName: event.data.display_name,
          scannedAvatar: event.data.avatar,
        };
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        this.qrState = { phase: 'qr_expired', message: 'Mã QR đã hết hạn. Hãy tạo mã mới để quét lại.' };
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        this.qrState = { phase: 'qr_declined', message: 'Bạn đã từ chối đăng nhập trên điện thoại.' };
        break;
      case LoginQRCallbackEventType.GotLoginInfo: {
        const credentials: Credentials = {
          cookie: event.data.cookie,
          imei: event.data.imei,
          userAgent: event.data.userAgent,
        };
        this.credentials = credentials;
        this.saveCredentials(credentials);
        break;
      }
    }
  }

  private onLoginSuccess(api: API): void {
    this.api = api;
    this.listenerOnline = true;
    this.qrState = { phase: 'logged_in' };
    this.setupListener(api);
    void this.loadOwnInfo(api);
    void this.syncConversations().catch((err) => console.error('Zalo sync conversations failed:', err));
  }

  private async loadOwnInfo(api: API): Promise<void> {
    try {
      const ownId = api.getOwnId();
      const info = await api.getUserInfo(ownId);
      const profile = info.changed_profiles[ownId];
      if (profile) {
        this.userInfo = {
          uid: ownId,
          name: profile.displayName || profile.zaloName,
          avatar: profile.avatar,
        };
      }
    } catch (err) {
      console.error('Zalo load own info failed:', err);
    }
  }

  private setupListener(api: API): void {
    api.listener.on('message', (message: Message) => {
      void this.onZaloMessage(message);
    });
    api.listener.on('connected', () => {
      this.listenerOnline = true;
    });
    api.listener.on('disconnected', (code, reason) => {
      this.listenerOnline = false;
      console.warn('Zalo listener disconnected:', code, reason);
    });
    api.listener.start({ retryOnClose: true });
  }

  private async onZaloMessage(message: Message): Promise<void> {
    try {
      const data = message.data;
      // Media/file messages arrive as JSON strings or objects; parse them into
      // display text + a structured attachment so the UI can render them.
      const { text, attachment } = parseZaloContent(data.content, data.msgType);
      if (!text && !attachment) return;

      const isGroup = message.type === ThreadType.Group;
      const threadType: 'individual' | 'group' = isGroup ? 'group' : 'individual';
      const conversation = await this.resolveConversation(message.threadId, threadType, data.dName);
      if (!conversation) return;

      const ts = Number(data.ts);
      const timestamp = new Date(ts < 1e12 ? ts * 1000 : ts).toISOString();

      await handleIncomingMessage({
        conversation_id: conversation.id,
        zalo_msg_id: data.msgId,
        sender_id: message.isSelf ? 'me' : data.uidFrom,
        sender_name: message.isSelf ? 'Tôi' : data.dName || conversation.name,
        is_from_me: message.isSelf,
        content: text,
        attachment,
        timestamp,
      });
    } catch (err) {
      console.error('Lỗi xử lý tin nhắn Zalo:', err);
    }
  }

  private async resolveConversation(
    threadId: string,
    threadType: 'individual' | 'group',
    fallbackName: string
  ): Promise<Conversation | null> {
    const existing = dbQueries.getConversationByThreadId(threadId);
    if (existing) return existing;
    if (!this.api) return null;

    let name = fallbackName || threadId;
    let avatar = '';
    try {
      if (threadType === 'group') {
        const info = await this.api.getGroupInfo(threadId);
        const group = info.gridInfoMap[threadId];
        if (group) {
          name = group.name || name;
          avatar = group.fullAvt || group.avt || '';
        }
      } else {
        const info = await this.api.getUserInfo(threadId);
        const profile = info.changed_profiles[threadId];
        if (profile) {
          name = profile.displayName || profile.zaloName || name;
          avatar = profile.avatar || '';
        }
      }
    } catch (err) {
      console.warn('Không lấy được thông tin hội thoại Zalo, dùng tên mặc định:', err);
    }

    return dbQueries.upsertConversation({
      zalo_thread_id: threadId,
      name,
      avatar,
      type: threadType,
    });
  }

  private loadCredentials(): Credentials | null {
    try {
      if (!fs.existsSync(this.credentialPath)) return null;
      const raw = fs.readFileSync(this.credentialPath, 'utf-8');
      const parsed = JSON.parse(raw) as Credentials;
      if (!parsed.imei || !parsed.cookie || !parsed.userAgent) return null;
      return parsed;
    } catch (err) {
      console.error('Không đọc được credentials Zalo:', err);
      return null;
    }
  }

  private saveCredentials(credentials: Credentials): void {
    try {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(this.credentialPath, JSON.stringify(credentials, null, 2), 'utf-8');
    } catch (err) {
      console.error('Không lưu được credentials Zalo:', err);
    }
  }

  private clearCredentials(): void {
    try {
      if (fs.existsSync(this.credentialPath)) fs.unlinkSync(this.credentialPath);
    } catch (err) {
      console.error('Không xóa được credentials Zalo:', err);
    }
  }

  private async performLogin(credentials: Credentials): Promise<boolean> {
    try {
      const zalo = new Zalo({ selfListen: true, checkUpdate: false, logging: false });
      const api = await zalo.login(credentials);
      this.onLoginSuccess(api);
      return true;
    } catch (err) {
      console.error('Zalo cookie login failed:', err);
      this.api = null;
      this.loginPromise = null;
      return false;
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __zaloManager: ZaloManager | undefined;
}

export function getZaloManager(): ZaloManager {
  if (!globalThis.__zaloManager) {
    globalThis.__zaloManager = new ZaloManager();
  }
  return globalThis.__zaloManager;
}
