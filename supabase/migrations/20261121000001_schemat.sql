-- =====================================================================
-- System warsztatu, moduł 1: rentowność zleceń
-- Schemat bazy, role i uprawnienia.
--
-- Zasada: dane operacyjne (zlecenia, zakres prac) widzi pracownik,
-- dane finansowe (kwoty, stawki, faktury, marże) widzi tylko właściciel.
-- Podział jest wymuszony w bazie (RLS + osobne tabele), nie tylko w aplikacji.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Użytkownicy i role
-- ---------------------------------------------------------------------

create type rola_uzytkownika as enum ('wlasciciel', 'pracownik');

create table profile (
  id         uuid primary key references auth.users (id) on delete cascade,
  imie       text not null,
  rola       rola_uzytkownika not null default 'pracownik',
  aktywny    boolean not null default true,
  utworzono  timestamptz not null default now()
);

comment on table profile is 'Konta zakłada właściciel. Brak samodzielnej rejestracji.';

-- Czy zalogowany użytkownik jest aktywnym właścicielem?
create function jest_wlascicielem() returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profile
    where id = auth.uid() and rola = 'wlasciciel' and aktywny
  );
$$;

-- Czy zalogowany użytkownik ma aktywne konto (dowolna rola)?
create function jest_uzytkownikiem() returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profile where id = auth.uid() and aktywny);
$$;

-- ---------------------------------------------------------------------
-- Klienci (płatnicy)
-- ---------------------------------------------------------------------

create type segment_klienta as enum ('ayvens', 'ubezpieczyciel', 'prywatny', 'pozostali');

create table klienci (
  id         uuid primary key default gen_random_uuid(),
  nazwa      text not null,
  nip        text unique,
  segment    segment_klienta not null,
  utworzono  timestamptz not null default now()
);

-- Stawki są danymi finansowymi: osobna tabela tylko dla właściciela.
create table klienci_stawki (
  klient_id       uuid primary key references klienci (id) on delete cascade,
  stawka_blach    numeric(8, 2),
  stawka_lak      numeric(8, 2),
  procent_prawnika numeric(5, 2),
  uwagi           text
);

-- ---------------------------------------------------------------------
-- Zlecenia: część operacyjna (widzi pracownik)
-- ---------------------------------------------------------------------

create type status_zlecenia as enum ('przyjete', 'w_naprawie', 'gotowe', 'wydane', 'anulowane');

create table zlecenia (
  id            uuid primary key default gen_random_uuid(),
  numer         text not null unique,           -- RR-NNNN, nadawany automatycznie
  nr_rej        text,
  vin           text,
  marka         text,
  model         text,
  klient_id     uuid references klienci (id),
  nr_szkody     text,
  zakres_prac   text,                           -- dla zleceń prywatnych bez kosztorysu
  status        status_zlecenia not null default 'przyjete',
  data_przyjecia date not null default current_date,
  data_wydania  date,
  utworzyl      uuid references auth.users (id) default auth.uid(),
  utworzono     timestamptz not null default now()
);

create index zlecenia_nr_rej_idx on zlecenia (upper(replace(nr_rej, ' ', '')));
create index zlecenia_vin_idx on zlecenia (upper(vin));

-- Kolejny numer zlecenia w danym roku: 26-0001, 26-0002, ...
create table liczniki_zlecen (rok int primary key, ostatni int not null);

create function nadaj_numer_zlecenia() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  r int := extract(year from coalesce(new.data_przyjecia, current_date))::int;
  n int;
begin
  if new.numer is not null and new.numer <> '' then
    return new;
  end if;
  insert into liczniki_zlecen as l (rok, ostatni) values (r, 1)
    on conflict (rok) do update set ostatni = l.ostatni + 1
    returning ostatni into n;
  new.numer := lpad((r % 100)::text, 2, '0') || '-' || lpad(n::text, 4, '0');
  return new;
end;
$$;

create trigger zlecenia_numer before insert on zlecenia
  for each row execute function nadaj_numer_zlecenia();

-- Operacje do karty pracy (z kosztorysu albo wpisane ręcznie), bez cen.
create table zlecenia_operacje (
  id          uuid primary key default gen_random_uuid(),
  zlecenie_id uuid not null references zlecenia (id) on delete cascade,
  kolejnosc   int not null default 0,
  rodzaj      text not null check (rodzaj in ('blacharka', 'lakier', 'mechanika', 'inne')),
  opis        text not null
);

-- ---------------------------------------------------------------------
-- Zlecenia: część finansowa (tylko właściciel)
-- ---------------------------------------------------------------------

create type wersja_kosztorysu as enum ('zlozony', 'zaakceptowany', 'wycena_ubezpieczyciela');

create table kosztorysy (
  id              uuid primary key default gen_random_uuid(),
  zlecenie_id     uuid not null references zlecenia (id) on delete cascade,
  wersja          wersja_kosztorysu not null,
  zrodlo          text not null,      -- 'audatex', 'controlexpert', 'skan', 'reczny'
  autor           text,               -- 'warsztat', 'Ayvens', 'UNIQA', ...
  nr_kalkulacji   text,
  data            date,
  stawka_blach    numeric(8, 2),
  stawka_lak      numeric(8, 2),
  rbh_blach       numeric(8, 2),
  rbh_lak         numeric(8, 2),
  robocizna_blach numeric(12, 2),
  koszty_dodatkowe numeric(12, 2),
  robocizna_lak   numeric(12, 2),
  material_lak    numeric(12, 2),
  czesci          numeric(12, 2),
  normalia        numeric(12, 2),
  netto           numeric(12, 2) not null,
  plik            text,               -- ścieżka w magazynie plików
  potwierdzony    boolean not null default false,
  utworzono       timestamptz not null default now()
);

create table kosztorysy_czesci (
  id             uuid primary key default gen_random_uuid(),
  kosztorys_id   uuid not null references kosztorysy (id) on delete cascade,
  kod            text,
  nazwa          text not null,
  nr_katalogowy  text,
  cena           numeric(12, 2) not null
);

-- Znormalizowany numer katalogowy (bez spacji, myślników, kropek) do dopasowań z fakturami.
create function norm_indeks(t text) returns text
  language sql immutable
as $$ select nullif(upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

create index kosztorysy_czesci_indeks_idx on kosztorysy_czesci (norm_indeks(nr_katalogowy));

-- Rozliczenie zlecenia: przychód prywatny, sprawa sądowa, wpłaty.
create type status_sprawy as enum ('brak', 'przed_pozwem', 'w_sadzie', 'ugoda', 'wygrana', 'przegrana');

create table zlecenia_rozliczenie (
  zlecenie_id        uuid primary key references zlecenia (id) on delete cascade,
  przychod_reczny    numeric(12, 2),   -- zlecenia prywatne bez faktury w KSeF
  wplacono_ubezp     numeric(12, 2),
  data_wplaty_ubezp  date,
  status_sprawy      status_sprawy not null default 'brak',
  sygnatura_sprawy   text,
  odzyskano          numeric(12, 2),
  data_odzyskania    date,
  uwagi              text
);

-- ---------------------------------------------------------------------
-- Faktury z KSeF (tylko właściciel)
-- ---------------------------------------------------------------------

create table faktury (
  id               uuid primary key default gen_random_uuid(),
  nr_ksef          text not null unique,
  kierunek         text not null check (kierunek in ('zakup', 'sprzedaz')),
  numer            text not null,
  nip_kontrahenta  text,
  nazwa_kontrahenta text,
  data_wystawienia date not null,
  netto            numeric(12, 2) not null,
  vat              numeric(12, 2) not null,
  brutto           numeric(12, 2) not null,
  korygowana_id    uuid references faktury (id),
  zlecenie_id      uuid references zlecenia (id),   -- faktura sprzedaży -> zlecenie
  xml              text not null,                    -- oryginał, do odtworzenia bazy
  pobrano          timestamptz not null default now()
);

create type kategoria_pozycji as enum ('czesc', 'lakier', 'material', 'koszt_ogolny', 'koszt_sprawy', 'nieustalona');
create type sposob_dopasowania as enum ('nr_zlecenia', 'rejestracja_vin', 'indeks_kosztorysu', 'regula', 'reczne', 'brak');

create table pozycje_faktur (
  id           uuid primary key default gen_random_uuid(),
  faktura_id   uuid not null references faktury (id) on delete cascade,
  lp           int not null,
  indeks       text,
  nazwa        text not null,
  ilosc        numeric(12, 3),
  jednostka    text,
  cena_netto   numeric(12, 2),
  netto        numeric(12, 2) not null,
  kategoria    kategoria_pozycji not null default 'nieustalona',
  zlecenie_id  uuid references zlecenia (id),
  sposob       sposob_dopasowania not null default 'brak',
  pewnosc      numeric(3, 2) not null default 0,   -- 0..1; poniżej progu trafia do kolejki
  zatwierdzil  uuid references auth.users (id),
  zatwierdzono timestamptz,
  unique (faktura_id, lp)
);

create index pozycje_faktur_kolejka_idx on pozycje_faktur (zatwierdzono) where zatwierdzono is null;
create index pozycje_faktur_indeks_idx on pozycje_faktur (norm_indeks(indeks));

-- Reguły powstają, gdy właściciel zatwierdza pozycję w kolejce.
create table reguly (
  id           uuid primary key default gen_random_uuid(),
  nip_dostawcy text,
  wzorzec      text,                 -- wyrażenie regularne na nazwę lub indeks; null = cały dostawca
  kategoria    kategoria_pozycji not null,
  rozdzielaj_miesiecznie boolean not null default false,
  utworzono    timestamptz not null default now()
);

-- Dwie liczby wpisywane raz w miesiącu; reszta liczona.
create table koszty_miesieczne (
  miesiac            date primary key check (extract(day from miesiac) = 1),
  wynagrodzenia      numeric(12, 2) not null,
  koszty_stale       numeric(12, 2) not null,
  godziny_przepracowane numeric(10, 2)
);

-- Stan synchronizacji KSeF (do którego momentu pobrano faktury).
create table synchronizacja_ksef (
  id             int primary key default 1 check (id = 1),
  pobrano_do     timestamptz,
  ostatni_start  timestamptz,
  ostatni_blad   text
);

-- ---------------------------------------------------------------------
-- Rejestr zmian
-- ---------------------------------------------------------------------

create table rejestr_zmian (
  id        bigint generated always as identity primary key,
  tabela    text not null,
  rekord    text,
  akcja     text not null,
  kto       uuid default auth.uid(),
  kiedy     timestamptz not null default now(),
  przed     jsonb,
  po        jsonb
);

create function zapisz_zmiane() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  insert into rejestr_zmian (tabela, rekord, akcja, przed, po)
  values (
    tg_table_name,
    coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'),
             (to_jsonb(new) ->> 'zlecenie_id'), (to_jsonb(old) ->> 'zlecenie_id')),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

-- Faktury pomijamy w rejestrze (duży XML, i tak są niezmienne).
do $$
declare t text;
begin
  foreach t in array array['profile', 'klienci', 'klienci_stawki', 'zlecenia', 'zlecenia_operacje',
                           'kosztorysy', 'zlecenia_rozliczenie', 'pozycje_faktur', 'reguly', 'koszty_miesieczne']
  loop
    execute format('create trigger %I after insert or update or delete on %I
                    for each row execute function zapisz_zmiane()', t || '_rejestr', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Uprawnienia (RLS)
-- ---------------------------------------------------------------------

alter table profile               enable row level security;
alter table klienci               enable row level security;
alter table klienci_stawki        enable row level security;
alter table zlecenia              enable row level security;
alter table zlecenia_operacje     enable row level security;
alter table liczniki_zlecen       enable row level security;
alter table kosztorysy            enable row level security;
alter table kosztorysy_czesci     enable row level security;
alter table zlecenia_rozliczenie  enable row level security;
alter table faktury               enable row level security;
alter table pozycje_faktur        enable row level security;
alter table reguly                enable row level security;
alter table koszty_miesieczne     enable row level security;
alter table synchronizacja_ksef   enable row level security;
alter table rejestr_zmian         enable row level security;

-- Profil: każdy widzi swój; właściciel widzi i zmienia wszystkie.
create policy profil_wlasny on profile for select using (id = auth.uid());
create policy profil_wlasciciel on profile for all using (jest_wlascicielem()) with check (jest_wlascicielem());

-- Dane operacyjne: każdy aktywny użytkownik czyta i dodaje; usuwa tylko właściciel.
create policy klienci_odczyt on klienci for select using (jest_uzytkownikiem());
create policy klienci_dodanie on klienci for insert with check (jest_uzytkownikiem());
create policy klienci_wlasciciel on klienci for all using (jest_wlascicielem()) with check (jest_wlascicielem());

create policy zlecenia_odczyt on zlecenia for select using (jest_uzytkownikiem());
create policy zlecenia_dodanie on zlecenia for insert with check (jest_uzytkownikiem());
create policy zlecenia_zmiana on zlecenia for update using (jest_uzytkownikiem()) with check (jest_uzytkownikiem());
create policy zlecenia_usuniecie on zlecenia for delete using (jest_wlascicielem());

create policy operacje_odczyt on zlecenia_operacje for select using (jest_uzytkownikiem());
create policy operacje_dodanie on zlecenia_operacje for insert with check (jest_uzytkownikiem());
create policy operacje_zmiana on zlecenia_operacje for update using (jest_uzytkownikiem()) with check (jest_uzytkownikiem());
create policy operacje_usuniecie on zlecenia_operacje for delete using (jest_uzytkownikiem());

-- Dane finansowe: wyłącznie właściciel. Brak polityki = brak dostępu.
create policy stawki_wlasciciel on klienci_stawki for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy kosztorysy_wlasciciel on kosztorysy for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy kosztorysy_czesci_wlasciciel on kosztorysy_czesci for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy rozliczenie_wlasciciel on zlecenia_rozliczenie for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy faktury_wlasciciel on faktury for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy pozycje_wlasciciel on pozycje_faktur for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy reguly_wlasciciel on reguly for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy koszty_wlasciciel on koszty_miesieczne for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy synchronizacja_wlasciciel on synchronizacja_ksef for select using (jest_wlascicielem());
create policy rejestr_wlasciciel on rejestr_zmian for select using (jest_wlascicielem());
-- liczniki_zlecen: bez polityk; zmienia je tylko funkcja nadaj_numer_zlecenia (security definer).

-- Pracownik nie może sam nadać sobie roli właściciela: zmianę roli blokuje polityka profil_wlasciciel,
-- a pracownik nie ma polityki update na profile.
