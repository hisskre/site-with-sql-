-- Run with psql as a PostgreSQL administrator:
-- psql -U postgres -v api_password='replace-with-a-strong-password' -f init_db.sql postgres

\set ON_ERROR_STOP on

\if :{?api_password}
\else
    \echo 'ERROR: pass the API password with -v api_password=...'
    \quit
\endif

-- A quoted identifier is required because the role name contains hyphens.
SELECT format(
    'CREATE ROLE "instr-api-user" LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
    :'api_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'instr-api-user'
) \gexec

ALTER ROLE "instr-api-user"
    WITH LOGIN PASSWORD :'api_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

SELECT 'CREATE DATABASE instructions_db WITH ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'instructions_db'
) \gexec

REVOKE ALL PRIVILEGES ON DATABASE instructions_db FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE instructions_db FROM "instr-api-user";
GRANT CONNECT ON DATABASE instructions_db TO "instr-api-user";

\connect instructions_db

CREATE EXTENSION IF NOT EXISTS pg_trgm;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM "instr-api-user";
GRANT USAGE ON SCHEMA public TO "instr-api-user";

CREATE TABLE IF NOT EXISTS categories (
    id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL UNIQUE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT categories_slug_format
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT categories_name_not_blank
        CHECK (length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS instructions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id SMALLINT NOT NULL
        REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    slug VARCHAR(160) NOT NULL,
    title VARCHAR(300) NOT NULL,
    summary TEXT,
    content JSONB NOT NULL,
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT instructions_category_slug_unique UNIQUE (category_id, slug),
    CONSTRAINT instructions_slug_format
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT instructions_title_not_blank
        CHECK (length(btrim(title)) > 0),
    CONSTRAINT instructions_content_is_structured
        CHECK (jsonb_typeof(content) IN ('object', 'array'))
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION set_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS instructions_set_updated_at ON instructions;
CREATE TRIGGER instructions_set_updated_at
BEFORE UPDATE ON instructions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS instructions_published_category_idx
    ON instructions (category_id, updated_at DESC)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS instructions_title_trgm_idx
    ON instructions USING GIN (title gin_trgm_ops)
    WHERE is_published = TRUE;

INSERT INTO categories (slug, name, sort_order)
VALUES
    ('printers-and-scanners', 'Принтеры и сканеры', 10),
    ('outlook', 'Почта Outlook', 20),
    ('password-reset', 'Сброс паролей', 30),
    ('multifactor', 'Multifactor', 35),
    ('terminals', 'Терминалы', 40),
    ('users', 'Пользователям', 50),
    ('forticlient', 'FortiClient', 60),
    ('wifi-and-internet', 'WIFI и Интернет', 70),
    ('mts-link', 'МТС Линк', 80),
    ('computers-and-laptops', 'Компьютеры/ноутбуки', 90),
    ('peripherals', 'Проблемы с периферией', 100),
    ('other', 'Другое', 110)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "instr-api-user";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "instr-api-user";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "instr-api-user";
GRANT SELECT ON TABLE categories, instructions TO "instr-api-user";

-- Future tables should not become readable automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM "instr-api-user";

-- Extra protection against accidental write transactions in the API service.
ALTER ROLE "instr-api-user" IN DATABASE instructions_db
    SET default_transaction_read_only = on;
ALTER ROLE "instr-api-user" IN DATABASE instructions_db
    SET statement_timeout = '5s';
ALTER ROLE "instr-api-user" IN DATABASE instructions_db
    SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE "instr-api-user" IN DATABASE instructions_db
    SET search_path = public;

-- Example instruction for an administrator/editor (not executed):
-- INSERT INTO instructions (category_id, slug, title, summary, content, tags, is_published)
-- SELECT id, 'install-printer', 'Как установить принтер', 'Краткое описание',
--        '{"type":"document","blocks":[{"type":"paragraph","text":"Текст инструкции"}]}'::jsonb,
--        ARRAY['принтер'], TRUE
-- FROM categories WHERE slug = 'printers-and-scanners';
