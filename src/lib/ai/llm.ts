import OpenAI from 'openai';
import { AppSettings } from '@/types';

/**
 * Local omniroute gateway (k3s). OpenAI-compatible; reachable from the k3s
 * node host without auth, or via OMNIROUTE_API_KEY from elsewhere.
 * Endpoint discovered from the cluster:
 *   omiRouteService 10.43.196.168:20128 → /v1/chat/completions
 * Models: auto/best-fast (cheap), auto/best-coding (extraction).
 */
export const OMNIROUTE_DEFAULT_BASE_URL =
  process.env.OMNIROUTE_BASE_URL || 'http://10.43.196.168:20128/v1';
export const OMNIROUTE_DEFAULT_MODEL = process.env.OMNIROUTE_MODEL || 'auto/best-fast';
export const OMNIROUTE_CODING_MODEL = process.env.OMNIROUTE_CODING_MODEL || 'auto/best-coding';

const TIMEOUT_MS = 120_000;

function clientFor(settings: AppSettings): OpenAI {
  return new OpenAI({
    apiKey: settings.omniroute_api_key || process.env.OMNIROUTE_API_KEY || 'local',
    baseURL: settings.omniroute_base_url || OMNIROUTE_DEFAULT_BASE_URL,
    timeout: TIMEOUT_MS,
  });
}

export interface ChatOpts {
  system: string;
  user: string;
  /** Description of the expected JSON shape — improves adherence on routed models. */
  jsonShape: string;
  model?: string;
  temperature?: number;
}

/**
 * Structured (JSON-object) completion against the local omniroute gateway.
 * Returns null on transport/parse failure so workers degrade gracefully —
 * AI output is derived data, never a system dependency.
 */
export async function chatJSON<T>(settings: AppSettings, opts: ChatOpts): Promise<T | null> {
  const client = clientFor(settings);
  const model = opts.model || settings.omniroute_model || OMNIROUTE_DEFAULT_MODEL;

  const prompt = [
    opts.system,
    '',
    '## Yêu cầu trả về',
    'Chỉ trả về MỘT đối tượng JSON hợp lệ, không kèm markdown, không kèm giải thích.',
    'Cấu trúc JSON:',
    opts.jsonShape,
  ].join('\n');

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: opts.user },
      ],
      response_format: { type: 'json_object' },
      temperature: opts.temperature ?? 0.2,
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) return null;
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error(`[llm] chatJSON failed (model=${model}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Free-form completion (daily brief, summaries). Falls back to null on failure. */
export async function complete(settings: AppSettings, opts: ChatOpts): Promise<string | null> {
  const client = clientFor(settings);
  const model = opts.model || settings.omniroute_model || OMNIROUTE_DEFAULT_MODEL;

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      temperature: opts.temperature ?? 0.5,
      max_tokens: 1200,
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error(`[llm] complete failed (model=${model}):`, err instanceof Error ? err.message : err);
    return null;
  }
}
