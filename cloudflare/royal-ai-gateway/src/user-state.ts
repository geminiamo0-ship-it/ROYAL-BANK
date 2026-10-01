import { DurableObject } from 'cloudflare:workers';
import type { RoyalAiEnv } from './env';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { id: number; role: ChatRole; content: string; sources: unknown[]; createdAtMs: number };

function cairoDayKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function cleanTitle(message: string): string {
  const value = message.replace(/\s+/g, ' ').trim();
  if (!value) return 'New conversation';
  return value.length <= 72 ? value : value.slice(0, 69).trimEnd() + '…';
}

export class RoyalAiUserState extends DurableObject<RoyalAiEnv> {
  constructor(ctx: DurableObjectState, env: RoyalAiEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entitlement (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        daily_limit INTEGER NOT NULL,
        expires_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_daily (
        day_key TEXT PRIMARY KEY,
        messages_used INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        language TEXT NOT NULL CHECK (language IN ('en','ar')),
        summary TEXT NOT NULL DEFAULT '',
        message_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_royal_ai_conversations_updated
        ON conversations(updated_at_ms DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        sources_json TEXT NOT NULL DEFAULT '[]',
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_royal_ai_messages_conversation
        ON messages(conversation_id, id);

      CREATE TABLE IF NOT EXISTS message_requests (
        request_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_response TEXT,
        sources_json TEXT NOT NULL DEFAULT '[]',
        grounding_mode TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        retrieval_ms REAL NOT NULL DEFAULT 0,
        first_token_ms REAL NOT NULL DEFAULT 0,
        generation_ms REAL NOT NULL DEFAULT 0,
        total_ms REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        usage_day_key TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_royal_ai_requests_conversation
        ON message_requests(conversation_id, created_at_ms);
    `);
  }

  private one<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T | null {
    return (this.ctx.storage.sql.exec<T>(query, ...bindings).toArray()[0] as T | undefined) ?? null;
  }

  private all<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray() as T[];
  }

  private assertUser(userId: string): void {
    if (!this.ctx.id.name || this.ctx.id.name !== userId) throw new Error('ROYAL_AI_USER_SHARD_MISMATCH');
  }

  private limits(defaultDailyLimit: number): { dailyLimit: number; override: null | { dailyLimit: number; expiresAtMs: number | null; updatedAtMs: number } } {
    const row = this.one<{ daily_limit: number; expires_at_ms: number | null; updated_at_ms: number }>(
      'SELECT daily_limit, expires_at_ms, updated_at_ms FROM entitlement WHERE id = 1',
    );
    if (!row) return { dailyLimit: defaultDailyLimit, override: null };
    const expiresAtMs = row.expires_at_ms == null ? null : Number(row.expires_at_ms);
    if (expiresAtMs != null && expiresAtMs <= Date.now()) {
      this.ctx.storage.sql.exec('DELETE FROM entitlement WHERE id = 1');
      return { dailyLimit: defaultDailyLimit, override: null };
    }
    const dailyLimit = Number(row.daily_limit);
    return {
      dailyLimit,
      override: {
        dailyLimit,
        expiresAtMs,
        updatedAtMs: Number(row.updated_at_ms),
      },
    };
  }

  private used(dayKey: string): number {
    return Number(this.one<{ messages_used: number }>(
      'SELECT messages_used FROM usage_daily WHERE day_key = ?',
      dayKey,
    )?.messages_used ?? 0);
  }

  private recentMessages(conversationId: string, limit = 8): ChatMessage[] {
    const rows = this.all<{
      id: number;
      role: string;
      content: string;
      sources_json: string;
      created_at_ms: number;
    }>(
      `SELECT id, role, content, sources_json, created_at_ms
       FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`,
      conversationId,
      limit,
    ).reverse();

    return rows
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({
        id: Number(row.id),
        role: row.role as ChatRole,
        content: String(row.content),
        sources: safeJsonArray(row.sources_json),
        createdAtMs: Number(row.created_at_ms),
      }));
  }

  async handle(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const userId = String(input.userId || '');
    this.assertUser(userId);
    const action = String(input.action || '');

    if (action === 'prepareMessage') {
      return this.prepareMessage({
        userId,
        conversationId: typeof input.conversationId === 'string' ? input.conversationId : null,
        requestId: String(input.requestId || ''),
        message: String(input.message || ''),
        language: input.language === 'ar' ? 'ar' : 'en',
        defaultDailyLimit: Number(input.defaultDailyLimit || 15),
        maxMessageChars: Number(input.maxMessageChars || 4000),
      });
    }
    if (action === 'commitMessage') {
      return this.commitMessage(input);
    }
    if (action === 'failMessage') {
      return this.failMessage(userId, String(input.requestId || ''));
    }
    if (action === 'listConversations') return this.listConversations();
    if (action === 'getConversation') return this.getConversation(String(input.conversationId || ''));
    if (action === 'newConversation') {
      return this.newConversation(input.language === 'ar' ? 'ar' : 'en');
    }
    if (action === 'deleteConversation') {
      return this.deleteConversation(String(input.conversationId || ''));
    }
    if (action === 'deleteAllConversations') return this.deleteAllConversations();
    if (action === 'usage') return this.usage(Number(input.defaultDailyLimit || 15));
    if (action === 'getSupportSnapshot') return this.supportSnapshot(Number(input.defaultDailyLimit || 15));
    if (action === 'setEntitlement') {
      return this.setEntitlement(
        Number(input.dailyLimit),
        input.expiresAtMs == null ? null : Number(input.expiresAtMs),
      );
    }
    if (action === 'clearEntitlement') {
      this.ctx.storage.sql.exec('DELETE FROM entitlement WHERE id = 1');
      return this.supportSnapshot(Number(input.defaultDailyLimit || 15));
    }
    if (action === 'getSummaryContext') return this.getSummaryContext(String(input.conversationId || ''));
    if (action === 'setSummary') {
      return this.setSummary(String(input.conversationId || ''), String(input.summary || ''));
    }
    if (action === 'setLanguage') {
      const language = input.language === 'ar' ? 'ar' : 'en';
      this.ctx.storage.sql.exec(
        `INSERT INTO preferences(id, language, updated_at_ms) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET language = excluded.language, updated_at_ms = excluded.updated_at_ms`,
        language,
        Date.now(),
      );
      return { ok: true, language };
    }
    if (action === 'getPreferences') {
      const row = this.one<{ language: string }>('SELECT language FROM preferences WHERE id = 1');
      return { ok: true, language: row?.language === 'ar' ? 'ar' : 'en' };
    }

    return { ok: false, code: 'ROYAL_AI_UNKNOWN_ACTION' };
  }

  private prepareMessage(input: {
    userId: string;
    conversationId: string | null;
    requestId: string;
    message: string;
    language: 'en' | 'ar';
    defaultDailyLimit: number;
    maxMessageChars: number;
  }): Record<string, unknown> {
    const message = input.message.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(input.requestId)) {
      return { ok: false, code: 'ROYAL_AI_INVALID_REQUEST_ID' };
    }
    if (!message || message.length > input.maxMessageChars) {
      return { ok: false, code: 'ROYAL_AI_INVALID_MESSAGE' };
    }

    const existingRequest = this.one<{
      conversation_id: string;
      user_message: string;
      assistant_response: string | null;
      sources_json: string;
      grounding_mode: string | null;
      model: string | null;
      status: string;
    }>(
      `SELECT conversation_id, user_message, assistant_response, sources_json, grounding_mode, model, status
       FROM message_requests WHERE request_id = ?`,
      input.requestId,
    );
    if (existingRequest) {
      if (existingRequest.user_message !== message) {
        return { ok: false, code: 'ROYAL_AI_REQUEST_ID_REUSED' };
      }
      if (existingRequest.status === 'completed' && existingRequest.assistant_response) {
        return {
          ok: true,
          idempotent: true,
          conversationId: existingRequest.conversation_id,
          assistantResponse: existingRequest.assistant_response,
          sources: safeJsonArray(existingRequest.sources_json),
          groundingMode: existingRequest.grounding_mode || 'general',
          model: existingRequest.model,
        };
      }
      return { ok: false, code: 'ROYAL_AI_MESSAGE_PENDING' };
    }

    let conversationId = input.conversationId;
    let conversation = conversationId
      ? this.one<{ id: string; summary: string; language: string; message_count: number }>(
          'SELECT id, summary, language, message_count FROM conversations WHERE id = ? AND status = ?',
          conversationId,
          'active',
        )
      : null;

    if (conversationId && !conversation) {
      return { ok: false, code: 'ROYAL_AI_CONVERSATION_NOT_FOUND' };
    }
    if (!conversation) {
      conversationId = crypto.randomUUID();
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO conversations(id, title, language, summary, message_count, status, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, '', 0, 'active', ?, ?)`,
        conversationId,
        cleanTitle(message),
        input.language,
        now,
        now,
      );
      conversation = { id: conversationId, summary: '', language: input.language, message_count: 0 };
    }

    const pending = Number(this.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM message_requests
       WHERE conversation_id = ? AND status = 'pending'`,
      conversationId,
    )?.count ?? 0);
    if (pending > 0) return { ok: false, code: 'ROYAL_AI_MESSAGE_PENDING' };

    const limits = this.limits(input.defaultDailyLimit);
    const dayKey = cairoDayKey();
    const used = this.used(dayKey);
    if (used >= limits.dailyLimit) {
      return {
        ok: false,
        code: 'ROYAL_AI_DAILY_LIMIT',
        dailyLimit: limits.dailyLimit,
        remainingToday: 0,
        dayKey,
      };
    }

    const activeConversationId = conversationId as string;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO message_requests(
          request_id, conversation_id, user_message, status, usage_day_key, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        input.requestId,
        activeConversationId,
        message,
        dayKey,
        now,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO usage_daily(day_key, messages_used) VALUES (?, 1)
         ON CONFLICT(day_key) DO UPDATE SET messages_used = messages_used + 1`,
        dayKey,
      );
      this.ctx.storage.sql.exec(
        'UPDATE conversations SET language = ?, updated_at_ms = ? WHERE id = ?',
        input.language,
        now,
        activeConversationId,
      );
    });

    return {
      ok: true,
      idempotent: false,
      conversationId: activeConversationId,
      summary: String(conversation.summary || ''),
      recentMessages: this.recentMessages(activeConversationId, 8).map(({ role, content }) => ({ role, content })),
      remainingToday: Math.max(0, limits.dailyLimit - used - 1),
      dailyLimit: limits.dailyLimit,
      dayKey,
    };
  }

  private commitMessage(input: Record<string, unknown>): Record<string, unknown> {
    const requestId = String(input.requestId || '');
    const request = this.one<{
      conversation_id: string;
      user_message: string;
      status: string;
    }>('SELECT conversation_id, user_message, status FROM message_requests WHERE request_id = ?', requestId);
    if (!request) return { ok: false, code: 'ROYAL_AI_REQUEST_NOT_FOUND' };
    if (request.status === 'completed') return { ok: true, alreadyCommitted: true };

    const assistantResponse = String(input.assistantResponse || '').trim();
    if (!assistantResponse) return { ok: false, code: 'ROYAL_AI_EMPTY_RESPONSE' };
    const sourcesJson = JSON.stringify(Array.isArray(input.sources) ? input.sources : []);
    const now = Date.now();

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO messages(conversation_id, role, content, sources_json, created_at_ms)
         VALUES (?, 'user', ?, '[]', ?)`,
        request.conversation_id,
        request.user_message,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO messages(conversation_id, role, content, sources_json, created_at_ms)
         VALUES (?, 'assistant', ?, ?, ?)`,
        request.conversation_id,
        assistantResponse,
        sourcesJson,
        now,
      );
      this.ctx.storage.sql.exec(
        `UPDATE message_requests SET assistant_response = ?, sources_json = ?, grounding_mode = ?,
           model = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, retrieval_ms = ?,
           first_token_ms = ?, generation_ms = ?, total_ms = ?, status = 'completed', updated_at_ms = ?
         WHERE request_id = ?`,
        assistantResponse,
        sourcesJson,
        String(input.groundingMode || 'general'),
        String(input.model || ''),
        Number(input.inputTokens || 0),
        Number(input.outputTokens || 0),
        Number(input.costUsd || 0),
        Number(input.retrievalMs || 0),
        Number(input.firstTokenMs || 0),
        Number(input.generationMs || 0),
        Number(input.totalMs || 0),
        now,
        requestId,
      );
      this.ctx.storage.sql.exec(
        `UPDATE conversations SET message_count = message_count + 2, updated_at_ms = ? WHERE id = ?`,
        now,
        request.conversation_id,
      );
    });

    const row = this.one<{ message_count: number }>('SELECT message_count FROM conversations WHERE id = ?', request.conversation_id);
    return {
      ok: true,
      conversationId: request.conversation_id,
      summaryDue: Number(row?.message_count || 0) >= 16 && Number(row?.message_count || 0) % 8 === 0,
    };
  }

  private failMessage(userId: string, requestId: string): Record<string, unknown> {
    this.assertUser(userId);
    const request = this.one<{ usage_day_key: string; status: string }>(
      'SELECT usage_day_key, status FROM message_requests WHERE request_id = ?',
      requestId,
    );
    if (!request || request.status !== 'pending') return { ok: true, refunded: false };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM message_requests WHERE request_id = ? AND status = ?', requestId, 'pending');
      this.ctx.storage.sql.exec(
        'UPDATE usage_daily SET messages_used = MAX(0, messages_used - 1) WHERE day_key = ?',
        request.usage_day_key,
      );
    });
    return { ok: true, refunded: true };
  }

  private listConversations(): Record<string, unknown> {
    const rows = this.all<{
      id: string; title: string; language: string; message_count: number; created_at_ms: number; updated_at_ms: number;
    }>(
      `SELECT id, title, language, message_count, created_at_ms, updated_at_ms
       FROM conversations WHERE status = 'active' ORDER BY updated_at_ms DESC LIMIT 100`,
    );
    return {
      ok: true,
      conversations: rows.map((row) => ({
        id: row.id,
        title: row.title,
        language: row.language,
        messageCount: Number(row.message_count),
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
      })),
    };
  }

  private getConversation(conversationId: string): Record<string, unknown> {
    const conversation = this.one<{
      id: string; title: string; language: string; summary: string; created_at_ms: number; updated_at_ms: number;
    }>(
      `SELECT id, title, language, summary, created_at_ms, updated_at_ms
       FROM conversations WHERE id = ? AND status = 'active'`,
      conversationId,
    );
    if (!conversation) return { ok: false, code: 'ROYAL_AI_CONVERSATION_NOT_FOUND' };
    const rows = this.all<{
      id: number; role: string; content: string; sources_json: string; created_at_ms: number;
    }>(
      `SELECT id, role, content, sources_json, created_at_ms
       FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 2000`,
      conversationId,
    );
    return {
      ok: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        language: conversation.language,
        createdAtMs: Number(conversation.created_at_ms),
        updatedAtMs: Number(conversation.updated_at_ms),
      },
      messages: rows.map((row) => ({
        id: Number(row.id),
        role: row.role,
        content: row.content,
        sources: safeJsonArray(row.sources_json),
        createdAtMs: Number(row.created_at_ms),
      })),
    };
  }

  private newConversation(language: 'en' | 'ar'): Record<string, unknown> {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO conversations(id, title, language, summary, message_count, status, created_at_ms, updated_at_ms)
       VALUES (?, 'New conversation', ?, '', 0, 'active', ?, ?)`,
      id,
      language,
      now,
      now,
    );
    return { ok: true, conversationId: id };
  }

  private deleteConversation(conversationId: string): Record<string, unknown> {
    if (!conversationId) return { ok: false, code: 'ROYAL_AI_CONVERSATION_NOT_FOUND' };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM message_requests WHERE conversation_id = ?', conversationId);
      this.ctx.storage.sql.exec('DELETE FROM messages WHERE conversation_id = ?', conversationId);
      this.ctx.storage.sql.exec('DELETE FROM conversations WHERE id = ?', conversationId);
    });
    return { ok: true };
  }

  private deleteAllConversations(): Record<string, unknown> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM message_requests');
      this.ctx.storage.sql.exec('DELETE FROM messages');
      this.ctx.storage.sql.exec('DELETE FROM conversations');
    });
    return { ok: true };
  }

  private usage(defaultDailyLimit: number): Record<string, unknown> {
    const dayKey = cairoDayKey();
    const limits = this.limits(defaultDailyLimit);
    const usedToday = this.used(dayKey);
    return {
      ok: true,
      dayKey,
      usedToday,
      dailyLimit: limits.dailyLimit,
      remainingToday: Math.max(0, limits.dailyLimit - usedToday),
    };
  }

  private supportSnapshot(defaultDailyLimit: number): Record<string, unknown> {
    const usage = this.usage(defaultDailyLimit);
    const limits = this.limits(defaultDailyLimit);
    const totalConversations = Number(this.one<{ count: number }>(
      'SELECT COUNT(*) AS count FROM conversations',
    )?.count ?? 0);
    const totalMessages = Number(this.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM messages WHERE role = 'user'`,
    )?.count ?? 0);
    return {
      ...usage,
      totalConversations,
      totalMessages,
      override: limits.override,
    };
  }

  private setEntitlement(dailyLimit: number, expiresAtMs: number | null): Record<string, unknown> {
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) {
      return { ok: false, code: 'ROYAL_AI_INVALID_ENTITLEMENT' };
    }
    if (expiresAtMs != null && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())) {
      return { ok: false, code: 'ROYAL_AI_INVALID_ENTITLEMENT' };
    }
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO entitlement(id, daily_limit, expires_at_ms, updated_at_ms)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET daily_limit = excluded.daily_limit,
         expires_at_ms = excluded.expires_at_ms, updated_at_ms = excluded.updated_at_ms`,
      dailyLimit,
      expiresAtMs,
      now,
    );
    return { ok: true };
  }

  private getSummaryContext(conversationId: string): Record<string, unknown> {
    const row = this.one<{ summary: string }>(
      'SELECT summary FROM conversations WHERE id = ?',
      conversationId,
    );
    if (!row) return { ok: false, code: 'ROYAL_AI_CONVERSATION_NOT_FOUND' };
    const messages = this.recentMessages(conversationId, 16).map(({ role, content }) => ({ role, content }));
    return { ok: true, summary: row.summary || '', messages };
  }

  private setSummary(conversationId: string, summary: string): Record<string, unknown> {
    const value = summary.trim().slice(0, 8000);
    this.ctx.storage.sql.exec(
      'UPDATE conversations SET summary = ?, updated_at_ms = ? WHERE id = ?',
      value,
      Date.now(),
      conversationId,
    );
    return { ok: true };
  }
}

function safeJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
