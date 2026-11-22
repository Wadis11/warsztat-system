-- Osobna numeracja w każdym rodzaju zlecenia: NN/MM/RRRR, od 01 w każdym miesiącu.
-- Dotychczasowy numer (26-0001) zostaje jako numer wewnętrzny: podają go pracownicy przy mieszalniku,
-- dostawcy na fakturach i po nim dopasowujemy koszty.

alter table zlecenia
  add column rodzaj rodzaj_zlecenia,
  add column numer_rodzaju text;

create table liczniki_rodzajow (
  rodzaj  rodzaj_zlecenia not null,
  rok     int not null,
  miesiac int not null,
  ostatni int not null,
  primary key (rodzaj, rok, miesiac)
);
alter table liczniki_rodzajow enable row level security;  -- tylko przez funkcję nadającą numer

create function rodzaj_z_klienta(klient uuid) returns rodzaj_zlecenia
  language sql stable security definer set search_path = public
as $$
  select case k.segment::text
    when 'ayvens' then 'ayvens' when 'ubezpieczyciel' then 'ubezpieczenie'
    when 'prywatny' then 'prywatne' when 'powiazany' then 'powiazani' else 'inne' end::rodzaj_zlecenia
  from klienci k where k.id = klient
$$;

create function nadaj_numer_rodzaju() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  d date := coalesce(new.data_przyjecia, current_date);
  n int;
begin
  if new.rodzaj is null then
    new.rodzaj := coalesce(rodzaj_z_klienta(new.klient_id), 'prywatne');
  end if;
  -- Nowy numer przy zakładaniu albo po zmianie rodzaju (numer w starym rodzaju przepada)
  if tg_op = 'INSERT' or new.rodzaj is distinct from old.rodzaj or new.numer_rodzaju is null then
    insert into liczniki_rodzajow (rodzaj, rok, miesiac, ostatni)
    values (new.rodzaj, extract(year from d), extract(month from d), 1)
    on conflict (rodzaj, rok, miesiac) do update set ostatni = liczniki_rodzajow.ostatni + 1
    returning ostatni into n;
    new.numer_rodzaju := lpad(n::text, 2, '0') || '/' || to_char(d, 'MM/YYYY');
  end if;
  return new;
end $$;
create trigger zlecenia_numer_rodzaju before insert or update of rodzaj on zlecenia
  for each row execute function nadaj_numer_rodzaju();

-- Istniejące zlecenia: rodzaj z klienta, numery w kolejności założenia
do $$
declare z record;
begin
  for z in select id from zlecenia order by utworzono loop
    update zlecenia set rodzaj = coalesce(rodzaj_z_klienta(klient_id), 'prywatne') where id = z.id;
  end loop;
end $$;
alter table zlecenia alter column rodzaj set not null;
create unique index zlecenia_numer_rodzaju_uq on zlecenia (rodzaj, numer_rodzaju);

-- Wyniki z rodzajem i numerem (kolumny dopisane na końcu widoku)
create or replace view zlecenia_wyniki with (security_invoker = true) as
select
  z.id, z.numer, z.nr_rej, z.marka, z.model, z.status, z.data_przyjecia, z.data_wydania,
  kl.nazwa as klient, kl.segment,
  k.wersja as wersja_kosztorysu, k.netto as przychod_kosztorys,
  coalesce(k.rbh_blach, 0) + coalesce(k.rbh_lak, 0) as rbh,
  (select sum(f.netto) from faktury f where f.zlecenie_id = z.id and f.kierunek = 'sprzedaz') as przychod_faktura,
  (select coalesce(sum(p.wartosc), 0) from pozycje_faktur p where p.zlecenie_id = z.id and p.kategoria = 'czesc') as koszt_czesci,
  (select coalesce(sum(p.wartosc), 0) from pozycje_faktur p
    where p.zlecenie_id = z.id and p.kategoria in ('lakier', 'material')) as koszt_lakier_materialy,
  (select count(*) from pozycje_faktur p where p.zlecenie_id = z.id) as pozycji_kosztowych,
  z.klient_id, z.rodzaj, z.numer_rodzaju
from zlecenia z
left join klienci kl on kl.id = z.klient_id
left join lateral (
  select * from kosztorysy ks where ks.zlecenie_id = z.id
  order by (ks.wersja = 'zaakceptowany') desc, ks.utworzono desc limit 1
) k on true;
