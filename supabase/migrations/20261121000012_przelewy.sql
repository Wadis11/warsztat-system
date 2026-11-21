-- Paczka przelewów do banku: adres odbiorcy z faktury i dane zleceniodawcy (nasz rachunek).

alter table faktury add column adres_kontrahenta text;   -- linie adresu rozdzielone znakiem |

create or replace function wyciagnij_platnosc() returns trigger
  language plpgsql set search_path = public
as $$
declare
  d xml;
  p constant text := '//*[local-name()="Platnosc"]';
  czesciowo numeric;
  pa text;
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

  -- Adres kontrahenta: sprzedawca (Podmiot1) przy zakupie, nabywca (Podmiot2) przy sprzedaży
  pa := '(//*[local-name()="' || case when new.kierunek = 'zakup' then 'Podmiot1' else 'Podmiot2' end || '"]/*[local-name()="Adres"])[1]';
  new.adres_kontrahenta := nullif(concat_ws('|',
    regexp_replace(xml_pierwszy(d, pa || '/*[local-name()="AdresL1"]'), '\s+', ' ', 'g'),
    regexp_replace(xml_pierwszy(d, pa || '/*[local-name()="AdresL2"]'), '\s+', ' ', 'g')), '');

  new.do_zaplaty := case when new.zaplacono_wg_faktury then 0 else new.brutto - czesciowo end;
  return new;
end;
$$;

update faktury set xml = xml;

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
where f.kierunek = 'zakup';

-- Dane zleceniodawcy do pliku przelewów; domyślnie jak na naszych fakturach sprzedaży.
alter table ustawienia
  add column firma_nazwa    text not null default 'AUTO-LACK GRZEGORZ WADOWSKI',
  add column firma_adres    text not null default 'SKRAJNA 13|31-331 KRAKÓW',
  add column firma_rachunek text check (firma_rachunek ~ '^[0-9]{26}$');
update ustawienia set firma_rachunek = (
  select rachunek from faktury where kierunek = 'sprzedaz' and rachunek ~ '^[0-9]{26}$'
  group by rachunek order by count(*) desc limit 1);
