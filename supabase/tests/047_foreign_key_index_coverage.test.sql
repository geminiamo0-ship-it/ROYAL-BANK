BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(1);

WITH fk AS (
    SELECT
        con.oid,
        con.conrelid,
        ns.nspname AS schema_name,
        rel.relname AS table_name,
        con.conname,
        array_agg(att.attname ORDER BY u.ord) AS columns
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY u(attnum, ord)
    JOIN pg_attribute att
      ON att.attrelid = rel.oid
     AND att.attnum = u.attnum
    WHERE con.contype = 'f'
      AND ns.nspname IN ('public', 'private')
    GROUP BY con.oid, con.conrelid, ns.nspname, rel.relname, con.conname
), uncovered AS (
    SELECT fk.*
    FROM fk
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = fk.conrelid
          AND i.indisvalid
          AND (
              SELECT array_agg(a.attname ORDER BY k.ord)
              FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a
                ON a.attrelid = i.indrelid
               AND a.attnum = k.attnum
              WHERE k.ord <= cardinality(fk.columns)
          ) = fk.columns
    )
)
SELECT extensions.is(
    (SELECT count(*)::int FROM uncovered),
    0,
    'all public/private foreign keys have a covering index prefix'
);

SELECT * FROM extensions.finish();
ROLLBACK;
