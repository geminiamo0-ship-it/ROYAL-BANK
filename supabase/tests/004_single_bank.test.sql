BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(2);

INSERT INTO public.pathways (id,name,slug) VALUES (9130,'Ownership Pathway','test-ownership-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit) VALUES
(9231,9130,'Ownership Bank A',FALSE,NULL),(9232,9130,'Ownership Bank B',FALSE,NULL);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (9330,19330,'Ownership question','Explanation','Medicine','Topic','1');

SELECT extensions.lives_ok($$INSERT INTO public.question_bank_questions(question_bank_id,question_id) VALUES (9231,9330)$$,'question can be mapped to its bank');
SELECT extensions.throws_ok($$INSERT INTO public.question_bank_questions(question_bank_id,question_id) VALUES (9232,9330)$$,'23505',NULL,'same question cannot be mapped to a second bank');

SELECT * FROM extensions.finish();
ROLLBACK;
