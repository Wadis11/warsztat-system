-- Auta zastępcze: numer umowy, brak podwójnej rezerwacji, terminy floty, uprawnienia.
\set ON_ERROR_STOP on

create function pg_temp.sprawdz(warunek boolean, opis text) returns void language plpgsql as $$
begin
  if not warunek then raise exception 'NIE PRZESZŁO: %', opis; end if;
  raise notice 'ok: %', opis;
end $$;

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into profile (id, imie, rola) values ('00000000-0000-0000-0000-00000000000a', 'Właściciel', 'wlasciciel'),
  ('00000000-0000-0000-0000-00000000000b', 'Pracownik', 'pracownik');
insert into auta_zastepcze (id, nr_rej, marka, model, ubezpieczenie_do, przeglad_do, serwis_co_mies) values
  ('50000000-0000-0000-0000-000000000001', 'KR 0001Z', 'SKODA', 'FABIA', '2026-12-10', '2027-03-01', 12);
insert into auta_zastepcze_serwis (auto_id, data, przebieg, opis) values
  ('50000000-0000-0000-0000-000000000001', '2026-06-01', 120000, 'Olej i filtry');

select pg_temp.sprawdz((select data from auta_zastepcze_terminy where rodzaj = 'serwis') = '2027-06-01', 'następny serwis z interwału');
select pg_temp.sprawdz((select count(*) from auta_zastepcze_terminy) = 3, 'ubezpieczenie, przegląd i serwis w terminach');

-- Pracownik wydaje auto
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select set_config('request.jwt.claims', '{"aal":"aal1"}', false);
insert into wypozyczenia (auto_id, rodzaj, wydanie, planowany_zwrot, najemca_nazwa) values
  ('50000000-0000-0000-0000-000000000001', 'najem', '2026-11-23 09:00+01', '2026-11-30 17:00+01', 'Jan Kowalski');
select pg_temp.sprawdz((select numer from wypozyczenia) = 'ZA/2026/0001', 'numer umowy nadany automatycznie');

do $$ begin
  insert into wypozyczenia (auto_id, wydanie, planowany_zwrot, najemca_nazwa) values
    ('50000000-0000-0000-0000-000000000001', '2026-11-28 09:00+01', '2026-12-02 09:00+01', 'Anna Nowak');
  raise exception 'NIE PRZESZŁO: podwójna rezerwacja przyjęta';
exception when exclusion_violation then raise notice 'ok: to samo auto nie może być wydane dwa razy w tym samym czasie';
end $$;

insert into wypozyczenia (auto_id, wydanie, planowany_zwrot, najemca_nazwa) values
  ('50000000-0000-0000-0000-000000000001', '2026-11-30 17:00+01', '2026-12-02 09:00+01', 'Anna Nowak');
select pg_temp.sprawdz((select count(*) from wypozyczenia) = 2, 'kolejne wypożyczenie od chwili zwrotu poprzedniego');

delete from wypozyczenia;
select pg_temp.sprawdz((select count(*) from wypozyczenia) = 2, 'pracownik nie usuwa wypożyczeń');

-- Umówione auto z potrzebą zastępczego
insert into zlecenia (nr_rej, status, termin, zastepcze_potrzebne, data_przyjecia) values ('KR 777AA', 'umowione', '2026-11-25 08:00+01', true, '2026-11-25');
select pg_temp.sprawdz((select count(*) from zlecenia where status = 'umowione' and zastepcze_potrzebne) = 1, 'zlecenie umówione z potrzebą auta zastępczego');
reset role;

-- Elementy na rysunku auta
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into zlecenia_elementy (zlecenie_id, element, czynnosci) select id, 'maska', array['blacharka', 'lakierowanie'] from zlecenia where nr_rej = 'KR 777AA';
select pg_temp.sprawdz((select czynnosci from zlecenia_elementy where element = 'maska') = array['blacharka', 'lakierowanie'], 'pracownik zaznacza element na rysunku');
do $$ begin
  insert into zlecenia_elementy (zlecenie_id, element, czynnosci) select id, 'dach', array['malowanie'] from zlecenia where nr_rej = 'KR 777AA';
  raise exception 'NIE PRZESZŁO: nieznana czynność przyjęta';
exception when check_violation then raise notice 'ok: tylko znane czynności';
end $$;
reset role;
