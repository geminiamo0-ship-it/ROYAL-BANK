import { createHash, createHmac } from 'node:crypto';

const EXPECTED_SUPABASE_URL = 'https://trnvsgenmzhyuayxxdoq.supabase.co';
const EXPECTED_BUCKET = 'royal-bank-exam-production-content';
const ROOT = 'exam-content-v2';
const SOURCE = 'ROYAL-BANK-PRODUCTION';
const PAGE_SIZE = 1000;
const CONCURRENCY = 24;

function required(name) {
  const value = process.env[name]?.trim() || '';
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
const supabaseKey = required('SUPABASE_SECRET_KEY');
const accountId = required('R2_ACCOUNT_ID');
const accessKeyId = required('R2_ACCESS_KEY_ID');
const secretAccessKey = required('R2_SECRET_ACCESS_KEY');
const bucket = required('R2_BUCKET_NAME');

if (supabaseUrl !== EXPECTED_SUPABASE_URL) {
  throw new Error(`Refusing export: expected Production Supabase ${EXPECTED_SUPABASE_URL}, got ${supabaseUrl}`);
}
if (!supabaseKey.startsWith('sb_secret_') && !supabaseKey.startsWith('eyJ')) {
  throw new Error('SUPABASE_SECRET_KEY does not look like a Supabase secret/service-role key.');
}
if (bucket !== EXPECTED_BUCKET) {
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
  if (!response.ok) throw new Error(`R2 GET ${key} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
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
  if (!response.ok) throw new Error(`R2 PUT ${key} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return 'uploaded';
}

async function putMutable(key, raw) {
  const signed = signedRequest('PUT', key, raw);
  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: { ...signed.headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: raw,
  });
  if (!response.ok) throw new Error(`R2 PUT ${key} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
}

async function fetchAll(table, select, order = 'id.asc') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', select);
    url.searchParams.set('order', order);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        accept: 'application/json',
        'user-agent': 'royal-bank-production-release-sync/1.0',
      },
    });
    if (!response.ok) throw new Error(`Production Supabase export ${table} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Invalid ${table} response`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function mapConcurrent(items, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

console.log('Exporting immutable exam content from Production Supabase...');
const [questions, options, memberships] = await Promise.all([
  fetchAll('questions', 'id,text_html,explanation_html,category,topic,difficulty,notes_id,concept_id'),
  fetchAll('options', 'id,question_id,text_html,option_order,is_correct,percentage', 'question_id.asc,option_order.asc,id.asc'),
  fetchAll('question_bank_questions', 'question_bank_id,question_id', 'question_bank_id.asc,question_id.asc'),
]);

if (questions.length === 0 || memberships.length === 0) {
  throw new Error('Production export returned no questions or bank memberships; refusing to activate an empty release.');
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

let uploaded = 0;
let reused = 0;
await mapConcurrent([...canonical.entries()], async ([questionId, object]) => {
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
