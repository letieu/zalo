import { Message, Task, AIAnalysisResult, AppSettings, TaskPriority } from '@/types';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

/**
 * Main AI Service to process chat messages, extract tasks, and detect completions.
 */
export class AIProcessor {
  /**
   * Run full AI analysis on a conversation's messages and pending tasks.
   */
  static async analyzeConversation(
    messages: Message[],
    pendingTasks: Task[],
    settings: AppSettings
  ): Promise<AIAnalysisResult> {
    const provider = settings.ai_provider || 'smart_heuristic';

    if (provider === 'gemini' && settings.gemini_api_key) {
      try {
        return await this.analyzeWithGemini(messages, pendingTasks, settings);
      } catch (err) {
        console.error('Gemini API error, falling back to heuristic engine:', err);
      }
    }

    if (provider === 'openai' && settings.openai_api_key) {
      try {
        return await this.analyzeWithOpenAI(messages, pendingTasks, settings);
      } catch (err) {
        console.error('OpenAI API error, falling back to heuristic engine:', err);
      }
    }

    if (provider === 'ollama' && settings.ollama_url) {
      try {
        return await this.analyzeWithOllama(messages, pendingTasks, settings);
      } catch (err) {
        console.error('Ollama API error, falling back to heuristic engine:', err);
      }
    }

    // Default Fallback: Smart Heuristic Rule Parser
    return this.analyzeWithHeuristics(messages, pendingTasks);
  }

  /**
   * Smart Heuristic Engine for Vietnamese & English customer chat patterns.
   */
  private static analyzeWithHeuristics(
    messages: Message[],
    pendingTasks: Task[]
  ): AIAnalysisResult {
    const result: AIAnalysisResult = {
      newTasks: [],
      completedTaskIds: [],
    };

    // Filter unprocessed messages or recent messages for task creation
    const recentMessages = messages.slice(-10);

    for (const msg of recentMessages) {
      // Only process unanalyzed messages for task creation
      if (msg.ai_processed) continue;

      const contentLower = msg.content.toLowerCase();

      // Check if message is a completion statement
      const isCompletionStatement = /(đã gửi|đã xong|đã hoàn thành|đã sửa|đã ship|đã giao|đã nhận|đã chuyển|đã note|đã xuất|xong rồi)/i.test(msg.content);
      if (isCompletionStatement && msg.is_from_me) {
        continue; // Skip creating new task from self completion messages
      }

      // Keywords requesting action/tasks
      const requestPatterns = [
        /(gửi|ship|chuyển|xuất|báo giá|sửa|giao|check|kiểm tra|note|lưu ý|đổi|chỉnh|làm|gửi cho|tạo|cung cấp)(?![\p{L}\p{N}])/iu,
        /(trước|chiều nay|hôm nay|ngày mai|sáng mai|tuần sau|\d+h|\d+ giờ)(?![\p{L}\p{N}])/iu,
      ];

      const isRequest = requestPatterns[0].test(msg.content) && !isCompletionStatement;

      if (isRequest && msg.content.length > 8) {
        // Extract title & priority
        let title = msg.content;
        if (title.length > 60) {
          title = title.substring(0, 57) + '...';
        }

        let priority: TaskPriority = 'medium';
        if (/gấp|khẩn cấp|ngay|trước \d+h|hôm nay/i.test(msg.content)) {
          priority = 'high';
        }

        // Extract deadline hint
        const deadlineMatch = msg.content.match(/(trước \d+h|\d+h chiều|\d+h sáng|hôm nay|ngày mai|sáng mai|chiều nay|cuối tuần)/i);
        const deadline = deadlineMatch ? deadlineMatch[0] : undefined;

        // Clean up title format
        const senderLabel = msg.is_from_me ? 'Tôi' : msg.sender_name;
        const formattedTitle = `${title.replace(/^[\s\n.-]+/, '')} (${senderLabel})`;

        // Avoid duplicate task titles
        const existingTask = pendingTasks.find(t => t.title.includes(title.substring(0, 15)));
        if (!existingTask) {
          result.newTasks.push({
            title: formattedTitle,
            description: `Trích xuất từ tin nhắn của ${senderLabel}: "${msg.content}"`,
            priority,
            deadline,
            source_msg_id: msg.id,
            source_msg_text: msg.content,
          });
        }
      }
    }

    // Detect completions for active pending tasks
    for (const task of pendingTasks) {
      if (task.status === 'completed' || task.status === 'cancelled') continue;

      // Extract core keywords from task title
      const coreKeywords = task.title
        .toLowerCase()
        .replace(/\(.*\)/g, '')
        .split(' ')
        .filter(w => w.length > 2);

      // Search latest messages for completion indicators
      for (const msg of recentMessages) {
        const text = msg.content.toLowerCase();

        // Completion indicator phrases in Vietnamese
        const completionPhrases = [
          'đã gửi', 'đã xong', 'đã hoàn thành', 'đã sửa', 'đã ship', 'đã giao', 
          'đã nhận', 'đã chuyển', 'đã note', 'đã xuất', 'đã check', 'xong rồi',
          'đã nhận được hàng', 'cảm ơn em đã nhận', 'ok rồi'
        ];

        const hasCompletionPhrase = completionPhrases.some(phrase => text.includes(phrase));

        if (hasCompletionPhrase) {
          // Check if message relates to task keywords
          const matchedWords = coreKeywords.filter(kw => text.includes(kw));
          if (matchedWords.length >= 1 || coreKeywords.length === 0) {
            result.completedTaskIds.push({
              task_id: task.id,
              reason: `Phát hiện câu trả lời xác nhận từ ${msg.sender_name}: "${msg.content}"`,
            });
            break;
          }
        }
      }
    }

    return result;
  }

  /**
   * Analyze conversation using Google Gemini LLM API.
   */
  private static async analyzeWithGemini(
    messages: Message[],
    pendingTasks: Task[],
    settings: AppSettings
  ): Promise<AIAnalysisResult> {
    const ai = new GoogleGenAI({ apiKey: settings.gemini_api_key });
    const modelName = settings.gemini_model || 'gemini-2.5-flash';

    const prompt = this.buildLLMPrompt(messages, pendingTasks);

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
    });

    const text = response.text || '';
    return this.parseLLMResponse(text);
  }

  /**
   * Analyze conversation using OpenAI Chat API.
   */
  private static async analyzeWithOpenAI(
    messages: Message[],
    pendingTasks: Task[],
    settings: AppSettings
  ): Promise<AIAnalysisResult> {
    const openai = new OpenAI({ apiKey: settings.openai_api_key, baseURL: settings.openai_base_url || undefined });
    const modelName = settings.openai_model || 'gpt-4o-mini';

    const prompt = this.buildLLMPrompt(messages, pendingTasks);

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0]?.message?.content || '{}';
    return this.parseLLMResponse(text);
  }

  /**
   * Analyze conversation using local Ollama endpoint.
   */
  private static async analyzeWithOllama(
    messages: Message[],
    pendingTasks: Task[],
    settings: AppSettings
  ): Promise<AIAnalysisResult> {
    const url = (settings.ollama_url || 'http://localhost:11434').replace(/\/$/, '') + '/api/generate';
    const model = settings.ollama_model || 'llama3';
    const prompt = this.buildLLMPrompt(messages, pendingTasks);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        format: 'json',
        stream: false,
      }),
    });

    if (!res.ok) throw new Error(`Ollama response error: ${res.statusText}`);
    const data = (await res.json()) as { response?: string };
    return this.parseLLMResponse(data.response || '{}');
  }

  /**
   * Prompt Builder for Structured Task Extraction & Completion Detection
   */
  private static buildLLMPrompt(messages: Message[], pendingTasks: Task[]): string {
    const chatHistory = messages
      .slice(-15)
      .map(m => `[ID: ${m.id}] ${m.is_from_me ? 'Tôi' : m.sender_name}: "${m.content}"`)
      .join('\n');

    const tasksList = pendingTasks
      .filter(t => t.status === 'pending' || t.status === 'in_progress')
      .map(t => `[Task ID: ${t.id}] "${t.title}" (Chi tiết: ${t.description || 'Không'})`)
      .join('\n');

    return `Bạn là Trợ lý AI Quản lý Công việc từ Đoạn Chat Zalo.
Nhiệm vụ của bạn:
1. Đọc lịch sử trò chuyện và xác định các CÔNG VIỆC MỚI (yêu cầu báo giá, giao hàng, chỉnh sửa file, hẹn thời gian, gửi tài liệu, v.v.).
2. Kiểm tra danh sách CÔNG VIỆC ĐANG CHỜ và xác định nếu có tin nhắn mới nào XÁC NHẬN CÔNG VIỆC ĐÃ HOÀN THÀNH (ví dụ: đã gửi file, đã giao hàng, đã thanh toán, khách xác nhận đã nhận).

LỊCH SỬ TIN NHẮN CHAT:
${chatHistory || '(Không có tin nhắn)'}

DANH SÁCH CÔNG VIỆC ĐANG CHỜ (PENDING TASKS):
${tasksList || '(Không có công việc đang chờ)'}

Trả về KẾT QUẢ duy nhất dưới dạng JSON hợp lệ theo cấu trúc sau:
{
  "newTasks": [
    {
      "title": "Tên công việc ngắn gọn (ví dụ: Gửi báo giá cho Anh Tuấn)",
      "description": "Chi tiết công việc và yêu cầu cụ thể",
      "priority": "low" | "medium" | "high",
      "deadline": "Thời gian hoàn thành nếu đề cập (vd: 16:00 hôm nay) hoặc null",
      "source_msg_id": "ID tin nhắn gốc tạo ra task này",
      "source_msg_text": "Trích dẫn tin nhắn gốc"
    }
  ],
  "completedTaskIds": [
    {
      "task_id": "ID công việc đã hoàn thành",
      "reason": "Lý do AI phát hiện công việc đã hoàn thành dựa trên tin nhắn"
    }
  ]
}`;
  }

  private static parseLLMResponse(jsonStr: string): AIAnalysisResult {
    try {
      const cleaned = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned) as {
        newTasks?: Array<{
          title: string;
          description?: string;
          priority?: TaskPriority;
          deadline?: string;
          source_msg_id?: string;
          source_msg_text?: string;
        }>;
        completedTaskIds?: Array<{
          task_id: string;
          reason: string;
        }>;
      };

      return {
        newTasks: (parsed.newTasks || []).map(t => ({
          title: t.title,
          description: t.description || '',
          priority: (t.priority || 'medium') as TaskPriority,
          deadline: t.deadline || undefined,
          source_msg_id: t.source_msg_id || undefined,
          source_msg_text: t.source_msg_text || undefined,
        })),
        completedTaskIds: parsed.completedTaskIds || [],
      };
    } catch (e) {
      console.error('Failed to parse AI JSON response:', e, jsonStr);
      return { newTasks: [], completedTaskIds: [] };
    }
  }
}
