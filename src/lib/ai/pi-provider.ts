import { createModels, createProvider, type Model, type MutableModels } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { AppSettings } from '@/types';
import { OMNIROUTE_DEFAULT_BASE_URL, OMNIROUTE_DEFAULT_MODEL } from './llm';

/**
 * Pi framework integration — omniroute provider.
 *
 * `@earendil-works/pi-ai` has no built-in "openai-completions" provider
 * factory; `createProvider` is the documented escape hatch for
 * OpenAI-compatible gateways (reference wiring: cloudflare-ai-gateway).
 * The gateway is unauthenticated, but pi requires a non-empty API key to
 * emit requests — we send a placeholder bearer header the gateway ignores.
 */
export function omnirouteModel(settings: AppSettings): Model<'openai-completions'> {
  return {
    id: settings.omniroute_model || OMNIROUTE_DEFAULT_MODEL,
    name: 'Omniroute (local gateway)',
    api: 'openai-completions',
    provider: 'omniroute',
    baseUrl: settings.omniroute_base_url || OMNIROUTE_DEFAULT_BASE_URL,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4096,
  };
}

let cachedKey: string | null = null;
let cachedModels: MutableModels | null = null;

/**
 * Shared pi model registry with the omniroute provider registered.
 * Rebuilt lazily when the effective settings (base URL / model / key)
 * change — settings are read fresh per assistant turn.
 */
export function getPiModels(settings: AppSettings): MutableModels {
  const key = [
    settings.omniroute_base_url || OMNIROUTE_DEFAULT_BASE_URL,
    settings.omniroute_model || OMNIROUTE_DEFAULT_MODEL,
    settings.omniroute_api_key || process.env.OMNIROUTE_API_KEY || '',
  ].join('|');
  if (cachedModels && cachedKey === key) return cachedModels;

  const model = omnirouteModel(settings);
  const models = createModels();
  models.setProvider(
    createProvider({
      id: 'omniroute',
      name: 'Omniroute (local gateway)',
      baseUrl: model.baseUrl,
      auth: {
        apiKey: {
          name: 'Omniroute',
          resolve: async () => ({
            auth: {
              apiKey:
                settings.omniroute_api_key || process.env.OMNIROUTE_API_KEY || 'omniroute-local',
            },
          }),
        },
      },
      models: [model],
      api: openAICompletionsApi(),
    })
  );

  cachedKey = key;
  cachedModels = models;
  return models;
}
