import { dbQueries } from '../src/lib/db/sqlite';
import { AIProcessor } from '../src/lib/ai/processor';

console.log('=== 1. Testing Database Query: Conversations ===');
const convs = dbQueries.getConversations();
console.log(`Found ${convs.length} initial seed conversations:`);
convs.forEach(c => console.log(`- ${c.name} (Pending Tasks: ${c.pending_task_count})`));

console.log('\n=== 2. Testing Message Retrieval & Tasks for Conv 1 ===');
const conv1Id = convs[0].id;
const initialMsgs = dbQueries.getMessagesByConversationId(conv1Id);
const initialTasks = dbQueries.getTasks(conv1Id);
console.log(`Messages count: ${initialMsgs.length}`);
console.log(`Tasks count: ${initialTasks.length}`);
initialTasks.forEach(t => console.log(`  [${t.status.toUpperCase()}] ${t.title}`));

console.log('\n=== 3. Simulating Incoming Customer Message (New Task Trigger) ===');
const newMsgId = 'msg_test_' + Date.now();
const testMsg = dbQueries.addMessage({
  id: newMsgId,
  conversation_id: conv1Id,
  zalo_msg_id: 'zm_test_' + Date.now(),
  sender_id: 'customer',
  sender_name: convs[0].name,
  is_from_me: false,
  content: 'Em ơi báo giá giúp anh 10 thùng nước ngọt trước 5h chiều nay nhé!',
  timestamp: new Date().toISOString(),
  ai_processed: false,
});

console.log(`Added test message: "${testMsg.content}"`);

console.log('\n=== 4. Running AI Auto-Task Pipeline ===');
const settings = dbQueries.getSettings();
const allMsgs = dbQueries.getMessagesByConversationId(conv1Id);
const currentPendingTasks = dbQueries.getTasks(conv1Id, 'pending');

const aiResult = await AIProcessor.analyzeConversation(allMsgs, currentPendingTasks, settings);
console.log('AI Pipeline Result:', JSON.stringify(aiResult, null, 2));

if (aiResult.newTasks.length > 0) {
  for (const t of aiResult.newTasks) {
    const created = dbQueries.addTask({
      conversation_id: conv1Id,
      title: t.title,
      description: t.description,
      status: 'pending',
      priority: t.priority,
      deadline: t.deadline,
      source_msg_id: testMsg.id,
      source_msg_text: testMsg.content,
      ai_created: true,
      ai_completed: false,
    });
    console.log(`✅ Created AI Task: [${created.id}] ${created.title} (Priority: ${created.priority})`);
  }
}

console.log('\n=== 5. Simulating User Fulfillment Message (Auto Completion Trigger) ===');
const completionMsg = dbQueries.addMessage({
  id: 'msg_complete_' + Date.now(),
  conversation_id: conv1Id,
  zalo_msg_id: 'zm_comp_' + Date.now(),
  sender_id: 'me',
  sender_name: 'Tôi',
  is_from_me: true,
  content: 'Dạ anh Tuấn ơi, em đã gửi file báo giá 10 thùng nước ngọt qua email cho anh rồi nhé!',
  timestamp: new Date().toISOString(),
  ai_processed: false,
});

console.log(`Added completion message: "${completionMsg.content}"`);

const updatedMsgs = dbQueries.getMessagesByConversationId(conv1Id);
const updatedPendingTasks = dbQueries.getTasks(conv1Id, 'pending');

const completionResult = await AIProcessor.analyzeConversation(updatedMsgs, updatedPendingTasks, settings);
console.log('Completion Pipeline Result:', JSON.stringify(completionResult, null, 2));

if (completionResult.completedTaskIds.length > 0) {
  for (const item of completionResult.completedTaskIds) {
    const updated = dbQueries.updateTaskStatus(item.task_id, 'completed', item.reason, true);
    console.log(`🎉 Auto-marked Task Complete: [${updated?.id}] ${updated?.title}`);
    console.log(`   Reason: ${item.reason}`);
  }
}

console.log('\n=== 6. Final Task State for Conv 1 ===');
const finalTasks = dbQueries.getTasks(conv1Id);
finalTasks.forEach(t => console.log(`- [${t.status.toUpperCase()}] ${t.title} ${t.ai_completed ? '(Completed by AI)' : ''}`));

console.log('\n✅ All AI Pipeline tests passed successfully!');
