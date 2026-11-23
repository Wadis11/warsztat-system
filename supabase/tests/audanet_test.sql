-- Lista AudaNet: scalanie kopii, stan z faktur sprzedaży i zleceń, uprawnienia.
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

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000d'), ('00000000-0000-0000-0000-00000000000e');
insert into profile (id, imie, rola) values ('00000000-0000-0000-0000-00000000000d', 'Biuro', 'biuro'),
  ('00000000-0000-0000-0000-00000000000e', 'Lakiernik', 'pracownik');

select zapisz_fakture_ksef(jsonb_build_object('nr_ksef', 'S-1', 'kierunek', 'sprzedaz', 'numer', 'FS/1', 'nip_kontrahenta', '1234567890',
  'data_wystawienia', '2026-11-20', 'netto', 100, 'vat', 23, 'brutto', 123, 'xml', '<Faktura/>', 'pozycje', '[]'::jsonb,
  'teksty', jsonb_build_array('Informacje: BMW X1 WE8FA46  2610230106')));
select zapisz_fakture_ksef(jsonb_build_object('nr_ksef', 'S-2', 'kierunek', 'sprzedaz', 'numer', 'FS/2', 'nip_kontrahenta', '1234567890',
  'data_wystawienia', '2026-09-10', 'netto', 100, 'vat', 23, 'brutto', 123, 'xml', '<Faktura/>', 'pozycje', '[]'::jsonb,
  'teksty', jsonb_build_array('Informacje: Toyota WE 7HX58')));

select pg_temp.sprawdz(nowe = 4 and zaktualizowane = 0, 'import: 5 wierszy, 4 sprawy') from importuj_audanet('[
  {"nr_szkody":"2610230106","vin":"WBA21EF0405178682","nr_rej":"we8fa46","producent":"BMW [01]","netto":"4316.85","brutto":"5309.73","utworzono":"2026-11-16T09:38:00+01:00"},
  {"nr_szkody":"2610090065","vin":"NMTBD3BE20R085071","nr_rej":"WE7HX58","netto":"10449.65","utworzono":"2026-10-15T08:20:00+02:00"},
  {"nr_szkody":"2610090065","vin":"NMTBD3BE20R085071","nr_rej":"WE7HX58","netto":"10449.65","utworzono":"2026-10-19T08:19:00+02:00"},
  {"nr_szkody":"2605150055","vin":"NMTBD3BE20R085071","nr_rej":"WE7HX58","netto":"2296.85","utworzono":"2026-05-22T17:45:00+02:00"},
  {"nr_szkody":"2611200089","vin":"VR3KAHPY1TS084658","nr_rej":"WPR078CF","utworzono":"2026-11-23T09:12:00+01:00"}
]'::jsonb);
select pg_temp.sprawdz((select kopii = 2 and pierwsze_utworzenie < ostatnie_utworzenie from audanet_sprawy where nr_szkody = '2610090065'), 'kopie scalone');
select pg_temp.sprawdz((select nr_rej from audanet_sprawy where nr_szkody = '2610230106') = 'WE8FA46', 'rejestracja znormalizowana');
select pg_temp.sprawdz((select stan || ' ' || faktura_szkoda from audanet_stan where nr_szkody = '2610230106') = 'zafakturowana FS/1', 'faktura po numerze szkody');
select pg_temp.sprawdz((select stan from audanet_stan where nr_szkody = '2605150055') = 'zafakturowana_rej', 'faktura po rejestracji wystawiona po sprawie');
select pg_temp.sprawdz((select stan from audanet_stan where nr_szkody = '2610090065') = 'otwarta', 'faktura sprzed sprawy jej nie zamyka');
select pg_temp.sprawdz((select inne_szkody_auta from audanet_stan where nr_szkody = '2610090065') = 1, 'inne szkody tego samego auta');

select pg_temp.sprawdz(nowe = 0 and zaktualizowane = 1, 'ponowny import aktualizuje') from importuj_audanet('[
  {"nr_szkody":"2611200089","vin":"VR3KAHPY1TS084658","nr_rej":"WPR078CF","netto":"3000","utworzono":"2026-11-23T10:00:00+01:00"}]'::jsonb);
select pg_temp.sprawdz((select netto from audanet_sprawy where nr_szkody = '2611200089') = 3000, 'kalkulacja dopisana');

insert into zlecenia (nr_rej, nr_szkody, data_przyjecia) values ('WPR078CF', '2611200089', '2026-11-23');
select pg_temp.sprawdz((select stan from audanet_stan where nr_szkody = '2611200089') = 'zlecenie', 'sprawa ze zleceniem w aplikacji');

set role authenticated;
select pg_temp.jako('00000000-0000-0000-0000-00000000000d');
update audanet_sprawy set ukryta = true where nr_szkody = '2610090065';
select pg_temp.sprawdz((select stan from audanet_stan where nr_szkody = '2610090065') = 'ukryta', 'biuro ukrywa sprawę');
select pg_temp.jako('00000000-0000-0000-0000-00000000000e');
select pg_temp.sprawdz((select count(*) from audanet_stan) = 0, 'pracownik nie widzi listy AudaNet (kwoty)');
reset role;
