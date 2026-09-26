import { DurableObject } from 'cloudflare:workers';
import type { DeepDiveChatMessage, DeepDiveLanguage } from './deep-dive';

type Entitlement = {
  dailyLimit: number;
  followupLimit: number;
  expiresAtMs: number | null;
};

type ThreadRow = {
  id: string;
  session_id: string;
  question_id: number;
  selected_option_id: number;
  cache_key: string;
  initial_response: string | null;
  model: string | null;
  prompt_version: string | null;
  status: string;
  usage_day_key: string;
  created_at_ms: number;
  updated_at_ms: number;
};

type ThreadVariantRow = {
  thread_id: string;
  language: DeepDiveLanguage;
  cache_key: string;
  initial_response: string;
  model: string | null;
  prompt_version: string | null;
  updated_at_ms: number;
};

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export class DeepDiveUserState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        day_key TEXT PRIMARY KEY,
        starts INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS entitlement (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        daily_limit INTEGER NOT NULL,
        followup_limit INTEGER NOT NULL,
        expires_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        question_id INTEGER NOT NULL,
        selected_option_id INTEGER NOT NULL,
        cache_key TEXT NOT NULL,
        initial_response TEXT,
        model TEXT,
        prompt_version TEXT,
        status TEXT NOT NULL,
        usage_day_key TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE(session_id, question_id)
      );
      CREATE INDEX IF NOT EXISTS idx_deep_dive_threads_question
        ON threads(question_id, updated_at_ms);

      CREATE TABLE IF NOT EXISTS thread_variants (
        thread_id TEXT NOT NULL,
        language TEXT NOT NULL CHECK (language IN ('en', 'ar')),
        cache_key TEXT NOT NULL,
        initial_response TEXT NOT NULL,
        model TEXT,
        prompt_version TEXT,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(thread_id, language)
      );
      CREATE INDEX IF NOT EXISTS idx_deep_dive_thread_variants_language
        ON thread_variants(language, updated_at_ms);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deep_dive_messages_thread
        ON messages(thread_id, id);

      CREATE TABLE IF NOT EXISTS message_requests (
        request_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_response TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms REAL NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deep_dive_message_requests_thread
        ON message_requests(thread_id, created_at_ms);
    `);
  }

  private one<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T | null {
    return (this.ctx.storage.sql.exec<T>(query, ...bindings).toArray()[0] as T | undefined) ?? null;
  }

  private all<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray() as T[];
  }

  private assertUser(userId: string): void {
    const objectUserId = this.ctx.id.name;
    if (!objectUserId || objectUserId !== userId) throw new Error('DEEP_DIVE_USER_SHARD_MISMATCH');
  }

  private limits(defaultDailyLimit: number, defaultFollowupLimit: number): Entitlement {
    const row = this.one<{
      daily_limit: number;
      followup_limit: number;
      expires_at_ms: number | null;
    }>('SELECT daily_limit, followup_limit, expires_at_ms FROM entitlement WHERE id = 1');

    if (!row) {
      return {
        dailyLimit: defaultDailyLimit,
        followupLimit: defaultFollowupLimit,
        expiresAtMs: null,
      };
    }

    const expiresAtMs = row.expires_at_ms == null ? null : Number(row.expires_at_ms);
    if (expiresAtMs != null && expiresAtMs <= Date.now()) {
      this.ctx.storage.sql.exec('DELETE FROM entitlement WHERE id = 1');
      return {
        dailyLimit: defaultDailyLimit,
        followupLimit: defaultFollowupLimit,
        expiresAtMs: null,
      };
    }

    return {
      dailyLimit: Number(row.daily_limit),
      followupLimit: Number(row.followup_limit),
      expiresAtMs,
    };
  }

  private usage(dayKey: string): number {
    return Number(
      this.one<{ starts: number }>('SELECT starts FROM usage_daily WHERE day_key = ?', dayKey)?.starts ?? 0,
    );
  }

  private thread(threadId: string): ThreadRow | null {
    return this.one<ThreadRow & Record<string, SqlStorageValue>>(
      'SELECT * FROM threads WHERE id = ?',
      threadId,
    ) as ThreadRow | null;
  }

  private variant(threadId: string, language: DeepDiveLanguage): ThreadVariantRow | null {
    return this.one<ThreadVariantRow & Record<string, SqlStorageValue>>(
      'SELECT * FROM thread_variants WHERE thread_id = ? AND language = ? LIMIT 1',
      threadId,
      language,
    ) as ThreadVariantRow | null;
  }

  private messages(threadId: string): DeepDiveChatMessage[] {
    return this.all<{ role: string; content: string }>(
      'SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id ASC LIMIT 32',
      threadId,
    )
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({ role: row.role as 'user' | 'assistant', content: String(row.content) }));
  }

  async prepareStart(input: {
    userId: string;
    sessionId: string;
    questionId: number;
    selectedOptionId: number;
    cacheKey: string;
    language: DeepDiveLanguage;
    defaultDailyLimit: number;
    defaultFollowupLimit: number;
  }): Promise<Record<string, unknown>> {
    this.assertUser(input.userId);
    const limits = this.limits(input.defaultDailyLimit, input.defaultFollowupLimit);
    const dayKey = utcDayKey();

    const existing = this.one<ThreadRow & Record<string, SqlStorageValue>>(
      'SELECT * FROM threads WHERE session_id = ? AND question_id = ? LIMIT 1',
      input.sessionId,
      input.questionId,
    ) as ThreadRow | null;

    if (existing) {
      const used = this.usage(dayKey);
      const messages = this.messages(existing.id);
      const followupsUsed = messages.filter((message) => message.role === 'user').length;
      let variant = this.variant(existing.id, input.language);
      const variantCount = Number(
        this.one<{ count: number }>(
          'SELECT COUNT(*) AS count FROM thread_variants WHERE thread_id = ?',
          existing.id,
        )?.count ?? 0,
      );

      // Threads created before bilingual support stored their only response directly
      // on the thread. Only backfill when the thread has no v2 variants at all.
      if (
        !variant
        && variantCount === 0
        && input.language === 'en'
        && existing.initial_response
        && existing.cache_key === input.cacheKey
      ) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO thread_variants(
            thread_id, language, cache_key, initial_response, model, prompt_version, updated_at_ms
          ) VALUES (?, 'en', ?, ?, ?, ?, ?)`,
          existing.id,
          existing.cache_key,
          existing.initial_response,
          existing.model,
          existing.prompt_version,
          existing.updated_at_ms,
        );
        variant = this.variant(existing.id, 'en');
      }

      if (variant) {
        this.ctx.storage.sql.exec(
          `UPDATE threads
           SET cache_key = ?, initial_response = ?, model = ?, prompt_version = ?,
               status = 'ready', updated_at_ms = ?
           WHERE id = ?`,
          variant.cache_key,
          variant.initial_response,
          variant.model,
          variant.prompt_version,
          Date.now(),
          existing.id,
        );
      }

      return {
        ok: true,
        existing: true,
        reserved: false,
        threadId: existing.id,
        status: variant?.initial_response ? 'ready' : existing.status,
        language: input.language,
        initialResponse: variant?.initial_response ?? null,
        model: variant?.model ?? null,
        promptVersion: variant?.prompt_version ?? null,
        cacheKey: variant?.cache_key ?? input.cacheKey,
        remaining: Math.max(0, limits.dailyLimit - used),
        dailyLimit: limits.dailyLimit,
        followupLimit: limits.followupLimit,
        remainingFollowups: Math.max(0, limits.followupLimit - followupsUsed),
        messages,
      };
    }

    const used = this.usage(dayKey);
    if (used >= limits.dailyLimit) {
      return {
        ok: false,
        code: 'DEEP_DIVE_DAILY_LIMIT',
        remaining: 0,
        dailyLimit: limits.dailyLimit,
        followupLimit: limits.followupLimit,
      };
    }

    const threadId = crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO threads(
          id, session_id, question_id, selected_option_id, cache_key,
          initial_response, model, prompt_version, status, usage_day_key,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending', ?, ?, ?)`,
        threadId,
        input.sessionId,
        input.questionId,
        input.selectedOptionId,
        input.cacheKey,
        dayKey,
        now,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO usage_daily(day_key, starts) VALUES (?, 1)
         ON CONFLICT(day_key) DO UPDATE SET starts = starts + 1`,
        dayKey,
      );
    });

    return {
      ok: true,
      existing: false,
      reserved: true,
      threadId,
      status: 'pending',
      initialResponse: null,
      cacheKey: input.cacheKey,
      language: input.language,
      remaining: Math.max(0, limits.dailyLimit - used - 1),
      dailyLimit: limits.dailyLimit,
      followupLimit: limits.followupLimit,
      remainingFollowups: limits.followupLimit,
      messages: [],
    };
  }

  async finalizeStart(input: {
    userId: string;
    threadId: string;
    language: DeepDiveLanguage;
    cacheKey: string;
    content: string;
    model: string;
    promptVersion: string;
  }): Promise<void> {
    this.assertUser(input.userId);
    const row = this.thread(input.threadId);
    if (!row) throw new Error('DEEP_DIVE_THREAD_NOT_FOUND');
    const now = Date.now();

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO thread_variants(
          thread_id, language, cache_key, initial_response, model, prompt_version, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, language) DO UPDATE SET
          cache_key = excluded.cache_key,
          initial_response = excluded.initial_response,
          model = excluded.model,
          prompt_version = excluded.prompt_version,
          updated_at_ms = excluded.updated_at_ms`,
        input.threadId,
        input.language,
        input.cacheKey,
        input.content,
        input.model,
        input.promptVersion,
        now,
      );

      // The logical thread is quota-bearing once. Its canonical seed follows the
      // currently generated language variant so follow-ups continue from what the learner sees.
      this.ctx.storage.sql.exec(
        `UPDATE threads
         SET cache_key = ?, initial_response = ?, model = ?, prompt_version = ?,
             status = 'ready', updated_at_ms = ?
         WHERE id = ?`,
        input.cacheKey,
        input.content,
        input.model,
        input.promptVersion,
        now,
        input.threadId,
      );
    });
  }

  async refundStart(input: { userId: string; threadId: string }): Promise<void> {
    this.assertUser(input.userId);
    const row = this.thread(input.threadId);
    if (!row || row.status !== 'pending') return;

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM threads WHERE id = ? AND status = ?', input.threadId, 'pending');
      this.ctx.storage.sql.exec(
        'UPDATE usage_daily SET starts = MAX(0, starts - 1) WHERE day_key = ?',
        row.usage_day_key,
      );
    });
  }

  async getThread(input: {
    userId: string;
    threadId: string;
    defaultDailyLimit: number;
    defaultFollowupLimit: number;
  }): Promise<Record<string, unknown>> {
    this.assertUser(input.userId);
    const row = this.thread(input.threadId);
    if (!row) return { ok: false, code: 'DEEP_DIVE_THREAD_NOT_FOUND' };
    const limits = this.limits(input.defaultDailyLimit, input.defaultFollowupLimit);
    const used = this.usage(utcDayKey());
    return {
      ok: true,
      threadId: row.id,
      sessionId: row.session_id,
      questionId: Number(row.question_id),
      selectedOptionId: Number(row.selected_option_id),
      initialResponse: row.initial_response,
      model: row.model,
      promptVersion: row.prompt_version,
      status: row.status,
      remaining: Math.max(0, limits.dailyLimit - used),
      dailyLimit: limits.dailyLimit,
      followupLimit: limits.followupLimit,
      messages: this.messages(row.id),
    };
  }

  async prepareMessage(input: {
    userId: string;
    threadId: string;
    requestId: string;
    message: string;
    defaultDailyLimit: number;
    defaultFollowupLimit: number;
  }): Promise<Record<string, unknown>> {
    this.assertUser(input.userId);
    const message = input.message.trim();
    if (!message || message.length > 2_000) {
      return { ok: false, code: 'DEEP_DIVE_INVALID_MESSAGE' };
    }

    const thread = this.thread(input.threadId);
    if (!thread || thread.status !== 'ready' || !thread.initial_response) {
      return { ok: false, code: 'DEEP_DIVE_THREAD_NOT_READY' };
    }

    const existing = this.one<{
      user_message: string;
      assistant_response: string | null;
      model: string | null;
      input_tokens: number;
      output_tokens: number;
      latency_ms: number;
    }>(
      `SELECT user_message, assistant_response, model, input_tokens, output_tokens, latency_ms
       FROM message_requests WHERE request_id = ?`,
      input.requestId,
    );
    if (existing) {
      if (String(existing.user_message) !== message) {
        return { ok: false, code: 'DEEP_DIVE_REQUEST_ID_REUSED' };
      }
      if (existing.assistant_response) {
        return {
          ok: true,
          idempotent: true,
          assistantResponse: existing.assistant_response,
          model: existing.model,
          inputTokens: Number(existing.input_tokens),
          outputTokens: Number(existing.output_tokens),
          latencyMs: Number(existing.latency_ms),
        };
      }
      return { ok: false, code: 'DEEP_DIVE_MESSAGE_PENDING' };
    }

    const limits = this.limits(input.defaultDailyLimit, input.defaultFollowupLimit);
    const followups = Number(
      this.one<{ count: number }>(
        `SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND role = 'user'`,
        input.threadId,
      )?.count ?? 0,
    );
    const pendingRequests = Number(
      this.one<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM message_requests
         WHERE thread_id = ? AND assistant_response IS NULL`,
        input.threadId,
      )?.count ?? 0,
    );

    if (pendingRequests > 0) {
      return {
        ok: false,
        code: 'DEEP_DIVE_MESSAGE_PENDING',
        remainingFollowups: Math.max(0, limits.followupLimit - followups - pendingRequests),
        followupLimit: limits.followupLimit,
      };
    }

    if (followups + pendingRequests >= limits.followupLimit) {
      return {
        ok: false,
        code: 'DEEP_DIVE_FOLLOWUP_LIMIT',
        remainingFollowups: 0,
        followupLimit: limits.followupLimit,
      };
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO message_requests(request_id, thread_id, user_message, created_at_ms)
       VALUES (?, ?, ?, ?)`,
      input.requestId,
      input.threadId,
      message,
      Date.now(),
    );

    return {
      ok: true,
      idempotent: false,
      sessionId: thread.session_id,
      questionId: Number(thread.question_id),
      selectedOptionId: Number(thread.selected_option_id),
      initialResponse: thread.initial_response,
      history: this.messages(thread.id),
      remainingFollowups: Math.max(0, limits.followupLimit - followups - 1),
      followupLimit: limits.followupLimit,
    };
  }

  async commitMessage(input: {
    userId: string;
    threadId: string;
    requestId: string;
    message: string;
    assistantResponse: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }): Promise<void> {
    this.assertUser(input.userId);
    const request = this.one<{ assistant_response: string | null }>(
      'SELECT assistant_response FROM message_requests WHERE request_id = ? AND thread_id = ?',
      input.requestId,
      input.threadId,
    );
    if (!request) throw new Error('DEEP_DIVE_MESSAGE_REQUEST_NOT_FOUND');
    if (request.assistant_response) return;

    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'INSERT INTO messages(thread_id, role, content, created_at_ms) VALUES (?, ?, ?, ?)',
        input.threadId,
        'user',
        input.message,
        now,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO messages(thread_id, role, content, created_at_ms) VALUES (?, ?, ?, ?)',
        input.threadId,
        'assistant',
        input.assistantResponse,
        now + 1,
      );
      this.ctx.storage.sql.exec(
        `UPDATE message_requests
         SET assistant_response = ?, model = ?, input_tokens = ?, output_tokens = ?, latency_ms = ?
         WHERE request_id = ?`,
        input.assistantResponse,
        input.model,
        input.inputTokens,
        input.outputTokens,
        input.latencyMs,
        input.requestId,
      );
      this.ctx.storage.sql.exec(
        'UPDATE threads SET updated_at_ms = ? WHERE id = ?',
        now,
        input.threadId,
      );
    });
  }

  async failMessage(input: { userId: string; requestId: string }): Promise<void> {
    this.assertUser(input.userId);
    this.ctx.storage.sql.exec(
      'DELETE FROM message_requests WHERE request_id = ? AND assistant_response IS NULL',
      input.requestId,
    );
  }

  async adminSnapshot(input: {
    userId: string;
    defaultDailyLimit: number;
    defaultFollowupLimit: number;
  }): Promise<Record<string, unknown>> {
    this.assertUser(input.userId);
    const limits = this.limits(input.defaultDailyLimit, input.defaultFollowupLimit);
    const dayKey = utcDayKey();
    const used = this.usage(dayKey);
    const threadCount = Number(
      this.one<{ count: number }>('SELECT COUNT(*) AS count FROM threads')?.count ?? 0,
    );
    const followupCount = Number(
      this.one<{ count: number }>(
        `SELECT COUNT(*) AS count FROM messages WHERE role = 'user'`,
      )?.count ?? 0,
    );
    const override = this.one<{
      daily_limit: number;
      followup_limit: number;
      expires_at_ms: number | null;
      updated_at_ms: number;
    }>(
      'SELECT daily_limit, followup_limit, expires_at_ms, updated_at_ms FROM entitlement WHERE id = 1',
    );

    return {
      ok: true,
      dayKey,
      usedToday: used,
      remainingToday: Math.max(0, limits.dailyLimit - used),
      dailyLimit: limits.dailyLimit,
      followupLimit: limits.followupLimit,
      totalThreads: threadCount,
      totalFollowups: followupCount,
      override: override
        ? {
            dailyLimit: Number(override.daily_limit),
            followupLimit: Number(override.followup_limit),
            expiresAtMs: override.expires_at_ms == null ? null : Number(override.expires_at_ms),
            updatedAtMs: Number(override.updated_at_ms),
          }
        : null,
    };
  }

  async clearEntitlement(input: { userId: string }): Promise<void> {
    this.assertUser(input.userId);
    this.ctx.storage.sql.exec('DELETE FROM entitlement WHERE id = 1');
  }

  async setEntitlement(input: {
    userId: string;
    dailyLimit: number;
    followupLimit: number;
    expiresAtMs: number | null;
  }): Promise<void> {
    this.assertUser(input.userId);
    this.ctx.storage.sql.exec(
      `INSERT INTO entitlement(id, daily_limit, followup_limit, expires_at_ms, updated_at_ms)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         daily_limit = excluded.daily_limit,
         followup_limit = excluded.followup_limit,
         expires_at_ms = excluded.expires_at_ms,
         updated_at_ms = excluded.updated_at_ms`,
      input.dailyLimit,
      input.followupLimit,
      input.expiresAtMs,
      Date.now(),
    );
  }
}
