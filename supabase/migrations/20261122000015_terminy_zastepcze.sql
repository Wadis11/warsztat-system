-- Terminy przyjęć (auta umówione) i samochody zastępcze: flota, serwis, wypożyczenia z umową.

alter type status_zlecenia add value if not exists 'umowione' before 'przyjete';

alter table zlecenia
  add column termin timestamptz,                               -- umówiony dzień i godzina przyjęcia
  add column zastepcze_potrzebne boolean not null default false;
create index zlecenia_termin_idx on zlecenia (termin);

create extension if not exists btree_gist;

create table auta_zastepcze (
  id               uuid primary key default gen_random_uuid(),
  nr_rej           text not null unique,
  marka            text,
  model            text,
  rok              int,
  vin              text,
  kolor            text,
  paliwo           text,
  opony_lato       text,          -- rozmiar, np. 205/55 R16 91V
  opony_zima       text,
  ubezpieczenie_do date,
  ubezpieczyciel   text,
  nr_polisy        text,
  przeglad_do      date,
  serwis_co_km     int,           -- interwał serwisu olejowego
  serwis_co_mies   int,
  aktywne          boolean not null default true,
  uwagi            text,
  utworzono        timestamptz not null default now()
);

create table auta_zastepcze_serwis (
  id          uuid primary key default gen_random_uuid(),
  auto_id     uuid not null references auta_zastepcze (id) on delete cascade,
  data        date not null,
  przebieg    int,
  opis        text not null,
  utworzono   timestamptz not null default now(),
  utworzyl    uuid references auth.users (id) default auth.uid()
);
create index auta_zastepcze_serwis_auto_idx on auta_zastepcze_serwis (auto_id, data desc);

create sequence wypozyczenia_nr;
create table wypozyczenia (
  id               uuid primary key default gen_random_uuid(),
  numer            text not null unique,      -- numer umowy, np. ZA/2026/0001
  auto_id          uuid not null references auta_zastepcze (id),
  zlecenie_id      uuid references zlecenia (id) on delete set null,
  rodzaj           text not null default 'najem' check (rodzaj in ('najem', 'uzyczenie')),
  wydanie          timestamptz not null,
  planowany_zwrot  timestamptz,
  zwrot            timestamptz,
  najemca_nazwa    text not null,
  najemca_adres    text,
  najemca_dokument text,                      -- seria i numer dowodu osobistego
  najemca_prawo_jazdy text,
  najemca_telefon  text,
  najemca_nip      text,
  stawka_netto     numeric(10, 2),            -- za dobę (najem)
  kaucja           numeric(10, 2),
  cesja            boolean not null default false,  -- najem rozliczany z ubezpieczycielem sprawcy (cesja)
  przebieg_wydania int,
  przebieg_zwrotu  int,
  paliwo_wydania   text,
  paliwo_zwrotu    text,
  stan_wydania     text,                      -- uszkodzenia, wyposażenie
  stan_zwrotu      text,
  uwagi            text,
  utworzono        timestamptz not null default now(),
  utworzyl         uuid references auth.users (id) default auth.uid(),
  check (zwrot is null or zwrot >= wydanie),
  check (planowany_zwrot is null or planowany_zwrot >= wydanie),
  -- jedno auto nie może być w tym samym czasie u dwóch osób
  exclude using gist (auto_id with =, tstzrange(wydanie, coalesce(zwrot, planowany_zwrot, 'infinity'), '[)') with &&)
);
create index wypozyczenia_zlecenie_idx on wypozyczenia (zlecenie_id);

create function nadaj_numer_umowy() returns trigger language plpgsql set search_path = public as $$
begin
  if new.numer is null or new.numer = '' then
    new.numer := 'ZA/' || to_char(new.wydanie at time zone 'Europe/Warsaw', 'YYYY') || '/' || lpad(nextval('wypozyczenia_nr')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger wypozyczenia_numer before insert on wypozyczenia for each row execute function nadaj_numer_umowy();

do $$
declare t text;
begin
  foreach t in array array['auta_zastepcze', 'auta_zastepcze_serwis', 'wypozyczenia'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (jest_uzytkownikiem())', t || '_odczyt', t);
    execute format('create policy %I on %I for insert with check (jest_uzytkownikiem())', t || '_dodanie', t);
    execute format('create policy %I on %I for update using (jest_uzytkownikiem()) with check (jest_uzytkownikiem())', t || '_zmiana', t);
    execute format('create policy %I on %I for delete using (jest_wlascicielem())', t || '_usuniecie', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on %I from anon', t); end if;
    execute format('create trigger %I after insert or update or delete on %I for each row execute function zapisz_zmiane()', t || '_rejestr', t);
  end loop;
end $$;
grant usage on sequence wypozyczenia_nr to authenticated;

-- Dane firmy na umowie
alter table ustawienia add column firma_nip text not null default '9451284984';

-- Terminy floty: ubezpieczenie, przegląd, następny serwis (wg daty z interwału)
create view auta_zastepcze_terminy with (security_invoker = true) as
select a.id as auto_id, a.nr_rej, a.marka, a.model, 'ubezpieczenie' as rodzaj, a.ubezpieczenie_do as data
from auta_zastepcze a where a.aktywne and a.ubezpieczenie_do is not null
union all
select a.id, a.nr_rej, a.marka, a.model, 'przeglad', a.przeglad_do
from auta_zastepcze a where a.aktywne and a.przeglad_do is not null
union all
select a.id, a.nr_rej, a.marka, a.model, 'serwis', (s.data + make_interval(months => a.serwis_co_mies))::date
from auta_zastepcze a
join lateral (select data from auta_zastepcze_serwis where auto_id = a.id order by data desc limit 1) s on true
where a.aktywne and a.serwis_co_mies is not null;
grant select on auta_zastepcze_terminy to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on auta_zastepcze_terminy from anon; end if;
end $$;
