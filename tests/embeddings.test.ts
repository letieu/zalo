import { describe, it, expect } from 'vitest';
import { embed, cosine, EMBEDDING_DIMS } from '@/lib/ai/embeddings';

describe('embed', () => {
  it('returns EMBEDDING_DIMS floats, deterministic', () => {
    const a = embed('10 thùng nước ngọt quận 7');
    const b = embed('10 thùng nước ngọt quận 7');
    expect(a).toHaveLength(EMBEDDING_DIMS);
    expect(a).toEqual(b);
  });

  it('produces L2-normalized vectors', () => {
    const v = embed('Em đặt giúp anh 10 thùng nước ngọt');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('empty/short text yields a zero vector (no crash)', () => {
    expect(embed('')).toEqual(new Array(EMBEDDING_DIMS).fill(0));
    expect(embed('ab')).toEqual(new Array(EMBEDDING_DIMS).fill(0));
  });

  it('folds Vietnamese diacritics: "Đà Nẵng" ≈ "Da Nang"', () => {
    const vi = embed('Đà Nẵng');
    const ascii = embed('Da Nang');
    const unrelated = embed('xe hơi bánh mì');
    expect(cosine(vi, ascii)).toBeGreaterThan(cosine(vi, unrelated));
  });

  it('ranks overlapping meaning above unrelated text', () => {
    const q = embed('đặt 10 thùng nước ngọt');
    const same = embed('10 thùng nước ngọt quận 7');
    const other = embed('gửi báo giá máy tính dell');
    expect(cosine(q, same)).toBeGreaterThan(cosine(q, other));
  });
});

describe('cosine', () => {
  it('identical unit vectors → 1; orthogonal → 0', () => {
    const a = [1, 0, 0, 0];
    expect(cosine(a, a)).toBeCloseTo(1, 9);
    expect(cosine(a, [0, 1, 0, 0])).toBe(0);
  });

  it('handles dimension mismatch by truncating to the shorter', () => {
    expect(cosine([1, 0], [1, 0, 0, 0])).toBeCloseTo(1, 9);
  });

  it('zero vector dot anything → 0 (search must not crash on empty embed)', () => {
    expect(cosine(embed(''), embed('bất cứ điều gì'))).toBe(0);
  });
});
