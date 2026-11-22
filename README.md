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
| `supabase/migrations/` | Schemat bazy, role, uprawnienia, rejestr zmian, funkcje zapisu faktur |
| `supabase/tests/` | Testy SQL: uprawnienia, zapis faktur z KSeF |
| `supabase/functions/_shared/ksef/` | Klient KSeF 2.0, odczyt FA(3), dopasowanie pozycji do zleceń, synchronizacja |
| `supabase/functions/ksef-sync/` | Funkcja uruchamiana co godzinę: pobiera nowe faktury z KSeF (najpierw ostatnie 60 dni, potem zaległości) |
| `supabase/functions/biala-lista/` | Sprawdzanie rachunków dostawców na białej liście VAT dla faktur do zapłaty |
| `app/` | Aplikacja webowa (React + Vite): logowanie z 2FA, kolejka faktur, zlecenia, wgrywanie kosztorysów, karta pracy |
| `app/src/faktury/` | Odczyt pozycji z faktur PDF sklepów internetowych (materiały pomocnicze) |
| `app/src/przelewy/` | Paczka przelewów MultiCash PLI dla BNP Paribas |
| `app/src/kosztorys/` | Parser kosztorysów w TypeScript (działa w przeglądarce, PDF nie opuszcza bazy firmy) |
| `netlify.toml` | Konfiguracja hostingu aplikacji |
| `tools/porownaj_parser.ts` | Porównanie parsera TS z prototypem na lokalnych PDF-ach |
| `tools/parser/` | Prototyp parsera kosztorysów (Audatex, ControlExpert, skany z poprawkami) |
| `tools/test_bazy.sh` | Uruchamia migracje i testy SQL na tymczasowym Postgresie |
| `docs/uruchomienie.md` | Instrukcja pierwszego uruchomienia (Supabase, sekrety, harmonogram) |

## Testy

```bash
npm test               # moduł KSeF (Node 22+)
npm run typy           # sprawdzenie typów
./tools/test_bazy.sh   # baza: wymaga Postgres 16; nie uruchamiać jako root
cd app && npm run build  # aplikacja: typy i paczka produkcyjna
```

Faktury testowe w `supabase/functions/_shared/ksef/testy/` są fikcyjne i przechodzą walidację
oficjalnym schematem FA(3). Klucz w tym katalogu służy wyłącznie testom.

## Dane wrażliwe

Do repozytorium nie trafiają: kosztorysy i faktury (dane klientów), token KSeF, klucze Supabase.
Token KSeF jest przechowywany wyłącznie jako sekret Supabase (Edge Functions → Secrets).
