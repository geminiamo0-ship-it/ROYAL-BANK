export const PUBLIC_R2_MEDIA_URL = (
  process.env.NEXT_PUBLIC_R2_MEDIA_URL?.trim()
  || 'https://pub-2a81f2cb19cc4473a3d076e657af6121.r2.dev'
).replace(/\/+$/, '');

const QUESTION_MEDIA_PATTERN =
  /(["'])(?:\/?offline_media\/|https:\/\/media\.royalbank\.com\/questions\/|https?:\/\/storage\.blablabl234a\.online\/offline_media\/)/gi;

export function rewriteExamMediaHtml(
  html: string,
  mediaUrl: string = PUBLIC_R2_MEDIA_URL,
) {
  if (!html) return '';
  const normalizedBase = mediaUrl.replace(/\/+$/, '');
  return html.replace(QUESTION_MEDIA_PATTERN, `$1${normalizedBase}/`);
}

export function prepareQuestionStemHtml(
  html: string,
  mediaUrl: string = PUBLIC_R2_MEDIA_URL,
) {
  if (!html) return '';
  const withoutEmbeddedStyles = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  return rewriteExamMediaHtml(withoutEmbeddedStyles, mediaUrl);
}
