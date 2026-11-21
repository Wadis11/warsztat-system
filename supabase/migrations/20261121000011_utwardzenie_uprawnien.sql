-- Tabele i widoki dodane po 0005 dostały od Supabase domyślne pełne uprawnienia (z TRUNCATE).
-- API tego nie udostępnia, ale porządkujemy: zalogowani tylko odczyt/zapis wierszy, pod kontrolą RLS.
do $$
begin
  revoke truncate, references, trigger on all tables in schema public from authenticated;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on platnosci to service_role;
  end if;
end $$;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
