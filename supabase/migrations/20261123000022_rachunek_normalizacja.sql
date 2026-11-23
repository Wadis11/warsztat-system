-- Numer rachunku z faktury bywa zapisany z prefiksem („PL…”, „ING:…”) albo zawiera śmieci.
-- Zapisujemy sam 26-cyfrowy NRB; zagraniczny IBAN zostaje jak jest; reszta = brak rachunku.

create function normalizuj_rachunek(surowy text) returns text
  language sql immutable set search_path = public
as $$
  with v as (select upper(regexp_replace(coalesce(surowy, ''), '[\s\-]', '', 'g')) as s)
  select case
    when regexp_replace(s, '^(PL|[A-Z]+:)', '') ~ '^\d{26}$' then regexp_replace(s, '^(PL|[A-Z]+:)', '')
    when regexp_replace(s, '\D', '', 'g') ~ '^\d{26}$' and s !~ '^[A-Z]{2}\d{2}' then regexp_replace(s, '\D', '', 'g')
    when s ~ '^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$' then s
    else null end
  from v
$$;

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
  new.rachunek         := normalizuj_rachunek(xml_pierwszy(d, '(' || p || '/*[local-name()="RachunekBankowy"]/*[local-name()="NrRB"])[1]'));
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

update faktury set xml = xml where kierunek = 'zakup';
