-- =====================================================================
-- Synchronizacja KSeF: osobne punkty kontynuacji dla zakupów i sprzedaży,
-- teksty odniesień z faktury, propozycje dopasowań, zapis faktury w jednej transakcji.
-- =====================================================================

alter table synchronizacja_ksef
  add column punkt_zakupy   timestamptz,
  add column punkt_sprzedaz timestamptz,
  add column ostatni_raport jsonb;
alter table synchronizacja_ksef drop column pobrano_do;
insert into synchronizacja_ksef (id) values (1) on conflict do nothing;

alter table faktury
  add column rodzaj text not null default 'VAT',
  add column teksty text[] not null default '{}';   -- uwagi, nr zamówień, stopka: tu dostawca podaje nr zlecenia

alter table pozycje_faktur
  add column stan_przed boolean not null default false,  -- korekta: wiersz „przed”, liczony ze znakiem minus
  add column wartosc    numeric(12, 2),                   -- wartość do rozliczenia (ze znakiem)
  add column propozycje uuid[] not null default '{}';    -- zlecenia do wyboru w kolejce

-- Otwarte zlecenia, do których mogą trafić nowe koszty, z numerami katalogowymi z kosztorysów.
-- „Otwarte” = nieanulowane i wydane najwyżej 60 dni temu (faktury bywają spóźnione).
create function kandydaci_dopasowania() returns table (
  id uuid, numer text, nr_rej text, vin text, indeksy text[]
)
  language sql stable security definer set search_path = public
as $$
  select z.id, z.numer, z.nr_rej, z.vin,
         coalesce(array_agg(distinct norm_indeks(kc.nr_katalogowy))
                  filter (where norm_indeks(kc.nr_katalogowy) is not null), '{}')
  from zlecenia z
  left join kosztorysy k on k.zlecenie_id = z.id
  left join kosztorysy_czesci kc on kc.kosztorys_id = k.id
  where z.status <> 'anulowane'
    and (z.data_wydania is null or z.data_wydania >= current_date - 60)
  group by z.id;
$$;

-- Zapis faktury z pozycjami w jednej transakcji. Ponowny zapis tej samej faktury niczego nie zmienia.
-- Wejście: obiekt JSON przygotowany przez funkcję synchronizacji (zob. supabase/functions/ksef-sync).
create function zapisz_fakture_ksef(p jsonb) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  fid uuid;
  poz jsonb;
begin
  insert into faktury (nr_ksef, kierunek, rodzaj, numer, nip_kontrahenta, nazwa_kontrahenta, data_wystawienia,
                       netto, vat, brutto, korygowana_id, zlecenie_id, teksty, xml)
  values (
    p ->> 'nr_ksef', p ->> 'kierunek', coalesce(p ->> 'rodzaj', 'VAT'), p ->> 'numer',
    p ->> 'nip_kontrahenta', p ->> 'nazwa_kontrahenta', (p ->> 'data_wystawienia')::date,
    (p ->> 'netto')::numeric, (p ->> 'vat')::numeric, (p ->> 'brutto')::numeric,
    (select id from faktury where nr_ksef = p ->> 'korygowana_nr_ksef'),
    nullif(p ->> 'zlecenie_id', '')::uuid,
    coalesce(array(select jsonb_array_elements_text(p -> 'teksty')), '{}'),
    p ->> 'xml'
  )
  on conflict (nr_ksef) do nothing
  returning id into fid;

  if fid is null then
    return (select id from faktury where nr_ksef = p ->> 'nr_ksef');
  end if;

  for poz in select * from jsonb_array_elements(coalesce(p -> 'pozycje', '[]'))
  loop
    insert into pozycje_faktur (faktura_id, lp, indeks, nazwa, ilosc, jednostka, cena_netto, netto, stan_przed, wartosc,
                                kategoria, zlecenie_id, sposob, pewnosc, propozycje, zatwierdzono)
    values (
      fid, (poz ->> 'lp')::int, poz ->> 'indeks', poz ->> 'nazwa', (poz ->> 'ilosc')::numeric, poz ->> 'jednostka',
      (poz ->> 'cena_netto')::numeric, (poz ->> 'netto')::numeric, coalesce((poz ->> 'stan_przed')::boolean, false),
      (poz ->> 'wartosc')::numeric,
      (poz ->> 'kategoria')::kategoria_pozycji,
      nullif(poz ->> 'zlecenie_id', '')::uuid,
      (poz ->> 'sposob')::sposob_dopasowania,
      (poz ->> 'pewnosc')::numeric,
      coalesce(array(select jsonb_array_elements_text(poz -> 'propozycje'))::uuid[], '{}'),
      -- pewne dopasowania są od razu zatwierdzone przez system; reszta czeka w kolejce
      case when (poz ->> 'pewnosc')::numeric >= 0.9 then now() end
    );
  end loop;
  return fid;
end;
$$;

-- Obie funkcje wywołuje wyłącznie synchronizacja (klucz serwisowy), nie użytkownicy aplikacji.
-- Supabase domyślnie nadaje EXECUTE rolom anon i authenticated, więc odbieramy je jawnie.
revoke execute on function kandydaci_dopasowania() from public;
revoke execute on function zapisz_fakture_ksef(jsonb) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function kandydaci_dopasowania() from %I', r);
      execute format('revoke execute on function zapisz_fakture_ksef(jsonb) from %I', r);
    end if;
  end loop;
end $$;
