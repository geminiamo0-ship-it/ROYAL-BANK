const TOPIC_FILTER_PREFIX = '__topic__::';
const TOPIC_FILTER_SEPARATOR = '::';

export function encodeTopicFilter(category: string, topic: string) {
  return `${TOPIC_FILTER_PREFIX}${encodeURIComponent(category)}${TOPIC_FILTER_SEPARATOR}${encodeURIComponent(topic)}`;
}

export function decodeTopicFilter(value: string) {
  if (!value.startsWith(TOPIC_FILTER_PREFIX)) {
    return null;
  }

  const payload = value.slice(TOPIC_FILTER_PREFIX.length);
  const separatorIndex = payload.indexOf(TOPIC_FILTER_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  return {
    category: decodeURIComponent(payload.slice(0, separatorIndex)),
    topic: decodeURIComponent(payload.slice(separatorIndex + TOPIC_FILTER_SEPARATOR.length)),
  };
}

export function isTopicFilterValue(value: string) {
  return value.startsWith(TOPIC_FILTER_PREFIX);
}
