import { describe, it, expect } from 'vitest';
import { parseZaloContent, attachmentCaption } from '@/lib/zalo/attachments';
import { MessageAttachment } from '@/types';

describe('parseZaloContent', () => {
  it('returns empty text and null attachment for empty/null content', () => {
    expect(parseZaloContent(null)).toEqual({ text: '', attachment: null });
    expect(parseZaloContent(undefined)).toEqual({ text: '', attachment: null });
    expect(parseZaloContent('')).toEqual({ text: '', attachment: null });
  });

  it('passes plain text through without an attachment', () => {
    const { text, attachment } = parseZaloContent('Nhờ em gửi báo giá trước 5h nhé!');
    expect(text).toBe('Nhờ em gửi báo giá trước 5h nhé!');
    expect(attachment).toBeNull();
  });

  it('treats unparseable strings as plain text', () => {
    const { text, attachment } = parseZaloContent('{"broken json');
    expect(text).toBe('{"broken json');
    expect(attachment).toBeNull();
  });

  it('parses an object image attachment (zca-js)', () => {
    const { text, attachment } = parseZaloContent({
      type: 1,
      href: 'https://zalo/photo.jpg',
      thumb: 'https://zalo/thumb.jpg',
      name: 'hang-dong-goi.jpg',
      desc: '512KB',
    });
    expect(text).toBe('[Ảnh]');
    expect(attachment).toMatchObject({
      kind: 'image',
      url: 'https://zalo/photo.jpg',
      thumb: 'https://zalo/thumb.jpg',
      name: 'hang-dong-goi.jpg',
      size: 512 * 1024,
    });
  });

  it('parses a JSON-string file attachment with byte size', () => {
    const { text, attachment } = parseZaloContent(
      JSON.stringify({ type: 'chat.file', href: 'https://zalo/bang-gia.xlsx', name: 'bang-gia-2026.xlsx', desc: '1.5MB' })
    );
    expect(text).toBe('[File: bang-gia-2026.xlsx]');
    expect(attachment).toMatchObject({ kind: 'file', size: Math.round(1.5 * 1024 * 1024) });
  });

  it('parses a link attachment (thumb + title + desc)', () => {
    const { text, attachment } = parseZaloContent({
      type: 7,
      href: 'https://shop.example.com/san-pham',
      thumb: 'https://shop.example.com/thumb.png',
      title: 'Máy tính Dell 5 bộ',
      desc: 'Chi tiết sản phẩm',
    });
    expect(text).toBe('[Liên kết: Máy tính Dell 5 bộ]');
    expect(attachment).toMatchObject({
      kind: 'link',
      url: 'https://shop.example.com/san-pham',
      title: 'Máy tính Dell 5 bộ',
      thumb: 'https://shop.example.com/thumb.png',
    });
  });

  it('parses voice, location and sticker kinds', () => {
    expect(parseZaloContent({ type: 5, href: 'https://zalo/v.m4a' }).attachment).toMatchObject({ kind: 'voice' });
    expect(parseZaloContent({ type: 6, title: '88 Lý Thường Kiệt' }).attachment).toMatchObject({
      kind: 'location',
      title: '88 Lý Thường Kiệt',
    });
    expect(parseZaloContent({ type: 3, href: 'https://zalo/sticker.webp' }).attachment).toMatchObject({ kind: 'sticker' });
  });

  it('uses msgType as fallback kind when the payload has no type', () => {
    const { attachment } = parseZaloContent(JSON.stringify({ href: 'https://zalo/x.jpg', name: 'a.jpg' }), 'chat.photo');
    expect(attachment).toMatchObject({ kind: 'image' });
  });

  it('falls back to kind inference for typeless objects', () => {
    expect(parseZaloContent({ thumb: 'https://zalo/t.jpg' }).attachment).toMatchObject({ kind: 'image' });
    expect(parseZaloContent({ href: 'https://zalo/f.pdf', name: 'f.pdf' }).attachment).toMatchObject({ kind: 'file' });
  });

  it('returns null attachment and keeps raw content for unknown JSON objects', () => {
    const raw = JSON.stringify({ foo: 'bar', baz: 1 });
    const { text, attachment } = parseZaloContent(raw);
    expect(attachment).toBeNull();
    expect(text).toBe(raw);
  });
});

describe('attachmentCaption', () => {
  const att = (kind: MessageAttachment['kind'], extra: Partial<MessageAttachment> = {}): MessageAttachment => ({
    kind,
    ...extra,
  });

  it('covers every kind with a short Vietnamese caption', () => {
    expect(attachmentCaption(att('image'))).toBe('[Ảnh]');
    expect(attachmentCaption(att('gif'))).toBe('[Ảnh động]');
    expect(attachmentCaption(att('file', { name: 'bang-gia.xlsx' }))).toBe('[File: bang-gia.xlsx]');
    expect(attachmentCaption(att('file'))).toBe('[File]');
    expect(attachmentCaption(att('link', { title: 'Sản phẩm' }))).toBe('[Liên kết: Sản phẩm]');
    expect(attachmentCaption(att('voice'))).toBe('[Tin nhắn thoại]');
    expect(attachmentCaption(att('sticker'))).toBe('[Nhãn dán]');
    expect(attachmentCaption(att('location', { title: 'Q.10' }))).toBe('[Vị trí: Q.10]');
  });
});
