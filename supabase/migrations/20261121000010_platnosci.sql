-- Płatności: dane do przelewu z faktur zakupu (sekcja Platnosc w FA(3)), termin, status, biała lista VAT.
-- Dane wyciąga z zapisanego XML wyzwalacz, więc działa to też dla faktur pobranych wcześniej.

alter table faktury
  add column termin_platnosci   date,
  add column forma_platnosci    smallint,          -- 1 gotówka, 2 karta, 3 bon, 4 czek, 5 kredyt, 6 przelew, 7 mobilna
  add column rachunek           text,
  add column bank               text,
  add column rachunek_wirtualny boolean not null default false,
  add column mpp                boolean not null default false,   -- mechanizm podzielonej płatności (P_18A = 1)
  add column waluta             text not null default 'PLN',
  add column do_zaplaty         numeric(12, 2),    -- brutto pomniejszone o zapłaty odnotowane na fakturze
  add column zaplacono_wg_faktury boolean not null default false,
  add column oplacono           date,              -- zaznaczone przez nas
  add column oplacil            uuid references auth.users (id),
  add column bl_wynik           text check (bl_wynik in ('TAK', 'NIE', 'blad')),
  add column bl_sprawdzono      timestamptz,
  add column bl_id              text;               -- identyfikator zapytania MF: dowód sprawdzenia

-- Pierwszy węzeł o danej nazwie (bez względu na przestrzeń nazw i prefiks, np. n0:Termin)
create function xml_pierwszy(d xml, sciezka text) returns text
  language sql immutable set search_path = public
as $$ select nullif(trim((xpath(sciezka || '/text()', d))[1]::text), '') $$;

create function wyciagnij_platnosc() returns trigger
  language plpgsql set search_path = public
as $$
declare
  d xml;
  p constant text := '//*[local-name()="Platnosc"]';
  czesciowo numeric;
begin
  begin
    d := xmlparse(document regexp_replace(new.xml, '^\s*<\?xml[^>]*\?>', ''));
  exception when others then
    new.do_zaplaty := new.brutto;   -- uszkodzony XML: bez danych przelewu, kwota z nagłówka; faktura i tak jest zapisana
    return new;
  end;

  new.termin_platnosci := xml_pierwszy(d, '(' || p || '/*[local-name()="TerminPlatnosci"]/*[local-name()="Termin"])[1]')::date;
  new.forma_platnosci  := xml_pierwszy(d, '(' || p || '/*[local-name()="FormaPlatnosci"])[1]')::smallint;
  new.rachunek         := regexp_replace(coalesce(xml_pierwszy(d, '(' || p || '/*[local-name()="RachunekBankowy"]/*[local-name()="NrRB"])[1]'), ''), '\s', '', 'g');
  new.rachunek         := nullif(new.rachunek, '');
  new.bank             := xml_pierwszy(d, '(' || p || '/*[local-name()="RachunekBankowy"]/*[local-name()="NazwaBanku"])[1]');
  new.rachunek_wirtualny := coalesce(xml_pierwszy(d, '(' || p || '/*[local-name()="RachunekBankowy"]/*[local-name()="RachunekWlasnyBanku"])[1]') in ('1', '2', '3'), false);
  new.mpp              := coalesce(xml_pierwszy(d, '(//*[local-name()="Adnotacje"]/*[local-name()="P_18A"])[1]') = '1', false);
  new.waluta           := coalesce(xml_pierwszy(d, '(//*[local-name()="Fa"]/*[local-name()="KodWaluty"])[1]'), 'PLN');
  new.zaplacono_wg_faktury := coalesce(xml_pierwszy(d, '(' || p || '/*[local-name()="Zaplacono"])[1]') = '1', false);

  select coalesce(sum(nullif(trim(x::text), '')::numeric), 0) into czesciowo
  from unnest(xpath(p || '/*[local-name()="ZaplataCzesciowa"]/*[local-name()="KwotaZaplatyCzesciowej"]/text()', d)) x;

  new.do_zaplaty := case when new.zaplacono_wg_faktury then 0 else new.brutto - czesciowo end;
  return new;
end;
$$;

create trigger faktury_platnosc before insert or update of xml on faktury
  for each row execute function wyciagnij_platnosc();

-- Uzupełnienie faktur pobranych przed tą zmianą
update faktury set xml = xml;

-- Od jakiego terminu płatności faktury trafiają na listę do zapłaty; starsze uznajemy za rozliczone.
alter table ustawienia add column platnosci_od date not null default '2026-11-01';

-- Lista płatności: tylko faktury zakupu. security_invoker: faktury widzi tylko właściciel.
create view platnosci with (security_invoker = true) as
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
  f.termin_platnosci - current_date as dni_do_terminu
from faktury f
cross join ustawienia u
where f.kierunek = 'zakup';
grant select on platnosci to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on platnosci from anon; end if;
end $$;
