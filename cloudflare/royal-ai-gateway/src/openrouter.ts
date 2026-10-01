import type { RoyalAiConfig } from './config';
import type { RoyalAiEnv } from './env';
import { ROYAL_AI_SYSTEM_PROMPT } from './prompt';

export type OpenRouterStreamResult = {
  response: Response;
  requestedModel: string;
};

function requestBody(model: string, prompt: string, config: RoyalAiConfig, stream: boolean, maxTokens?: number) {
  return {
    model,
    temperature: config.temperature,
    max_tokens: maxTokens ?? config.maxOutputTokens,
    stream,
    stream_options: stream ? { include_usage: true } : undefined,
    messages: [
      { role: 'system', content: ROYAL_AI_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  };
}

async function callModel(
  env: RoyalAiEnv,
  model: string,
  prompt: string,
  config: RoyalAiConfig,
): Promise<Response> {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'http-referer': 'https://royal-bank-five.vercel.app',
      'x-title': 'Royal AI',
    },
    body: JSON.stringify(requestBody(model, prompt, config, true)),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
}

export async function openRouterStream(
  env: RoyalAiEnv,
  prompt: string,
  config: RoyalAiConfig,
): Promise<OpenRouterStreamResult> {
  const models = [config.primaryModel, config.fallbackModel].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  let lastStatus = 502;

  for (const model of models) {
    const response = await callModel(env, model, prompt, config);
    if (response.ok && response.body) return { response, requestedModel: model };
    lastStatus = response.status;
    console.error('ROYAL_AI_MODEL_FAILED', { model, status: response.status });
  }

  throw Object.assign(new Error('Royal AI model is temporarily unavailable.'), { status: lastStatus });
}

export async function summarizeConversation(
  env: RoyalAiEnv,
  input: { config: RoyalAiConfig; previousSummary: string; messages: Array<{ role: string; content: string }> },
): Promise<string | null> {
  const prompt = `Compress this Royal medical tutoring conversation into a concise working memory for future follow-ups.
Keep medical topics, user goals, resolved facts, unresolved questions, and important preferences.
Do not add facts that are not in the conversation.
Return plain text under 220 words.

PREVIOUS SUMMARY:
${input.previousSummary || '(none)'}

MESSAGES:
${input.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'http-referer': 'https://royal-bank-five.vercel.app',
        'x-title': 'Royal AI Memory',
      },
      body: JSON.stringify({
        ...requestBody(input.config.primaryModel, prompt, { ...input.config, temperature: 0.1 }, false, 350),
        stream: false,
      }),
      signal: AbortSignal.timeout(Math.min(input.config.timeoutMs, 45_000)),
    });
    if (!response.ok) return null;
    const payload = await response.json<{
      choices?: Array<{ message?: { content?: string } }>;
    }>();
    const content = payload.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (error) {
    console.error('ROYAL_AI_SUMMARY_FAILED', error);
    return null;
  }
}
