# System warsztatu

System do zarządzania warsztatem blacharsko-lakierniczym. Moduł 1: rentowność zleceń.

Specyfikacja: dokument „System zarządzania warsztatem — Moduł 1: Rentowność zleceń” (Claude Docs).

## Zasady

- Dane wchodzą ze źródeł (KSeF, kosztorysy Audatex, weryfikacje ubezpieczycieli), nie z klawiatury.
- System proponuje, właściciel zatwierdza w kolejce.
- Uprawnienia wymusza baza (RLS): pracownik nie ma dostępu do kwot, stawek, faktur ani marż.

## Struktura

| Katalog | Zawartość |
| --- | --- |
| `supabase/migrations/` | Schemat bazy, role, uprawnienia, rejestr zmian |
| `supabase/tests/` | Testy uprawnień (pracownik vs właściciel) |
| `tools/parser/` | Prototyp parsera kosztorysów (Audatex, ControlExpert, skany z poprawkami) |
| `tools/test_bazy.sh` | Uruchamia migracje i testy na tymczasowym Postgresie |

## Testy bazy

```bash
./tools/test_bazy.sh   # wymaga Postgres 16 (initdb, pg_ctl, psql); nie uruchamiać jako root
```

## Dane wrażliwe

Do repozytorium nie trafiają: kosztorysy i faktury (dane klientów), token KSeF, klucze Supabase.
Token KSeF jest przechowywany wyłącznie jako sekret Supabase (Edge Functions → Secrets).
