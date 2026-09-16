export type ActiveRelease = {
  schema_version: number;
  release_id: string;
  prefix: string;
  manifest_sha256?: string;
};

export type IndexedQuestion = {
  id: number;
  difficulty: string;
  category: string;
  topic: string | null;
};

export type BankSelectionIndex = {
  schema_version: 1;
  release_id: string;
  bank_id: number;
  questions: IndexedQuestion[];
};

export type R2Question = {
  id: number;
  text_html: string;
  category: string;
  topic: string | null;
  difficulty: string;
  notes_id: string | null;
  concept_id: string | null;
  options: Array<{
    id: number;
    question_id: number;
    text_html: string;
    option_order: number;
  }>;
};

export type R2Feedback = {
  question_id: number;
  correct_option_id: number;
  option_percentages: Record<string, number>;
  explanation_html: string;
};

const ACTIVE_RELEASE_CACHE_TTL_MS = 30_000;
const MAX_SELECTION_INDEX_CACHE_ENTRIES = 64;

let activeReleaseCache: { value: ActiveRelease; expiresAt: number } | null = null;
let activeReleaseInFlight: Promise<ActiveRelease> | null = null;
const selectionIndexCache = new Map<string, BankSelectionIndex>();
const selectionIndexInFlight = new Map<string, Promise<BankSelectionIndex>>();

function root(env: Env): string {
  return (env.EXAM_CONTENT_ROOT || 'exam-content-v2').replace(/^\/+|\/+$/g, '');
}

async function jsonObject<T>(bucket: R2Bucket, key: string): Promise<T> {
  const object = await bucket.get(key);
  if (!object) throw new Error(`R2_OBJECT_MISSING:${key}`);
  return object.json<T>();
}

function validateActiveRelease(active: ActiveRelease): ActiveRelease {
  if (!/^[0-9a-f]{64}$/.test(active.release_id || '') || !active.prefix) {
    throw new Error('INVALID_ACTIVE_RELEASE');
  }
  return active;
}

export async function getActiveRelease(env: Env): Promise<ActiveRelease> {
  const now = Date.now();
  if (activeReleaseCache && activeReleaseCache.expiresAt > now) {
    return activeReleaseCache.value;
  }
  if (activeReleaseInFlight) return activeReleaseInFlight;

  const request = jsonObject<ActiveRelease>(env.EXAM_CONTENT, `${root(env)}/active.json`)
    .then(validateActiveRelease)
    .then((active) => {
      activeReleaseCache = {
        value: active,
        expiresAt: Date.now() + ACTIVE_RELEASE_CACHE_TTL_MS,
      };
      return active;
    })
    .finally(() => {
      if (activeReleaseInFlight === request) activeReleaseInFlight = null;
    });

  activeReleaseInFlight = request;
  return request;
}

function rememberSelectionIndex(key: string, index: BankSelectionIndex): void {
  if (selectionIndexCache.has(key)) selectionIndexCache.delete(key);
  selectionIndexCache.set(key, index);
  while (selectionIndexCache.size > MAX_SELECTION_INDEX_CACHE_ENTRIES) {
    const oldest = selectionIndexCache.keys().next().value as string | undefined;
    if (!oldest) break;
    selectionIndexCache.delete(oldest);
  }
}

export async function getBankSelectionIndex(
  env: Env,
  active: ActiveRelease,
  bankId: number,
): Promise<BankSelectionIndex> {
  const key = `${active.release_id}:${bankId}`;
  const cached = selectionIndexCache.get(key);
  if (cached) {
    selectionIndexCache.delete(key);
    selectionIndexCache.set(key, cached);
    return cached;
  }

  const existing = selectionIndexInFlight.get(key);
  if (existing) return existing;

  const request = jsonObject<BankSelectionIndex>(
    env.EXAM_CONTENT,
    `${active.prefix}/selection/banks/${bankId}.json`,
  )
    .then((index) => {
      if (
        index.release_id !== active.release_id ||
        index.bank_id !== bankId ||
        !Array.isArray(index.questions)
      ) {
        throw new Error('INVALID_SELECTION_INDEX');
      }
      rememberSelectionIndex(key, index);
      return index;
    })
    .finally(() => {
      if (selectionIndexInFlight.get(key) === request) {
        selectionIndexInFlight.delete(key);
      }
    });

  selectionIndexInFlight.set(key, request);
  return request;
}

export async function getQuestion(env: Env, prefix: string, questionId: number): Promise<R2Question> {
  return jsonObject<R2Question>(env.EXAM_CONTENT, `${prefix}/questions/${questionId}.json`);
}

export async function getFeedback(env: Env, prefix: string, questionId: number): Promise<R2Feedback> {
  return jsonObject<R2Feedback>(env.EXAM_CONTENT, `${prefix}/feedback/${questionId}.json`);
}
