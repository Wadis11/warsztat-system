-- Materiał: porównanie cen z faktur i ofert, mnożnik opakowania, dostęp tylko dla właściciela.
\set ON_ERROR_STOP on

create function pg_temp.sprawdz(warunek boolean, opis text) returns void language plpgsql as $$
begin
  if not warunek then raise exception 'NIE PRZESZŁO: %', opis; end if;
  raise notice 'ok: %', opis;
end $$;

insert into dostawcy_materialow (nip, nazwa) values ('1110000001', 'Dostawca A'), ('1110000002', 'Dostawca B');
insert into materialy (id, kategoria, nazwa, wariant, jednostka) values
  ('40000000-0000-0000-0000-000000000001', 'Taśmy', 'Taśma', 'Średnia', 'rolka'),
  ('40000000-0000-0000-0000-000000000002', 'Papier wodny', 'Papier wodny', 'P800', 'opak. 50 szt.');
insert into materialy_ceny_ofert (material_id, nip_dostawcy, cena_netto, data) values
  ('40000000-0000-0000-0000-000000000001', '1110000001', 9.00, '2026-10-01'),
  ('40000000-0000-0000-0000-000000000001', '1110000002', 7.00, '2026-10-01'),
  ('40000000-0000-0000-0000-000000000002', '1110000002', 90.00, '2026-10-01');
insert into materialy_kody (material_id, nip_dostawcy, indeks_norm, mnoznik) values
  ('40000000-0000-0000-0000-000000000001', '1110000001', norm_indeks('TA-30'), 1),
  ('40000000-0000-0000-0000-000000000002', '1110000002', norm_indeks('PW-800'), 0.02);

select zapisz_fakture_ksef(jsonb_build_object(
  'nr_ksef', 'M-1', 'kierunek', 'zakup', 'numer', 'FV/M/1', 'nip_kontrahenta', '1110000001',
  'data_wystawienia', '2026-11-10', 'netto', 80, 'vat', 18.4, 'brutto', 98.4, 'xml', '<Faktura/>',
  'pozycje', jsonb_build_array(jsonb_build_object('lp', 1, 'nazwa', 'TAŚMA 30MM', 'indeks', 'TA-30', 'ilosc', 10,
    'cena_netto', 8.00, 'netto', 80, 'wartosc', 80, 'kategoria', 'material', 'sposob', 'brak', 'pewnosc', 0.6))));
select zapisz_fakture_ksef(jsonb_build_object(
  'nr_ksef', 'M-2', 'kierunek', 'zakup', 'numer', 'FV/M/2', 'nip_kontrahenta', '1110000002',
  'data_wystawienia', '2026-11-12', 'netto', 100, 'vat', 23, 'brutto', 123, 'xml', '<Faktura/>',
  'pozycje', jsonb_build_array(
    jsonb_build_object('lp', 1, 'nazwa', 'ARKUSZ P800', 'indeks', 'PW-800', 'ilosc', 50, 'cena_netto', 1.90,
      'netto', 95, 'wartosc', 95, 'kategoria', 'material', 'sposob', 'brak', 'pewnosc', 0.6),
    jsonb_build_object('lp', 2, 'nazwa', 'NIEZNANY', 'indeks', 'X-1', 'ilosc', 1, 'netto', 5, 'wartosc', 5,
      'kategoria', 'material', 'sposob', 'brak', 'pewnosc', 0.6))));

select pg_temp.sprawdz((select cena = 8 and zrodlo = 'faktura' from materialy_porownanie
  where material_id = '40000000-0000-0000-0000-000000000001' and nip = '1110000001'), 'cena z faktury wygrywa z ofertą');
select pg_temp.sprawdz((select cena = 7 and zrodlo = 'oferta' from materialy_porownanie
  where material_id = '40000000-0000-0000-0000-000000000001' and nip = '1110000002'), 'bez faktury: cena z oferty');
select pg_temp.sprawdz((select cena = 95 from materialy_porownanie
  where material_id = '40000000-0000-0000-0000-000000000002' and nip = '1110000002'), 'mnożnik: arkusz 1,90 × 50 = 95 za opakowanie');
select pg_temp.sprawdz((select count(*) from materialy_zakupy where material_id is null) = 1, 'nieprzypisany produkt widoczny do przypisania');
select pg_temp.sprawdz((select wydano_12m from materialy_porownanie
  where material_id = '40000000-0000-0000-0000-000000000001' and nip = '1110000001') = 80, 'wydatki z 12 miesięcy');

-- Lakiery na auto
insert into zlecenia (id, nr_rej, data_przyjecia) values ('42000000-0000-0000-0000-000000000001', 'KR 1234A', '2026-11-10');
select zapisz_fakture_ksef(jsonb_build_object(
  'nr_ksef', 'L-1', 'kierunek', 'zakup', 'numer', 'FV/L/1', 'nip_kontrahenta', '1110000001',
  'data_wystawienia', '2026-11-14', 'netto', 400, 'vat', 92, 'brutto', 492, 'xml', '<Faktura/>',
  'pozycje', jsonb_build_array(
    jsonb_build_object('lp', 1, 'nazwa', 'LAKIER BAZA I/METALIC', 'indeks', 'LB-1', 'ilosc', 0.5, 'jednostka', 'L', 'netto', 150, 'wartosc', 150, 'kategoria', 'lakier', 'sposob', 'brak', 'pewnosc', 0.6),
    jsonb_build_object('lp', 2, 'nazwa', 'LES BCOAT WB 25 Lakier bazowy 1L', 'indeks', 'WB25', 'ilosc', 1, 'jednostka', 'szt.', 'netto', 200, 'wartosc', 200, 'kategoria', 'lakier', 'sposob', 'brak', 'pewnosc', 0.6),
    jsonb_build_object('lp', 3, 'nazwa', 'UTWARDZACZ DO LAKIERU', 'indeks', 'UT', 'ilosc', 1, 'jednostka', 'L', 'netto', 50, 'wartosc', 50, 'kategoria', 'lakier', 'sposob', 'brak', 'pewnosc', 0.6))));
select pg_temp.sprawdz((select count(*) from lakiery_zakupy where faktura = 'FV/L/1') = 1, 'lakier na litry rozpoznany, baza do mieszalnika i utwardzacz nie');
select pg_temp.sprawdz((select status from lakiery_zakupy where faktura = 'FV/L/1') = 'do_przypisania', 'lakier czeka na przypisanie');
select pg_temp.sprawdz((select count(*) from materialy_zakupy where faktura = 'FV/L/1' and lakier) = 1, 'lakier nie trafia do „Do przypisania” w Materiale');
insert into materialy_kody (nip_dostawcy, indeks_norm, lakier) values ('1110000001', norm_indeks('WB25'), true);
select pg_temp.sprawdz((select count(*) from lakiery_zakupy where faktura = 'FV/L/1') = 2, 'produkt oznaczony ręcznie jako lakier');
update pozycje_faktur set zlecenie_id = '42000000-0000-0000-0000-000000000001', zatwierdzono = now() where nazwa = 'LAKIER BAZA I/METALIC';
select pg_temp.sprawdz((select nr_rej from lakiery_zakupy where nazwa = 'LAKIER BAZA I/METALIC') = 'KR 1234A', 'lakier przypisany do zlecenia');

-- Pracownik nie widzi materiałów ani cen
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000a');
insert into profile (id, imie, rola) values ('00000000-0000-0000-0000-00000000000b', 'Pracownik', 'pracownik'),
  ('00000000-0000-0000-0000-00000000000a', 'Właściciel', 'wlasciciel');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select pg_temp.sprawdz((select count(*) from materialy_porownanie) = 0 and (select count(*) from materialy) = 0
  and (select count(*) from zakupy_pomocnicze) = 0, 'pracownik nie widzi materiałów i cen');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.sprawdz((select count(*) from materialy) = 2, 'właściciel widzi katalog');
insert into zakupy_pomocnicze (id, data, sprzedawca) values ('41000000-0000-0000-0000-000000000001', '2026-11-20', 'Sklep internetowy');
insert into zakupy_pomocnicze_pozycje (zakup_id, nazwa, ilosc, wartosc_netto) values ('41000000-0000-0000-0000-000000000001', 'Rękawiczki', 2, 30);
select pg_temp.sprawdz((select utworzyl from zakupy_pomocnicze) = '00000000-0000-0000-0000-00000000000a', 'zakup pomocniczy zapisany z autorem');
reset role;
