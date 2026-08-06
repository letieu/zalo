# Zalo — Personal Communication OS

A Next.js app integrating Zalo messaging with AI-powered assistant features (summaries, task extraction, semantic search, daily digest) via a local omniroute LLM gateway.

## Quick Start

### Prerequisites
- Node.js 20.x (Dockerfile uses `node:20-slim`)
- Docker + k3s (for production deployment)
- Local omniroute gateway: `http://10.43.196.168:20128/v1` (k3s service `omniroute-service:20128`)

### Environment
Copy `.env.example` → `.env.local` and adjust:

```bash
cp .env.example .env.local
```

Key settings:
```env
OMNIROUTE_BASE_URL=http://10.43.196.168:20128/v1
OMNIROUTE_MODEL=auto/best-fast
AI_PROVIDER=omniroute
ZALO_DB_PATH=./data/zalo_tasks.db
```

### Local Development

```bash
# Install deps (includes @earendil-works/pi-agent-core, pi-ai)
npm ci

# Run dev server (turbopack)
npm run dev
# → http://localhost:3000
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with turbopack |
| `npm run build` | Production build (`next build`) |
| `npm run start` | Run production server |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit/integration tests (99 tests) |
| `npx tsc --noEmit` | TypeScript type check |

### Test Suite
```bash
npm test                 # All 109 tests (including pi-agent fauxProvider tests)
npx vitest run tests/pi-agent.test.ts  # Pi-specific deterministic tests
```

### Docker (Production)

```bash
# Build multi-stage image (node:20-slim, compiles better-sqlite3)
docker build -t letieu/zalo:local .

# Import to k3s containerd
docker save letieu/zalo:local | k3s ctr images import -

# Deploy (k8s manifest at ../tieu-orc-deployments/k8s/zalo/)
kubectl apply -f ../tieu-orc-deployments/k8s/zalo/deployment.yaml
kubectl apply -f ../tieu-orc-deployments/k8s/zalo/ingress.yaml

# Or restart existing deployment after image rebuild
kubectl rollout restart deployment/zalo -n default
kubectl rollout status deployment/zalo -n default --timeout=120s
```

### Architecture Notes

- **LLM Provider**: Local omniroute (OpenAI-compatible) at `http://omniroute-service:20128/v1` in-cluster, `http://10.43.196.168:20128/v1` from host
- **AI Framework**: `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` — agent loop with tool calling, human-first gate (proposals only, no auto-execute)
- **Database**: SQLite (`better-sqlite3@^11.10.0` — v13 segfaults on arm64/node20)
- **Zalo Client**: `zca-js` (mock mode for dev, real credentials via env for prod)

### Key Files

```
src/lib/ai/
  ├── pi-provider.ts     # Omniroute provider factory (createProvider + auth)
  ├── pi-agent.ts        # Agent wrapper (hydrate, tool, runPiAssistantTurn)
  ├── assistant.ts       # Main entry (runAssistantTurn → pi path + heuristic fallback)
  ├── assistant-actions.ts  # Zalo send execution
  └── llm.ts             # Legacy chatJSON (used by other features)

src/app/api/assistant/
  ├── chat/route.ts      # POST {message, context?} → {userMessage, assistantMessage}
  ├── actions/route.ts   # POST {message_id, action_id} → executes confirmed proposal
  └── messages/route.ts  # GET recent assistant messages

tests/pi-agent.test.ts   # Deterministic fauxProvider tests (no network)
```

### Human-First Rule
The assistant **never auto-sends**. Every `send_message` tool call is a proposal:
1. User asks → pi agent proposes action (blocked by `beforeToolCall`)
2. UI shows proposal with "Gửi" button
3. User confirms → `/api/assistant/actions` executes via Zalo
4. Result persisted in `action_results`

### Pi Integration Gotchas (for maintainers)
- Tool definition uses `parameters:` (TypeBox), NOT `schema:` — `schema` crashes `validateToolArguments`
- `createProvider` requires `auth: { apiKey: { name, resolve: async () => ({ auth: { apiKey } }) } }` — keyless `{}` fails with "Provider is not configured"
- `Promise.withResolvers` polyfilled in `pi-agent.ts` for Node 20 compatibility
- Model registry (`createModels()`) cached per `(baseUrl|model|key)`; settings read fresh per turn

### License
MIT