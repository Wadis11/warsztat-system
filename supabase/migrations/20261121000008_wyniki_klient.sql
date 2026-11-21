-- Widok wyników z identyfikatorem klienta (zmiana płatnika z listy zleceń).
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
  z.klient_id
from zlecenia z
left join klienci kl on kl.id = z.klient_id
left join lateral (
  select * from kosztorysy ks where ks.zlecenie_id = z.id
  order by (ks.wersja = 'zaakceptowany') desc, ks.utworzono desc limit 1
) k on true;
