-- Aplikacja: dwuetapowe logowanie właściciela, wyniki zleceń, magazyn plików kosztorysów.

-- Właściciel widzi dane finansowe tylko po zalogowaniu kodem z telefonu (AAL2).
-- Samo hasło, nawet wykradzione, nie wystarcza do zobaczenia kwot.
create or replace function jest_wlascicielem() returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profile
    where id = auth.uid() and rola = 'wlasciciel' and aktywny
  ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- Rola zalogowanego (do menu aplikacji); bez danych wrażliwych.
create function moja_rola() returns text
  language sql stable security definer set search_path = public
as $$ select rola::text from profile where id = auth.uid() and aktywny $$;
revoke execute on function moja_rola() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function moja_rola() from anon;
  end if;
end $$;
grant execute on function moja_rola() to authenticated;

-- Wynik zlecenia: przychód z kosztorysu (zaakceptowany ma pierwszeństwo) albo z faktury,
-- koszty przypisane z faktur zakupowych. Robocizna dojdzie po wpisaniu kosztów miesięcznych.
-- security_invoker: działa z uprawnieniami pytającego, więc pracownik nie zobaczy kwot.
create view zlecenia_wyniki with (security_invoker = true) as
select
  z.id, z.numer, z.nr_rej, z.marka, z.model, z.status, z.data_przyjecia, z.data_wydania,
  kl.nazwa as klient, kl.segment,
  k.wersja as wersja_kosztorysu, k.netto as przychod_kosztorys,
  coalesce(k.rbh_blach, 0) + coalesce(k.rbh_lak, 0) as rbh,
  (select sum(f.netto) from faktury f where f.zlecenie_id = z.id and f.kierunek = 'sprzedaz') as przychod_faktura,
  (select coalesce(sum(p.wartosc), 0) from pozycje_faktur p where p.zlecenie_id = z.id and p.kategoria = 'czesc') as koszt_czesci,
  (select coalesce(sum(p.wartosc), 0) from pozycje_faktur p
    where p.zlecenie_id = z.id and p.kategoria in ('lakier', 'material')) as koszt_lakier_materialy,
  (select count(*) from pozycje_faktur p where p.zlecenie_id = z.id) as pozycji_kosztowych
from zlecenia z
left join klienci kl on kl.id = z.klient_id
left join lateral (
  select * from kosztorysy ks where ks.zlecenie_id = z.id
  order by (ks.wersja = 'zaakceptowany') desc, ks.utworzono desc limit 1
) k on true;
grant select on zlecenia_wyniki to authenticated;

-- Pliki kosztorysów (PDF): tylko właściciel.
insert into storage.buckets (id, name, public) values ('kosztorysy', 'kosztorysy', false)
  on conflict (id) do nothing;
create policy kosztorysy_pliki_wlasciciel on storage.objects for all
  using (bucket_id = 'kosztorysy' and public.jest_wlascicielem())
  with check (bucket_id = 'kosztorysy' and public.jest_wlascicielem());
