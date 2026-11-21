#!/usr/bin/env bash
# Uruchamia migracje i testy uprawnień na tymczasowym, lokalnym Postgresie.
# Schemat auth Supabase jest zastąpiony minimalną atrapą (auth.users, auth.uid()).
set -euo pipefail

BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
PORT=${PG_PORT:-55432}
trap '"$BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

"$BIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP" -l "$TMP/log" start -w >/dev/null

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" <<'SQL'
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migracja: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

# Supabase domyślnie nadaje rolom API uprawnienia do tabel; o dostępie decyduje RLS.
"${PSQL[@]}" -c "grant usage on schema public to authenticated;
                 grant all on all tables in schema public to authenticated;
                 grant all on all sequences in schema public to authenticated;"

for f in "$ROOT"/supabase/tests/*.sql; do
  echo "test: $(basename "$f")"
  "${PSQL[@]}" -f "$f" 2>&1 | grep -E 'ok:|NIE PRZESZ|ERROR' | sed 's/^.*NOTICE:  /  /'; test "${PIPESTATUS[0]}" -eq 0
done
echo "wszystkie testy przeszły"
