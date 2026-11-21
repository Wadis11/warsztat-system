# Uruchomienie: Supabase i synchronizacja KSeF

Kroki do wykonania raz, przy pierwszym uruchomieniu. Kolejność ma znaczenie.

## 1. Projekt Supabase

1. Na supabase.com załóż nowy projekt (plan Free, region **Frankfurt**).
2. Zapisz hasło do bazy w menedżerze haseł. Nie wysyłaj go nikomu, także w czacie.

## 2. Schemat bazy

Uruchom migracje z katalogu `supabase/migrations/` w kolejności nazw plików
(Supabase → SQL Editor → wklej treść pliku → Run), albo przez Supabase CLI:

```bash
supabase link --project-ref <ID_PROJEKTU>
supabase db push
```

## 3. Sekrety

Supabase → Edge Functions → Secrets. Każdą wartość wklejasz **tylko tutaj**.

| Nazwa | Wartość |
| --- | --- |
| `KSEF_TOKEN` | Nowy token KSeF z uprawnieniem wyłącznie do odczytu faktur |
| `KSEF_NIP` | NIP firmy |
| `KSEF_SRODOWISKO` | `prod` (do testów: `test`) |
| `KSEF_START` | `2026-02-01T00:00:00Z` (od kiedy pobrać faktury przy pierwszym uruchomieniu) |
| `SYNC_SEKRET` | Długi losowy ciąg, np. z menedżera haseł (min. 32 znaki) |

## 4. Funkcja synchronizacji

```bash
supabase functions deploy ksef-sync --no-verify-jwt
```

`--no-verify-jwt`, bo funkcja ma własne zabezpieczenie (`SYNC_SEKRET`) i nie jest wywoływana z przeglądarki.

## 5. Harmonogram: co 20 minut (o :07, :27, :47)

Co godzinę, bo limit KSeF to 64 pobrane faktury na godzinę. Pierwsze pobranie zaległych faktur od lutego
(ok. 2–3 tys.) zajmie więc ok. 2 dni, a potem każde uruchomienie pobiera tylko nowe faktury.

W SQL Editor (z rozszerzeniami `pg_cron` i `pg_net` włączonymi w Database → Extensions):

```sql
select vault.create_secret('<TEN_SAM_SYNC_SEKRET>', 'sync_sekret');

select cron.schedule('ksef-sync', '7,27,47 * * * *', $$
  select net.http_post(
    url := 'https://<ID_PROJEKTU>.supabase.co/functions/v1/ksef-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-sekret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_sekret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
```

## 6. Sprawdzenie

```sql
select ostatni_start, punkt_zakupy, punkt_sprzedaz, ostatni_raport, ostatni_blad from synchronizacja_ksef;
select kierunek, count(*), sum(netto) from faktury group by kierunek;
```

`ostatni_raport.dokonczone = false` w czasie pobierania zaległości jest normalne.
Błąd uwierzytelnienia (np. kod 450) oznacza zły albo unieważniony token: wygeneruj nowy i podmień sekret.

## 7. Aplikacja (Netlify)

1. Netlify → Add new site → Import an existing project → GitHub → `Wadis11/warsztat-system`.
   Ustawienia budowania czyta z `netlify.toml` (katalog `app`, Node 22) — nic nie zmieniać.
2. Supabase → Authentication → Sign In / Providers → Email: wyłączyć „Allow new users to sign up”.
   Konta zakłada tylko właściciel (Authentication → Users → Add user, z zaznaczonym auto-potwierdzeniem).
3. Każde nowe konto dostaje rolę w tabeli `profile` (`wlasciciel` albo `pracownik`).
   Konto bez profilu nie widzi niczego.
4. Właściciel przy pierwszym logowaniu skanuje kod QR w aplikacji uwierzytelniającej
   (Google Authenticator, Microsoft Authenticator, 1Password). Bez drugiego składnika baza
   nie wydaje danych finansowych nawet z poprawnym hasłem.

## 8. Biała lista VAT (płatności)

Funkcja `biala-lista` sprawdza rachunki z faktur do zapłaty w wykazie MF (wl-api.mf.gov.pl)
i zapisuje wynik z identyfikatorem zapytania (dowód sprawdzenia). Harmonogram: 6:37 i 12:37 czasu polskiego.

```sql
select cron.schedule('biala-lista', '37 5,11 * * *', $$
  select net.http_post(
    url := 'https://<ID_PROJEKTU>.supabase.co/functions/v1/biala-lista',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-sekret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_sekret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
```
