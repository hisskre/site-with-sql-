#!/usr/bin/env bash
set -euo pipefail

if [ -z "${INSTR_API_PASSWORD:-}" ]; then
  echo "ERROR: INSTR_API_PASSWORD is not set"
  exit 1
fi

psql \
  -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  -v "api_password=${INSTR_API_PASSWORD}" \
  -f /docker-entrypoint-initdb.d/sql/init_db.sql

psql \
  -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname instructions_db \
  -f /docker-entrypoint-initdb.d/sql/seed_instructions.sql
