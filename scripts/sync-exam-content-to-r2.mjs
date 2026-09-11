import { createHash, createHmac } from 'node:crypto';

const PAGE_SIZE = 1000;
const CONCURRENCY = 12;
const DEFAULT_PREFIX = 'exam-content/v1';
const args = new Set(process.argv.slice(2));
const verifyOnly = args.has('--verify-only');
const dryRun = args.has('--dry-run');

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

const supabaseUrl = requiredEnv('SUPABASE_URL');
const supabaseKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
const accountId = dryRun ? process.env.R2_ACCOUNT_ID?.trim() || '' : requiredEnv('R2_ACCOUNT_ID');
const accessKeyId = dryRun ? process.env.R2_ACCESS_KEY_ID?.trim() || '' : requiredEnv('R2_ACCESS_KEY_ID');
const secretAccessKey = dryRun
  ? process.env.R2_SECRET_ACCESS_KEY?.trim() || ''
  : requiredEnv('R2_SECRET_ACCESS_KEY');
const bucket = dryRun ? process.env.R2_BUCKET_NAME?.trim() || '' : requiredEnv('R2_BUCKET_NAME');
const prefix = (process.env.ROYAL_R2_CONTENT_PREFIX?.trim() || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalObjectPath(key) {
  const normalizedKey = key
    .split('/')
    .filter(Boolean)
    .map(encodeRfc3986)
    .join('/');
  return `/${encodeRfc3986(bucket)}/${normalizedKey}`;
}

function amzTimestamp(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function signedR2Request(method, key, body = '') {
  const canonicalUri = canonicalObjectPath(key);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const amzDate = amzTimestamp(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  };
}

async function r2PutJson(key, raw) {
  const signed = signedR2Request('PUT', key, raw);
  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: {
      ...signed.headers,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0, no-store',
    },
    body: raw,
  });
  if (!response.ok) throw new Error(`R2 PUT ${key} failed (${response.status}).`);
}

async function r2GetText(key) {
  const signed = signedR2Request('GET', key);
  const response = await fetch(signed.url, {
    method: 'GET',
    headers: signed.headers,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 GET ${key} failed (${response.status}).`);
  return response.text();
}

async function fetchAll(table, select, order = 'id.asc') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}`);
    url.searchParams.set('select', select);
    url.searchParams.set('order', order);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase export for ${table} failed (${response.status}).`);
    }

    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Unexpected ${table} export payload.`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function mapConcurrent(items, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function buildObjects(questions, options) {
  const optionsByQuestion = new Map();
  for (const option of options) {
    const questionId = Number(option.question_id);
    if (!Number.isSafeInteger(questionId) || questionId <= 0) {
      throw new Error(`Invalid option question_id: ${option.question_id}`);
    }
    const list = optionsByQuestion.get(questionId) || [];
    list.push({
      id: Number(option.id),
      question_id: questionId,
      text_html: String(option.text_html ?? ''),
      option_order: Number(option.option_order),
    });
    optionsByQuestion.set(questionId, list);
  }

  const objects = [];
  for (const question of questions) {
    const questionId = Number(question.id);
    if (!Number.isSafeInteger(questionId) || questionId <= 0) {
      throw new Error(`Invalid question id: ${question.id}`);
    }

    const questionOptions = (optionsByQuestion.get(questionId) || []).sort(
      (a, b) => a.option_order - b.option_order || a.id - b.id,
    );

    const questionPayload = {
      id: questionId,
      text_html: String(question.text_html ?? ''),
      category: String(question.category ?? ''),
      topic: question.topic == null ? null : String(question.topic),
      difficulty: String(question.difficulty ?? '1'),
      notes_id: question.notes_id == null ? null : String(question.notes_id),
      concept_id: question.concept_id == null ? null : String(question.concept_id),
      options: questionOptions,
    };
    const feedbackPayload = {
      question_id: questionId,
      explanation_html: String(question.explanation_html ?? ''),
    };

    const questionRaw = JSON.stringify(questionPayload);
    const feedbackRaw = JSON.stringify(feedbackPayload);
    objects.push({
      questionId,
      questionKey: `${prefix}/questions/${questionId}.json`,
      questionRaw,
      questionSha256: sha256Hex(questionRaw),
      feedbackKey: `${prefix}/feedback/${questionId}.json`,
      feedbackRaw,
      feedbackSha256: sha256Hex(feedbackRaw),
    });
  }

  return objects;
}

console.log('Exporting canonical exam content from Supabase...');
const [questions, options] = await Promise.all([
  fetchAll(
    'questions',
    'id,text_html,explanation_html,category,topic,difficulty,notes_id,concept_id',
  ),
  fetchAll('options', 'id,question_id,text_html,option_order', 'question_id.asc,option_order.asc,id.asc'),
]);

const objects = buildObjects(questions, options);
if (objects.length !== questions.length) throw new Error('Question object count mismatch.');

console.log(`Prepared ${objects.length} questions and ${options.length} options.`);
console.log(`R2 prefix: ${prefix}`);

if (dryRun) {
  console.log('Dry run complete. No R2 objects were changed.');
  process.exit(0);
}

let uploaded = 0;
let verified = 0;

await mapConcurrent(objects, async (object) => {
  if (!verifyOnly) {
    await r2PutJson(object.questionKey, object.questionRaw);
    await r2PutJson(object.feedbackKey, object.feedbackRaw);
    uploaded += 2;
  }

  const [questionRemote, feedbackRemote] = await Promise.all([
    r2GetText(object.questionKey),
    r2GetText(object.feedbackKey),
  ]);

  if (questionRemote == null || sha256Hex(questionRemote) !== object.questionSha256) {
    throw new Error(`Question parity failed for ${object.questionId}.`);
  }
  if (feedbackRemote == null || sha256Hex(feedbackRemote) !== object.feedbackSha256) {
    throw new Error(`Feedback parity failed for ${object.questionId}.`);
  }
  verified += 2;

  if (verified % 1000 === 0) {
    console.log(`Verified ${verified}/${objects.length * 2} objects...`);
  }
});

const manifest = {
  schema_version: 1,
  prefix,
  generated_at: new Date().toISOString(),
  question_count: questions.length,
  option_count: options.length,
  object_count: objects.length * 2,
  objects: objects.map((object) => ({
    question_id: object.questionId,
    question_sha256: object.questionSha256,
    feedback_sha256: object.feedbackSha256,
  })),
};
const manifestRaw = JSON.stringify(manifest);
const manifestKey = `${prefix}/manifest.json`;

if (!verifyOnly) await r2PutJson(manifestKey, manifestRaw);
const remoteManifest = await r2GetText(manifestKey);
if (remoteManifest == null) throw new Error('R2 manifest is missing.');
if (!verifyOnly && sha256Hex(remoteManifest) !== sha256Hex(manifestRaw)) {
  throw new Error('R2 manifest parity failed.');
}

console.log(
  verifyOnly
    ? `Verification passed for ${verified} content objects.`
    : `Sync passed: uploaded ${uploaded} content objects and verified ${verified}.`,
);
console.log(`Manifest: ${manifestKey}`);
