// Elementy nadwozia i czynności odczytane z kosztorysu Audatex — do zaznaczenia na rysunku auta.
// Źródła: sekcja robocizny (NAPRAWA / WYMIENIĆ), sekcja lakierowania (lakierowanie, naprawa tworzywa)
// i lista części zamiennych (wymiana). Drobne części (mocowania, czujniki, lampy) pomijamy.

export type CzynnoscElementu = "wymiana" | "blacharka" | "lakierowanie" | "cieniowanie";

const bezOgonkow = (t: string) => t.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Ł/g, "L");
const POMIN = /\b(UCHW|MOCOW|WSPORN|BELKA|BLACHA ZAM|NADKOL|WNEK|PODLUZ|POPRZECZ|CZUJ|ZEST|PROWADZ|ZAWIAS|ZAMEK|USZCZEL|KLAMKA|WYKLADZ|SZYBA|REFLEKTOR|LAMPA|SWIATL|EMBLEMAT|NAPIS|ZNAK|OKLADZ|POKRYCIE|SIEDZ|OPARCIE|FOLI|PRET|OSLONA TYL RAMY|RAMY OKNA|KAMERA|DYSZ|SPRYSK)/;
const PRZOD = new Set(["P", "PRZ", "PRZEDNI", "PRZEDNIA", "PRZEDNIE", "PRZOD"]);
const TYL = new Set(["T", "TYL", "TYLNY", "TYLNA", "TYLNE"]);

/** Tokeny pozycji po słowie kluczowym: przód/tył i strona. */
function pozycja(po: string) {
  const t = po.split(/[\s/,.()-]+/).filter(Boolean);
  const iPoz = t.findIndex((x) => PRZOD.has(x) || TYL.has(x));
  const poz = iPoz < 0 ? null : TYL.has(t[iPoz]) ? "t" : "p";
  const reszta = iPoz < 0 ? t : t.slice(iPoz + 1);
  const s = [...reszta].reverse().find((x) => x === "L" || x === "P" || x === "LEWY" || x === "PRAWY" || x === "LEWE" || x === "PRAWE");
  const strona = !s ? null : s.startsWith("L") ? "l" : "p";
  return { poz, strona, tylkoJedno: t.find((x) => x === "L" || x === "P") ?? null };
}

/** Nazwa części z kosztorysu → id elementu na rysunku (albo null). */
export function elementZNazwy(nazwa: string): string | null {
  const n = bezOgonkow(nazwa).replace(/\s+/g, " ");
  if (POMIN.test(n)) return null;
  const po = (re: RegExp) => { const m = n.match(re); return m ? n.slice(m.index! + m[0].length) : null; };
  const strona = (rest: string) => { const { strona: s, tylkoJedno } = pozycja(rest); return s ?? (tylkoJedno === "L" ? "l" : tylkoJedno === "P" ? "p" : null); };

  let r: string | null;
  if ((r = po(/LUSTER/))) { const s = strona(r); return s ? `lusterko_${s}` : null; }
  if ((r = po(/SLUP(EK)? ?"?A"?\b/))) { const s = strona(r); return s ? `slupek_a_${s}` : null; }
  if ((r = po(/\bPROG/))) { const s = strona(r); return s ? `prog_${s}` : null; }
  if ((r = po(/OBRECZ|FELGA|\bKOLO\b/))) {
    const { poz, strona: s } = pozycja(r);
    return poz && s ? `felga_${s}${poz === "p" ? "p" : "t"}` : null;
  }
  if ((r = po(/SCIANA BOCZ\w*|BOCZNA/))) { const s = strona(r); return s ? `blotnik_tylny_${s}` : null; }
  if ((r = po(/BLOTN\w*/))) {
    const { poz, strona: s, tylkoJedno } = pozycja(r);
    const strona2 = s ?? (poz ? null : tylkoJedno === "L" ? "l" : tylkoJedno === "P" ? "p" : null);
    return strona2 ? `blotnik_${poz === "t" ? "tylny" : "przedni"}_${strona2}` : null;
  }
  if ((r = po(/DRZWI/))) {
    const { poz, strona: s, tylkoJedno } = pozycja(r);
    const strona2 = s ?? (poz ? null : tylkoJedno === "L" ? "l" : tylkoJedno === "P" ? "p" : null);
    return strona2 ? `drzwi_${poz === "t" ? "tylne" : "przednie"}_${strona2}` : null;
  }
  if ((r = po(/ZDERZ\w*/))) { const { poz } = pozycja(r); return poz === "t" ? "zderzak_tylny" : poz === "p" ? "zderzak_przedni" : null; }
  if (/MASKA|POKRYWA (PRZ|PRZEDNIA)\b|POKRYWA KOMORY SILN|POKRYWA SILN/.test(n)) return "maska";
  if (/KLAPA|POKRYWA BAGAZ|POKRYWA (T|TYL|TYLNA)\b|POKRYWA KOMORY BAGAZ/.test(n)) return "klapa_tylna";
  if (/\bDACH\b/.test(n) && !/RELING|LISTWA/.test(n)) return "dach";
  if (/ATRAPA|KRATA CZOL|OSLONA CHLODN|GRILL/.test(n)) return "grill";
  return null;
}

const KLUCZ = /\b(NAPRAWA TWORZYWA|NAPRAWA|NAPRAWIC|WYMIENIC|WYMIANA|LAK\.? ?NOW|LAK NOWA|ODNOWA LAKIERU|ODTW\.? LAK|L\.? WIERZCH|LAK\.? WIERZCH|CIENIOW)/;
function czynnoscZOpisu(op: string): CzynnoscElementu | null {
  const o = bezOgonkow(op);
  if (/CIENIOW/.test(o)) return "cieniowanie";
  if (/NAPRAW/.test(o)) return "blacharka";
  if (/WYMIEN|WYMIAN/.test(o)) return "wymiana";
  if (/LAK|ODNOWA|WIERZCH/.test(o)) return "lakierowanie";
  return null;
}

/** Wynik: element → czynności. linieMono to siatka znaków kosztorysu (kolumna nazw od 13. znaku). */
export function elementyZKosztorysu(linieMono: string[], czesci: { nazwa: string }[] = []): Map<string, Set<CzynnoscElementu>> {
  const wynik = new Map<string, Set<CzynnoscElementu>>();
  const dodaj = (el: string | null, c: CzynnoscElementu | null) => { if (el && c) wynik.set(el, (wynik.get(el) ?? new Set()).add(c)); };

  let sekcja: "robocizna" | "lakier" | null = null;
  for (const surowa of linieMono) {
    const l = bezOgonkow(surowa);
    if (/R O B O C I Z N A/.test(l)) { sekcja = "robocizna"; continue; }
    if (/L A K I E R O W A N I E/.test(l)) { sekcja = "lakier"; continue; }
    if (/MATERIAL LAKIERNICZY NA CZESC|KOSZTY ROBOCIZNY LAKIER|KOSZTY MATERIALU LAKIER|^\s*-{20,}|ZESTAWIENIE|CZESCI ZAMIENNE/.test(l)) { sekcja = null; continue; }
    if (!sekcja || l.length < 20 || !/^\S/.test(surowa)) continue;
    const tekst = l.slice(13).replace(/\s+\d[\d.,*P ]*$/, "").trim();
    const m = tekst.match(KLUCZ);
    if (!m) continue;
    // W sekcji lakierowania nazwa elementu ma stałą szerokość (20 znaków), operacja jest za nią
    const nazwa = sekcja === "lakier" ? l.slice(13, 34).trim() : tekst.slice(0, m.index).trim();
    dodaj(elementZNazwy(nazwa), czynnoscZOpisu(sekcja === "lakier" ? l.slice(34) : m[0]));
  }
  for (const c of czesci) dodaj(elementZNazwy(c.nazwa), "wymiana");
  for (const [, cz] of wynik) if (cz.has("lakierowanie")) cz.delete("cieniowanie");
  return wynik;
}
