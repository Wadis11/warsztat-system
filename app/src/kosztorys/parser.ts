// Odczyt kosztorysów: Audatex (warsztat, Ayvens, pismo UNIQA) i weryfikacja ControlExpert.
// Czysta logika na tekście; wyciąganie tekstu z PDF jest w tekstPdf.ts.
// Przeniesione z prototypu tools/parser/audatex.py i sprawdzone na tych samych 9 dokumentach.

export interface CzescKosztorysu {
  kod: string;
  ilosc: string;
  nazwa: string;
  nrKatalogowy: string;
  znacznik: string | null;
  cena: number;
}

export interface KosztorysAudatex {
  format: "audatex";
  autor: "warsztat" | "Ayvens" | "UNIQA" | null;
  nrKalkulacji: string | null;
  sygnatura: string | null;
  data: string | null; // DD.MM.RRRR
  marka: string | null;
  model: string | null;
  nrRej: string | null;
  vin: string | null;
  nrSzkody: string | null;
  stawkaBlach: number | null;
  stawkaLak: number | null;
  rbhBlach: number;
  rbhLak: number | null;
  robociznaBlach: number | null;
  kosztyDodatkowe: number | null;
  robociznaLak: number | null;
  materialLak: number | null;
  czesci: number | null;
  normalia: number | null;
  netto: number | null;
  vat: number | null;
  brutto: number | null;
  pozycjeCzesci: CzescKosztorysu[];
  kontrolaSumy: boolean;
  kontrolaCzesci: boolean | null;
}

type Trojka = { zlozone: number; korekta: number; zaakceptowane: number };

export interface WeryfikacjaControlExpert {
  format: "controlexpert";
  nrSzkody: string | null;
  data: string | null;
  pojazd: string | null;
  nrRej: string | null;
  robocizna?: Trojka;
  robociznaLak?: Trojka;
  materialLak?: Trojka;
  czesci?: Trojka;
  normalia?: Trojka;
  netto?: Trojka;
  stawkaZlozona?: { blach: number; lak: number };
  stawkaZaakceptowana?: { blach: number; lak: number };
}

export interface Skan {
  format: "skan";
}

export type Kosztorys = KosztorysAudatex | WeryfikacjaControlExpert | Skan;

/** '1 234.56' / '1 234,56' -> 1234.56 */
export function liczba(s: string): number {
  let t = s.replace(/zł/g, "").replace(/ /g, " ").trim().replace(/ /g, "");
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  return Number(t);
}

function znajdz(wzor: RegExp, tekst: string): string | null {
  const m = wzor.exec(tekst);
  return m ? m[1].trim() : null;
}
const znajdzLiczbe = (wzor: RegExp, tekst: string) => {
  const v = znajdz(wzor, tekst);
  return v === null ? null : liczba(v);
};

const KWOTA = String.raw`(\d{1,3}(?: \d{3})*\.\d{2})`;
const re = (s: string, flagi = "") => new RegExp(s, flagi);

export function parsujCzesci(linie: string[]): CzescKosztorysu[] {
  const czesci: CzescKosztorysu[] = [];
  let naglowek: { okr: number; kat: number | null } | null = null;
  for (const ln of linie) {
    if (ln.startsWith("KOD CZ") && ln.includes("OKRE") && ln.includes("CENA") && !ln.includes("KOSZT")) {
      naglowek = { okr: ln.indexOf("OKRE"), kat: ln.includes("NUMER KATALOGOWY") ? ln.indexOf("NUMER KATALOGOWY") : null };
      continue;
    }
    if (!naglowek) continue;
    // Koniec tabeli części: kalkulacja końcowa albo linia z kresek (z wcięciem lub bez)
    if (/K\s+O\s+Ń\s+C\s+O\s+W\s+A/.test(ln) || /^\s*-{10,}/.test(ln)) {
      naglowek = null;
      continue;
    }
    if (ln.startsWith("---") || ln.includes("SYSTEM AUDATEX") || ln.includes("K A L K U L A C J A")) {
      if (ln.startsWith("---")) naglowek = null;
      continue;
    }
    const m = /^(\d{4}|KN|BRAK NR)\s/.exec(ln);
    const pm = /(\d+\.\d{2})[*I]*$/.exec(ln);
    if (!m || !pm) continue;
    const { okr, kat } = naglowek;
    const ilosc = ln.slice(m[1].length, okr).trim();
    let nazwa: string, znacznik: string, nr: string;
    if (kat) {
      nazwa = ln.slice(okr, kat - 1).trim();
      znacznik = ln.slice(kat - 1, kat).trim();
      nr = ln.slice(kat, pm.index).trim();
    } else {
      nazwa = ln.slice(okr, pm.index).trim();
      znacznik = "";
      nr = "";
    }
    czesci.push({ kod: m[1], ilosc: ilosc || "1", nazwa, nrKatalogowy: nr, znacznik: znacznik || null, cena: Number(pm[1]) });
  }
  return czesci;
}

export function parsujAudatex(linie: string[], pelnyTekst: string): KosztorysAudatex {
  const grid = linie.join("\n");
  const t = grid || pelnyTekst;

  const reg = /NR\s+REJESTRACYJNY\/NR\s+IDENT\.\s*:\s*(\S+)\s*\/\s*(\S+)/.exec(t);
  const autor: KosztorysAudatex["autor"] = pelnyTekst.slice(0, 3000).includes("UNIQA")
    ? "UNIQA"
    : /FIRMA NAPRAWCZA\s*:\s*AYVENS/.test(t)
    ? "Ayvens"
    : t.slice(0, 400).includes("AUTO-LACK")
    ? "warsztat"
    : null;

  const stawkaBlach = znajdzLiczbe(/MECH-BLACH\.\s*:\s*([\d.]+)/, grid) ??
    znajdzLiczbe(/CENA(?:\/KL\s+\d)?\s*=\s*([\d.]+)\s*PLN\/RBG/, grid);
  const stawkaLak = znajdzLiczbe(/LAKIEROWANIE - AZT\s*:\s*([\d.]+)/, grid) ??
    znajdzLiczbe(/WSPÓŁCZYNNIK\s+([\d.]+)\s*PLN\/RBG/, grid);
  const jcBaza = znajdzLiczbe(/(\d+)\s*JC\s*=\s*1\s*RBG/, grid) ?? 10;

  const km = /K\s+O\s+Ń\s+C\s+O\s+W\s+A/.exec(grid);
  const k = km ? grid.slice(km.index) : grid;
  const rob = k.split(/L\s?A\s?K\s?I\s?E\s?R\s?O\s?W/)[0];
  let jcBlach = 0;
  for (const m of rob.matchAll(/RAZEM(?:\s+KL\s+\d)?\s+([\d.]+)\s+JC\s+X/g)) jcBlach += liczba(m[1]);
  const jcLak = znajdzLiczbe(/KOŃCOWA\s+ROBOCIZNA\s+LAKIER\s+\d+\s+JC\/RBG\s*:\s*([\d.]+)/, grid);

  const r: KosztorysAudatex = {
    format: "audatex",
    autor,
    nrKalkulacji: znajdz(/K A L K U L A C J A\s+N A P R A W Y\s+NR\s+(\S+)/, t),
    sygnatura: znajdz(/SYGNATURA AKT[^:]*:\s*([^/\n]+)/, t),
    data: znajdz(/DATA WYLICZENIA\s*:\s*(\d\d\.\d\d\.\d{4})/, t),
    marka: znajdz(/MARKA\s*:\s*(.+)/, t),
    model: znajdz(/TYP\/MODEL\s*:\s*(.+)/, t),
    nrRej: reg ? reg[1] : null,
    vin: reg ? reg[2] : null,
    nrSzkody: znajdz(/NUMER SZKODY:\s*(\S+)/, pelnyTekst),
    stawkaBlach,
    stawkaLak,
    rbhBlach: Math.round((jcBlach / jcBaza) * 100) / 100,
    rbhLak: jcLak === null ? null : Math.round((jcLak / jcBaza) * 100) / 100,
    robociznaBlach: znajdzLiczbe(re(String.raw`RAZEM\s+ROBOCIZNA\s*\.+\s*` + KWOTA), k),
    kosztyDodatkowe: znajdzLiczbe(re(String.raw`RAZEM\s+KOSZTY\s+DODATKOWE\s*\.+\s*` + KWOTA), k),
    robociznaLak: znajdzLiczbe(re(String.raw`KOSZTY\s+ROBOCIZNY\s+` + KWOTA), k),
    materialLak: znajdzLiczbe(re(String.raw`KOSZTY\s+MATERIAŁU\s+` + KWOTA), k),
    czesci: znajdzLiczbe(re(String.raw`C\s?Z\s?Ę\s?Ś\s?C\s?I\s+Z\s?A\s?M\s?I\s?E\s?N\s?N\s?E\s+` + KWOTA), k),
    normalia: znajdzLiczbe(re(String.raw`NORMALIA\s*\(\s*[\d.]+\s*%\)\s+` + KWOTA), k),
    netto: znajdzLiczbe(re(String.raw`N\s?A\s?P\s?R\s?A\s?W\s?Y\s+BEZ\s+VAT\s*\.+\s*` + KWOTA), k),
    vat: znajdzLiczbe(re(String.raw`VAT\s+[\d.]+\s*%\s+` + KWOTA), k),
    brutto: znajdzLiczbe(re(String.raw`N\s?A\s?P\s?R\s?A\s?W\s?Y\s+Z\s+VAT\s*\.+\s*` + KWOTA), k),
    pozycjeCzesci: parsujCzesci(linie),
    kontrolaSumy: false,
    kontrolaCzesci: null,
  };

  const skladniki = [r.robociznaBlach, r.kosztyDodatkowe, r.robociznaLak, r.materialLak, r.czesci, r.normalia]
    .reduce<number>((a, v) => a + (v ?? 0), 0);
  r.kontrolaSumy = r.netto !== null && Math.abs(skladniki - r.netto) < 0.02;
  if (r.czesci !== null) {
    r.kontrolaCzesci = Math.abs(r.pozycjeCzesci.reduce((a, p) => a + p.cena, 0) - r.czesci) < 0.02;
  }
  return r;
}

export function parsujControlExpert(pelnyTekst: string): WeryfikacjaControlExpert {
  const A = String.raw`([\d ]+,\d{2}) zł`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const r: WeryfikacjaControlExpert = {
    format: "controlexpert",
    nrSzkody: znajdz(/Numer szkody:\s*(\S+)/, pelnyTekst),
    data: znajdz(/Data:\s*(\d\d\.\d\d\.\d{4})/, pelnyTekst),
    pojazd: znajdz(/Pojazd:\s*(.+)/, pelnyTekst),
    nrRej: znajdz(/Numer rejestracyjny:\s*(\S+)/, pelnyTekst),
  };
  const wiersze: [keyof WeryfikacjaControlExpert, string][] = [
    ["robocizna", "Robocizna"], ["robociznaLak", "Robocizna lakiernicza"], ["materialLak", "Materiał lakierniczy"],
    ["czesci", "Części zamienne"], ["normalia", "Normalia"], ["netto", "Suma całkowita netto"],
  ];
  for (const [klucz, etykieta] of wiersze) {
    const m = re(String.raw`^\s*` + esc(etykieta) + String.raw`\s+` + A + String.raw`\s+` + A + String.raw`\s+` + A, "m")
      .exec(pelnyTekst);
    if (m) (r as unknown as Record<string, Trojka>)[klucz] = { zlozone: liczba(m[1]), korekta: liczba(m[2]), zaakceptowane: liczba(m[3]) };
  }
  for (const [klucz, etykieta] of [["stawkaZlozona", "Złożone"], ["stawkaZaakceptowana", "Zaakceptowane"]] as const) {
    const m = re("^" + etykieta + String.raw`\s+` + A + String.raw`\s+` + A, "m").exec(pelnyTekst);
    if (m) r[klucz] = { blach: liczba(m[1]), lak: liczba(m[2]) };
  }
  return r;
}

/** Rozpoznaje format na podstawie wyciągniętego tekstu. */
export function parsujKosztorys(linieMono: string[], pelnyTekst: string): Kosztorys {
  if (pelnyTekst.includes("Złożone") && pelnyTekst.includes("Zaakceptowane")) return parsujControlExpert(pelnyTekst);
  if (linieMono.length === 0) return { format: "skan" };
  return parsujAudatex(linieMono, pelnyTekst);
}
