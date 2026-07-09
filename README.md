# База знаний ИТ-поддержки

Готовый сайт и read-only API на FastAPI для публикации внутренних инструкций.
Сайт получает разделы, результаты поиска и содержимое инструкций только через API.

## Что входит в проект

- `site.html` — главная страница сайта на основе выбранного прототипа;
- `frontend/assets/site.css` и `frontend/assets/site-app.js` — локальные стили и логика интерфейса без внешних CDN;
- `api.py` — FastAPI-приложение и запросы к PostgreSQL;
- `init_db.sql` — база, роль `instr-api-user`, таблицы, индексы и разделы;
- `seed_instructions.sql` — стартовый набор опубликованных инструкций по всем разделам;
- `.env.example` — пример параметров подключения;
- `Dockerfile` — контейнер API и сайта;
- `compose.yaml` — запуск API и PostgreSQL одной командой.

Сайт открывается на `http://127.0.0.1:8000/`, OpenAPI — на
`http://127.0.0.1:8000/docs`.

## 1. Создание объектов PostgreSQL

Запустите скрипт через `psql` от администратора PostgreSQL. В нём используются
команды `psql` (`\connect` и `\gexec`), поэтому обычное окно SQL-запросов не подходит.

```powershell
psql -U postgres -v api_password='replace-with-a-strong-password' -f init_db.sql postgres
```

Скрипт создаёт базу `instructions_db`, пользователя `instr-api-user`, таблицы
`categories` и `instructions`, индексы и одиннадцать заданных разделов. Роль API
получает только `CONNECT`, `USAGE` схемы и `SELECT` таблиц. Для неё также включён
`default_transaction_read_only`, отозваны права на последовательности и функции.

Добавлять и редактировать инструкции нужно под отдельным владельцем/редактором БД,
а не под `instr-api-user`.

## 2. Docker-запуск

Скопируйте пример окружения и замените пароли:

```powershell
Copy-Item .env.example .env
notepad .env
```

Минимально нужно изменить `DB_PASSWORD` и `POSTGRES_PASSWORD`. После этого:

```powershell
docker compose up --build -d
```

При первом запуске контейнер PostgreSQL выполнит `init_db.sql`: создаст базу
`instructions_db`, роль `instr-api-user`, таблицы и разделы. После этого выполнится
`seed_instructions.sql` и добавит стартовые инструкции. Сайт будет доступен на
`http://127.0.0.1:8000/`, OpenAPI — на `http://127.0.0.1:8000/docs`.

Если база уже создана и нужно повторно применить стартовые инструкции:

```powershell
docker compose cp seed_instructions.sql db:/tmp/seed_instructions.sql
docker compose exec -T db psql -U postgres -d instructions_db -f /tmp/seed_instructions.sql
docker compose up --build -d api
```

## 3. Локальный запуск без Docker

```powershell
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m pip install -r requirements-api.txt
```

Перенесите значения из `.env` в окружение процесса. Минимально требуется пароль:

```powershell
$env:DB_PASSWORD='replace-with-a-strong-password'
.\.venv\Scripts\python.exe main.py
```

На Windows используйте именно `main.py`: он включает совместимый event loop для
асинхронного драйвера PostgreSQL. Хост и порт можно переопределить переменными
`API_HOST` и `API_PORT`. В Linux/Docker можно запускать `uvicorn api:app`.

Для production запускайте Uvicorn за reverse proxy с HTTPS. Реальный пароль БД
не сохраняйте в репозитории.

## Маршруты API

- `GET /api/v1/categories`
- `GET /api/v1/instructions?q=принтер&category=printers-and-scanners&limit=20&offset=0`
- `GET /api/v1/instructions/{id}`
- `GET /api/v1/instructions/by-slug/{category_slug}/{instruction_slug}`
- `GET /health/live`
- `GET /health/ready`

API возвращает только опубликованные инструкции из активных разделов. Поиск
выполняется без учёта регистра по полю `title`.

## Формат содержимого инструкции

Поле `content` хранится как `JSONB`. Интерфейс поддерживает блоки `heading`,
`paragraph`, `list`, `steps`, `note`, `warning`, `danger`, `code`, `link`, `image`
и `divider`. Пример:

```json
{
  "type": "document",
  "blocks": [
    {"type": "heading", "level": 2, "text": "Подготовка"},
    {"type": "paragraph", "text": "Подключитесь к корпоративной сети."},
    {
      "type": "steps",
      "items": [
        {"title": "Откройте параметры", "text": "Перейдите в раздел устройств."},
        {"title": "Добавьте принтер", "text": "Выберите его из списка."}
      ]
    },
    {"type": "note", "title": "Важно", "text": "Распечатайте тестовую страницу."}
  ]
}
```

В `init_db.sql` в конце есть пример `INSERT`. HTML из базы не исполняется: сайт
создаёт элементы безопасно и выводит текст через DOM API.

## Проверка

```powershell
.\.venv\Scripts\python.exe -m compileall -q api.py main.py tests\mock_app.py
node --check frontend\assets\app.js
node --check frontend\assets\site-app.js
```

`tests/mock_app.py` — локальная фикстура для визуальной проверки интерфейса без
PostgreSQL. Для её запуска:

```powershell
.\.venv\Scripts\python.exe -m uvicorn tests.mock_app:app --host 127.0.0.1 --port 8010
```
