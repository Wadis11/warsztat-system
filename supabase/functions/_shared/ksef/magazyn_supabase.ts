// Magazyn synchronizacji oparty na bazie Supabase (klucz serwisowy, tylko po stronie serwera).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kandydat, Regula } from "./dopasowanie.ts";
import type { TypPodmiotu } from "./klient.ts";
import type { Magazyn, ZapisFaktury } from "./synchronizacja.ts";

const kolumnaPunktu = (t: TypPodmiotu) => (t === "Subject2" ? "punkt_zakupy" : "punkt_sprzedaz");

async function wynik<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`Baza: ${error.message}`);
  return data as T;
}

export function magazynSupabase(db: SupabaseClient): Magazyn {
  return {
    async punktKontynuacji(typ) {
      const w = await wynik(db.from("synchronizacja_ksef").select("*").eq("id", 1).maybeSingle());
      return (w as Record<string, string | null> | null)?.[kolumnaPunktu(typ)] ?? null;
    },

    async ustawPunktKontynuacji(typ, iso) {
      await wynik(db.from("synchronizacja_ksef").upsert({ id: 1, [kolumnaPunktu(typ)]: iso }));
    },

    async znaneNumery(numery) {
      if (numery.length === 0) return new Set();
      const w = await wynik(db.from("faktury").select("nr_ksef").in("nr_ksef", numery));
      return new Set((w as { nr_ksef: string }[]).map((r) => r.nr_ksef));
    },

    async kandydaci(): Promise<Kandydat[]> {
      const w = await wynik(db.rpc("kandydaci_dopasowania"));
      return (w as { id: string; numer: string; nr_rej: string | null; vin: string | null; indeksy: string[] }[])
        .map((r) => ({ id: r.id, numer: r.numer, nrRej: r.nr_rej, vin: r.vin, indeksy: r.indeksy ?? [] }));
    },

    async reguly(): Promise<Regula[]> {
      const w = await wynik(db.from("reguly").select("nip_dostawcy, wzorzec, kategoria").order("utworzono", { ascending: false }));
      return (w as { nip_dostawcy: string | null; wzorzec: string | null; kategoria: Regula["kategoria"] }[])
        .map((r) => ({ nipDostawcy: r.nip_dostawcy, wzorzec: r.wzorzec, kategoria: r.kategoria }));
    },

    async zapisz(z: ZapisFaktury) {
      const f = z.faktura;
      const kontrahent = z.kierunek === "zakup" ? f.sprzedawca : f.nabywca;
      await wynik(db.rpc("zapisz_fakture_ksef", {
        p: {
          nr_ksef: z.meta.ksefNumber,
          kierunek: z.kierunek,
          rodzaj: f.rodzaj,
          numer: f.numer,
          nip_kontrahenta: kontrahent.nip,
          nazwa_kontrahenta: kontrahent.nazwa,
          data_wystawienia: f.dataWystawienia,
          netto: f.netto,
          vat: f.vat,
          brutto: f.brutto,
          korygowana_nr_ksef: f.korygowanaNrKsef,
          zlecenie_id: z.zlecenieId,
          teksty: f.teksty,
          xml: z.xml,
          pozycje: z.pozycje.map((p, i) => {
            const poz = f.pozycje[i];
            return {
              lp: p.lp, nazwa: poz.nazwa, indeks: poz.indeks, ilosc: poz.ilosc, jednostka: poz.jednostka,
              cena_netto: poz.cenaNetto, netto: poz.netto, stan_przed: poz.stanPrzed, wartosc: p.wartosc,
              kategoria: p.wynik.kategoria, zlecenie_id: p.wynik.zlecenieId, sposob: p.wynik.sposob,
              pewnosc: p.wynik.pewnosc, propozycje: p.wynik.propozycje,
            };
          }),
        },
      }));
    },
  };
}
