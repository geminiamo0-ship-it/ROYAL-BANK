const QUESTION_MEDIA_PATTERN =
  /(["'])(?:\/?offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi;

export function rewriteExamMediaHtml(html: string, mediaUrl: string) {
  if (!html) return '';
  return html.replace(QUESTION_MEDIA_PATTERN, `$1${mediaUrl}/`);
}

export function prepareQuestionStemHtml(html: string, mediaUrl: string) {
  if (!html) return '';
  const withoutEmbeddedStyles = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  return rewriteExamMediaHtml(withoutEmbeddedStyles, mediaUrl);
}
