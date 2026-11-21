-- Test zapisu faktury z KSeF i listy kandydatów do dopasowania.
\set ON_ERROR_STOP on

create function pg_temp.sprawdz(warunek boolean, opis text) returns void language plpgsql as $$
begin
  if not warunek then raise exception 'NIE PRZESZŁO: %', opis; end if;
  raise notice 'ok: %', opis;
end $$;

insert into zlecenia (id, nr_rej, vin, data_przyjecia) values
  ('30000000-0000-0000-0000-000000000001', 'WE 5V073', 'WF0FXXWPCHME30786', '2026-11-10');
insert into kosztorysy (id, zlecenie_id, wersja, zrodlo, netto) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'zlozony', 'audatex', 1000);
insert into kosztorysy_czesci (kosztorys_id, nazwa, nr_katalogowy, cena) values
  ('31000000-0000-0000-0000-000000000001', 'ZDERZAK T', '1 904 748', 900),
  ('31000000-0000-0000-0000-000000000001', 'BEZ NUMERU', null, 100);

select pg_temp.sprawdz((select indeksy from kandydaci_dopasowania()
                        where id = '30000000-0000-0000-0000-000000000001') = array['1904748'],
                       'kandydat ma znormalizowane numery katalogowe z kosztorysu');

select zapisz_fakture_ksef(jsonb_build_object(
  'nr_ksef', 'KSEF-1', 'kierunek', 'zakup', 'numer', 'FV/1', 'nip_kontrahenta', '9990000001',
  'data_wystawienia', '2026-11-19', 'netto', 2457.25, 'vat', 565.17, 'brutto', 3022.42,
  'teksty', jsonb_build_array('Uwagi: Zlecenie 26-0001'), 'xml', '<Faktura/>',
  'pozycje', jsonb_build_array(
    jsonb_build_object('lp', 1, 'nazwa', 'ZDERZAK TYLNY', 'indeks', '1 904 748', 'netto', 2270, 'wartosc', 2270,
      'kategoria', 'czesc', 'zlecenie_id', '30000000-0000-0000-0000-000000000001', 'sposob', 'nr_zlecenia', 'pewnosc', 0.99),
    jsonb_build_object('lp', 2, 'nazwa', 'SPINKA', 'netto', 187.25, 'wartosc', 187.25,
      'kategoria', 'czesc', 'sposob', 'brak', 'pewnosc', 0.5,
      'propozycje', jsonb_build_array('30000000-0000-0000-0000-000000000001'))
  )));

select pg_temp.sprawdz((select count(*) from pozycje_faktur) = 2, 'zapisane obie pozycje');
select pg_temp.sprawdz((select count(*) from pozycje_faktur where zatwierdzono is null) = 1,
                       'niepewna pozycja czeka w kolejce, pewna zatwierdzona');
select pg_temp.sprawdz((select propozycje from pozycje_faktur where lp = 2)
                       = array['30000000-0000-0000-0000-000000000001']::uuid[], 'propozycje zapisane');

-- ponowny zapis tej samej faktury nie dubluje danych
select zapisz_fakture_ksef(jsonb_build_object('nr_ksef', 'KSEF-1', 'kierunek', 'zakup', 'numer', 'FV/1',
  'data_wystawienia', '2026-11-19', 'netto', 1, 'vat', 0, 'brutto', 1, 'xml', '<x/>'));
select pg_temp.sprawdz((select count(*) from faktury) = 1 and (select count(*) from pozycje_faktur) = 2,
                       'ponowny zapis niczego nie dubluje');

-- korekta wskazuje fakturę pierwotną po numerze KSeF
select zapisz_fakture_ksef(jsonb_build_object('nr_ksef', 'KSEF-2', 'kierunek', 'zakup', 'rodzaj', 'KOR', 'numer', 'KOR/1',
  'data_wystawienia', '2026-11-21', 'netto', -187.25, 'vat', -43.07, 'brutto', -230.32, 'xml', '<x/>',
  'korygowana_nr_ksef', 'KSEF-1'));
select pg_temp.sprawdz((select korygowana_id from faktury where nr_ksef = 'KSEF-2')
                       = (select id from faktury where nr_ksef = 'KSEF-1'), 'korekta powiązana z fakturą pierwotną');

-- użytkownik aplikacji nie może wywołać funkcji zapisu
set role authenticated;
do $$ begin
  perform zapisz_fakture_ksef('{}'::jsonb);
  raise exception 'NIE PRZESZŁO: użytkownik wywołał zapis faktury';
exception when insufficient_privilege then raise notice 'ok: użytkownik NIE wywoła zapisu faktury';
end $$;
reset role;

-- faktury sprzed granicy kolejki nie trafiają do kolejki
update ustawienia set kolejka_od = '2026-11-20';
select pg_temp.sprawdz((select count(*) from kolejka_pozycji) = 0, 'faktura sprzed granicy nie jest w kolejce');
update ustawienia set kolejka_od = '2026-11-01';
select pg_temp.sprawdz((select count(*) from kolejka_pozycji) = 1, 'faktura po granicy z niepewną pozycją jest w kolejce');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
select pg_temp.sprawdz((select count(*) from kolejka_pozycji) = 0, 'obcy użytkownik nie widzi kolejki');
reset role;

-- ---- Płatności: dane z sekcji Platnosc ----
create function pg_temp.faktura(nr text, xml text, brutto numeric) returns void language sql as $$
  select zapisz_fakture_ksef(jsonb_build_object('nr_ksef', nr, 'kierunek', 'zakup', 'numer', nr, 'nip_kontrahenta', '9990000002',
    'data_wystawienia', '2026-11-15', 'netto', round(brutto / 1.23, 2), 'vat', brutto - round(brutto / 1.23, 2), 'brutto', brutto,
    'xml', xml, 'pozycje', '[]'::jsonb));
$$;
select pg_temp.faktura('P-PRZELEW', '<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Fa><KodWaluty>PLN</KodWaluty><Adnotacje><P_18A>1</P_18A></Adnotacje>
<Platnosc><TerminPlatnosci><Termin>2026-12-05</Termin></TerminPlatnosci><FormaPlatnosci>6</FormaPlatnosci>
<RachunekBankowy><NrRB>11 1090 1665 0000 0001 3222 7458</NrRB><NazwaBanku>Bank Testowy</NazwaBanku></RachunekBankowy></Platnosc></Fa></Faktura>', 18450);
select pg_temp.faktura('P-PREFIKS', '<n0:Faktura xmlns:n0="http://crd.gov.pl/wzor/2025/06/25/13775/"><n0:Fa><n0:Platnosc><n0:Zaplacono>1</n0:Zaplacono>
<n0:DataZaplaty>2026-11-15</n0:DataZaplaty></n0:Platnosc></n0:Fa></n0:Faktura>', 569.50);
select pg_temp.faktura('P-CZESC', '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Fa><Platnosc><ZnacznikZaplatyCzesciowej>1</ZnacznikZaplatyCzesciowej>
<ZaplataCzesciowa><KwotaZaplatyCzesciowej>100.00</KwotaZaplatyCzesciowej><DataZaplatyCzesciowej>2026-11-15</DataZaplatyCzesciowej></ZaplataCzesciowa>
<TerminPlatnosci><Termin>2026-10-20</Termin></TerminPlatnosci><RachunekBankowy><NrRB>70102010264321605100770094</NrRB><RachunekWlasnyBanku>1</RachunekWlasnyBanku></RachunekBankowy></Platnosc></Fa></Faktura>', 300);
select pg_temp.faktura('P-ZEPSUTA', '<to nie jest xml', 50);

select pg_temp.sprawdz((select termin_platnosci = '2026-12-05' and rachunek = '11109016650000000132227458' and mpp and forma_platnosci = 6
                        and bank = 'Bank Testowy' and do_zaplaty = 18450 from faktury where nr_ksef = 'P-PRZELEW'),
                       'przelew: termin, rachunek bez spacji, bank, MPP, kwota');
select pg_temp.sprawdz((select status from platnosci where nr_ksef = 'P-PRZELEW') = 'do_zaplaty', 'przelew czeka na zapłatę');
select pg_temp.sprawdz((select status = 'zaplacona_wg_faktury' and do_zaplaty = 0 from platnosci where nr_ksef = 'P-PREFIKS'),
                       'faktura z prefiksem n0: zapłacona według faktury');
select pg_temp.sprawdz((select do_zaplaty = 200 and rachunek_wirtualny from faktury where nr_ksef = 'P-CZESC'),
                       'zapłata częściowa pomniejsza kwotę, rachunek wirtualny rozpoznany');
select pg_temp.sprawdz((select status from platnosci where nr_ksef = 'P-CZESC') = 'archiwum', 'termin sprzed granicy: archiwum');
select pg_temp.sprawdz((select termin_platnosci is null and do_zaplaty = 50 from faktury where nr_ksef = 'P-ZEPSUTA'),
                       'uszkodzony XML nie blokuje zapisu faktury');
update faktury set oplacono = '2026-11-21' where nr_ksef = 'P-PRZELEW';
select pg_temp.sprawdz((select status from platnosci where nr_ksef = 'P-PRZELEW') = 'zaplacona', 'oznaczenie zapłaty');

-- Adres dostawcy do przelewu
select pg_temp.faktura('P-ADRES', '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Podmiot1><Adres><KodKraju>PL</KodKraju>
<AdresL1>UL. DŁUGA  5</AdresL1><AdresL2>30-001 Kraków</AdresL2></Adres></Podmiot1><Podmiot2><Adres><AdresL1>INNY</AdresL1></Adres></Podmiot2>
<Fa><Platnosc><TerminPlatnosci><Termin>2026-12-01</Termin></TerminPlatnosci></Platnosc></Fa></Faktura>', 100);
select pg_temp.sprawdz((select adres_kontrahenta from platnosci where nr_ksef = 'P-ADRES') = 'UL. DŁUGA 5|30-001 Kraków',
                       'adres sprzedawcy z faktury zakupu');
