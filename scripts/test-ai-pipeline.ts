/**
 * E2E smoke test: ingestion -> durable outbox -> 5 independent workers,
 * each backed by the real local omniroute LLM gateway (k3s).
 *
 * Run: npx tsx scripts/test-ai-pipeline.ts  (fresh DB recommended)
 *
 * Asserts (in order):
 *  1. Worker registry: exactly 5 workers registered.
 *  2. Ingested message persists + its `message.saved` event is published.
 *  3. TaskWorker extracts >= 1 new pending task from the new message.
 *  4. MemoryWorker folds >= 1 durable fact into the contact.
 *  5. EmbeddingWorker stores a 384-dim vector for the new message.
 *  6. ContactWorker keeps last_interaction_at fresh.
 *  7. SummaryWorker updates the living-doc fields (summary/sentiment/importance).
 *  8. Semantic search finds the new message by meaning (not keyword).
 */
import { dbQueries } from '../src/lib/db/sqlite';
import { ensureWorkersRegistered } from '../src/lib/workers';
import { handleIncomingMessage } from '../src/lib/ai/pipeline';
import { embed, cosine } from '../src/lib/ai/embeddings';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

console.log('=== 1. Worker registry ===');
const workers = ensureWorkersRegistered();
console.log(`Registered: ${workers.join(', ')}`);
if (workers.length !== 5) fail(`expected 5 workers, got ${workers.length}`);
if (!['task', 'memory', 'summary', 'contact', 'embedding'].every(w => workers.includes(w))) {
  fail(`missing workers, got ${workers.join(', ')}`);
}

console.log('\n=== 2. Ingest a customer message (outbox-driven) ===');
const convs = dbQueries.getConversations();
if (convs.length === 0) fail('no conversations seeded');
const conv = convs[0];
console.log(`Conversation: ${conv.name} (${conv.id})`);

const tasksBefore = dbQueries.getTasks(conv.id, 'pending').length;
const memBefore = dbQueries.getMemories(999).length;
const embBefore = dbQueries.getAllEmbeddedMessages().length;
const contactBefore = conv.contact_id ? dbQueries.getContactById(conv.contact_id) : undefined;

const content =
  'Em ơi, sáng mai 9h anh có buổi gặp khách hàng mới ở quận 7. ' +
  'Em đặt giúp anh 10 thùng nước ngọt và chuẩn bị bảng giá sản phẩm mới nhé.';
const ingested = await handleIncomingMessage({
  conversation_id: conv.id,
  zalo_msg_id: 'zm_smoke_' + Date.now(),
  sender_id: 'ct_tuan_zalo',
  sender_name: conv.name,
  is_from_me: false,
  content,
  timestamp: new Date().toISOString(),
});
console.log(`Ingested message ${ingested.message.id} (aiResult=${ingested.aiResult})`);
if (!ingested.message.id) fail('ingest returned no message');

console.log('\n=== 3. TaskWorker: extraction via omniroute ===');
const tasksAfter = dbQueries.getTasks(conv.id, 'pending');
const newTasks = tasksAfter.filter(t => t.source_msg_id === ingested.message.id);
console.log(`Pending tasks before=${tasksBefore} after=${tasksAfter.length}; new from this message=${newTasks.length}`);
if (newTasks.length === 0) fail('TaskWorker created no task from the new message');
for (const t of newTasks) console.log(`  [${t.priority}] ${t.title} | deadline=${t.deadline || '-'}`);

console.log('\n=== 4. MemoryWorker: facts folded into contact ===');
const memAfter = dbQueries.getMemories(999);
const newFacts = memAfter.filter(m => m.source_msg_id === ingested.message.id);
console.log(`Memories before=${memBefore} after=${memAfter.length}; new facts=${newFacts.length}`);
if (newFacts.length === 0) fail('MemoryWorker extracted no facts');
for (const f of newFacts) console.log(`  [${f.category}] ${f.content} (${f.confidence})`);
const badCat = newFacts.find(f => !['email','phone','company','product','preference','personal','location','commitment','other'].includes(f.category));
if (badCat) fail(`invalid memory category: ${badCat.category}`);

console.log('\n=== 5. EmbeddingWorker: vector stored ===');
const emb = dbQueries.getMessageEmbedding(ingested.message.id);
if (!emb) fail('no embedding for ingested message');
if (emb.length !== 384) fail(`expected 384 dims, got ${emb.length}`);
console.log(`Embedding dims=${emb.length}; total embedded=${dbQueries.getAllEmbeddedMessages().length} (before=${embBefore})`);

console.log('\n=== 6. ContactWorker: interaction touched ===');
const contactAfter = conv.contact_id ? dbQueries.getContactById(conv.contact_id) : undefined;
if (!contactAfter) fail('conversation has no linked contact');
console.log(`Contact ${contactAfter.name}: last_interaction_at=${contactAfter.last_interaction_at} (before=${contactBefore?.last_interaction_at ?? '-'})`);
if (contactBefore && (contactAfter.last_interaction_at || '') < (contactBefore.last_interaction_at || '')) {
  fail('last_interaction_at went backwards');
}

console.log('\n=== 7. SummaryWorker: living document updated ===');
const convNow = dbQueries.getConversationById(conv.id);
if (!convNow) fail('conversation disappeared');
console.log(`summary="${convNow.summary?.slice(0, 120)}${(convNow.summary?.length ?? 0) > 120 ? '...' : ''}"`);
console.log(`open_topics=${JSON.stringify(convNow.open_topics)}`);
console.log(`sentiment=${convNow.sentiment} importance=${convNow.importance} last_ai_summary_at=${convNow.last_ai_summary_at}`);
if (!convNow.summary) fail('summary empty');
if (!convNow.last_ai_summary_at) fail('last_ai_summary_at not set');
if (!['positive', 'neutral', 'negative'].includes(convNow.sentiment || '')) fail(`bad sentiment ${convNow.sentiment}`);

console.log('\n=== 8. Semantic search: "đặt 10 thùng nước ngọt quận 7" ===');
const queryVec = embed('đặt 10 thùng nước ngọt quận 7');
const hits = dbQueries
  .getAllEmbeddedMessages()
  .map(({ message, embedding }) => ({ message, score: cosine(queryVec, embedding) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 3);
for (const h of hits) console.log(`  ${h.score.toFixed(3)} ${h.message.content.slice(0, 80)}`);
if (hits[0]?.message.id !== ingested.message.id) fail('new message not the top semantic hit');

console.log('\n=== 9. Task completion path (second ingest: user confirms) ===');
await handleIncomingMessage({
  conversation_id: conv.id,
  zalo_msg_id: 'zm_smoke_done_' + Date.now(),
  sender_id: 'me',
  sender_name: 'Tôi',
  is_from_me: true,
  content: 'Dạ xong rồi ạ. Em đã đặt xong 10 thùng nước ngọt, gửi bảng giá qua email và chốt lịch 9h sáng mai với khách.',
  timestamp: new Date().toISOString(),
});
const completedNow = dbQueries.getTasks(conv.id).filter(t => t.status === 'completed' && t.source_msg_id === newTasks[0]?.id);
console.log(`Auto-completed by AI: ${completedNow.length} (title="${completedNow[0]?.title ?? '-'}")`);

console.log('\nDONE: all checks passed');
process.exit(0);
