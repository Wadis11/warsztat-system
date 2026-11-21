-- Test uprawnień: pracownik nie widzi danych finansowych, właściciel widzi wszystko.
-- Uruchamiany przez tools/test_bazy.sh na lokalnym Postgresie z atrapą schematu auth Supabase.
\set ON_ERROR_STOP on

-- Dane testowe (jako superużytkownik, z pominięciem RLS)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');
insert into profile (id, imie, rola) values
  ('00000000-0000-0000-0000-00000000000a', 'Właściciel', 'wlasciciel'),
  ('00000000-0000-0000-0000-00000000000b', 'Pracownik', 'pracownik');
-- użytkownik ...c nie ma profilu (np. ktoś, kto założył konto z pominięciem procedury)

insert into klienci (id, nazwa, nip, segment) values
  ('10000000-0000-0000-0000-000000000001', 'Ayvens Poland', '0000000000', 'ayvens');
insert into klienci_stawki (klient_id, stawka_blach, stawka_lak) values
  ('10000000-0000-0000-0000-000000000001', 180, 180);
insert into zlecenia (id, nr_rej, marka, klient_id, data_przyjecia) values
  ('20000000-0000-0000-0000-000000000001', 'WE 5V073', 'FORD', '10000000-0000-0000-0000-000000000001', '2026-11-21');
insert into kosztorysy (zlecenie_id, wersja, zrodlo, netto) values
  ('20000000-0000-0000-0000-000000000001', 'zlozony', 'audatex', 38350.74);

create function pg_temp.jako(uid text, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false);
  select set_config('request.jwt.claims', json_build_object('aal', aal)::text, false);
$$;

create function pg_temp.sprawdz(warunek boolean, opis text) returns void language plpgsql as $$
begin
  if not warunek then raise exception 'NIE PRZESZŁO: %', opis; end if;
  raise notice 'ok: %', opis;
end $$;

-- Numer zlecenia nadany automatycznie
select pg_temp.sprawdz((select numer from zlecenia limit 1) = '26-0001', 'numer zlecenia 26-0001');

set role authenticated;

-- ---- Pracownik ----
select pg_temp.jako('00000000-0000-0000-0000-00000000000b');
select pg_temp.sprawdz((select count(*) from zlecenia) = 1, 'pracownik widzi zlecenia');
select pg_temp.sprawdz((select count(*) from klienci) = 1, 'pracownik widzi klientów');
select pg_temp.sprawdz((select count(*) from klienci_stawki) = 0, 'pracownik NIE widzi stawek');
select pg_temp.sprawdz((select przychod_kosztorys from zlecenia_wyniki limit 1) is null, 'pracownik NIE widzi kwot w wynikach zleceń');
select pg_temp.sprawdz((select count(*) from kosztorysy) = 0, 'pracownik NIE widzi kosztorysów');
select pg_temp.sprawdz((select count(*) from rejestr_zmian) = 0, 'pracownik NIE widzi rejestru zmian');

insert into zlecenia (nr_rej, marka, data_przyjecia) values ('KR 12345', 'OPEL', '2026-11-21');
select pg_temp.sprawdz((select count(*) from zlecenia) = 2, 'pracownik dodaje zlecenie prywatne');
select pg_temp.sprawdz((select numer from zlecenia where nr_rej = 'KR 12345') = '26-0002', 'kolejny numer 26-0002');

update profile set rola = 'wlasciciel' where id = '00000000-0000-0000-0000-00000000000b';
reset role;
select pg_temp.sprawdz((select rola from profile where id = '00000000-0000-0000-0000-00000000000b') = 'pracownik',
                       'pracownik NIE nadaje sobie roli właściciela');
set role authenticated;

do $$ begin
  insert into kosztorysy (zlecenie_id, wersja, zrodlo, netto)
  values ('20000000-0000-0000-0000-000000000001', 'zlozony', 'reczny', 1);
  raise exception 'NIE PRZESZŁO: pracownik zapisał kosztorys';
exception when insufficient_privilege then raise notice 'ok: pracownik NIE zapisuje kosztorysów';
end $$;

do $$ begin
  insert into pracownicy (imie) values ('Ktoś');
  raise exception 'NIE PRZESZŁO: pracownik dodał pracownika';
exception when insufficient_privilege then raise notice 'ok: pracownik NIE dodaje pracowników';
end $$;

delete from zlecenia where nr_rej = 'KR 12345';
select pg_temp.sprawdz((select count(*) from zlecenia) = 2, 'pracownik NIE usuwa zleceń');

-- ---- Konto bez profilu ----
select pg_temp.jako('00000000-0000-0000-0000-00000000000c');
select pg_temp.sprawdz((select count(*) from zlecenia) = 0, 'konto bez profilu NIE widzi zleceń');

-- ---- Właściciel bez kodu z telefonu (samo hasło) ----
select pg_temp.jako('00000000-0000-0000-0000-00000000000a', 'aal1');
select pg_temp.sprawdz((select count(*) from klienci_stawki) = 0, 'właściciel bez kodu 2FA NIE widzi stawek');
select pg_temp.sprawdz((select count(*) from zlecenia) = 2, 'właściciel bez kodu 2FA widzi zlecenia jak pracownik');

-- ---- Właściciel ----
select pg_temp.jako('00000000-0000-0000-0000-00000000000a');
select pg_temp.sprawdz(moja_rola() = 'wlasciciel', 'rola właściciela odczytana');
select pg_temp.sprawdz((select przychod_kosztorys from zlecenia_wyniki where nr_rej = 'WE 5V073') = 38350.74,
                       'wynik zlecenia: przychód z kosztorysu');
select pg_temp.sprawdz((select count(*) from klienci_stawki) = 1, 'właściciel widzi stawki');
select pg_temp.sprawdz((select count(*) from kosztorysy) = 1, 'właściciel widzi kosztorysy');
select pg_temp.sprawdz((select count(*) from rejestr_zmian where tabela = 'zlecenia') >= 2, 'rejestr zapisuje zmiany');
select pg_temp.sprawdz((select kto from rejestr_zmian where tabela = 'zlecenia' and po ->> 'nr_rej' = 'KR 12345' limit 1)
                       = '00000000-0000-0000-0000-00000000000b', 'rejestr wie, kto dodał zlecenie');
select pg_temp.sprawdz(norm_indeks('6508-05-8186249P') = '6508058186249P', 'normalizacja indeksu części');

-- Pracownicy: przypisanie i podział RBH
update kosztorysy set rbh_blach = 10, rbh_lak = 6, robocizna_blach = 1800, robocizna_lak = 1080;
insert into pracownicy (id, imie, specjalizacja) values
  ('30000000-0000-0000-0000-000000000001', 'Blacharz A', 'blacharz'),
  ('30000000-0000-0000-0000-000000000002', 'Blacharz B', 'blacharz'),
  ('30000000-0000-0000-0000-000000000003', 'Lakiernik', 'lakiernik');
insert into zlecenia_pracownicy (zlecenie_id, pracownik_id, rola) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'blacharz'),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'blacharz'),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'lakiernik');
select pg_temp.sprawdz((select rbh from udzial_pracownikow where pracownik_id = '30000000-0000-0000-0000-000000000001') = 5,
                       'dwóch blacharzy dzieli RBH po równo');
select pg_temp.sprawdz((select robocizna from udzial_pracownikow where pracownik_id = '30000000-0000-0000-0000-000000000003') = 1080,
                       'lakiernik dostaje robociznę lakierniczą');
select pg_temp.jako('00000000-0000-0000-0000-00000000000b');
select pg_temp.sprawdz((select count(*) from udzial_pracownikow) = 3 and (select max(rbh) from udzial_pracownikow) is null,
                       'pracownik widzi przypisania, ale NIE kwoty i RBH');
select pg_temp.jako('00000000-0000-0000-0000-00000000000a');

reset role;
