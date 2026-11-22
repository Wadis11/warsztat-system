-- Materiał: katalog produktów, powiązanie z kodami dostawców, porównanie cen, zakupy pomocnicze spoza KSeF.
-- Wszystko z kwotami: tylko właściciel.

create table materialy (
  id          uuid primary key default gen_random_uuid(),
  kategoria   text not null,
  nazwa       text not null,
  wariant     text,
  jednostka   text,            -- jednostka porównania cen, np. szt, L, rolka 50m, opak. 10 szt.
  uwagi       text,
  aktywny     boolean not null default true,
  arkusz_wiersz int unique,    -- wiersz z arkusza „WYCENA”, z którego pochodzi pozycja
  utworzono   timestamptz not null default now()
);

-- Dostawcy, których faktury trafiają do zakładki Materiał
create table dostawcy_materialow (
  nip    text primary key,
  nazwa  text not null,
  rodzaj text not null default 'glowny' check (rodzaj in ('glowny', 'pomocniczy'))
);

-- Produkt dostawcy (kod z faktury) przypisany do pozycji katalogu.
-- mnoznik: ile jednostek katalogu jest w jednej jednostce z faktury (np. arkusz z paczki 50 szt. = 0,02).
create table materialy_kody (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid references materialy (id) on delete cascade,
  nip_dostawcy text not null,
  indeks_norm  text not null,
  nazwa_dostawcy text,
  mnoznik      numeric(12, 6) not null default 1 check (mnoznik > 0),
  pominiety    boolean not null default false,   -- np. lakier mieszany na kolor: nie porównujemy
  unique (nip_dostawcy, indeks_norm),
  constraint materialy_kody_cel check (pominiety or material_id is not null)
);

-- Ceny z ofert i cenników (np. arkusz), gdy nie ma jeszcze faktury
create table materialy_ceny_ofert (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references materialy (id) on delete cascade,
  nip_dostawcy text not null,
  cena_netto   numeric(12, 2) not null,
  data         date not null default current_date,
  zrodlo       text not null default 'reczna'
);
create index materialy_ceny_ofert_idx on materialy_ceny_ofert (material_id, nip_dostawcy, data desc);

-- Zakupy pomocnicze spoza KSeF (internet, paragon)
create table zakupy_pomocnicze (
  id         uuid primary key default gen_random_uuid(),
  data       date not null,
  sprzedawca text not null,
  numer      text,
  plik       text,             -- ścieżka w magazynie 'zakupy'
  utworzono  timestamptz not null default now(),
  utworzyl   uuid references auth.users (id) default auth.uid()
);
create table zakupy_pomocnicze_pozycje (
  id         uuid primary key default gen_random_uuid(),
  zakup_id   uuid not null references zakupy_pomocnicze (id) on delete cascade,
  nazwa      text not null,
  ilosc      numeric(12, 3) not null default 1,
  jednostka  text,
  cena_netto numeric(12, 2),   -- za jednostkę
  wartosc_netto numeric(12, 2) not null,
  stawka_vat numeric(4, 2) default 23
);

do $$
declare t text;
begin
  foreach t in array array['materialy', 'dostawcy_materialow', 'materialy_kody', 'materialy_ceny_ofert',
                           'zakupy_pomocnicze', 'zakupy_pomocnicze_pozycje'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (jest_wlascicielem()) with check (jest_wlascicielem())', t || '_wlasciciel', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on %I from anon', t); end if;
    execute format('create trigger %I after insert or update or delete on %I for each row execute function zapisz_zmiane()', t || '_rejestr', t);
  end loop;
end $$;

-- Zakupy materiałów z faktur KSeF: jedna linia = jedna pozycja faktury od dostawcy materiałów.
-- Cena za jednostkę katalogu = cena z faktury / mnożnik. Wiersze „stan przed” korekty pomijamy.
create view materialy_zakupy with (security_invoker = true) as
select
  p.id as pozycja_id, f.id as faktura_id, f.numer as faktura, f.data_wystawienia as data,
  f.nip_kontrahenta as nip, d.nazwa as dostawca, d.rodzaj,
  p.indeks, norm_indeks(p.indeks) as indeks_norm, p.nazwa, p.ilosc, p.jednostka,
  round(coalesce(p.cena_netto, p.wartosc / nullif(p.ilosc, 0)), 4) as cena_netto,
  p.wartosc,
  k.material_id, k.mnoznik,
  round(coalesce(p.cena_netto, p.wartosc / nullif(p.ilosc, 0)) / k.mnoznik, 4) as cena_katalogowa,
  f.rodzaj like 'KOR%' as korekta,
  coalesce(k.pominiety, false) as pominiety
from pozycje_faktur p
join faktury f on f.id = p.faktura_id and f.kierunek = 'zakup'
join dostawcy_materialow d on d.nip = f.nip_kontrahenta
left join materialy_kody k on k.nip_dostawcy = f.nip_kontrahenta and k.indeks_norm = norm_indeks(p.indeks)
where not p.stan_przed;

-- Porównanie: dla każdego produktu i głównego dostawcy ostatnia cena z faktury, a bez faktury ostatnia oferta.
create view materialy_porownanie with (security_invoker = true) as
select
  m.id as material_id, m.kategoria, m.nazwa, m.wariant, m.jednostka, m.uwagi, m.aktywny,
  d.nip, d.nazwa as dostawca,
  fz.cena_katalogowa as cena_faktura, fz.data as data_faktury,
  o.cena_netto as cena_oferta, o.data as data_oferty,
  coalesce(fz.cena_katalogowa, o.cena_netto) as cena,
  case when fz.cena_katalogowa is not null then 'faktura' when o.cena_netto is not null then 'oferta' end as zrodlo,
  (select coalesce(sum(z.wartosc), 0) from materialy_zakupy z
    where z.material_id = m.id and z.nip = d.nip and z.data >= current_date - 365) as wydano_12m
from materialy m
cross join dostawcy_materialow d
left join lateral (
  select z.cena_katalogowa, z.data from materialy_zakupy z
  where z.material_id = m.id and z.nip = d.nip and not z.korekta and z.cena_katalogowa > 0
  order by z.data desc limit 1
) fz on true
left join lateral (
  select c.cena_netto, c.data from materialy_ceny_ofert c
  where c.material_id = m.id and c.nip_dostawcy = d.nip order by c.data desc limit 1
) o on true
where d.rodzaj = 'glowny';

grant select on materialy_zakupy, materialy_porownanie to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on materialy_zakupy, materialy_porownanie from anon;
  end if;
end $$;

-- Pliki faktur zakupów pomocniczych
insert into storage.buckets (id, name, public) values ('zakupy', 'zakupy', false) on conflict (id) do nothing;
create policy zakupy_wlasciciel on storage.objects for all to authenticated
  using (bucket_id = 'zakupy' and jest_wlascicielem()) with check (bucket_id = 'zakupy' and jest_wlascicielem());
