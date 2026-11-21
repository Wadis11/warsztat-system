-- Granica kolejki: faktury sprzed tej daty służą tylko do zestawień (archiwum)
-- i nie trafiają do kolejki do sprawdzenia. Wcześniejsze faktury pobieramy i tak:
-- to nic nie kosztuje, a daje przychody wg klientów i wydatki wg dostawców od lutego.
create table ustawienia (
  id int primary key default 1 check (id = 1),
  kolejka_od date not null default '2026-11-01'
);
comment on column ustawienia.kolejka_od is 'Faktury wystawione wcześniej służą tylko do zestawień (archiwum) i nie trafiają do kolejki do sprawdzenia';
insert into ustawienia (id) values (1);
alter table ustawienia enable row level security;
create policy ustawienia_odczyt on ustawienia for select using (jest_uzytkownikiem());
create policy ustawienia_wlasciciel on ustawienia for update using (jest_wlascicielem()) with check (jest_wlascicielem());
grant select, update on ustawienia to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on ustawienia to service_role;
  end if;
end $$;

-- Kolejka do sprawdzenia: niezatwierdzone pozycje z faktur od daty granicznej.
-- security_invoker: widok podlega RLS tabel źródłowych (pracownik nie zobaczy nic).
create view kolejka_pozycji with (security_invoker = true) as
  select p.*, f.numer as numer_faktury, f.nazwa_kontrahenta, f.nip_kontrahenta, f.data_wystawienia
  from pozycje_faktur p
  join faktury f on f.id = p.faktura_id
  where p.zatwierdzono is null
    and f.data_wystawienia >= (select kolejka_od from ustawienia where id = 1);
grant select on kolejka_pozycji to authenticated;
