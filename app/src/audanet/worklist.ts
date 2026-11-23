// Odczyt eksportu „Master Worklist” z AudaNet (CSV, tabulatory, zwykle UTF-16 LE z BOM).

export interface SprawaAudanet {
  nr_szkody: string;
  vin: string;
  nr_rej: string;
  producent: string;
  model: string;
  status_biznesowy: string;
  typ_szkody: string;
  netto: number | null;
  brutto: number | null;
  /** ISO z przesunięciem strefy, czas lokalny przeglądarki (Polska). */
  utworzono: string;
}

/** Dekoduje bajty pliku: UTF-16 LE/BE po BOM albo po zerach co drugi bajt, inaczej UTF-8. */
export function dekoduj(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  if (b.length > 3 && b[1] === 0 && b[3] === 0) return new TextDecoder("utf-16le").decode(b);
  return new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");
}

/** „5 865,83” (spacja twarda) → 5865.83; puste → null. */
export function kwota(t: string | undefined): number | null {
  const s = (t ?? "").replace(/[\s ]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** „08.05.2026 06:19” → Date w czasie lokalnym. */
export function data(t: string): Date | null {
  const m = t.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
}

/** „VW [06]” → „VW”. */
export const producent = (t: string) => t.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
/** „Passat (od 07/'19)      [E3]   [V][R][M]” → „Passat (od 07/'19)”. */
export const model = (t: string) => t.split(/\s{2,}/)[0].trim();

const KOLUMNY = {
  vin: "VIN", nr_szkody: "Numer szkody", utworzono: "Data utworzenia", nr_rej: "Numer rejestracyjny",
  status_biznesowy: "Status biznesowy", producent: "Producent", model: "Model",
  netto: "Kwota całkowita naprawy", brutto: "Kwota całkowita naprawy z VAT", typ_szkody: "Typ szkody",
} as const;

/** Parsuje tekst listy. Rzuca błąd, gdy to nie jest eksport listy AudaNet. */
export function parsujWorklist(tekst: string): SprawaAudanet[] {
  const linie = tekst.split(/\r?\n/).filter((l) => l.trim());
  if (!linie.length) return [];
  const naglowek = linie[0].split("\t").map((h) => h.trim());
  const idx = Object.fromEntries(Object.entries(KOLUMNY).map(([k, h]) => [k, naglowek.indexOf(h)])) as Record<keyof typeof KOLUMNY, number>;
  if (idx.nr_szkody < 0 || idx.utworzono < 0) throw new Error("To nie wygląda na listę spraw z AudaNet (brak kolumn „Numer szkody” i „Data utworzenia”).");
  const pole = (w: string[], k: keyof typeof KOLUMNY) => (idx[k] >= 0 ? (w[idx[k]] ?? "").trim() : "");
  const wynik: SprawaAudanet[] = [];
  for (const l of linie.slice(1)) {
    const w = l.split("\t");
    const nr = pole(w, "nr_szkody");
    const d = data(pole(w, "utworzono"));
    if (!nr || !d) continue;
    wynik.push({
      nr_szkody: nr, vin: pole(w, "vin").toUpperCase(), nr_rej: pole(w, "nr_rej").toUpperCase().replace(/\s/g, ""),
      producent: producent(pole(w, "producent")), model: model(pole(w, "model")),
      status_biznesowy: pole(w, "status_biznesowy"), typ_szkody: pole(w, "typ_szkody"),
      netto: kwota(pole(w, "netto")), brutto: kwota(pole(w, "brutto")), utworzono: d.toISOString(),
    });
  }
  return wynik;
}

/** Numer szkody Ayvens to 10 cyfr (RRMMDDNNNN); inne (np. „CA20/112511/26”) to ubezpieczyciel. */
export const czyAyvens = (nr: string) => /^\d{10}$/.test(nr.trim());
