BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.ok(
    has_function_privilege('service_role','public.content_manager_import_questions(bigint,jsonb)','EXECUTE'),
    'service_role can execute question import RPC'
);
SELECT extensions.ok(
    has_function_privilege('service_role','public.content_manager_import_articles(bigint,jsonb)','EXECUTE'),
    'service_role can execute article import RPC'
);
SELECT extensions.ok(
    has_function_privilege('service_role','public.content_manager_refresh_counts()','EXECUTE'),
    'service_role can execute count refresh RPC'
);
SELECT extensions.ok(
    NOT has_function_privilege('authenticated','public.content_manager_import_questions(bigint,jsonb)','EXECUTE'),
    'authenticated cannot execute question import RPC'
);
SELECT extensions.ok(
    NOT has_function_privilege('authenticated','public.content_manager_import_articles(bigint,jsonb)','EXECUTE'),
    'authenticated cannot execute article import RPC'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon','public.content_manager_refresh_counts()','EXECUTE'),
    'anon cannot execute content refresh RPC'
);

INSERT INTO public.pathways(id,name,slug)
VALUES (12401,'Content Runtime Pathway','test-content-runtime-pathway');
INSERT INTO public.question_banks(id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (12402,12401,'Content Runtime Bank',FALSE,NULL);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE imported_questions(payload jsonb);
INSERT INTO imported_questions
SELECT public.content_manager_import_questions(
    12402,
    jsonb_build_array(
        jsonb_build_object(
            'id', 12403,
            'main_id', 22403,
            'text_html', '<p>Imported question</p>',
            'explanation_html', '<p>Imported explanation</p>',
            'category', 'Cardiology',
            'topic', 'Import',
            'difficulty', '2',
            'source', 'PassMedicine',
            'options', jsonb_build_array(
                jsonb_build_object('option_order',0,'text_html','Correct','is_correct',true,'percentage',70),
                jsonb_build_object('option_order',1,'text_html','Wrong','is_correct',false,'percentage',30)
            )
        )
    )
);
RESET ROLE;

SELECT extensions.is(
    ((SELECT payload FROM imported_questions)->>'questions_processed')::int,
    1,
    'question import processes the requested question'
);
SELECT extensions.is(
    ((SELECT payload FROM imported_questions)->>'options_processed')::int,
    2,
    'question import processes the requested options'
);
SELECT extensions.is(
    (SELECT count(*)::int FROM public.options WHERE question_id=12403 AND is_correct),
    1,
    'imported question has exactly one correct option'
);
SELECT extensions.ok(
    EXISTS (
        SELECT 1 FROM public.question_bank_questions
        WHERE question_bank_id=12402 AND question_id=12403
    ),
    'imported question is mapped to the target bank'
);

SET LOCAL ROLE service_role;
SELECT public.content_manager_refresh_counts();
RESET ROLE;
SELECT extensions.ok(
    EXISTS (
        SELECT 1 FROM public.bank_question_stats
        WHERE question_bank_id=12402
          AND category='Cardiology'
          AND topic='Import'
          AND difficulty='2'
          AND total_questions=1
    ),
    'explicit content refresh rebuilds bank question stats after bulk import'
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE imported_articles(payload jsonb);
INSERT INTO imported_articles
SELECT public.content_manager_import_articles(
    12402,
    jsonb_build_array(
        jsonb_build_object(
            'id','content-runtime-article',
            'name','Content Runtime Article',
            'category','Cardiology',
            'content_html','<p>Article body</p>',
            'source','Pastest',
            'display_order',3
        )
    )
);
RESET ROLE;

SELECT extensions.is(
    ((SELECT payload FROM imported_articles)->>'articles_processed')::int,
    1,
    'article import processes the requested article'
);
SELECT extensions.ok(
    EXISTS (
        SELECT 1 FROM public.question_bank_library_articles
        WHERE question_bank_id=12402
          AND article_id='content-runtime-article'
          AND display_order=3
    ),
    'imported article is mapped to the target bank'
);

SELECT * FROM extensions.finish();
ROLLBACK;
