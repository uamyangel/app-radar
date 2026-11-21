#!/usr/bin/env bash
# 把 Railway 上的数据拉到本地库，供本地前端开发用（本地 workerd 连不了 TLS，见 DECISIONS.md）。
# 传输经 SSL；会覆盖本地库 app_radar 的 public schema。
# 用法：pnpm db:pull
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
LOCAL=${LOCAL_DATABASE_URL:-postgres://localhost:5432/app_radar}
case "$REMOTE" in *localhost*|*127.0.0.1*) echo ".env 里的 DATABASE_URL 是本地库，不需要同步"; exit 1;; esac
SEP='?'; [[ "$REMOTE" == *\?* ]] && SEP='&'
DUMP=$(mktemp -t app-radar-dump)
trap 'rm -f "$DUMP"' EXIT
echo "从 Railway 导出…"
pg_dump "${REMOTE}${SEP}sslmode=require" --format=custom --no-owner --no-privileges --schema=public --schema=drizzle -f "$DUMP"
echo "导入本地 $LOCAL …"
pg_restore --no-owner --no-privileges --clean --if-exists -d "$LOCAL" "$DUMP"
psql "$LOCAL" -Atc "select 'reviews ' || count(*) from reviews union all select 'apps ' || count(*) from apps"
