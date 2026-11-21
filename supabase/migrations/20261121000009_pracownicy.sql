-- Pracownicy warsztatu i przypisanie ich do zleceń (przypisuje właściciel).
-- Pracownik warsztatu to osoba na hali; konto w aplikacji (profile) jest opcjonalne.

create table pracownicy (
  id            uuid primary key default gen_random_uuid(),
  imie          text not null,
  specjalizacja text not null default 'blacharz'
                check (specjalizacja in ('blacharz', 'lakiernik', 'przygotowanie', 'mechanik', 'inne')),
  aktywny       boolean not null default true,
  profil_id     uuid unique references profile (id) on delete set null,
  utworzono     timestamptz not null default now()
);

-- Rola na zleceniu: blacharz dostaje RBH blacharskie, lakiernik lakiernicze.
-- Kilka osób w tej samej roli dzieli RBH po równo.
create table zlecenia_pracownicy (
  zlecenie_id  uuid not null references zlecenia (id) on delete cascade,
  pracownik_id uuid not null references pracownicy (id) on delete cascade,
  rola         text not null check (rola in ('blacharz', 'lakiernik', 'przygotowanie', 'mechanik', 'inne')),
  primary key (zlecenie_id, pracownik_id, rola)
);
create index zlecenia_pracownicy_pracownik_idx on zlecenia_pracownicy (pracownik_id);

alter table pracownicy enable row level security;
alter table zlecenia_pracownicy enable row level security;
create policy pracownicy_odczyt on pracownicy for select using (jest_uzytkownikiem());
create policy pracownicy_wlasciciel on pracownicy for all using (jest_wlascicielem()) with check (jest_wlascicielem());
create policy zlec_prac_odczyt on zlecenia_pracownicy for select using (jest_uzytkownikiem());
create policy zlec_prac_wlasciciel on zlecenia_pracownicy for all using (jest_wlascicielem()) with check (jest_wlascicielem());

grant select, insert, update, delete on pracownicy, zlecenia_pracownicy to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on pracownicy, zlecenia_pracownicy to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on pracownicy, zlecenia_pracownicy from anon;
  end if;
end $$;

create trigger pracownicy_rejestr after insert or update or delete on pracownicy
  for each row execute function zapisz_zmiane();
create trigger zlecenia_pracownicy_rejestr after insert or update or delete on zlecenia_pracownicy
  for each row execute function zapisz_zmiane();

-- Udział pracownika w zleceniu: RBH i robocizna z obowiązującego kosztorysu, podzielone na osoby w roli.
-- security_invoker: kosztorysy widzi tylko właściciel, więc pracownik dostaje puste kwoty.
create view udzial_pracownikow with (security_invoker = true) as
with k as (
  select distinct on (zlecenie_id) zlecenie_id, rbh_blach, rbh_lak, robocizna_blach, robocizna_lak
  from kosztorysy order by zlecenie_id, (wersja = 'zaakceptowany') desc, utworzono desc
),
osob as (select zlecenie_id, rola, count(*) as n from zlecenia_pracownicy group by 1, 2)
select
  zp.pracownik_id, zp.zlecenie_id, zp.rola, z.numer, z.status,
  coalesce(z.data_wydania, z.data_przyjecia) as data,
  case zp.rola when 'blacharz' then k.rbh_blach when 'lakiernik' then k.rbh_lak end / o.n as rbh,
  case zp.rola when 'blacharz' then k.robocizna_blach when 'lakiernik' then k.robocizna_lak end / o.n as robocizna
from zlecenia_pracownicy zp
join zlecenia z on z.id = zp.zlecenie_id
join osob o on o.zlecenie_id = zp.zlecenie_id and o.rola = zp.rola
left join k on k.zlecenie_id = zp.zlecenie_id
where z.status <> 'anulowane';
grant select on udzial_pracownikow to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on udzial_pracownikow from anon; end if;
end $$;
