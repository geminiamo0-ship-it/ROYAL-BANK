import { createHash, createHmac } from 'node:crypto';

const EXPECTED_PROJECT_REF = 'trnvsgenmzhyuayxxdoq';
const EXPECTED_SUPABASE_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
const EXPECTED_BUCKET = 'royal-bank-exam-production-content';
const ROOT = 'exam-content-v2';
const SOURCE = 'ROYAL-BANK-PRODUCTION';
const UI_ROOT = 'ui-static-v1';
const PAGE_SIZE = 1000;
const CONCURRENCY = 24;
const EXPORT_RETRY_DELAYS_MS = [750, 1500, 3000, 6000];
const args = new Set(process.argv.slice(2));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dryRun = args.has('--dry-run');

function required(name, { allowEmptyInDryRun = false } = {}) {
  const value = process.env[name]?.trim() || '';
  if (!value && !(dryRun && allowEmptyInDryRun)) throw new Error(`Missing ${name}`);
  return value;
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
if (supabaseUrl !== EXPECTED_SUPABASE_URL) {
  throw new Error(`Refusing export: expected Production Supabase ${EXPECTED_SUPABASE_URL}, got ${supabaseUrl}`);
}

const supabaseKey = required('SUPABASE_SECRET_KEY');
const accountId = required('R2_ACCOUNT_ID', { allowEmptyInDryRun: true });
const expectedAccountId = required('EXPECTED_R2_ACCOUNT_ID', { allowEmptyInDryRun: true });
const accessKeyId = required('R2_ACCESS_KEY_ID', { allowEmptyInDryRun: true });
const secretAccessKey = required('R2_SECRET_ACCESS_KEY', { allowEmptyInDryRun: true });
const bucket = required('R2_BUCKET_NAME', { allowEmptyInDryRun: true });

if (!dryRun && accountId !== expectedAccountId) {
  throw new Error('Refusing R2 write: R2_ACCOUNT_ID does not match CLOUDFLARE_ACCOUNT_ID');
}
if (!dryRun && bucket !== EXPECTED_BUCKET) {
  throw new Error(`Refusing R2 write: expected ${EXPECTED_BUCKET}, got ${bucket}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalObjectPath(key) {
  const normalized = key.split('/').filter(Boolean).map(encodeRfc3986).join('/');
  return `/${encodeRfc3986(bucket)}/${normalized}`;
}

function amzTimestamp(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function signedRequest(method, key, body = '') {
  const canonicalUri = canonicalObjectPath(key);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const amzDate = amzTimestamp(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  };
}

async function getR2(key) {
  const signed = signedRequest('GET', key);
  const response = await fetch(signed.url, { headers: signed.headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 GET ${key} failed (${response.status})`);
  return response.text();
}

async function putImmutable(key, raw) {
  const existing = await getR2(key);
  if (existing != null) {
    if (sha256(existing) !== sha256(raw)) throw new Error(`Immutable collision at ${key}`);
    return 'reused';
  }
  const signed = signedRequest('PUT', key, raw);
  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: { ...signed.headers, 'content-type': 'application/json; charset=utf-8' },
    body: raw,
  });
  if (!response.ok) throw new Error(`R2 PUT ${key} failed (${response.status})`);
  return 'uploaded';
}

async function putMutable(key, raw) {
  const signed = signedRequest('PUT', key, raw);
  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: { ...signed.headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: raw,
  });
  if (!response.ok) throw new Error(`R2 PUT ${key} failed (${response.status})`);
}

async function fetchAll(table, select, order = 'id.asc') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', select);
    url.searchParams.set('order', order);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    let page = null;
    for (let attempt = 0; attempt <= EXPORT_RETRY_DELAYS_MS.length; attempt += 1) {
      const response = await fetch(url, {
        headers: {
          apikey: supabaseKey,
          accept: 'application/json',
          'user-agent': 'royal-bank-production-release-sync/1.0',
        },
      });

      if (response.ok) {
        page = await response.json();
        break;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= EXPORT_RETRY_DELAYS_MS.length) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(
          `Production Supabase export ${table} failed (${response.status}) at offset ${offset}: ${detail}`,
        );
      }

      const delay = EXPORT_RETRY_DELAYS_MS[attempt];
      console.warn(
        `Production Supabase export ${table} returned ${response.status} at offset ${offset}; retrying in ${delay}ms`,
      );
      await sleep(delay);
    }

    if (!Array.isArray(page)) throw new Error(`Invalid ${table} response`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function mapConcurrent(items, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

console.log('Exporting edge content from Production Supabase...');
const [questions, options, memberships] = await Promise.all([
  fetchAll('questions', 'id,text_html,explanation_html,category,topic,difficulty,notes_id,concept_id'),
  fetchAll('options', 'id,question_id,text_html,option_order,is_correct,percentage', 'question_id.asc,option_order.asc,id.asc'),
  fetchAll('question_bank_questions', 'question_bank_id,question_id', 'question_bank_id.asc,question_id.asc'),
]);

// Keep the heavier exam export isolated from the small UI metadata reads so
// Supabase Nano is not asked to serve six release exports concurrently.
const [pathways, bankCatalog, libraryArticles] = await Promise.all([
  fetchAll('pathways', 'id,slug,name,description,icon_url,is_free_trial_available,display_order', 'display_order.asc,id.asc'),
  fetchAll('question_banks', 'id,pathway_id,name,description,display_order,is_free_trial,free_trial_block_limit,free_trial_question_limit,free_trial_article_limit', 'display_order.asc,id.asc'),
  fetchAll('library_articles', 'id,name,category,topic,content_html', 'id.asc'),
]);

const libraryMappings = await fetchAll(
  'question_bank_library_articles',
  'question_bank_id,article_id,display_order',
  'question_bank_id.asc,display_order.asc,article_id.asc',
);
const [contentTopics, questionTopics, topicLibraryArticles] = await Promise.all([
  fetchAll('content_topics', 'id,question_bank_id,name,category,display_order', 'question_bank_id.asc,display_order.asc,id.asc'),
  fetchAll('question_topics', 'question_bank_id,question_id,topic_id', 'question_bank_id.asc,topic_id.asc,question_id.asc'),
  fetchAll('topic_library_articles', 'question_bank_id,topic_id,article_id,is_primary,display_order', 'question_bank_id.asc,topic_id.asc,display_order.asc,article_id.asc'),
]);

if (questions.length === 0 || options.length === 0 || memberships.length === 0) {
  throw new Error('Refusing release: Production export is unexpectedly empty');
}

const optionsByQuestion = new Map();
for (const option of options) {
  const questionId = Number(option.question_id);
  const list = optionsByQuestion.get(questionId) || [];
  list.push({
    id: Number(option.id),
    question_id: questionId,
    text_html: String(option.text_html ?? ''),
    option_order: Number(option.option_order),
    is_correct: option.is_correct === true,
    percentage: Number(option.percentage ?? 0),
  });
  optionsByQuestion.set(questionId, list);
}

const canonical = new Map();
for (const row of questions) {
  const id = Number(row.id);
  const sourceOptions = (optionsByQuestion.get(id) || []).sort((a, b) => a.option_order - b.option_order || a.id - b.id);
  const correct = sourceOptions.filter((option) => option.is_correct);
  if (correct.length !== 1 || sourceOptions.length === 0) throw new Error(`Question ${id} does not have exactly one correct option`);
  const question = {
    id,
    text_html: String(row.text_html ?? ''),
    category: String(row.category ?? ''),
    topic: row.topic == null ? null : String(row.topic),
    difficulty: String(row.difficulty ?? '1'),
    notes_id: row.notes_id == null ? null : String(row.notes_id),
    concept_id: row.concept_id == null ? null : String(row.concept_id),
    options: sourceOptions.map(({ is_correct, percentage, ...safe }) => safe),
  };
  const feedback = {
    question_id: id,
    correct_option_id: correct[0].id,
    option_percentages: Object.fromEntries(sourceOptions.map((option) => [String(option.id), option.percentage])),
    explanation_html: String(row.explanation_html ?? ''),
  };
  const questionRaw = JSON.stringify(question);
  const feedbackRaw = JSON.stringify(feedback);
  canonical.set(id, {
    question,
    questionRaw,
    feedbackRaw,
    questionSha256: sha256(questionRaw),
    feedbackSha256: sha256(feedbackRaw),
  });
}

const membershipsByBank = new Map();
for (const membership of memberships) {
  const bankId = Number(membership.question_bank_id);
  const questionId = Number(membership.question_id);
  const list = membershipsByBank.get(bankId) || [];
  list.push(questionId);
  membershipsByBank.set(bankId, list);
}

const bankDescriptors = [];
for (const [bankId, questionIds] of [...membershipsByBank.entries()].sort((a, b) => a[0] - b[0])) {
  const metadata = questionIds.map((questionId) => {
    const object = canonical.get(questionId);
    if (!object) throw new Error(`Bank ${bankId} references missing question ${questionId}`);
    return {
      id: questionId,
      difficulty: object.question.difficulty,
      category: object.question.category,
      topic: object.question.topic,
    };
  });
  bankDescriptors.push({ bank_id: bankId, questions: metadata, metadata_sha256: sha256(JSON.stringify(metadata)) });
}

const releaseDescriptor = {
  schema_version: 1,
  source: SOURCE,
  question_count: canonical.size,
  option_count: options.length,
  membership_count: memberships.length,
  objects: [...canonical.entries()].sort((a, b) => a[0] - b[0]).map(([questionId, object]) => ({
    question_id: questionId,
    question_sha256: object.questionSha256,
    feedback_sha256: object.feedbackSha256,
  })),
  banks: bankDescriptors.map(({ bank_id, metadata_sha256, questions: bankQuestions }) => ({
    bank_id,
    question_count: bankQuestions.length,
    metadata_sha256,
  })),
};

const releaseId = sha256(JSON.stringify(releaseDescriptor));
const releasePrefix = `${ROOT}/releases/${releaseId}`;
const bankIndexes = bankDescriptors.map((bank) => ({
  key: `${releasePrefix}/selection/banks/${bank.bank_id}.json`,
  raw: JSON.stringify({ schema_version: 1, release_id: releaseId, bank_id: bank.bank_id, questions: bank.questions }),
}));
const manifestRaw = JSON.stringify({ ...releaseDescriptor, release_id: releaseId, prefix: releasePrefix });

console.log(JSON.stringify({ releaseId, questions: canonical.size, options: options.length, memberships: memberships.length, banks: bankDescriptors.length }, null, 2));
if (dryRun) {
  console.log('Dry run complete; no R2 writes were made.');
  process.exit(0);
}

let uploaded = 0;
let reused = 0;
const objects = [...canonical.entries()];
await mapConcurrent(objects, async ([questionId, object]) => {
  for (const [key, raw] of [
    [`${releasePrefix}/questions/${questionId}.json`, object.questionRaw],
    [`${releasePrefix}/feedback/${questionId}.json`, object.feedbackRaw],
  ]) {
    const result = await putImmutable(key, raw);
    if (result === 'uploaded') uploaded += 1;
    else reused += 1;
  }
});
for (const index of bankIndexes) {
  const result = await putImmutable(index.key, index.raw);
  if (result === 'uploaded') uploaded += 1;
  else reused += 1;
}
const manifestKey = `${releasePrefix}/manifest.json`;
const manifestResult = await putImmutable(manifestKey, manifestRaw);
if (manifestResult === 'uploaded') uploaded += 1;
else reused += 1;

const catalogRaw = JSON.stringify({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  pathways,
  banks: bankCatalog,
});
await putMutable(`${UI_ROOT}/catalog/current.json`, catalogRaw);

await mapConcurrent(libraryArticles, async (article) => {
  const articleRaw = JSON.stringify({
    schema_version: 1,
    id: String(article.id),
    name: String(article.name ?? ''),
    category: article.category == null ? null : String(article.category),
    topic: article.topic == null ? null : String(article.topic),
    content_html: String(article.content_html ?? ''),
  });
  await putMutable(
    `${UI_ROOT}/library/articles/${encodeURIComponent(String(article.id))}.json`,
    articleRaw,
  );
});


const libraryById = new Map(libraryArticles.map((article) => [String(article.id), article]));
for (const bank of bankCatalog) {
  const bankId = Number(bank.id);
  const mapped = libraryMappings
    .filter((row) => Number(row.question_bank_id) === bankId)
    .map((row) => {
      const article = libraryById.get(String(row.article_id));
      if (!article) return null;
      return {
        id: String(article.id),
        name: String(article.name ?? ''),
        category: article.category == null ? null : String(article.category),
        display_order: Number(row.display_order ?? 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      a.display_order - b.display_order
      || String(a.category ?? '').localeCompare(String(b.category ?? ''))
      || a.name.localeCompare(b.name)
      || a.id.localeCompare(b.id)
    )
    .map(({ display_order, ...article }) => article);

  await putMutable(
    `${UI_ROOT}/library/catalogs/${bankId}.json`,
    JSON.stringify({ schema_version: 1, bank_id: bankId, articles: mapped }),
  );
}

const questionCountsByTopic = new Map();
for (const row of questionTopics) {
  const key = `${Number(row.question_bank_id)}:${Number(row.topic_id)}`;
  questionCountsByTopic.set(key, (questionCountsByTopic.get(key) || 0) + 1);
}

const primaryArticleByTopic = new Map();
for (const row of [...topicLibraryArticles].sort((a, b) =>
  Number(b.is_primary === true) - Number(a.is_primary === true)
  || Number(a.display_order ?? 0) - Number(b.display_order ?? 0)
  || String(a.article_id).localeCompare(String(b.article_id))
)) {
  const key = `${Number(row.question_bank_id)}:${Number(row.topic_id)}`;
  if (!primaryArticleByTopic.has(key)) primaryArticleByTopic.set(key, String(row.article_id));
}

for (const bank of bankCatalog) {
  const bankId = Number(bank.id);
  const topics = contentTopics
    .filter((topic) => Number(topic.question_bank_id) === bankId)
    .map((topic) => {
      const key = `${bankId}:${Number(topic.id)}`;
      return {
        id: Number(topic.id),
        name: String(topic.name ?? ''),
        category: String(topic.category ?? 'General') || 'General',
        display_order: Number(topic.display_order ?? 0),
        question_count: Number(questionCountsByTopic.get(key) || 0),
        article_id: primaryArticleByTopic.get(key) || null,
      };
    })
    .filter((topic) => topic.question_count > 0);

  const categories = new Map();
  for (const topic of topics) {
    const list = categories.get(topic.category) || [];
    list.push(topic);
    categories.set(topic.category, list);
  }

  const categoryPayload = [...categories.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, rows]) => ({
      name,
      topic_count: rows.length,
      topics: rows
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name) || a.id - b.id)
        .map(({ category, display_order, ...topic }) => topic),
    }));

  await putMutable(
    `${UI_ROOT}/study-plan/catalogs/${bankId}.json`,
    JSON.stringify({
      schema_version: 1,
      bank_id: bankId,
      topic_count: topics.length,
      categories: categoryPayload,
    }),
  );
}


const activeRaw = JSON.stringify({
  schema_version: 1,
  release_id: releaseId,
  prefix: releasePrefix,
  manifest_sha256: sha256(manifestRaw),
  source: SOURCE,
  activated_at: new Date().toISOString(),
});
await putMutable(`${ROOT}/active.json`, activeRaw);
const activeCheck = await getR2(`${ROOT}/active.json`);
if (!activeCheck || JSON.parse(activeCheck).release_id !== releaseId) throw new Error('Production active pointer verification failed');
console.log(`Production edge release activated: ${releaseId}; uploaded=${uploaded}; reused=${reused}`);
