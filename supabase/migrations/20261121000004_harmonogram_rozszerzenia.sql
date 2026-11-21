-- Rozszerzenia do harmonogramu synchronizacji (pg_cron) i wywołań HTTP z bazy (pg_net).
-- W Supabase dostępne od ręki; lokalny test bazy pomija ten plik, jeśli rozszerzeń brak.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;
