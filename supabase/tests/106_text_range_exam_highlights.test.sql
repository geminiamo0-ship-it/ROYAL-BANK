BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.ok(
  public.is_valid_question_annotation_strokes(
    '[{"id":"h1","tool":"text-highlight","start":4,"end":16,"color":"yellow","quote":"sample text"}]'::jsonb
  ),
  'text-range highlight is accepted'
);

SELECT extensions.ok(
  public.is_valid_question_annotation_strokes(
    '[{"id":"p1","tool":"pencil","width":2.5,"points":[[0.1,0.1],[0.2,0.2]],"color":"blue"}]'::jsonb
  ),
  'legacy pencil stroke remains accepted'
);

SELECT extensions.ok(
  public.is_valid_question_annotation_strokes(
    '[{"id":"legacy-h","tool":"highlighter","width":16,"points":[[0.1,0.1],[0.2,0.2]],"color":"yellow"}]'::jsonb
  ),
  'legacy freehand highlighter remains accepted'
);

SELECT extensions.ok(
  NOT public.is_valid_question_annotation_strokes(
    '[{"id":"h2","tool":"text-highlight","start":20,"end":10,"color":"yellow"}]'::jsonb
  ),
  'reversed text highlight offsets are rejected'
);

SELECT extensions.ok(
  NOT public.is_valid_question_annotation_strokes(
    '[{"id":"h3","tool":"text-highlight","start":0.5,"end":10,"color":"yellow"}]'::jsonb
  ),
  'fractional text highlight offsets are rejected'
);

SELECT extensions.ok(
  NOT public.is_valid_question_annotation_strokes(
    '[{"id":"h4","tool":"text-highlight","start":0,"end":250001,"color":"yellow"}]'::jsonb
  ),
  'oversized text highlight offset is rejected'
);

SELECT extensions.ok(
  NOT public.is_valid_question_annotation_strokes(
    '[{"id":"h5","tool":"text-highlight","start":0,"end":10,"color":"orange"}]'::jsonb
  ),
  'unknown highlight color is rejected'
);

SELECT extensions.ok(
  public.is_valid_question_annotation_strokes('[]'::jsonb),
  'empty annotation payload remains accepted'
);

SELECT * FROM extensions.finish();
ROLLBACK;
