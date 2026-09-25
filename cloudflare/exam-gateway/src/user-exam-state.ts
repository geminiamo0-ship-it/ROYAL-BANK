import { DurableObject } from 'cloudflare:workers';
import { payloadHash } from './canonical';
import type { InternalGatewayRequest, QuestionSelection, SessionType } from './contracts';
import type { DeepDiveTrustedContext } from './deep-dive';
import {
  getActiveRelease,
  getBankSelectionIndex,
  getFeedback,
  getQuestion,
  type IndexedQuestion,
  type R2Feedback,
} from './r2';

const SESSION_BURST_LIMIT = 4;
const SESSION_BURST_WINDOW_MS = 10 * 60 * 1000;
const SESSION_DAILY_LIMIT = 14;
const ACTIVE_SESSION_LIMIT = 3;
const ACTIVE_LEASE_MS = 30 * 60 * 1000;
const QUESTION_BURST_LIMIT = 60;
const QUESTION_BURST_WINDOW_MS = 15 * 60 * 1000;
const QUESTION_DAILY_LIMIT = 650;
const QUESTION_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_NEW_QUESTIONS_PER_WINDOW = 3;
const PREPARED_ACCESS_GRANT_TTL_MS = 2 * 60 * 1000;

export type SessionRow = {
  id: string;
  create_request_id: string;
  create_request_hash: string;
  bank_id: number;
  session_type: SessionType;
  release_id: string;
  release_prefix: string;
  started_at: string;
  time_limit_minutes: number | null;
  deadline_at: string | null;
  suspended_at: string | null;
  completed_at: string | null;
  total_questions: number;
  version: number;
  last_active_at_ms: number;
  final_snapshot_json: string | null;
};

type AnswerRow = {
  session_id: string;
  question_id: number;
  selected_option_id: number;
  is_correct: number;
  time_spent_seconds: number;
  answered_at: string;
  revision: number;
};

type QuestionStateRow = {
  question_id: number;
  seen: number;
  incorrect: number;
  flagged: number;
};

class GatewayError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
  }
}

function trainingMode(sessionType: SessionType): boolean {
  return sessionType === 'standard' || sessionType === 'tutor';
}

function countdownMode(sessionType: SessionType): boolean {
  return sessionType === 'timed' || sessionType === 'fixed_timed' || sessionType === 'mock_exam';
}

function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

function randomTake<T>(values: T[], count: number): T[] {
  const copy = values.slice();
  const limit = Math.min(count, copy.length);
  for (let i = 0; i < limit; i += 1) {
    const j = i + randomInt(copy.length - i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, limit);
}

function metadataMatches(
  question: IndexedQuestion,
  difficulties: string[],
  categories: string[],
  topics: Array<{ category: string; topic: string }>,
): boolean {
  if (difficulties.length > 0 && !difficulties.includes(question.difficulty)) return false;
  if (categories.length === 0 && topics.length === 0) return true;
  if (categories.includes(question.category)) return true;
  return topics.some((filter) => filter.category === question.category && filter.topic === question.topic);
}

function normalizedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).sort((a, b) => a.localeCompare(b));
}

function normalizedTopics(value: unknown): Array<{ category: string; topic: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as { category: string; topic: string })
    .map((item) => ({ category: String(item.category), topic: String(item.topic) }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.topic.localeCompare(b.topic));
}

function normalizedCreatePayload(args: Record<string, unknown>) {
  return {
    bank_id: Number(args.p_bank_id),
    session_type: String(args.p_session_type),
    limit: Number(args.p_limit),
    difficulties: normalizedStringArray(args.p_difficulties),
    categories: normalizedStringArray(args.p_categories),
    topics: normalizedTopics(args.p_topics),
    question_selection: String(args.p_question_selection),
    time_limit_minutes: args.p_time_limit_minutes == null ? null : Number(args.p_time_limit_minutes),
  };
}

function normalizedSubmitPayload(args: Record<string, unknown>, withFeedback: boolean) {
  return {
    operation: withFeedback ? 'submit' : 'submitRaw',
    session_id: String(args.p_session_id),
    question_id: Number(args.p_question_id),
    selected_option_id: Number(args.p_selected_option_id),
    time_spent_seconds: Number(args.p_time_spent_seconds),
  };
}

export class UserExamState extends DurableObject<Env> {
  private readonly preparedAccessGrants = new Map<number, number>();

  private preparedAccessGrantKey(bankId: number): string {
    return `prepared-access:${bankId}`;
  }

  private async preparedAccessGrantExpiresAt(bankId: number): Promise<number> {
    const cached = this.preparedAccessGrants.get(bankId) ?? 0;
    if (cached > Date.now()) return cached;

    const stored = Number(await this.ctx.storage.get<number>(this.preparedAccessGrantKey(bankId)) ?? 0);
    if (stored > Date.now()) {
      this.preparedAccessGrants.set(bankId, stored);
      return stored;
    }

    this.preparedAccessGrants.delete(bankId);
    if (stored > 0) {
      await this.ctx.storage.delete(this.preparedAccessGrantKey(bankId));
    }
    return 0;
  }

  private async rememberPreparedAccessGrant(bankId: number): Promise<number> {
    const expiresAt = Date.now() + PREPARED_ACCESS_GRANT_TTL_MS;
    this.preparedAccessGrants.set(bankId, expiresAt);
    await this.ctx.storage.put(this.preparedAccessGrantKey(bankId), expiresAt);
    return expiresAt;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;

    const initialized = sql
      .exec<{ present: number }>(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'metadata' LIMIT 1",
      )
      .toArray()[0];

    if (!initialized) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', '2');

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          create_request_id TEXT NOT NULL UNIQUE,
          create_request_hash TEXT NOT NULL,
          bank_id INTEGER NOT NULL,
          session_type TEXT NOT NULL,
          release_id TEXT NOT NULL,
          release_prefix TEXT NOT NULL,
          started_at TEXT NOT NULL,
          time_limit_minutes INTEGER,
          deadline_at TEXT,
          suspended_at TEXT,
          completed_at TEXT,
          total_questions INTEGER NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          last_active_at_ms INTEGER NOT NULL,
          final_snapshot_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(completed_at, suspended_at, last_active_at_ms);
        CREATE INDEX IF NOT EXISTS idx_sessions_bank_active ON sessions(bank_id, completed_at);

        CREATE TABLE IF NOT EXISTS session_questions (
          session_id TEXT NOT NULL,
          question_id INTEGER NOT NULL,
          sort_order INTEGER NOT NULL,
          PRIMARY KEY (session_id, question_id),
          UNIQUE (session_id, sort_order)
        );
        CREATE INDEX IF NOT EXISTS idx_session_questions_order ON session_questions(session_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_session_questions_question ON session_questions(question_id, session_id);

        CREATE TABLE IF NOT EXISTS answers (
          session_id TEXT NOT NULL,
          question_id INTEGER NOT NULL,
          selected_option_id INTEGER NOT NULL,
          is_correct INTEGER NOT NULL,
          time_spent_seconds INTEGER NOT NULL,
          answered_at TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (session_id, question_id)
        );

        CREATE TABLE IF NOT EXISTS answer_requests (
          request_id TEXT PRIMARY KEY,
          request_hash TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS question_state (
          question_id INTEGER PRIMARY KEY,
          seen INTEGER NOT NULL DEFAULT 0,
          incorrect INTEGER NOT NULL DEFAULT 0,
          flagged INTEGER NOT NULL DEFAULT 0,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS create_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_create_events_time ON create_events(created_at_ms);

        CREATE TABLE IF NOT EXISTS question_disclosures (
          question_id INTEGER PRIMARY KEY,
          first_disclosed_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS disclosure_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          question_id INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_disclosure_events_time ON disclosure_events(created_at_ms);

        CREATE TABLE IF NOT EXISTS outbox (
          event_id TEXT PRIMARY KEY,
          session_id TEXT,
          stream_version INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          sent_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_unsent ON outbox(sent_at_ms, created_at_ms);
      `);
    } else {
      const schemaVersion = sql
        .exec<{ value: string }>("SELECT value FROM metadata WHERE key = 'schema_version' LIMIT 1")
        .toArray()[0]?.value;
      if (schemaVersion !== '2') {
        throw new Error(`UNSUPPORTED_V2_DO_SCHEMA_VERSION:${String(schemaVersion ?? 'missing')}`);
      }
    }
    this.scheduleOutboxAlarm();
  }

  private one<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T | null {
    return (this.ctx.storage.sql.exec<T>(query, ...bindings).toArray()[0] as T | undefined) ?? null;
  }

  private all<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray() as T[];
  }

  private session(sessionId: string): SessionRow {
    const row = this.one<SessionRow & Record<string, SqlStorageValue>>(
      'SELECT * FROM sessions WHERE id = ?',
      sessionId,
    );
    if (!row) throw new GatewayError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    return row as SessionRow;
  }

  private sessionQuestionIds(sessionId: string): number[] {
    return this.all<{ question_id: number }>(
      'SELECT question_id FROM session_questions WHERE session_id = ? ORDER BY sort_order',
      sessionId,
    ).map((row) => Number(row.question_id));
  }

  private questionStates(): Map<number, QuestionStateRow> {
    const rows = this.all<QuestionStateRow & Record<string, SqlStorageValue>>(
      'SELECT question_id, seen, incorrect, flagged FROM question_state',
    );
    return new Map(rows.map((row) => [Number(row.question_id), row as QuestionStateRow]));
  }

  private incompleteQuestionIds(bankId: number): Set<number> {
    const rows = this.all<{ question_id: number }>(
      `SELECT DISTINCT sq.question_id
       FROM session_questions sq
       JOIN sessions s ON s.id = sq.session_id
       WHERE s.bank_id = ? AND s.completed_at IS NULL`,
      bankId,
    );
    return new Set(rows.map((row) => Number(row.question_id)));
  }

  private suspendedQuestionIds(bankId: number): Set<number> {
    const rows = this.all<{ question_id: number }>(
      `SELECT DISTINCT sq.question_id
       FROM session_questions sq
       JOIN sessions s ON s.id = sq.session_id
       LEFT JOIN answers a ON a.session_id = sq.session_id AND a.question_id = sq.question_id
       WHERE s.bank_id = ?
         AND s.completed_at IS NULL
         AND a.question_id IS NULL`,
      bankId,
    );
    return new Set(rows.map((row) => Number(row.question_id)));
  }

  private eligibleByState(
    candidates: IndexedQuestion[],
    selection: QuestionSelection,
    bankId: number,
  ): IndexedQuestion[] {
    if (selection === 'all') return candidates;
    const states = this.questionStates();
    const incomplete = selection === 'new_only' ? this.incompleteQuestionIds(bankId) : null;
    const suspended = selection === 'suspended_only' ? this.suspendedQuestionIds(bankId) : null;

    return candidates.filter((question) => {
      const state = states.get(question.id);
      if (selection === 'new_only') return !state?.seen && !incomplete?.has(question.id);
      if (selection === 'incorrect_only') return state?.incorrect === 1;
      if (selection === 'flagged_only') return state?.flagged === 1;
      if (selection === 'suspended_only') return suspended?.has(question.id) === true;
      return false;
    });
  }

  private enforceCreateLimits(nowMs: number): void {
    const dayAgo = nowMs - 24 * 60 * 60 * 1000;
    const burstSince = nowMs - SESSION_BURST_WINDOW_MS;
    const activeSince = nowMs - ACTIVE_LEASE_MS;
    this.ctx.storage.sql.exec('DELETE FROM create_events WHERE created_at_ms < ?', dayAgo);

    const burst = Number(
      this.one<{ count: number }>('SELECT COUNT(*) AS count FROM create_events WHERE created_at_ms >= ?', burstSince)?.count ?? 0,
    );
    const daily = Number(this.one<{ count: number }>('SELECT COUNT(*) AS count FROM create_events')?.count ?? 0);
    const active = Number(
      this.one<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sessions
         WHERE completed_at IS NULL
           AND suspended_at IS NULL
           AND last_active_at_ms >= ?`,
        activeSince,
      )?.count ?? 0,
    );

    if (burst >= SESSION_BURST_LIMIT) {
      throw new GatewayError(429, 'SESSION_CREATE_RATE_LIMITED', 'Too many exam sessions created.');
    }
    if (daily >= SESSION_DAILY_LIMIT) {
      throw new GatewayError(429, 'SESSION_CREATE_DAILY_LIMIT', 'Daily exam session limit reached.');
    }
    if (active >= ACTIVE_SESSION_LIMIT) {
      throw new GatewayError(409, 'ACTIVE_SESSION_LIMIT', 'Too many active exam sessions. Resume or suspend an existing session first.');
    }
  }

  private recordDisclosures(questionIds: number[]): void {
    const unique = [...new Set(questionIds.map(Number))];
    if (unique.length === 0) return;
    const now = Date.now();

    this.ctx.storage.transactionSync(() => {
      const newIds = unique.filter((questionId) =>
        !this.one<{ present: number }>('SELECT 1 AS present FROM question_disclosures WHERE question_id = ?', questionId),
      );
      if (newIds.length === 0) return;
      if (newIds.length > MAX_NEW_QUESTIONS_PER_WINDOW) {
        throw new GatewayError(429, 'QUESTION_WINDOW_LIMIT', 'Too many new questions requested at once.');
      }

      const dailySince = now - QUESTION_DAILY_WINDOW_MS;
      const burstSince = now - QUESTION_BURST_WINDOW_MS;
      this.ctx.storage.sql.exec('DELETE FROM disclosure_events WHERE created_at_ms < ?', dailySince);
      const burst = Number(
        this.one<{ count: number }>('SELECT COUNT(*) AS count FROM disclosure_events WHERE created_at_ms >= ?', burstSince)?.count ?? 0,
      );
      const daily = Number(this.one<{ count: number }>('SELECT COUNT(*) AS count FROM disclosure_events')?.count ?? 0);
      if (burst + newIds.length > QUESTION_BURST_LIMIT) {
        throw new GatewayError(429, 'QUESTION_DISCLOSURE_RATE_LIMITED', 'Question request limit reached.');
      }
      if (daily + newIds.length > QUESTION_DAILY_LIMIT) {
        throw new GatewayError(429, 'QUESTION_DISCLOSURE_DAILY_LIMIT', 'Daily question limit reached.');
      }

      for (const questionId of newIds) {
        this.ctx.storage.sql.exec(
          'INSERT INTO question_disclosures(question_id, first_disclosed_at_ms) VALUES (?, ?)',
          questionId,
          now,
        );
        this.ctx.storage.sql.exec(
          'INSERT INTO disclosure_events(question_id, created_at_ms) VALUES (?, ?)',
          questionId,
          now,
        );
      }
    });
  }

  private flaggedQuestionIds(): number[] {
    return this.all<{ question_id: number }>(
      'SELECT question_id FROM question_state WHERE flagged = 1 ORDER BY question_id',
    ).map((row) => Number(row.question_id));
  }

  private touchSession(sessionId: string): void {
    this.ctx.storage.sql.exec(
      'UPDATE sessions SET last_active_at_ms = ? WHERE id = ? AND completed_at IS NULL',
      Date.now(),
      sessionId,
    );
  }

  private deadlineExpired(session: SessionRow, nowMs = Date.now()): boolean {
    if (!countdownMode(session.session_type) || !session.deadline_at) return false;
    const deadlineMs = Date.parse(session.deadline_at);
    return Number.isFinite(deadlineMs) && nowMs >= deadlineMs;
  }

  private insertOutbox(
    eventType: string,
    sessionId: string | null,
    streamVersion: number,
    payload: Record<string, unknown>,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO outbox(event_id, session_id, stream_version, event_type, payload_json, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      sessionId,
      streamVersion,
      eventType,
      JSON.stringify(payload),
      Date.now(),
    );
    this.scheduleOutboxAlarm();
  }

  private scheduleOutboxAlarm(delayMs = 1_000): void {
    this.ctx.waitUntil(
      Promise.resolve()
        .then(() => this.ensureOutboxAlarm(delayMs))
        .catch((error) => console.error('Failed to schedule V2 outbox alarm', error)),
    );
  }

  private async ensureOutboxAlarm(delayMs = 1_000): Promise<void> {
    const pending = this.one<{ present: number }>(
      'SELECT 1 AS present FROM outbox WHERE sent_at_ms IS NULL LIMIT 1',
    );
    if (!pending) return;

    const target = Date.now() + Math.max(0, delayMs);
    const current = await this.ctx.storage.getAlarm();
    if (current == null || current > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  private finalizeSession(sessionId: string, reason: 'user' | 'deadline'): SessionRow {
    this.ctx.storage.transactionSync(() => {
      const current = this.session(sessionId);
      if (current.completed_at) return;

      if (!trainingMode(current.session_type)) {
        const rows = this.all<{
          question_id: number;
          selected_option_id: number | null;
          is_correct: number | null;
          time_spent_seconds: number | null;
        }>(
          `SELECT sq.question_id, a.selected_option_id, a.is_correct, a.time_spent_seconds
           FROM session_questions sq
           LEFT JOIN answers a ON a.session_id = sq.session_id AND a.question_id = sq.question_id
           WHERE sq.session_id = ?
           ORDER BY sq.sort_order`,
          current.id,
        );

        for (const row of rows) {
          const incorrect = row.selected_option_id == null || Number(row.is_correct) !== 1 ? 1 : 0;
          this.ctx.storage.sql.exec(
            `INSERT INTO question_state(question_id, seen, incorrect, flagged, updated_at_ms)
             VALUES (?, 1, ?, 0, ?)
             ON CONFLICT(question_id) DO UPDATE SET
               seen = 1,
               incorrect = excluded.incorrect,
               updated_at_ms = excluded.updated_at_ms`,
            Number(row.question_id),
            incorrect,
            Date.now(),
          );
        }
      }

      const answers = this.all<{
        question_id: number;
        sort_order: number;
        selected_option_id: number | null;
        is_correct: number | null;
        time_spent_seconds: number | null;
      }>(
        `SELECT sq.question_id, sq.sort_order, a.selected_option_id, a.is_correct, a.time_spent_seconds
         FROM session_questions sq
         LEFT JOIN answers a ON a.session_id = sq.session_id AND a.question_id = sq.question_id
         WHERE sq.session_id = ?
         ORDER BY sq.sort_order`,
        current.id,
      ).map((row) => ({
        question_id: Number(row.question_id),
        sort_order: Number(row.sort_order),
        selected_option_id: row.selected_option_id == null ? null : Number(row.selected_option_id),
        is_correct: row.selected_option_id == null ? false : Number(row.is_correct) === 1,
        time_spent_seconds: Math.max(0, Number(row.time_spent_seconds || 0)),
      }));

      const completedAt = new Date().toISOString();
      const nextVersion = Number(current.version) + 1;
      const correctCount = answers.filter((answer) => answer.is_correct).length;
      const snapshot = {
        schema_version: 1,
        session_id: current.id,
        bank_id: Number(current.bank_id),
        session_type: current.session_type,
        release_id: current.release_id,
        started_at: current.started_at,
        completed_at: completedAt,
        completion_reason: reason,
        total_questions: Number(current.total_questions),
        correct_count: correctCount,
        incorrect_count: Math.max(0, Number(current.total_questions) - correctCount),
        version: nextVersion,
        answers,
      };

      this.ctx.storage.sql.exec(
        `UPDATE sessions
         SET completed_at = ?, suspended_at = NULL, version = ?, last_active_at_ms = ?, final_snapshot_json = ?
         WHERE id = ? AND completed_at IS NULL`,
        completedAt,
        nextVersion,
        Date.now(),
        JSON.stringify(snapshot),
        current.id,
      );
      this.insertOutbox('session.completed', current.id, nextVersion, snapshot);
    });
    return this.session(sessionId);
  }

  private finalizeIfExpired(session: SessionRow): SessionRow {
    if (session.completed_at || !this.deadlineExpired(session)) return session;
    return this.finalizeSession(session.id, 'deadline');
  }

  private async bootstrap(sessionId: string, requireCompleted?: boolean): Promise<Record<string, unknown>> {
    let session = this.finalizeIfExpired(this.session(sessionId));
    let completed = Boolean(session.completed_at);
    if (requireCompleted === true && !completed) {
      throw new GatewayError(409, 'SESSION_NOT_COMPLETED', 'Session is not completed.');
    }
    if (requireCompleted === false && completed) {
      throw new GatewayError(409, 'SESSION_COMPLETED', 'Session is completed.');
    }

    if (!completed && session.suspended_at) {
      this.ctx.storage.transactionSync(() => {
        const current = this.session(session.id);
        if (!current.completed_at && current.suspended_at) {
          const nextVersion = Number(current.version) + 1;
          this.ctx.storage.sql.exec(
            'UPDATE sessions SET suspended_at = NULL, last_active_at_ms = ?, version = ? WHERE id = ?',
            Date.now(),
            nextVersion,
            current.id,
          );
          this.insertOutbox('session.resumed', current.id, nextVersion, {
            session_id: current.id,
            version: nextVersion,
          });
        }
      });
      session = this.session(session.id);
      completed = Boolean(session.completed_at);
    } else if (!completed) {
      this.touchSession(session.id);
      session = this.session(session.id);
    }

    const questionIds = this.sessionQuestionIds(sessionId);
    const answerRows = this.all<AnswerRow & Record<string, SqlStorageValue>>(
      'SELECT * FROM answers WHERE session_id = ? ORDER BY answered_at, question_id',
      sessionId,
    ) as AnswerRow[];
    const answered = new Set(answerRows.map((row) => Number(row.question_id)));
    let currentIndex = Math.max(questionIds.length - 1, 0);
    for (let i = 0; i < questionIds.length; i += 1) {
      if (!answered.has(questionIds[i])) {
        currentIndex = i;
        break;
      }
    }

    let questions: unknown[] = [];
    if (questionIds.length > 0) {
      const index = completed ? 0 : currentIndex;
      const questionId = questionIds[index];
      if (!completed) this.recordDisclosures([questionId]);
      questions = [await getQuestion(this.env, session.release_prefix, questionId)];
    }

    const reveal = completed || trainingMode(session.session_type);
    const answers = await Promise.all(
      answerRows.map(async (row) => {
        let correctOptionId: number | null = null;
        if (reveal) {
          correctOptionId = (await getFeedback(this.env, session.release_prefix, Number(row.question_id))).correct_option_id;
        }
        return {
          question_id: Number(row.question_id),
          selected_option_id: Number(row.selected_option_id),
          is_correct: reveal ? Boolean(row.is_correct) : null,
          correct_option_id: reveal ? correctOptionId : null,
          time_spent_seconds: Number(row.time_spent_seconds),
          revision: Number(row.revision),
        };
      }),
    );

    return {
      status: completed ? 'completed' : 'active',
      session: {
        id: session.id,
        question_bank_id: Number(session.bank_id),
        session_type: session.session_type,
        time_limit_minutes: session.time_limit_minutes == null ? null : Number(session.time_limit_minutes),
        total_questions: Number(session.total_questions),
        is_completed: completed,
        is_suspended: Boolean(session.suspended_at),
        started_at: session.started_at,
        deadline_at: session.deadline_at,
        content_release_id: session.release_id,
        version: Number(session.version),
      },
      question_ids: questionIds,
      questions,
      answers,
      flagged_question_ids: this.flaggedQuestionIds(),
      current_index: currentIndex,
      server_now: new Date().toISOString(),
    };
  }

  private async prepare(bankId: number, bankAccessGranted: boolean | undefined): Promise<Record<string, unknown>> {
    if (bankAccessGranted !== true) {
      throw new GatewayError(403, 'QUESTION_BANK_ACCESS_DENIED', 'Question bank access denied.');
    }

    const prepareStarted = performance.now();
    const edgeTiming: Record<string, number> = {};

    const releaseStarted = performance.now();
    const active = await getActiveRelease(this.env);
    edgeTiming.do_release = performance.now() - releaseStarted;

    const indexStarted = performance.now();
    const index = await getBankSelectionIndex(this.env, active, bankId);
    edgeTiming.do_index = performance.now() - indexStarted;

    const grantExpiresAt = await this.rememberPreparedAccessGrant(bankId);
    edgeTiming.do_prepare_total = performance.now() - prepareStarted;

    return {
      ok: true,
      prepared: true,
      bank_id: bankId,
      release_id: active.release_id,
      question_count: index.questions.length,
      access_grant_expires_at: grantExpiresAt,
      __edge_timing: edgeTiming,
    };
  }

  private async create(args: Record<string, unknown>, bankAccessGranted: boolean | undefined): Promise<Record<string, unknown>> {
    const bankId = Number(args.p_bank_id);
    const preparedGrantExpiresAt = await this.preparedAccessGrantExpiresAt(bankId);
    const hasPreparedAccessGrant = preparedGrantExpiresAt > Date.now();
    if (bankAccessGranted !== true && !hasPreparedAccessGrant) {
      throw new GatewayError(428, 'QUESTION_BANK_ACCESS_REVALIDATION_REQUIRED', 'Question bank access must be revalidated.');
    }
    if (bankAccessGranted === true) {
      await this.rememberPreparedAccessGrant(bankId);
    }

    const createStarted = performance.now();
    const edgeTiming: Record<string, number> = {};
    const requestId = String(args.p_request_id);
    const hashStarted = performance.now();
    const requestHash = await payloadHash(normalizedCreatePayload(args));
    edgeTiming.do_hash = performance.now() - hashStarted;
    const existing = this.one<{ id: string; create_request_hash: string }>(
      'SELECT id, create_request_hash FROM sessions WHERE create_request_id = ?',
      requestId,
    );
    if (existing?.id) {
      if (String(existing.create_request_hash) !== requestHash) {
        throw new GatewayError(409, 'IDEMPOTENCY_KEY_REUSED', 'Create request id was reused with different arguments.');
      }
      const bootstrapStarted = performance.now();
      const replay = await this.bootstrap(String(existing.id));
      edgeTiming.do_bootstrap = performance.now() - bootstrapStarted;
      edgeTiming.do_total = performance.now() - createStarted;
      return { ...replay, __edge_timing: edgeTiming };
    }

    const releaseStarted = performance.now();
    const active = await getActiveRelease(this.env);
    edgeTiming.do_release = performance.now() - releaseStarted;
    const indexStarted = performance.now();
    const index = await getBankSelectionIndex(this.env, active, bankId);
    edgeTiming.do_index = performance.now() - indexStarted;
    const selectionStarted = performance.now();
    const filtered = index.questions.filter((question) =>
      metadataMatches(
        question,
        (args.p_difficulties as string[]) || [],
        (args.p_categories as string[]) || [],
        (args.p_topics as Array<{ category: string; topic: string }>) || [],
      ),
    );
    const eligible = this.eligibleByState(
      filtered,
      args.p_question_selection as QuestionSelection,
      bankId,
    );
    const selected = randomTake(eligible, Number(args.p_limit));
    edgeTiming.do_selection = performance.now() - selectionStarted;
    if (selected.length === 0) {
      throw new GatewayError(409, 'NO_MATCHING_QUESTIONS', 'No questions match this selection.');
    }

    const sessionType = String(args.p_session_type) as SessionType;
    const rawTimeLimit = args.p_time_limit_minutes == null ? null : Number(args.p_time_limit_minutes);
    const timeLimitMinutes = countdownMode(sessionType) && rawTimeLimit && rawTimeLimit > 0
      ? Math.floor(rawTimeLimit)
      : null;
    const proposedSessionId = crypto.randomUUID();
    const nowMs = Date.now();
    const startedAt = new Date(nowMs).toISOString();
    const deadlineAt = timeLimitMinutes == null
      ? null
      : new Date(nowMs + timeLimitMinutes * 60 * 1000).toISOString();

    const transactionStarted = performance.now();
    const outcome = this.ctx.storage.transactionSync(() => {
      const already = this.one<{ id: string; create_request_hash: string }>(
        'SELECT id, create_request_hash FROM sessions WHERE create_request_id = ?',
        requestId,
      );
      if (already?.id) {
        if (String(already.create_request_hash) !== requestHash) {
          throw new GatewayError(409, 'IDEMPOTENCY_KEY_REUSED', 'Create request id was reused with different arguments.');
        }
        return { sessionId: String(already.id), created: false };
      }

      this.enforceCreateLimits(nowMs);
      this.ctx.storage.sql.exec(
        `INSERT INTO sessions(
           id, create_request_id, create_request_hash, bank_id, session_type,
           release_id, release_prefix, started_at, time_limit_minutes, deadline_at,
           total_questions, version, last_active_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        proposedSessionId,
        requestId,
        requestHash,
        bankId,
        sessionType,
        active.release_id,
        active.prefix,
        startedAt,
        timeLimitMinutes,
        deadlineAt,
        selected.length,
        nowMs,
      );
      for (let i = 0; i < selected.length; i += 1) {
        this.ctx.storage.sql.exec(
          'INSERT INTO session_questions(session_id, question_id, sort_order) VALUES (?, ?, ?)',
          proposedSessionId,
          selected[i].id,
          i,
        );
      }
      this.ctx.storage.sql.exec('INSERT INTO create_events(created_at_ms) VALUES (?)', nowMs);
      this.insertOutbox('session.created', proposedSessionId, 1, {
        session_id: proposedSessionId,
        bank_id: bankId,
        session_type: sessionType,
        release_id: active.release_id,
        started_at: startedAt,
        deadline_at: deadlineAt,
        total_questions: selected.length,
        question_ids: selected.map((question) => question.id),
        version: 1,
      });
      return { sessionId: proposedSessionId, created: true };
    });
    edgeTiming.do_transaction = performance.now() - transactionStarted;

    const bootstrapStarted = performance.now();
    const bootstrap = await this.bootstrap(outcome.sessionId, false);
    edgeTiming.do_bootstrap = performance.now() - bootstrapStarted;
    edgeTiming.do_total = performance.now() - createStarted;
    return { ...bootstrap, __edge_timing: edgeTiming };
  }

  private async window(args: Record<string, unknown>, review: boolean): Promise<unknown[]> {
    let session = this.finalizeIfExpired(this.session(String(args.p_session_id)));
    const completed = Boolean(session.completed_at);
    if (review && !completed) throw new GatewayError(409, 'SESSION_NOT_COMPLETED', 'Session is not completed.');
    if (!review && completed) throw new GatewayError(409, 'SESSION_COMPLETED', 'Session is completed.');

    if (!review) {
      if (session.suspended_at) throw new GatewayError(409, 'SESSION_SUSPENDED', 'Resume the session before requesting questions.');
      this.touchSession(session.id);
      session = this.session(session.id);
    }

    const start = Number(args.p_start);
    const count = Number(args.p_count);
    const rows = this.all<{ question_id: number }>(
      `SELECT question_id FROM session_questions
       WHERE session_id = ? AND sort_order >= ? AND sort_order < ?
       ORDER BY sort_order`,
      session.id,
      start,
      start + count,
    );
    const questionIds = rows.map((row) => Number(row.question_id));
    if (!review) this.recordDisclosures(questionIds);
    return Promise.all(questionIds.map((questionId) => getQuestion(this.env, session.release_prefix, questionId)));
  }

  private answerPayload(row: AnswerRow, reveal: boolean, sessionVersion?: number): Record<string, unknown> {
    return {
      question_id: Number(row.question_id),
      selected_option_id: Number(row.selected_option_id),
      is_correct: reveal ? Boolean(row.is_correct) : null,
      time_spent_seconds: Number(row.time_spent_seconds),
      revision: Number(row.revision),
      ...(sessionVersion == null ? {} : { session_version: sessionVersion }),
    };
  }

  private feedbackPayload(answer: AnswerRow, feedback: R2Feedback): Record<string, unknown> {
    return {
      question_id: Number(answer.question_id),
      selected_option_id: Number(answer.selected_option_id),
      is_correct: Boolean(answer.is_correct),
      correct_option_id: Number(feedback.correct_option_id),
      explanation_html: feedback.explanation_html || '',
      option_percentages: feedback.option_percentages || {},
    };
  }

  private async submit(args: Record<string, unknown>, withFeedback: boolean): Promise<Record<string, unknown>> {
    const requestId = String(args.p_request_id);
    const requestHash = await payloadHash(normalizedSubmitPayload(args, withFeedback));
    const previous = this.one<{ request_hash: string; response_json: string }>(
      'SELECT request_hash, response_json FROM answer_requests WHERE request_id = ?',
      requestId,
    );
    if (previous?.response_json) {
      if (String(previous.request_hash) !== requestHash) {
        throw new GatewayError(409, 'IDEMPOTENCY_KEY_REUSED', 'Answer request id was reused with different arguments.');
      }
      return JSON.parse(String(previous.response_json)) as Record<string, unknown>;
    }

    let session = this.session(String(args.p_session_id));
    if (session.completed_at) throw new GatewayError(409, 'SESSION_COMPLETED', 'Session is completed.');
    if (this.deadlineExpired(session)) {
      this.finalizeSession(session.id, 'deadline');
      throw new GatewayError(409, 'EXAM_DEADLINE_EXPIRED', 'The exam deadline has expired.');
    }
    if (session.suspended_at) throw new GatewayError(409, 'SESSION_SUSPENDED', 'Resume the session before submitting answers.');

    const questionId = Number(args.p_question_id);
    const belongs = this.one<{ present: number }>(
      'SELECT 1 AS present FROM session_questions WHERE session_id = ? AND question_id = ?',
      session.id,
      questionId,
    );
    if (!belongs) throw new GatewayError(400, 'QUESTION_NOT_IN_SESSION', 'Question does not belong to session.');
    if (!this.one<{ present: number }>('SELECT 1 AS present FROM question_disclosures WHERE question_id = ?', questionId)) {
      throw new GatewayError(409, 'QUESTION_NOT_DISCLOSED', 'Question has not been disclosed to this user.');
    }

    const feedback = await getFeedback(this.env, session.release_prefix, questionId);
    const selectedOptionId = Number(args.p_selected_option_id);
    if (!Object.prototype.hasOwnProperty.call(feedback.option_percentages || {}, String(selectedOptionId))) {
      throw new GatewayError(400, 'OPTION_NOT_IN_QUESTION', 'Option does not belong to question.');
    }
    const isCorrect = selectedOptionId === Number(feedback.correct_option_id);
    const nowIso = new Date().toISOString();
    const training = trainingMode(session.session_type);

    const response = this.ctx.storage.transactionSync(() => {
      const duplicate = this.one<{ request_hash: string; response_json: string }>(
        'SELECT request_hash, response_json FROM answer_requests WHERE request_id = ?',
        requestId,
      );
      if (duplicate?.response_json) {
        if (String(duplicate.request_hash) !== requestHash) {
          throw new GatewayError(409, 'IDEMPOTENCY_KEY_REUSED', 'Answer request id was reused with different arguments.');
        }
        return JSON.parse(String(duplicate.response_json)) as Record<string, unknown>;
      }

      const currentSession = this.session(session.id);
      if (currentSession.completed_at) throw new GatewayError(409, 'SESSION_COMPLETED', 'Session is completed.');
      if (this.deadlineExpired(currentSession)) {
        throw new GatewayError(409, 'EXAM_DEADLINE_EXPIRED', 'The exam deadline has expired.');
      }

      const existing = this.one<AnswerRow & Record<string, SqlStorageValue>>(
        'SELECT * FROM answers WHERE session_id = ? AND question_id = ?',
        currentSession.id,
        questionId,
      ) as AnswerRow | null;
      if (existing && training) {
        throw new GatewayError(409, 'ANSWER_FINALIZED', 'Answer is already final for this question.');
      }

      const revision = existing ? Number(existing.revision) + 1 : 1;
      this.ctx.storage.sql.exec(
        `INSERT INTO answers(session_id, question_id, selected_option_id, is_correct, time_spent_seconds, answered_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, question_id) DO UPDATE SET
           selected_option_id = excluded.selected_option_id,
           is_correct = excluded.is_correct,
           time_spent_seconds = excluded.time_spent_seconds,
           answered_at = excluded.answered_at,
           revision = excluded.revision`,
        currentSession.id,
        questionId,
        selectedOptionId,
        isCorrect ? 1 : 0,
        Number(args.p_time_spent_seconds),
        nowIso,
        revision,
      );

      if (training) {
        this.ctx.storage.sql.exec(
          `INSERT INTO question_state(question_id, seen, incorrect, flagged, updated_at_ms)
           VALUES (?, 1, ?, 0, ?)
           ON CONFLICT(question_id) DO UPDATE SET
             seen = 1,
             incorrect = excluded.incorrect,
             updated_at_ms = excluded.updated_at_ms`,
          questionId,
          isCorrect ? 0 : 1,
          Date.now(),
        );
      }

      const nextVersion = Number(currentSession.version) + 1;
      this.ctx.storage.sql.exec(
        'UPDATE sessions SET version = ?, last_active_at_ms = ? WHERE id = ?',
        nextVersion,
        Date.now(),
        currentSession.id,
      );

      const answer: AnswerRow = {
        session_id: currentSession.id,
        question_id: questionId,
        selected_option_id: selectedOptionId,
        is_correct: isCorrect ? 1 : 0,
        time_spent_seconds: Number(args.p_time_spent_seconds),
        answered_at: nowIso,
        revision,
      };
      const rawAnswer = this.answerPayload(answer, training, nextVersion);
      const result = withFeedback
        ? {
            answer: rawAnswer,
            feedback: training ? this.feedbackPayload(answer, feedback) : null,
            feedback_pending: !training,
          }
        : rawAnswer;

      this.ctx.storage.sql.exec(
        'INSERT INTO answer_requests(request_id, request_hash, response_json, created_at_ms) VALUES (?, ?, ?, ?)',
        requestId,
        requestHash,
        JSON.stringify(result),
        Date.now(),
      );
      this.insertOutbox(training ? 'answer.finalized' : 'answer.saved', currentSession.id, nextVersion, {
        session_id: currentSession.id,
        question_id: questionId,
        selected_option_id: selectedOptionId,
        is_correct: training ? isCorrect : null,
        time_spent_seconds: Number(args.p_time_spent_seconds),
        revision,
        version: nextVersion,
      });
      return result;
    });

    session = this.session(session.id);
    return response;
  }

  private async feedback(args: Record<string, unknown>, kind: 'feedback' | 'reviewFeedback' | 'trainingFeedback'): Promise<Record<string, unknown>> {
    const session = this.finalizeIfExpired(this.session(String(args.p_session_id)));
    const questionId = Number(args.p_question_id);
    const completed = Boolean(session.completed_at);
    const training = trainingMode(session.session_type);
    if (kind === 'reviewFeedback' && !completed) throw new GatewayError(409, 'SESSION_NOT_COMPLETED', 'Session is not completed.');
    if (kind !== 'reviewFeedback' && !completed && !training) {
      throw new GatewayError(403, 'FEEDBACK_LOCKED', 'Feedback is unavailable until End Block.');
    }
    const belongs = this.one<{ present: number }>(
      'SELECT 1 AS present FROM session_questions WHERE session_id = ? AND question_id = ?',
      session.id,
      questionId,
    );
    if (!belongs) throw new GatewayError(400, 'QUESTION_NOT_IN_SESSION', 'Question does not belong to session.');
    const feedback = await getFeedback(this.env, session.release_prefix, questionId);

    if (kind === 'trainingFeedback') {
      return {
        question_id: questionId,
        correct_option_id: feedback.correct_option_id,
        explanation_html: feedback.explanation_html,
        option_percentages: feedback.option_percentages,
      };
    }
    const answer = this.one<AnswerRow & Record<string, SqlStorageValue>>(
      'SELECT * FROM answers WHERE session_id = ? AND question_id = ?',
      session.id,
      questionId,
    ) as AnswerRow | null;
    if (!answer) throw new GatewayError(409, 'QUESTION_NOT_ANSWERED', 'Question has not been answered.');
    return this.feedbackPayload(answer, feedback);
  }

  private setFlag(args: Record<string, unknown>): Record<string, unknown> {
    const questionId = Number(args.p_question_id);
    const flagged = args.p_flagged === true ? 1 : 0;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO question_state(question_id, seen, incorrect, flagged, updated_at_ms)
         VALUES (?, 0, 0, ?, ?)
         ON CONFLICT(question_id) DO UPDATE SET flagged = excluded.flagged, updated_at_ms = excluded.updated_at_ms`,
        questionId,
        flagged,
        Date.now(),
      );
      this.insertOutbox('question.flagged', null, 0, {
        question_id: questionId,
        flagged: flagged === 1,
      });
    });
    return { question_id: questionId, flagged: flagged === 1 };
  }

  private suspend(args: Record<string, unknown>): Record<string, unknown> {
    const session = this.finalizeIfExpired(this.session(String(args.p_session_id)));
    if (session.completed_at) return { ok: true, session_id: session.id, completed: true };
    if (session.suspended_at) return { ok: true, session_id: session.id, suspended: true };

    this.ctx.storage.transactionSync(() => {
      const current = this.session(session.id);
      if (current.completed_at || current.suspended_at) return;
      const nextVersion = Number(current.version) + 1;
      const suspendedAt = new Date().toISOString();
      this.ctx.storage.sql.exec(
        'UPDATE sessions SET suspended_at = ?, version = ?, last_active_at_ms = ? WHERE id = ?',
        suspendedAt,
        nextVersion,
        Date.now(),
        current.id,
      );
      this.insertOutbox('session.suspended', current.id, nextVersion, {
        session_id: current.id,
        suspended_at: suspendedAt,
        version: nextVersion,
      });
    });
    return { ok: true, session_id: session.id, suspended: true };
  }

  private resume(args: Record<string, unknown>): Record<string, unknown> {
    const session = this.finalizeIfExpired(this.session(String(args.p_session_id)));
    if (session.completed_at) return { ok: true, session_id: session.id, completed: true };
    if (!session.suspended_at) {
      this.touchSession(session.id);
      return { ok: true, session_id: session.id, suspended: false };
    }

    this.ctx.storage.transactionSync(() => {
      const current = this.session(session.id);
      if (current.completed_at || !current.suspended_at) return;
      const nextVersion = Number(current.version) + 1;
      this.ctx.storage.sql.exec(
        'UPDATE sessions SET suspended_at = NULL, version = ?, last_active_at_ms = ? WHERE id = ?',
        nextVersion,
        Date.now(),
        current.id,
      );
      this.insertOutbox('session.resumed', current.id, nextVersion, {
        session_id: current.id,
        version: nextVersion,
      });
    });
    return { ok: true, session_id: session.id, suspended: false };
  }

  private complete(args: Record<string, unknown>): Record<string, unknown> {
    const session = this.session(String(args.p_session_id));
    const completed = session.completed_at
      ? session
      : this.finalizeSession(session.id, this.deadlineExpired(session) ? 'deadline' : 'user');
    return {
      ok: true,
      session_id: completed.id,
      completed_at: completed.completed_at,
      version: Number(completed.version),
    };
  }

  async getDeepDiveContext(input: {
    userId: string;
    sessionId: string;
    questionId: number;
  }): Promise<DeepDiveTrustedContext> {
    const objectUserId = this.ctx.id.name;
    if (!objectUserId || objectUserId !== input.userId) {
      throw new GatewayError(403, 'USER_SHARD_MISMATCH', 'Invalid user shard.');
    }

    const session = this.finalizeIfExpired(this.session(input.sessionId));
    const completed = Boolean(session.completed_at);
    const training = trainingMode(session.session_type);
    if (!completed && !training) {
      throw new GatewayError(403, 'FEEDBACK_LOCKED', 'Deep Dive is unavailable until End Block.');
    }

    const belongs = this.one<{ present: number }>(
      'SELECT 1 AS present FROM session_questions WHERE session_id = ? AND question_id = ?',
      session.id,
      input.questionId,
    );
    if (!belongs) {
      throw new GatewayError(400, 'QUESTION_NOT_IN_SESSION', 'Question does not belong to session.');
    }

    const answer = this.one<AnswerRow & Record<string, SqlStorageValue>>(
      'SELECT * FROM answers WHERE session_id = ? AND question_id = ?',
      session.id,
      input.questionId,
    ) as AnswerRow | null;
    if (!answer) {
      throw new GatewayError(409, 'QUESTION_NOT_ANSWERED', 'Answer the question before using Deep Dive.');
    }

    const [question, feedback] = await Promise.all([
      getQuestion(this.env, session.release_prefix, input.questionId),
      getFeedback(this.env, session.release_prefix, input.questionId),
    ]);

    const selectedOptionId = Number(answer.selected_option_id);
    const correctOptionId = Number(feedback.correct_option_id);
    if (!question.options.some((option) => option.id === selectedOptionId)) {
      throw new GatewayError(409, 'DEEP_DIVE_SELECTED_OPTION_MISSING', 'Selected answer is unavailable.');
    }
    if (!question.options.some((option) => option.id === correctOptionId)) {
      throw new GatewayError(409, 'DEEP_DIVE_CORRECT_OPTION_MISSING', 'Correct answer is unavailable.');
    }

    return {
      sessionId: session.id,
      questionId: input.questionId,
      releaseId: session.release_id,
      releasePrefix: session.release_prefix,
      sessionType: session.session_type,
      stemHtml: question.text_html || '',
      options: question.options.map((option) => ({
        id: Number(option.id),
        text_html: option.text_html || '',
        option_order: Number(option.option_order),
      })),
      selectedOptionId,
      correctOptionId,
      explanationHtml: feedback.explanation_html || '',
      category: question.category || '',
      topic: question.topic || null,
      difficulty: question.difficulty || '',
    };
  }

  async alarm(): Promise<void> {
    const pending = this.all<{
      event_id: string;
      session_id: string | null;
      stream_version: number;
      event_type: string;
      payload_json: string;
      created_at_ms: number;
    }>(
      `SELECT event_id, session_id, stream_version, event_type, payload_json, created_at_ms
       FROM outbox
       WHERE sent_at_ms IS NULL
       ORDER BY created_at_ms, event_id
       LIMIT 10`,
    );

    if (pending.length === 0) return;
    const userId = this.ctx.id.name;
    if (!userId) {
      console.error('V2 outbox cannot resolve named Durable Object user id');
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      return;
    }

    const messages = pending.map((row) => {
      const parsed = JSON.parse(String(row.payload_json)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid V2 outbox payload for ${String(row.event_id)}`);
      }
      return {
        body: {
          event_id: String(row.event_id),
          user_id: userId,
          session_id: row.session_id == null ? null : String(row.session_id),
          stream_version: Number(row.stream_version),
          event_type: String(row.event_type),
          payload: parsed as Record<string, unknown>,
          occurred_at: new Date(Number(row.created_at_ms)).toISOString(),
        },
      };
    });

    try {
      await this.env.EXAM_SYNC_QUEUE.sendBatch(messages);
    } catch (error) {
      console.error('V2 outbox queue publish failed', error);
      await this.ctx.storage.setAlarm(Date.now() + 5_000);
      return;
    }

    const sentAt = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const row of pending) {
        this.ctx.storage.sql.exec(
          'UPDATE outbox SET sent_at_ms = ? WHERE event_id = ? AND sent_at_ms IS NULL',
          sentAt,
          String(row.event_id),
        );
      }
      this.ctx.storage.sql.exec(
        'DELETE FROM outbox WHERE sent_at_ms IS NOT NULL AND sent_at_ms < ?',
        sentAt - 7 * 24 * 60 * 60 * 1000,
      );
    });

    const more = this.one<{ present: number }>(
      'SELECT 1 AS present FROM outbox WHERE sent_at_ms IS NULL LIMIT 1',
    );
    if (more) await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  async handle(input: InternalGatewayRequest): Promise<unknown> {
    const objectUserId = this.ctx.id.name;
    if (!objectUserId || objectUserId !== input.userId) {
      throw new GatewayError(403, 'USER_SHARD_MISMATCH', 'Invalid user shard.');
    }

    switch (input.action) {
      case 'prepare':
        return this.prepare(Number(input.args.p_bank_id), input.bankAccessGranted);
      case 'create':
        return this.create(input.args, input.bankAccessGranted);
      case 'bootstrap':
        return this.bootstrap(String(input.args.p_session_id));
      case 'reviewBootstrap':
        return this.bootstrap(String(input.args.p_session_id), true);
      case 'window':
        return this.window(input.args, false);
      case 'reviewWindow':
        return this.window(input.args, true);
      case 'submit':
        return this.submit(input.args, true);
      case 'submitRaw':
        return this.submit(input.args, false);
      case 'feedback':
      case 'reviewFeedback':
      case 'trainingFeedback':
        return this.feedback(input.args, input.action);
      case 'flag':
        return this.setFlag(input.args);
      case 'suspend':
        return this.suspend(input.args);
      case 'resume':
        return this.resume(input.args);
      case 'complete':
        return this.complete(input.args);
      case 'renewWindowAccess':
        return { window_access_token: null, window_access_expires_at: null, server_now: new Date().toISOString() };
      default:
        throw new GatewayError(400, 'INVALID_EXAM_ACTION', 'Invalid exam action.');
    }
  }
}
