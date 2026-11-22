-- Lakiery dorabiane u dostawców pod konkretne auto: pozycje faktur zakupu do przypisania do zlecenia.
-- Rozpoznanie: lakier sprzedawany na litry (np. „LAKIER BAZA I/METALIC” 0,5 L), albo produkt oznaczony ręcznie.
-- Bazy do własnego mieszalnika (Lesonal, sprzedawane w puszkach „szt.”) tu nie trafiają: to zapas mieszalnika.

create function jest_lakierem_na_auto(nazwa text, jednostka text) returns boolean
  language sql immutable set search_path = public
as $$
  select lower(trim(coalesce(jednostka, ''), ' .')) in ('l', 'litr', 'ltr', 'litry')
     and nazwa ~* '(lakier|baza|bazow|kolor|farba|akryl|perł|perl|metali)'
     and nazwa !~* '(utwardzacz|hardener|rozcie[nń]czalnik|thinner|bezbarwn|klar|podk[łl]ad)'
$$;

alter table materialy_kody add column lakier boolean not null default false;
alter table materialy_kody drop constraint materialy_kody_cel;
alter table materialy_kody add constraint materialy_kody_cel check (pominiety or lakier or material_id is not null);

create view lakiery_zakupy with (security_invoker = true) as
select
  p.id as pozycja_id, f.id as faktura_id, f.numer as faktura, f.data_wystawienia as data,
  f.nip_kontrahenta as nip, f.nazwa_kontrahenta as dostawca, f.teksty,
  p.nazwa, p.indeks, p.ilosc, p.jednostka, p.wartosc,
  p.zlecenie_id, z.numer as zlecenie, z.nr_rej, z.marka, z.model,
  case when p.zlecenie_id is not null then 'zlecenie'
       when p.zatwierdzono is not null then 'ogolny'
       else 'do_przypisania' end as status
from pozycje_faktur p
join faktury f on f.id = p.faktura_id and f.kierunek = 'zakup'
left join materialy_kody k on k.nip_dostawcy = f.nip_kontrahenta and k.indeks_norm = norm_indeks(p.indeks)
left join zlecenia z on z.id = p.zlecenie_id
where not p.stan_przed
  and (k.lakier or (k.id is null and jest_lakierem_na_auto(p.nazwa, p.jednostka)));

grant select on lakiery_zakupy to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on lakiery_zakupy from anon; end if;
end $$;

-- W „Do przypisania” (Materiał) lakiery na auto się nie pokazują
create or replace view materialy_zakupy with (security_invoker = true) as
select
  p.id as pozycja_id, f.id as faktura_id, f.numer as faktura, f.data_wystawienia as data,
  f.nip_kontrahenta as nip, d.nazwa as dostawca, d.rodzaj,
  p.indeks, norm_indeks(p.indeks) as indeks_norm, p.nazwa, p.ilosc, p.jednostka,
  round(coalesce(p.cena_netto, p.wartosc / nullif(p.ilosc, 0)), 4) as cena_netto,
  p.wartosc,
  k.material_id, k.mnoznik,
  round(coalesce(p.cena_netto, p.wartosc / nullif(p.ilosc, 0)) / k.mnoznik, 4) as cena_katalogowa,
  f.rodzaj like 'KOR%' as korekta,
  coalesce(k.pominiety, false) as pominiety,
  coalesce(k.lakier, k.id is null and jest_lakierem_na_auto(p.nazwa, p.jednostka)) as lakier
from pozycje_faktur p
join faktury f on f.id = p.faktura_id and f.kierunek = 'zakup'
join dostawcy_materialow d on d.nip = f.nip_kontrahenta
left join materialy_kody k on k.nip_dostawcy = f.nip_kontrahenta and k.indeks_norm = norm_indeks(p.indeks)
where not p.stan_przed;
