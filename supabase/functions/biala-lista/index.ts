// Funkcja Supabase: sprawdzenie rachunków dostawców na białej liście VAT (wl-api.mf.gov.pl).
// Dla faktur czekających na zapłatę. Wynik i identyfikator zapytania MF (dowód sprawdzenia) trafiają do faktury.
// Wywoływana przez harmonogram z nagłówkiem x-sync-sekret (ten sam sekret co synchronizacja KSeF).
import { createClient } from "@supabase/supabase-js";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Brak sekretu ${k}`);
  return v;
};
const API = "https://wl-api.mf.gov.pl/api/check/nip";
const PONOWNIE_PO_DNIACH = 7;
const NA_RAZ = 40;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Metoda niedozwolona", { status: 405 });
  if (req.headers.get("x-sync-sekret") !== env("SYNC_SEKRET")) return new Response("Brak uprawnień", { status: 401 });
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  const granica = new Date(Date.now() - PONOWNIE_PO_DNIACH * 864e5).toISOString();
  const { data, error } = await db.from("platnosci")
    .select("id, nip_kontrahenta, rachunek")
    .eq("status", "do_zaplaty").not("rachunek", "is", null).not("nip_kontrahenta", "is", null)
    .or(`bl_sprawdzono.is.null,bl_sprawdzono.lt.${granica}`)
    .order("termin_platnosci", { ascending: true }).limit(NA_RAZ);
  if (error) return new Response(error.message, { status: 500 });

  const dzis = new Date().toISOString().slice(0, 10);
  const wynik = { sprawdzono: 0, tak: 0, nie: 0, bledy: 0 };
  for (const f of data ?? []) {
    const nip = String(f.nip_kontrahenta).replace(/\D/g, "");
    const nrb = String(f.rachunek).replace(/[^0-9]/g, "");
    let zapis: { bl_wynik: string; bl_id: string | null };
    try {
      const odp = await fetch(`${API}/${nip}/bank-account/${nrb}?date=${dzis}`, { headers: { Accept: "application/json" } });
      const j = await odp.json();
      if (!odp.ok || !j?.result?.accountAssigned) throw new Error(j?.message ?? `HTTP ${odp.status}`);
      zapis = { bl_wynik: j.result.accountAssigned === "TAK" ? "TAK" : "NIE", bl_id: j.result.requestId ?? null };
    } catch (e) {
      console.error(f.id, e instanceof Error ? e.message : String(e));
      zapis = { bl_wynik: "blad", bl_id: null };
    }
    await db.from("faktury").update({ ...zapis, bl_sprawdzono: new Date().toISOString() }).eq("id", f.id);
    wynik.sprawdzono++;
    if (zapis.bl_wynik === "TAK") wynik.tak++; else if (zapis.bl_wynik === "NIE") wynik.nie++; else wynik.bledy++;
  }
  return Response.json(wynik);
});
