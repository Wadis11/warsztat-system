// Funkcja Supabase: nocna synchronizacja faktur z KSeF.
// Wywoływana przez harmonogram (pg_cron) albo ręcznie z aplikacji przez właściciela.
//
// Sekrety (Supabase → Edge Functions → Secrets), nigdy w kodzie:
//   KSEF_TOKEN        token KSeF z uprawnieniem wyłącznie do odczytu faktur
//   KSEF_NIP          NIP firmy (kontekst logowania)
//   KSEF_SRODOWISKO   test | demo | prod (domyślnie test)
//   KSEF_START        od kiedy pobierać przy pierwszym uruchomieniu (domyślnie 2026-02-01T00:00:00Z)
//   SYNC_SEKRET       wspólny sekret harmonogramu; wywołanie bez niego jest odrzucane
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  ustawiane przez Supabase automatycznie
import { createClient } from "@supabase/supabase-js";
import { KlientKsef, SRODOWISKA } from "../_shared/ksef/klient.ts";
import { magazynSupabase } from "../_shared/ksef/magazyn_supabase.ts";
import { synchronizuj } from "../_shared/ksef/synchronizacja.ts";

const env = (k: string, domyslna?: string) => {
  const v = Deno.env.get(k) ?? domyslna;
  if (!v) throw new Error(`Brak sekretu ${k}`);
  return v;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Metoda niedozwolona", { status: 405 });
  if (req.headers.get("x-sync-sekret") !== env("SYNC_SEKRET")) return new Response("Brak uprawnień", { status: 401 });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const srodowisko = env("KSEF_SRODOWISKO", "test") as keyof typeof SRODOWISKA;
  const start = new Date().toISOString();
  await db.from("synchronizacja_ksef").upsert({ id: 1, ostatni_start: start });

  try {
    const klient = new KlientKsef(SRODOWISKA[srodowisko]);
    await klient.zaloguj(env("KSEF_NIP"), env("KSEF_TOKEN"));
    const raport = await synchronizuj(klient, magazynSupabase(db), { start: env("KSEF_START", "2026-02-01T00:00:00Z") });
    await db.from("synchronizacja_ksef").upsert({
      id: 1, ostatni_raport: raport, ostatni_blad: raport.bledy.length ? raport.bledy.join("\n") : null,
    });
    return Response.json(raport);
  } catch (e) {
    // Nie zwracamy szczegółów na zewnątrz; zapisujemy je dla właściciela.
    const opis = e instanceof Error ? e.message : String(e);
    await db.from("synchronizacja_ksef").upsert({ id: 1, ostatni_blad: opis });
    return new Response("Synchronizacja nie powiodła się", { status: 500 });
  }
});
