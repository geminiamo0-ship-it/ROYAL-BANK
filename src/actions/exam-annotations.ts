'use server';

import { createClient } from '@/lib/supabase/server';
import {
  isAnnotationSurface,
  isValidAnnotationStrokes,
  type AnnotationStroke,
  type AnnotationSurface,
  type StoredQuestionAnnotation,
} from '@/lib/exam-annotations';

function requireQuestionId(questionId: number): number {
  if (!Number.isInteger(questionId) || questionId <= 0) {
    throw new Error('Invalid question id.');
  }
  return questionId;
}

function normalizeStoredAnnotation(value: unknown): StoredQuestionAnnotation {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid annotation response.');
  }

  const row = value as {
    surface?: unknown;
    content_hash?: unknown;
    strokes?: unknown;
    version?: unknown;
    updated_at?: unknown;
  };

  if (!isAnnotationSurface(row.surface)) throw new Error('Invalid annotation surface.');
  if (typeof row.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.content_hash)) {
    throw new Error('Invalid annotation content hash.');
  }
  if (!isValidAnnotationStrokes(row.strokes)) throw new Error('Invalid annotation stroke payload.');

  const version = Number(row.version);
  if (!Number.isInteger(version) || version < 1) throw new Error('Invalid annotation version.');

  return {
    surface: row.surface,
    contentHash: row.content_hash,
    strokes: row.strokes,
    version,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  };
}

async function requireAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) throw new Error('Authentication required.');
  return supabase;
}

export async function getQuestionAnnotationsAction(
  questionId: number,
): Promise<StoredQuestionAnnotation[]> {
  const parsedQuestionId = requireQuestionId(questionId);
  const supabase = await requireAuthenticatedClient();
  const { data, error } = await supabase.rpc('get_my_question_annotations', {
    p_question_id: parsedQuestionId,
  });

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map(normalizeStoredAnnotation);
}

export async function saveQuestionAnnotationAction(input: {
  questionId: number;
  surface: AnnotationSurface;
  contentHash: string;
  strokes: AnnotationStroke[];
  expectedVersion: number;
}): Promise<StoredQuestionAnnotation> {
  const questionId = requireQuestionId(input.questionId);
  if (!isAnnotationSurface(input.surface)) throw new Error('Invalid annotation surface.');
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) throw new Error('Invalid annotation content hash.');
  if (!isValidAnnotationStrokes(input.strokes)) throw new Error('Annotation payload is too large or invalid.');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new Error('Invalid annotation version.');
  }

  const supabase = await requireAuthenticatedClient();
  const { data, error } = await supabase.rpc('save_my_question_annotation', {
    p_question_id: questionId,
    p_surface: input.surface,
    p_content_hash: input.contentHash,
    p_strokes: input.strokes,
    p_expected_version: input.expectedVersion,
  });

  if (error) throw new Error(error.message);
  return normalizeStoredAnnotation(data);
}

export async function clearQuestionAnnotationsAction(questionId: number): Promise<number> {
  const parsedQuestionId = requireQuestionId(questionId);
  const supabase = await requireAuthenticatedClient();
  const { data, error } = await supabase.rpc('clear_my_question_annotations', {
    p_question_id: parsedQuestionId,
  });

  if (error) throw new Error(error.message);
  return Number(data || 0);
}
