"""Local UI fixture used for browser verification; not part of production startup."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


BASE_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = BASE_DIR / "frontend"
SITE_HTML = BASE_DIR / "site.html"
NOW = datetime(2026, 6, 30, 9, 30, tzinfo=UTC).isoformat()

CATEGORY_NAMES = [
    ("printers-and-scanners", "Принтеры и сканеры"),
    ("outlook", "Почта Outlook"),
    ("password-reset", "Сброс паролей"),
    ("terminals", "Терминалы"),
    ("users", "Пользователям"),
    ("forticlient", "FortiClient"),
    ("wifi-and-internet", "WIFI и Интернет"),
    ("mts-link", "МТС Линк"),
    ("computers-and-laptops", "Компьютеры/ноутбуки"),
    ("peripherals", "Проблемы с периферией"),
    ("other", "Другое"),
]


def instruction(
    item_id: int,
    category_slug: str,
    slug: str,
    title: str,
    summary: str,
    tags: list[str],
    content: dict | None = None,
) -> dict:
    category_id = next(
        index for index, (value, _) in enumerate(CATEGORY_NAMES, start=1) if value == category_slug
    )
    category_name = CATEGORY_NAMES[category_id - 1][1]
    return {
        "id": item_id,
        "slug": slug,
        "title": title,
        "summary": summary,
        "category": {"id": category_id, "slug": category_slug, "name": category_name},
        "tags": tags,
        "updated_at": NOW,
        "created_at": NOW,
        "content": content
        or {
            "type": "document",
            "blocks": [
                {"type": "heading", "level": 2, "text": "Перед началом"},
                {
                    "type": "paragraph",
                    "text": "Убедитесь, что компьютер подключён к корпоративной сети.",
                },
                {
                    "type": "steps",
                    "items": [
                        {"title": "Откройте параметры", "text": "Перейдите в нужный раздел системы."},
                        {"title": "Выберите устройство", "text": "Найдите его в списке доступных."},
                        {"title": "Проверьте результат", "text": "Выполните тестовое действие."},
                    ],
                },
                {
                    "type": "note",
                    "title": "Обратите внимание",
                    "text": "Если устройство не найдено, обратитесь в ИТ-поддержку.",
                },
            ],
        },
    }


INSTRUCTIONS = [
    instruction(1, "printers-and-scanners", "connect-network-printer", "Как подключить сетевой принтер", "Добавление принтера в Windows и печать тестовой страницы.", ["Windows", "принтер"]),
    instruction(2, "printers-and-scanners", "scan-to-email", "Как отсканировать документ в почту", "Сканирование документа и отправка результата по электронной почте.", ["сканер", "почта"]),
    instruction(3, "outlook", "outlook-profile", "Настройка почты Outlook на новом компьютере", "Подключение корпоративной учётной записи и первая синхронизация.", ["Outlook", "почта"]),
    instruction(4, "password-reset", "reset-domain-password", "Как самостоятельно сбросить пароль", "Смена забытого пароля корпоративной учётной записи.", ["пароль", "учётная запись"]),
    instruction(5, "forticlient", "connect-vpn", "Подключение к VPN через FortiClient", "Безопасное подключение к корпоративной сети из дома.", ["VPN", "FortiClient"]),
    instruction(6, "wifi-and-internet", "connect-corporate-wifi", "Подключение к корпоративной сети WIFI", "Выбор сети, авторизация и проверка подключения.", ["WIFI", "интернет"]),
    instruction(7, "mts-link", "join-meeting", "Как подключиться к встрече в МТС Линк", "Вход во встречу, настройка камеры и микрофона.", ["МТС Линк", "видеосвязь"]),
    instruction(8, "computers-and-laptops", "lock-workstation", "Как заблокировать рабочий компьютер", "Быстрая блокировка рабочего места при уходе.", ["Windows", "безопасность"]),
]


app = FastAPI()
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")


@app.get("/", include_in_schema=False)
async def website() -> FileResponse:
    return FileResponse(SITE_HTML)


@app.get("/api/v1/categories")
async def categories() -> dict:
    counts = {
        slug: sum(item["category"]["slug"] == slug for item in INSTRUCTIONS)
        for slug, _ in CATEGORY_NAMES
    }
    return {
        "items": [
            {
                "id": index,
                "slug": slug,
                "name": name,
                "sort_order": index * 10,
                "instruction_count": counts[slug],
            }
            for index, (slug, name) in enumerate(CATEGORY_NAMES, start=1)
        ]
    }


@app.get("/api/v1/instructions")
async def instructions(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=20),
    offset: int = Query(default=0),
) -> dict:
    items = INSTRUCTIONS
    if category:
        items = [item for item in items if item["category"]["slug"] == category]
    if q:
        query = q.casefold()
        items = [item for item in items if query in item["title"].casefold()]
    summaries = [{key: value for key, value in item.items() if key not in {"content", "created_at"}} for item in items]
    return {"items": summaries[offset : offset + limit], "total": len(items), "limit": limit, "offset": offset}


@app.get("/api/v1/instructions/by-slug/{category_slug}/{instruction_slug}")
async def instruction_detail(category_slug: str, instruction_slug: str) -> dict:
    for item in INSTRUCTIONS:
        if item["category"]["slug"] == category_slug and item["slug"] == instruction_slug:
            return item
    raise HTTPException(status_code=404, detail="Инструкция не найдена")
