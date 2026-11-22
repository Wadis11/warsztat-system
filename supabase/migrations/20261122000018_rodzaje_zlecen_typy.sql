-- Rodzaje zleceń z osobną numeracją: Ayvens, ubezpieczenie, prywatne, powiązani (firmy powiązane), inne.
create type rodzaj_zlecenia as enum ('ayvens', 'ubezpieczenie', 'prywatne', 'powiazani', 'inne');
alter type segment_klienta add value if not exists 'powiazany' after 'prywatny';
