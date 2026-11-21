-- Utwardzenie po przeglądzie doradcy bezpieczeństwa Supabase.
-- Funkcje wyzwalaczy nie są do wywoływania przez API (wyzwalacze działają bez EXECUTE).
do $$
declare r text;
begin
  revoke execute on function nadaj_numer_zlecenia() from public;
  revoke execute on function zapisz_zmiane() from public;
  revoke execute on function jest_wlascicielem() from public;
  revoke execute on function jest_uzytkownikiem() from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function nadaj_numer_zlecenia() from %I', r);
      execute format('revoke execute on function zapisz_zmiane() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function jest_wlascicielem() from anon;
    revoke execute on function jest_uzytkownikiem() from anon;
  end if;
  -- Funkcje ról są potrzebne zalogowanym (polityki RLS).
  grant execute on function jest_wlascicielem() to authenticated;
  grant execute on function jest_uzytkownikiem() to authenticated;
end $$;
alter function norm_indeks(text) set search_path = public;
