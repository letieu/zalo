/**
 * Local deterministic text embeddings (hashing trick).
 *
 * omniroute serves chat models only — no embedding endpoint — so V1 uses a
 * char-n-gram hashing vectorizer: subword overlap gives decent Vietnamese
 * semantic-ish matching (morphology, typos, "Da Nang" vs "Đà Nẵng" via
 * ASCII folding) with zero infra. The interface is the pgvector contract
 * (float vector + cosine), so swapping in a real embedding model later is
 * a one-file change.
 */

export const EMBEDDING_DIMS = 384;

/** Fold Vietnamese diacritics for one gram variant (keeps the original too). */
const DIACRITIC_MAP: Record<string, string> = {
  'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a', 'ă': 'a', 'ắ': 'a', 'ằ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
  'â': 'a', 'ấ': 'a', 'ầ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
  'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e', 'ê': 'e', 'ế': 'e', 'ề': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
  'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
  'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o', 'ô': 'o', 'ố': 'o', 'ồ': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
  'ơ': 'o', 'ớ': 'o', 'ờ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
  'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u', 'ư': 'u', 'ứ': 'u', 'ừ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
  'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
  'đ': 'd',
};

function foldDiacritics(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    out += DIACRITIC_MAP[ch] ?? ch;
  }
  return out;
}

/** Stable 32-bit FNV-1a hash → [0, EMBEDDING_DIMS). */
function hashToBucket(gram: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < gram.length; i++) {
    h ^= gram.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % EMBEDDING_DIMS;
}

export function embed(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIMS);
  const normalized = text.toLowerCase();
  const folded = foldDiacritics(normalized);

  // Weighted term frequencies; both the original and the diacritic-folded
  // forms contribute so near-miss spellings still overlap.
  for (const source of [normalized, folded]) {
    for (let n = 3; n <= 4; n++) {
      for (let i = 0; i <= source.length - n; i++) {
        const gram = source.slice(i, i + n);
        vec[hashToBucket(gram)] += 1;
      }
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return new Array(EMBEDDING_DIMS).fill(0);
  return Array.from(vec, v => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}
