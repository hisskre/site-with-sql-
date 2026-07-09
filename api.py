"""Read-only HTTP API for the instructions website."""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Path as PathParam, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg import AsyncConnection, InterfaceError, OperationalError
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool, PoolTimeout
from pydantic import BaseModel, ConfigDict, Field, JsonValue


logger = logging.getLogger("instructions_api")
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
SITE_HTML = BASE_DIR / "site.html"
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'; "
    "form-action 'self'"
)
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw_value = os.getenv(name, str(default))
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value < minimum:
        raise RuntimeError(f"{name} must be greater than or equal to {minimum}")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    database_dsn: str
    cors_origins: tuple[str, ...]
    pool_min_size: int
    pool_max_size: int
    pool_timeout_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = os.getenv("DATABASE_URL")
        if database_url:
            database_dsn = database_url
        else:
            connection_options: dict[str, str | int] = {
                "host": os.getenv("DB_HOST", "localhost"),
                "port": _env_int("DB_PORT", 5432),
                "dbname": os.getenv("DB_NAME", "instructions_db"),
                "user": os.getenv("DB_USER", "instr-api-user"),
            }
            if password := os.getenv("DB_PASSWORD"):
                connection_options["password"] = password
            database_dsn = make_conninfo(**connection_options)

        raw_origins = os.getenv(
            "API_CORS_ORIGINS",
            "http://localhost:3000,http://localhost:5173",
        )
        cors_origins = tuple(
            origin.strip() for origin in raw_origins.split(",") if origin.strip()
        )
        pool_min_size = _env_int("DB_POOL_MIN_SIZE", 1)
        pool_max_size = _env_int("DB_POOL_MAX_SIZE", 10)
        if pool_min_size > pool_max_size:
            raise RuntimeError("DB_POOL_MIN_SIZE cannot exceed DB_POOL_MAX_SIZE")

        return cls(
            database_dsn=database_dsn,
            cors_origins=cors_origins,
            pool_min_size=pool_min_size,
            pool_max_size=pool_max_size,
            pool_timeout_seconds=_env_int("DB_POOL_TIMEOUT", 5),
        )


settings = Settings.from_env()


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ServiceInfo(ApiModel):
    service: str
    version: str
    documentation: str


class HealthStatus(ApiModel):
    status: str


class CategoryReference(ApiModel):
    id: int
    slug: str
    name: str


class Category(CategoryReference):
    sort_order: int
    instruction_count: int


class CategoryList(ApiModel):
    items: list[Category]


class InstructionSummary(ApiModel):
    id: int
    slug: str
    title: str
    summary: str | None
    category: CategoryReference
    tags: list[str]
    updated_at: datetime


class Instruction(InstructionSummary):
    content: JsonValue
    created_at: datetime


class InstructionPage(ApiModel):
    items: list[InstructionSummary]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = AsyncConnectionPool(
        conninfo=settings.database_dsn,
        min_size=settings.pool_min_size,
        max_size=settings.pool_max_size,
        timeout=settings.pool_timeout_seconds,
        kwargs={"autocommit": True, "row_factory": dict_row},
        open=False,
    )
    await pool.open(wait=False)
    app.state.db_pool = pool
    try:
        yield
    finally:
        await pool.close()


app = FastAPI(
    title="Instructions API",
    summary="Read-only API for corporate support instructions",
    version="1.0.0",
    lifespan=lifespan,
)

app.mount(
    "/assets",
    StaticFiles(directory=FRONTEND_DIR / "assets"),
    name="frontend-assets",
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
    )


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    if request.url.path not in {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}:
        response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
    return response


async def get_db(request: Request) -> AsyncIterator[AsyncConnection[dict[str, Any]]]:
    pool: AsyncConnectionPool = request.app.state.db_pool
    try:
        async with pool.connection(
            timeout=settings.pool_timeout_seconds
        ) as connection:
            yield connection
    except (PoolTimeout, OperationalError, InterfaceError) as exc:
        logger.exception("Database is unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="База данных временно недоступна",
        ) from exc


DbConnection = AsyncConnection[dict[str, Any]]


def _category_reference(row: dict[str, Any]) -> CategoryReference:
    return CategoryReference(
        id=row["category_id"],
        slug=row["category_slug"],
        name=row["category_name"],
    )


def _instruction_summary(row: dict[str, Any]) -> InstructionSummary:
    return InstructionSummary(
        id=row["id"],
        slug=row["slug"],
        title=row["title"],
        summary=row["summary"],
        category=_category_reference(row),
        tags=row["tags"],
        updated_at=row["updated_at"],
    )


def _instruction(row: dict[str, Any]) -> Instruction:
    summary = _instruction_summary(row)
    return Instruction(
        **summary.model_dump(),
        content=row["content"],
        created_at=row["created_at"],
    )


def _literal_like_pattern(value: str) -> str:
    """Build an ILIKE pattern while treating user input as literal text."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


INSTRUCTION_COLUMNS = """
    i.id,
    i.slug,
    i.title,
    i.summary,
    i.content,
    i.tags,
    i.created_at,
    i.updated_at,
    c.id AS category_id,
    c.slug AS category_slug,
    c.name AS category_name
"""


@app.get("/", response_class=FileResponse, include_in_schema=False)
async def website() -> FileResponse:
    return FileResponse(SITE_HTML)


@app.get("/api/v1", response_model=ServiceInfo, tags=["service"])
async def service_info() -> ServiceInfo:
    return ServiceInfo(
        service="instructions-api",
        version=app.version,
        documentation="/docs",
    )


@app.get("/health/live", response_model=HealthStatus, tags=["health"])
async def liveness() -> HealthStatus:
    return HealthStatus(status="ok")


@app.get("/health/ready", response_model=HealthStatus, tags=["health"])
async def readiness(db: DbConnection = Depends(get_db)) -> HealthStatus:
    async with db.cursor() as cursor:
        await cursor.execute("SELECT 1")
        await cursor.fetchone()
    return HealthStatus(status="ok")


@app.get("/api/v1/categories", response_model=CategoryList, tags=["categories"])
async def list_categories(db: DbConnection = Depends(get_db)) -> CategoryList:
    query = """
        SELECT
            c.id,
            c.slug,
            c.name,
            c.sort_order,
            COUNT(i.id) AS instruction_count
        FROM categories AS c
        LEFT JOIN instructions AS i
            ON i.category_id = c.id
           AND i.is_published = TRUE
        WHERE c.is_active = TRUE
        GROUP BY c.id, c.slug, c.name, c.sort_order
        ORDER BY c.sort_order, c.name
    """
    async with db.cursor() as cursor:
        await cursor.execute(query)
        rows = await cursor.fetchall()
    return CategoryList(items=[Category(**row) for row in rows])


@app.get(
    "/api/v1/instructions",
    response_model=InstructionPage,
    tags=["instructions"],
)
async def list_instructions(
    db: DbConnection = Depends(get_db),
    q: str | None = Query(
        default=None,
        min_length=1,
        max_length=200,
        description="Поиск по названию инструкции",
    ),
    category: str | None = Query(
        default=None,
        min_length=1,
        max_length=80,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="Slug раздела",
    ),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
) -> InstructionPage:
    if q is not None:
        q = q.strip()
        if not q:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Параметр q не должен состоять только из пробелов",
            )

    filters = """
        FROM instructions AS i
        JOIN categories AS c ON c.id = i.category_id
        WHERE i.is_published = TRUE
          AND c.is_active = TRUE
          AND (%(category)s::text IS NULL OR c.slug = %(category)s)
          AND (
              %(search)s::text IS NULL
              OR i.title ILIKE %(search)s ESCAPE E'\\\\'
          )
    """
    parameters = {
        "category": category,
        "search": _literal_like_pattern(q) if q is not None else None,
    }

    async with db.cursor() as cursor:
        await cursor.execute("SELECT COUNT(*) AS total " + filters, parameters)
        total_row = await cursor.fetchone()
        await cursor.execute(
            "SELECT "
            + INSTRUCTION_COLUMNS
            + filters
            + " ORDER BY i.updated_at DESC, i.title LIMIT %(limit)s OFFSET %(offset)s",
            {**parameters, "limit": limit, "offset": offset},
        )
        rows = await cursor.fetchall()

    return InstructionPage(
        items=[_instruction_summary(row) for row in rows],
        total=total_row["total"] if total_row else 0,
        limit=limit,
        offset=offset,
    )


@app.get(
    "/api/v1/instructions/by-slug/{category_slug}/{instruction_slug}",
    response_model=Instruction,
    tags=["instructions"],
)
async def get_instruction_by_slug(
    db: DbConnection = Depends(get_db),
    category_slug: str = PathParam(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"),
    instruction_slug: str = PathParam(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"),
) -> Instruction:
    query = (
        "SELECT "
        + INSTRUCTION_COLUMNS
        + """
        FROM instructions AS i
        JOIN categories AS c ON c.id = i.category_id
        WHERE c.slug = %(category_slug)s
          AND i.slug = %(instruction_slug)s
          AND i.is_published = TRUE
          AND c.is_active = TRUE
    """
    )
    async with db.cursor() as cursor:
        await cursor.execute(
            query,
            {
                "category_slug": category_slug,
                "instruction_slug": instruction_slug,
            },
        )
        row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Инструкция не найдена")
    return _instruction(row)


@app.get(
    "/api/v1/instructions/{instruction_id}",
    response_model=Instruction,
    tags=["instructions"],
)
async def get_instruction(
    instruction_id: int = PathParam(ge=1),
    db: DbConnection = Depends(get_db),
) -> Instruction:
    query = (
        "SELECT "
        + INSTRUCTION_COLUMNS
        + """
        FROM instructions AS i
        JOIN categories AS c ON c.id = i.category_id
        WHERE i.id = %(instruction_id)s
          AND i.is_published = TRUE
          AND c.is_active = TRUE
    """
    )
    async with db.cursor() as cursor:
        await cursor.execute(query, {"instruction_id": instruction_id})
        row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Инструкция не найдена")
    return _instruction(row)
