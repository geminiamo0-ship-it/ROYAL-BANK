import { createHash, createHmac } from 'node:crypto';

const PAGE_SIZE = 1000;
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const concurrency = Math.min(32, Math.max(1, Number(process.env.ROYAL_AI_CORPUS_CONCURRENCY || 16) || 16));
const forcePublish = /^(1|true|yes)$/i.test(process.env.ROYAL_AI_FORCE_PUBLISH || '');

function required(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  if (dryRun) return '';
  throw new Error('Missing required environment variable: ' + names.join(' or '));
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
const supabaseKey = required('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
const accountId = required('R2_ACCOUNT_ID');
const accessKeyId = required('R2_ACCESS_KEY_ID');
const secretAccessKey = required('R2_SECRET_ACCESS_KEY');
const bucket = required('R2_BUCKET_NAME');
const root = (process.env.ROYAL_AI_CORPUS_ROOT?.trim() || 'content').replace(/^\/+|\/+$/g, '');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function enc(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
}

function objectPath(key) {
  const normalized = key.split('/').filter(Boolean).map(enc).join('/');
  return '/' + enc(bucket) + '/' + normalized;
}

function amzTimestamp(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function signedRequest(method, key, body = '') {
  const canonicalUri = objectPath(key);
  const host = accountId + '.r2.cloudflarestorage.com';
  const amzDate = amzTimestamp(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = 'host:' + host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac('AWS4' + secretAccessKey, dateStamp);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: 'https://' + host + canonicalUri,
    headers: {
      authorization: 'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  };
}

async function r2Put(key, body) {
  if (dryRun) return;
  const signed = signedRequest('PUT', key, body);
  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: { ...signed.headers, 'content-type': 'text/markdown; charset=utf-8' },
    body,
  });
  if (!response.ok) throw new Error('R2 PUT failed for ' + key + ' (' + response.status + ')');
}

async function r2Delete(key) {
  if (dryRun) return;
  const signed = signedRequest('DELETE', key);
  const response = await fetch(signed.url, { method: 'DELETE', headers: signed.headers });
  if (!response.ok && response.status !== 404) {
    throw new Error('R2 DELETE failed for ' + key + ' (' + response.status + ')');
  }
}

async function fetchAll(table, select, order = 'id.asc') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(supabaseUrl + '/rest/v1/' + table);
    url.searchParams.set('select', select);
    url.searchParams.set('order', order);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        authorization: 'Bearer ' + supabaseKey,
        accept: 'application/json',
      },
    });
    if (!response.ok) throw new Error('Supabase export failed for ' + table + ' (' + response.status + ')');
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Unexpected Supabase payload for ' + table);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function upsertRegistry(rows) {
  if (dryRun || rows.length === 0) return;
  const response = await fetch(supabaseUrl + '/rest/v1/ai_royal_tutor_corpus_registry?on_conflict=article_id', {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      authorization: 'Bearer ' + supabaseKey,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error('Corpus registry upsert failed (' + response.status + ')');
}

async function deleteRegistry(articleId) {
  if (dryRun) return;
  const response = await fetch(
    supabaseUrl + '/rest/v1/ai_royal_tutor_corpus_registry?article_id=eq.' + encodeURIComponent(articleId),
    {
      method: 'DELETE',
      headers: {
        apikey: supabaseKey,
        authorization: 'Bearer ' + supabaseKey,
        prefer: 'return=minimal',
      },
    },
  );
  if (!response.ok) throw new Error('Corpus registry delete failed (' + response.status + ')');
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'");
}

function htmlToMarkdown(value) {
  return decodeEntities(String(value || ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanCorpusText(value) {
  return String(value || '')
    .replace(/You've never been tested on this concept\.?/gi, '')
    .replace(/You've not yet rated this concept\.?/gi, '')
    .replace(/\bImportance:\s*\d+\b/gi, '')
    .replace(/Report broken media/gi, '')
    .replace(/Suggest link\s+Report broken link/gi, '')
    .replace(/Report broken link/gi, '')
    .replace(/👍\s*\d+\s*👎\s*\d+/g, '')
    .replace(/\+?\s*PassMedicine Notes\b/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slug(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

const [articles, sources, registry, mappings] = await Promise.all([
  fetchAll('library_articles', 'id,name,category,topic,content_html,source_id,ai_search_enabled', 'id.asc'),
  fetchAll('library_sources', 'id,name,slug,edition,version,source_date,ai_search_enabled', 'id.asc'),
  fetchAll('ai_royal_tutor_corpus_registry', 'article_id,object_key,content_hash,published_at', 'article_id.asc'),
  fetchAll('question_bank_library_articles', 'question_bank_id,article_id', 'article_id.asc'),
]);

const sourceById = new Map(sources.map((row) => [String(row.id), row]));
const bankByArticle = new Map(mappings.map((row) => [String(row.article_id), Number(row.question_bank_id)]));
const registryByArticle = new Map(registry.map((row) => [String(row.article_id), row]));
const activeIds = new Set();
const uploadOps = [];
const deleteOps = [];

for (const article of articles) {
  const articleId = String(article.id);
  const source = article.source_id == null ? null : sourceById.get(String(article.source_id));
  const enabled = article.ai_search_enabled === true && (source == null || source.ai_search_enabled === true);
  if (!enabled) continue;

  activeIds.add(articleId);
  const category = slug(article.category, 'general');
  const nameSlug = slug(article.topic || article.name, 'article-' + articleId);
  const bankId = bankByArticle.get(articleId) ?? null;
  const bankSegment = bankId ? 'bank-' + bankId : 'unmapped';
  const objectKey = root + '/' + bankSegment + '/' + category + '/' + articleId + '--' + nameSlug + '.md';
  const markdown = [
    '# ' + String(article.topic || article.name || 'Royal medical article'),
    '',
    article.category ? 'Category: ' + String(article.category) : '',
    article.topic ? 'Topic: ' + String(article.topic) : '',
    bankId ? 'Question bank ID: ' + String(bankId) : '',
    source?.name ? 'Source: ' + String(source.name) : 'Source: Royal Library',
    source?.edition ? 'Edition: ' + String(source.edition) : '',
    source?.version ? 'Version: ' + String(source.version) : '',
    source?.source_date ? 'Source date: ' + String(source.source_date) : '',
    '',
    cleanCorpusText(htmlToMarkdown(article.content_html)),
    '',
  ].filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== '')).join('\n');

  const contentHash = sha256(markdown);
  const existing = registryByArticle.get(articleId);
  if (forcePublish || !existing || existing.content_hash !== contentHash || existing.object_key !== objectKey) {
    uploadOps.push({ articleId, objectKey, markdown, contentHash, oldKey: existing?.object_key || null });
  }
}

for (const row of registry) {
  const articleId = String(row.article_id);
  if (!activeIds.has(articleId)) deleteOps.push({ articleId, objectKey: String(row.object_key) });
}

async function runPool(items, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

const writes = [];
await runPool(uploadOps, async (op) => {
  if (op.oldKey && op.oldKey !== op.objectKey) await r2Delete(op.oldKey);
  await r2Put(op.objectKey, op.markdown);
  writes.push({
    article_id: op.articleId,
    object_key: op.objectKey,
    content_hash: op.contentHash,
    published_at: new Date().toISOString(),
  });
});

await runPool(deleteOps, async (op) => {
  await r2Delete(op.objectKey);
  await deleteRegistry(op.articleId);
});

for (let start = 0; start < writes.length; start += 250) {
  await upsertRegistry(writes.slice(start, start + 250));
}

console.log(JSON.stringify({
  dryRun,
  articles: articles.length,
  enabled: activeIds.size,
  uploadedOrUpdated: writes.length,
  concurrency,
  forcePublish,
  removed: registry.filter((row) => !activeIds.has(String(row.article_id))).length,
  bucket,
  root,
}, null, 2));
