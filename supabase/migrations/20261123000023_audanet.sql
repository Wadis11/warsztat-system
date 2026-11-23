-- Lista spraw z AudaNet (eksport „Master Worklist” CSV).
-- Jedna sprawa = jeden numer szkody; kopie zadań z tym samym numerem scalają się.
-- Stan liczony z bazy: zlecenie w aplikacji / faktura sprzedaży z tym nr szkody lub rejestracją / ukryta / otwarta.

create table audanet_sprawy (
  nr_szkody text primary key,
  vin text,
  nr_rej text,
  producent text,
  model text,
  status_biznesowy text,
  typ_szkody text,
  netto numeric(12,2),
  brutto numeric(12,2),
  pierwsze_utworzenie timestamptz not null,
  ostatnie_utworzenie timestamptz not null,
  kopii int not null default 1,
  ukryta boolean not null default false,
  ukryl uuid references auth.users(id),
  zaimportowano timestamptz not null default now()
);
create index on audanet_sprawy (vin);
create index on audanet_sprawy (nr_rej);

alter table audanet_sprawy enable row level security;
create policy audanet_czytaj on audanet_sprawy for select to authenticated using (ma_dostep_do_kwot());
create policy audanet_dodaj on audanet_sprawy for insert to authenticated with check (ma_dostep_do_kwot());
create policy audanet_zmien on audanet_sprawy for update to authenticated using (ma_dostep_do_kwot()) with check (ma_dostep_do_kwot());
create policy audanet_usun on audanet_sprawy for delete to authenticated using (jest_wlascicielem());
grant select, insert, update, delete on audanet_sprawy to authenticated;

create function norm_rej(t text) returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

-- Import: tablica obiektów {nr_szkody, vin, nr_rej, producent, model, status_biznesowy, typ_szkody, netto, brutto, utworzono}.
-- Wiersze z tym samym numerem szkody (też w jednym pliku) scalają się; kwoty i status z najnowszej kopii.
create function importuj_audanet(wiersze jsonb) returns table (nowe int, zaktualizowane int)
language plpgsql security invoker set search_path = public as $$
declare n int := 0; z int := 0; r record; byl boolean;
begin
  for r in
    select distinct on (w->>'nr_szkody')
      trim(w->>'nr_szkody') nr, nullif(upper(trim(w->>'vin')), '') vin, norm_rej(w->>'nr_rej') rej,
      nullif(trim(w->>'producent'), '') producent, nullif(trim(w->>'model'), '') model,
      nullif(trim(w->>'status_biznesowy'), '') status, nullif(trim(w->>'typ_szkody'), '') typ,
      (w->>'netto')::numeric netto, (w->>'brutto')::numeric brutto,
      (select min((x->>'utworzono')::timestamptz) from jsonb_array_elements(wiersze) x where x->>'nr_szkody' = w->>'nr_szkody') pierwsze,
      (w->>'utworzono')::timestamptz ostatnie,
      (select count(*) from jsonb_array_elements(wiersze) x where x->>'nr_szkody' = w->>'nr_szkody')::int kopii
    from jsonb_array_elements(wiersze) w
    where coalesce(trim(w->>'nr_szkody'), '') <> ''
    order by w->>'nr_szkody', (w->>'netto') is null, (w->>'utworzono')::timestamptz desc
  loop
    select true into byl from audanet_sprawy where nr_szkody = r.nr;
    insert into audanet_sprawy as s (nr_szkody, vin, nr_rej, producent, model, status_biznesowy, typ_szkody, netto, brutto,
                                     pierwsze_utworzenie, ostatnie_utworzenie, kopii)
    values (r.nr, r.vin, r.rej, r.producent, r.model, r.status, r.typ, r.netto, r.brutto, r.pierwsze, r.ostatnie, r.kopii)
    on conflict (nr_szkody) do update set
      vin = coalesce(excluded.vin, s.vin), nr_rej = coalesce(excluded.nr_rej, s.nr_rej),
      producent = coalesce(excluded.producent, s.producent), model = coalesce(excluded.model, s.model),
      status_biznesowy = coalesce(excluded.status_biznesowy, s.status_biznesowy),
      typ_szkody = coalesce(excluded.typ_szkody, s.typ_szkody),
      netto = coalesce(excluded.netto, s.netto), brutto = coalesce(excluded.brutto, s.brutto),
      pierwsze_utworzenie = least(s.pierwsze_utworzenie, excluded.pierwsze_utworzenie),
      ostatnie_utworzenie = greatest(s.ostatnie_utworzenie, excluded.ostatnie_utworzenie),
      kopii = greatest(s.kopii, excluded.kopii),
      zaimportowano = now();
    if coalesce(byl, false) then z := z + 1; else n := n + 1; end if;
    byl := null;
  end loop;
  return query select n, z;
end $$;

-- Stan sprawy. Faktura „po szkodzie” = numer szkody w opisie faktury sprzedaży (pewne).
-- „Po rejestracji” = rejestracja w opisie faktury wystawionej po utworzeniu sprawy (prawdopodobne —
-- przy kilku szkodach jednego auta jedna faktura może obejmować tylko część).
create view audanet_stan with (security_invoker = true) as
select s.*,
  z.id as zlecenie_id, z.numer_rodzaju as zlecenie_numer, z.status::text as zlecenie_status,
  fs.numer as faktura_szkoda, fs.data_wystawienia as faktura_szkoda_data,
  fr.numer as faktura_rej, fr.data_wystawienia as faktura_rej_data,
  (select count(*) from audanet_sprawy o where o.nr_szkody <> s.nr_szkody and o.vin = s.vin)::int as inne_szkody_auta,
  case
    when z.id is not null then 'zlecenie'
    when fs.numer is not null then 'zafakturowana'
    when s.ukryta then 'ukryta'
    when fr.numer is not null then 'zafakturowana_rej'
    else 'otwarta'
  end as stan
from audanet_sprawy s
left join lateral (
  select id, numer_rodzaju, status from zlecenia
  where zlecenia.nr_szkody = s.nr_szkody order by utworzono desc limit 1) z on true
left join lateral (
  select numer, data_wystawienia from faktury f
  where f.kierunek = 'sprzedaz' and array_to_string(f.teksty, ' ') like '%' || s.nr_szkody || '%'
  order by data_wystawienia limit 1) fs on true
left join lateral (
  select numer, data_wystawienia from faktury f
  where f.kierunek = 'sprzedaz' and s.nr_rej is not null
    and f.data_wystawienia >= s.pierwsze_utworzenie::date
    and norm_rej(array_to_string(f.teksty, ' ')) like '%' || s.nr_rej || '%'
  order by data_wystawienia limit 1) fr on true;
grant select on audanet_stan to authenticated;
