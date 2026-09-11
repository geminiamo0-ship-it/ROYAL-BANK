import { createHash, createHmac } from 'node:crypto';

const PAGE_SIZE = 1000;
const CONCURRENCY = 12;
const REGISTRATION_BATCH_SIZE = 500;
const DEFAULT_ROOT = 'exam-content';
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
const root = (process.env.ROYAL_R2_CONTENT_ROOT?.trim() || DEFAULT_ROOT).replace(/^\/+|\/+$/g, '');

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

async function r2PutJsonImmutable(key, raw) {
  const existing = await r2GetText(key);
  if (existing != null) {
    if (sha256Hex(existing) !== sha256Hex(raw)) {
      throw new Error(`Immutable R2 object already exists with different content: ${key}`);
    }
    return 'reused';
  }

  await r2PutJson(key, raw);
  const stored = await r2GetText(key);
  if (stored == null || sha256Hex(stored) !== sha256Hex(raw)) {
    throw new Error(`Immutable R2 write verification failed: ${key}`);
  }
  return 'uploaded';
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

async function callSupabaseRpc(name, body) {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase RPC ${name} failed (${response.status}): ${raw.slice(0, 500)}`);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
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

function buildCanonicalObjects(questions, options) {
  const optionsByQuestion = new Map();
  for (const option of options) {
    const questionId = Number(option.question_id);
    const optionId = Number(option.id);
    const optionOrder = Number(option.option_order);
    const percentage = Number(option.percentage ?? 0);
    if (!Number.isSafeInteger(questionId) || questionId <= 0) {
      throw new Error(`Invalid option question_id: ${option.question_id}`);
    }
    if (!Number.isSafeInteger(optionId) || optionId <= 0 || !Number.isSafeInteger(optionOrder)) {
      throw new Error(`Invalid option row: ${option.id}`);
    }
    if (!Number.isFinite(percentage)) throw new Error(`Invalid option percentage: ${option.id}`);

    const list = optionsByQuestion.get(questionId) || [];
    list.push({
      id: optionId,
      question_id: questionId,
      text_html: String(option.text_html ?? ''),
      option_order: optionOrder,
      is_correct: option.is_correct === true,
      percentage,
    });
    optionsByQuestion.set(questionId, list);
  }

  const objects = [];
  for (const question of questions) {
    const questionId = Number(question.id);
    if (!Number.isSafeInteger(questionId) || questionId <= 0) {
      throw new Error(`Invalid question id: ${question.id}`);
    }

    const sourceOptions = (optionsByQuestion.get(questionId) || []).sort(
      (a, b) => a.option_order - b.option_order || a.id - b.id,
    );
    const correctOptions = sourceOptions.filter((option) => option.is_correct);
    if (sourceOptions.length < 1 || correctOptions.length !== 1) {
      throw new Error(`Question ${questionId} must have exactly one correct option.`);
    }

    const safeOptions = sourceOptions.map(({ is_correct: _isCorrect, percentage: _percentage, ...option }) => option);
    const optionPercentages = Object.fromEntries(
      sourceOptions.map((option) => [String(option.id), option.percentage]),
    );
    const correctOptionId = correctOptions[0].id;

    const questionRaw = JSON.stringify({
      id: questionId,
      text_html: String(question.text_html ?? ''),
      category: String(question.category ?? ''),
      topic: question.topic == null ? null : String(question.topic),
      difficulty: String(question.difficulty ?? '1'),
      notes_id: question.notes_id == null ? null : String(question.notes_id),
      concept_id: question.concept_id == null ? null : String(question.concept_id),
      options: safeOptions,
    });
    const feedbackRaw = JSON.stringify({
      question_id: questionId,
      correct_option_id: correctOptionId,
      option_percentages: optionPercentages,
      explanation_html: String(question.explanation_html ?? ''),
    });

    objects.push({
      questionId,
      questionRaw,
      questionSha256: sha256Hex(questionRaw),
      feedbackRaw,
      feedbackSha256: sha256Hex(feedbackRaw),
      answerSnapshot: {
        question_id: questionId,
        correct_option_id: correctOptionId,
        option_ids: sourceOptions.map((option) => option.id),
        option_percentages: optionPercentages,
      },
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
  fetchAll(
    'options',
    'id,question_id,text_html,option_order,is_correct,percentage',
    'question_id.asc,option_order.asc,id.asc',
  ),
]);

const canonicalObjects = buildCanonicalObjects(questions, options);
if (canonicalObjects.length !== questions.length) throw new Error('Question object count mismatch.');

const releaseDescriptor = {
  schema_version: 3,
  question_count: questions.length,
  option_count: options.length,
  objects: canonicalObjects.map((object) => ({
    question_id: object.questionId,
    question_sha256: object.questionSha256,
    feedback_sha256: object.feedbackSha256,
  })),
};
const releaseId = sha256Hex(JSON.stringify(releaseDescriptor));
const releasePrefix = `${root}/releases/${releaseId}`;
const objects = canonicalObjects.map((object) => ({
  ...object,
  questionKey: `${releasePrefix}/questions/${object.questionId}.json`,
  feedbackKey: `${releasePrefix}/feedback/${object.questionId}.json`,
}));
const manifest = {
  ...releaseDescriptor,
  release_id: releaseId,
  prefix: releasePrefix,
  object_count: objects.length * 2,
};
const manifestRaw = JSON.stringify(manifest);
const manifestSha256 = sha256Hex(manifestRaw);
const manifestKey = `${releasePrefix}/manifest.json`;
const activeKey = `${root}/active.json`;

console.log(`Prepared ${objects.length} questions and ${options.length} options.`);
console.log(`Release: ${releaseId}`);
console.log(`Release prefix: ${releasePrefix}`);

if (dryRun) {
  console.log('Dry run complete. No R2 objects or release registry rows were changed.');
  process.exit(0);
}

if (verifyOnly) {
  const activeRaw = await r2GetText(activeKey);
  if (activeRaw == null) throw new Error('R2 active release pointer is missing.');
  const active = JSON.parse(activeRaw);
  if (
    active?.schema_version !== 2 ||
    active?.release_id !== releaseId ||
    active?.prefix !== releasePrefix ||
    active?.manifest_sha256 !== manifestSha256
  ) {
    throw new Error('Active R2 release does not match canonical Supabase content.');
  }
}

let uploaded = 0;
let reused = 0;
let verified = 0;

await mapConcurrent(objects, async (object) => {
  if (!verifyOnly) {
    const questionResult = await r2PutJsonImmutable(object.questionKey, object.questionRaw);
    const feedbackResult = await r2PutJsonImmutable(object.feedbackKey, object.feedbackRaw);
    if (questionResult === 'uploaded') uploaded += 1;
    else reused += 1;
    if (feedbackResult === 'uploaded') uploaded += 1;
    else reused += 1;
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
    console.log(`Verified ${verified}/${objects.length * 2} content objects...`);
  }
});

if (!verifyOnly) {
  const manifestResult = await r2PutJsonImmutable(manifestKey, manifestRaw);
  if (manifestResult === 'uploaded') uploaded += 1;
  else reused += 1;
}

const remoteManifest = await r2GetText(manifestKey);
if (remoteManifest == null || sha256Hex(remoteManifest) !== manifestSha256) {
  throw new Error('R2 release manifest parity failed.');
}

if (!verifyOnly) {
  // Register the immutable answer key in Postgres before activation. A session can
  // only pin a release whose complete snapshot has been finalized, so the mutable
  // active pointer can never expose an R2 generation without matching scoring data.
  await callSupabaseRpc('register_exam_content_release', {
    p_release_id: releaseId,
    p_manifest_sha256: manifestSha256,
    p_question_count: questions.length,
    p_option_count: options.length,
  });

  for (let offset = 0; offset < objects.length; offset += REGISTRATION_BATCH_SIZE) {
    const batch = objects
      .slice(offset, offset + REGISTRATION_BATCH_SIZE)
      .map((object) => object.answerSnapshot);
    await callSupabaseRpc('register_exam_content_release_answers', {
      p_release_id: releaseId,
      p_answers: batch,
    });
  }
  await callSupabaseRpc('finalize_exam_content_release', { p_release_id: releaseId });

  // The only mutable R2 object is switched last, after both R2 parity and the
  // private Postgres answer-key snapshot are complete.
  const activeRaw = JSON.stringify({
    schema_version: 2,
    release_id: releaseId,
    prefix: releasePrefix,
    manifest_sha256: manifestSha256,
    activated_at: new Date().toISOString(),
  });
  await r2PutJson(activeKey, activeRaw);

  const activatedRaw = await r2GetText(activeKey);
  if (activatedRaw == null) throw new Error('R2 active release pointer write failed.');
  const activated = JSON.parse(activatedRaw);
  if (
    activated?.release_id !== releaseId ||
    activated?.prefix !== releasePrefix ||
    activated?.manifest_sha256 !== manifestSha256
  ) {
    throw new Error('R2 active release pointer verification failed.');
  }
}

console.log(
  verifyOnly
    ? `Verification passed for active release ${releaseId} (${verified} content objects).`
    : `Release activated: ${releaseId}; uploaded ${uploaded}, reused ${reused}, verified ${verified} content objects.`,
);
console.log(`Manifest: ${manifestKey}`);
console.log(`Active pointer: ${activeKey}`);
