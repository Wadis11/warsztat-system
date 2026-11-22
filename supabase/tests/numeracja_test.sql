-- Numeracja zleceń w rodzajach: NN/MM/RRRR, osobno dla każdego rodzaju i miesiąca.
\set ON_ERROR_STOP on
create function pg_temp.sprawdz(warunek boolean, opis text) returns void language plpgsql as $$
begin
  if not warunek then raise exception 'NIE PRZESZŁO: %', opis; end if;
  raise notice 'ok: %', opis;
end $$;

insert into klienci (id, nazwa, segment) values
  ('70000000-0000-0000-0000-000000000001', 'Ayvens', 'ayvens'),
  ('70000000-0000-0000-0000-000000000002', 'PZU', 'ubezpieczyciel'),
  ('70000000-0000-0000-0000-000000000003', 'Wadowscy Sp. z o.o.', 'powiazany');
insert into zlecenia (nr_rej, klient_id, data_przyjecia) values
  ('A1', '70000000-0000-0000-0000-000000000001', '2026-11-03'),
  ('A2', '70000000-0000-0000-0000-000000000001', '2026-11-05'),
  ('U1', '70000000-0000-0000-0000-000000000002', '2026-11-05'),
  ('P1', null, '2026-11-06'),
  ('W1', '70000000-0000-0000-0000-000000000003', '2026-11-06'),
  ('A3', '70000000-0000-0000-0000-000000000001', '2026-12-01');

select pg_temp.sprawdz((select numer_rodzaju from zlecenia where nr_rej = 'A2') = '02/11/2026', 'Ayvens: kolejny numer w miesiącu');
select pg_temp.sprawdz((select numer_rodzaju from zlecenia where nr_rej = 'U1') = '01/11/2026', 'ubezpieczenie: osobna numeracja od 01');
select pg_temp.sprawdz((select rodzaj::text || ' ' || numer_rodzaju from zlecenia where nr_rej = 'P1') = 'prywatne 01/11/2026', 'bez klienta: naprawa prywatna');
select pg_temp.sprawdz((select rodzaj from zlecenia where nr_rej = 'W1') = 'powiazani', 'firma powiązana');
select pg_temp.sprawdz((select numer_rodzaju from zlecenia where nr_rej = 'A3') = '01/12/2026', 'nowy miesiąc od 01');
select pg_temp.sprawdz((select numer from zlecenia where nr_rej = 'A1') ~ '^\d\d-\d{4}$', 'numer wewnętrzny bez zmian');
update zlecenia set rodzaj = 'ubezpieczenie' where nr_rej = 'P1';
select pg_temp.sprawdz((select numer_rodzaju from zlecenia where nr_rej = 'P1') = '02/11/2026', 'zmiana rodzaju: numer w nowym rodzaju');
