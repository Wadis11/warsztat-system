-- Rola „biuro”: kwoty i kosztorysy tak, płatności/ustawienia/konta nie; bez drugiego składnika nic.
\set ON_ERROR_STOP on

create function pg_temp.sprawdz(warunek boolean, opis text) returns void language plpgsql as $$
begin
  if not warunek then raise exception 'NIE PRZESZŁO: %', opis; end if;
  raise notice 'ok: %', opis;
end $$;
create function pg_temp.jako(uid text, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false);
  select set_config('request.jwt.claims', json_build_object('aal', aal)::text, false);
$$;

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000d');
insert into profile (id, imie, rola) values ('00000000-0000-0000-0000-00000000000d', 'Biuro', 'biuro');
insert into zlecenia (id, nr_rej, data_przyjecia) values ('60000000-0000-0000-0000-000000000001', 'KR 1111B', '2026-11-20');
insert into kosztorysy (zlecenie_id, wersja, zrodlo, netto) values ('60000000-0000-0000-0000-000000000001', 'zlozony', 'audatex', 5000);
select zapisz_fakture_ksef(jsonb_build_object('nr_ksef', 'B-1', 'kierunek', 'zakup', 'numer', 'FV/B/1', 'nip_kontrahenta', '1234567890',
  'data_wystawienia', '2026-11-20', 'netto', 100, 'vat', 23, 'brutto', 123, 'xml', '<Faktura/>', 'pozycje', '[]'::jsonb));

set role authenticated;
select pg_temp.jako('00000000-0000-0000-0000-00000000000d', 'aal1');
select pg_temp.sprawdz((select count(*) from kosztorysy) = 0, 'biuro bez drugiego składnika nie widzi kosztorysów');

select pg_temp.jako('00000000-0000-0000-0000-00000000000d');
select pg_temp.sprawdz(moja_rola() = 'biuro', 'rola biuro odczytana');
select pg_temp.sprawdz((select count(*) from kosztorysy) = 1, 'biuro widzi kosztorysy');
select pg_temp.sprawdz((select przychod_kosztorys from zlecenia_wyniki where nr_rej = 'KR 1111B') = 5000, 'biuro widzi wynik zlecenia');
insert into kosztorysy (zlecenie_id, wersja, zrodlo, netto) values ('60000000-0000-0000-0000-000000000001', 'zaakceptowany', 'audatex', 4500);
select pg_temp.sprawdz((select count(*) from kosztorysy) = 2, 'biuro dodaje kosztorys');
select pg_temp.sprawdz((select count(*) from faktury) = 1, 'biuro widzi faktury (koszty zleceń, materiał, lakiery)');
select pg_temp.sprawdz((select count(*) from platnosci) = 0, 'biuro nie widzi listy płatności');
update ustawienia set platnosci_od = '2020-01-01';
select pg_temp.sprawdz((select platnosci_od from ustawienia) <> '2020-01-01', 'biuro nie zmienia ustawień');
select pg_temp.sprawdz((select count(*) from kolejka_pozycji) = 0, 'biuro nie widzi kolejki Do sprawdzenia');
update profile set rola = 'wlasciciel' where id = '00000000-0000-0000-0000-00000000000d';
reset role;
select pg_temp.sprawdz((select rola from profile where id = '00000000-0000-0000-0000-00000000000d') = 'biuro', 'biuro nie może nadać sobie roli właściciela');
