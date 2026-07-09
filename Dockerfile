FROM python:3.14-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY requirements.txt requirements-api.txt ./

RUN pip install --no-cache-dir -r requirements-api.txt

COPY --chown=appuser:appuser . .

USER appuser

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
