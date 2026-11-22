-- Uprawnienia roli „biuro” (osobny plik: nowej wartości typu nie można użyć w tej samej transakcji).

create function ma_dostep_do_kwot() returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profile
    where id = auth.uid() and rola in ('wlasciciel', 'biuro') and aktywny
  ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke execute on function ma_dostep_do_kwot() from public;
grant execute on function ma_dostep_do_kwot() to authenticated;

-- Tabele z kwotami, z których korzysta biuro. Właściciel na wyłączność zostaje przy: profile, ustawienia,
-- koszty_miesieczne, synchronizacja_ksef, rejestr_zmian i usuwaniu zleceń.
do $$
declare p record;
begin
  for p in select * from (values
    ('klienci', 'klienci_wlasciciel'), ('klienci_stawki', 'stawki_wlasciciel'),
    ('kosztorysy', 'kosztorysy_wlasciciel'), ('kosztorysy_czesci', 'kosztorysy_czesci_wlasciciel'),
    ('zlecenia_rozliczenie', 'rozliczenie_wlasciciel'), ('faktury', 'faktury_wlasciciel'),
    ('pozycje_faktur', 'pozycje_wlasciciel'), ('reguly', 'reguly_wlasciciel'),
    ('pracownicy', 'pracownicy_wlasciciel'), ('zlecenia_pracownicy', 'zlec_prac_wlasciciel'),
    ('materialy', 'materialy_wlasciciel'), ('dostawcy_materialow', 'dostawcy_materialow_wlasciciel'),
    ('materialy_kody', 'materialy_kody_wlasciciel'), ('materialy_ceny_ofert', 'materialy_ceny_ofert_wlasciciel'),
    ('zakupy_pomocnicze', 'zakupy_pomocnicze_wlasciciel'), ('zakupy_pomocnicze_pozycje', 'zakupy_pomocnicze_pozycje_wlasciciel')
  ) as t(tabela, polityka) loop
    execute format('alter policy %I on %I using (ma_dostep_do_kwot()) with check (ma_dostep_do_kwot())', p.polityka, p.tabela);
  end loop;
end $$;

alter policy kosztorysy_pliki_wlasciciel on storage.objects
  using (bucket_id = 'kosztorysy' and public.ma_dostep_do_kwot()) with check (bucket_id = 'kosztorysy' and public.ma_dostep_do_kwot());
alter policy zakupy_wlasciciel on storage.objects
  using (bucket_id = 'zakupy' and public.ma_dostep_do_kwot()) with check (bucket_id = 'zakupy' and public.ma_dostep_do_kwot());

-- Płatności i kolejka „Do sprawdzenia” (zakładka Płatności) tylko dla właściciela
create or replace view platnosci with (security_invoker = true) as
select
  f.id, f.numer, f.nr_ksef, f.nip_kontrahenta, f.nazwa_kontrahenta, f.data_wystawienia, f.rodzaj,
  f.netto, f.vat, f.brutto, f.do_zaplaty, f.waluta, f.termin_platnosci, f.forma_platnosci,
  f.rachunek, f.bank, f.rachunek_wirtualny, f.mpp, f.oplacono, f.bl_wynik, f.bl_sprawdzono, f.bl_id,
  case
    when f.oplacono is not null then 'zaplacona'
    when f.zaplacono_wg_faktury or f.do_zaplaty = 0 then 'zaplacona_wg_faktury'
    when f.forma_platnosci in (1, 2, 3, 7) then 'przy_zakupie'
    when coalesce(f.termin_platnosci, f.data_wystawienia) < u.platnosci_od then 'archiwum'
    else 'do_zaplaty'
  end as status,
  f.termin_platnosci - current_date as dni_do_terminu,
  f.adres_kontrahenta
from faktury f
cross join ustawienia u
where f.kierunek = 'zakup' and (current_user not in ('authenticated', 'anon') or jest_wlascicielem());

create or replace view kolejka_pozycji with (security_invoker = true) as
  select p.*, f.numer as numer_faktury, f.nazwa_kontrahenta, f.nip_kontrahenta, f.data_wystawienia
  from pozycje_faktur p
  join faktury f on f.id = p.faktura_id
  where p.zatwierdzono is null
    and f.data_wystawienia >= (select kolejka_od from ustawienia where id = 1)
    and (current_user not in ('authenticated', 'anon') or jest_wlascicielem());
