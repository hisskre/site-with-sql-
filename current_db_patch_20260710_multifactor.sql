\set ON_ERROR_STOP on

\connect instructions_db

INSERT INTO categories (slug, name, sort_order, is_active)
VALUES ('multifactor', 'Multifactor', 35, TRUE)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE;

GRANT SELECT ON TABLE categories, instructions TO "instr-api-user";
