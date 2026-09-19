begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

select extensions.ok(
  to_regclass('public.edge_question_annotation_versions') is not null,
  'edge annotation version table exists'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.materialize_edge_annotation_checkpoint_row()', 'EXECUTE'),
  'service role can execute annotation checkpoint materializer'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'public.materialize_edge_annotation_checkpoint_row()', 'EXECUTE'),
  'authenticated cannot execute annotation checkpoint materializer directly'
);

select extensions.ok(
  public.is_valid_question_annotation_strokes(
    '[{"id":"h1","tool":"text-highlight","start":1,"end":9,"color":"yellow","quote":"example"}]'::jsonb
  ),
  'text highlights remain valid for checkpoint materialization'
);

select extensions.ok(
  public.is_valid_question_annotation_strokes(
    '[{"id":"p1","tool":"pencil","width":2.5,"points":[[0.1,0.1],[0.2,0.2]],"color":"blue"}]'::jsonb
  ),
  'pencil marks remain valid for checkpoint materialization'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.edge_question_annotation_versions', 'SELECT'),
  'annotation edge versions stay private'
);

select extensions.ok(
  has_table_privilege('service_role', 'public.edge_question_annotation_versions', 'SELECT'),
  'service role can read annotation edge versions'
);

select * from extensions.finish();
rollback;
