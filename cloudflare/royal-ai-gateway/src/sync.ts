import type { RoyalAiEnv, RoyalAiUsageEvent } from './env';
import { normalizedSupabaseUrl } from './auth';

export async function syncRoyalAiUsage(
  env: RoyalAiEnv,
  events: RoyalAiUsageEvent[],
): Promise<void> {
  if (!events.length) return;
  const rows = events.map((event) => ({
    event_id: event.eventId,
    user_id: event.userId,
    conversation_id: event.conversationId,
    request_id: event.requestId,
    model: event.model,
    prompt_version: event.promptVersion,
    grounding_mode: event.groundingMode,
    source_count: event.sourceCount,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    cost_usd: event.costUsd,
    retrieval_ms: event.retrievalMs,
    first_token_ms: event.firstTokenMs,
    generation_ms: event.generationMs,
    total_ms: event.totalMs,
    created_at: event.createdAt,
  }));

  const response = await fetch(
    normalizedSupabaseUrl(env) + '/rest/v1/ai_royal_tutor_usage_events?on_conflict=event_id',
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
        'content-type': 'application/json',
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!response.ok) throw new Error('ROYAL_AI_USAGE_SYNC_FAILED_' + response.status);
}
