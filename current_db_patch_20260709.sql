\set ON_ERROR_STOP on

\connect instructions_db

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "instr-api-user";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "instr-api-user";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "instr-api-user";
GRANT SELECT ON TABLE categories, instructions TO "instr-api-user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM "instr-api-user";

INSERT INTO instructions (category_id, slug, title, summary, content, tags, is_published)
SELECT
    c.id,
    'test-picture-instruction',
    'Тест с картинкой',
    'Проверочная инструкция для отображения локального изображения внутри карточки.',
    $${
      "type": "document",
      "blocks": [
        {"type": "heading", "level": 2, "text": "Проверка картинки"},
        {"type": "paragraph", "text": "Эта инструкция нужна для проверки, что сайт корректно показывает изображения из локальной папки assets."},
        {"type": "image", "url": "/assets/instructions/test-picture.svg", "alt": "Тестовая картинка инструкции", "caption": "Локальная тестовая картинка из frontend/assets/instructions/test-picture.svg"},
        {"type": "note", "title": "Ожидаемый результат", "text": "При открытии инструкции картинка должна отображаться внутри карточки и открываться в увеличенном просмотре по клику."}
      ]
    }$$::jsonb,
    ARRAY['тест', 'картинка', 'проверка']::text[],
    TRUE
FROM categories AS c
WHERE c.slug = 'other'
ON CONFLICT (category_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    content = EXCLUDED.content,
    tags = EXCLUDED.tags,
    is_published = TRUE,
    updated_at = CURRENT_TIMESTAMP;
