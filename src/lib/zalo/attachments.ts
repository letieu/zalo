import { AttachmentKind, MessageAttachment } from '@/types';

/**
 * Parse Zalo message content into display text + a structured attachment.
 *
 * Zalo delivers media/file messages as either a JSON string or (via zca-js)
 * a plain object carrying `type`, `href`, `thumb`, `title`, `description`…
 * Without this parser those payloads hit the UI as raw JSON blobs — the
 * "file/image not showing" bug.
 *
 * The type ints are the zalo-js client message types for media:
 *   1 image · 2 video · 3 sticker · 4 file · 5 voice · 6 location · 7 link
 */

const KIND_BY_TYPE: Record<string, AttachmentKind> = {
  '1': 'image',
  '2': 'file', // video — rendered as a downloadable file card
  '3': 'sticker',
  '4': 'file',
  '5': 'voice',
  '6': 'location',
  '7': 'link',
  'image': 'image',
  'video': 'file',
  'sticker': 'sticker',
  'file': 'file',
  'voice': 'voice',
  'location': 'location',
  'link': 'link',
  'chat.photo': 'image',
  'chat.video': 'file',
  'chat.sticker': 'sticker',
  'chat.file': 'file',
  'chat.voice': 'voice',
  'chat.location': 'location',
  'chat.link': 'link',
};

interface RawAttachmentFields {
  type?: string | number;
  href?: string;
  thumb?: string;
  title?: string;
  desc?: string;
  description?: string;
  name?: string;
  params?: unknown;
}

function toAttachment(fields: RawAttachmentFields): MessageAttachment | null {
  const type = fields.type === undefined ? undefined : String(fields.type);
  const kind = (type && KIND_BY_TYPE[type]) || inferKind(fields);
  if (!kind) return null;

  const attachment: MessageAttachment = { kind };
  if (fields.href) attachment.url = fields.href;
  if (fields.thumb) attachment.thumb = fields.thumb;
  const title = fields.name || fields.title;
  if (title) attachment.name = title;
  const description = fields.desc || fields.description;
  if (description) attachment.description = description;
  if (kind === 'file' || kind === 'image') {
    const size = parseByteSize(description);
    if (size !== undefined) attachment.size = size;
  }
  if (kind === 'link' || kind === 'location') {
    if (title) attachment.title = title;
  }
  return attachment;
}

/** Fallback kind inference for objects without a usable `type`. */
function inferKind(fields: RawAttachmentFields): AttachmentKind | undefined {
  if (!fields.href && !fields.thumb) return undefined;
  if (fields.thumb && !fields.title) return 'image';
  if (fields.thumb && fields.title && fields.desc) return 'link';
  return 'file';
}

/** "102.5 KB" / "1.2MB" / "123456" → bytes (or undefined). */
function parseByteSize(text?: string): number | undefined {
  if (!text) return undefined;
  const m = text.trim().match(/^([\d.,]+)\s*(b|kb|mb|gb)?$/i);
  if (!m) return undefined;
  const value = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(value)) return undefined;
  const unit = (m[2] || 'b').toLowerCase();
  const mult = unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1;
  return Math.round(value * mult);
}

export function parseZaloContent(
  content: string | Record<string, unknown> | null | undefined,
  msgType?: string | number
): { text: string; attachment: MessageAttachment | null } {
  if (content === null || content === undefined || content === '') {
    return { text: '', attachment: null };
  }

  if (typeof content === 'object') {
    const attachment = toAttachment(content as RawAttachmentFields);
    return { text: attachment ? attachmentCaption(attachment) : '', attachment };
  }

  let parsed: RawAttachmentFields | null = null;
  try {
    const candidate = JSON.parse(content) as unknown;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as RawAttachmentFields;
    }
  } catch {
    parsed = null; // not JSON → plain text
  }

  if (!parsed) return { text: content, attachment: null };

  const type = parsed.type ?? msgType;
  const attachment = toAttachment({ ...parsed, type });
  return { text: attachment ? attachmentCaption(attachment) : content, attachment };
}

/** Short display caption for a media/file bubble ("[Ảnh]", "[File: báo giá.xlsx]"…). */
export function attachmentCaption(attachment: MessageAttachment): string {
  switch (attachment.kind) {
    case 'image':
      return '[Ảnh]';
    case 'gif':
      return '[Ảnh động]';
    case 'file':
      return attachment.name ? `[File: ${attachment.name}]` : '[File]';
    case 'link':
      return attachment.title ? `[Liên kết: ${attachment.title}]` : '[Liên kết]';
    case 'voice':
      return '[Tin nhắn thoại]';
    case 'sticker':
      return '[Nhãn dán]';
    case 'location':
      return attachment.title ? `[Vị trí: ${attachment.title}]` : '[Vị trí]';
  }
}
