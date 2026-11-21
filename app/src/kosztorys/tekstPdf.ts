// Wyciąganie tekstu z PDF przez pdf.js.
// Audatex pisze czcionką o stałej szerokości: odtwarzamy siatkę znaków, żeby kolumny
// (nazwa części, numer katalogowy, cena) trafiały w te same pozycje co na wydruku.

// Minimalny interfejs, który spełnia zarówno pdf.js w przeglądarce, jak i w Node (testy).
export interface DokumentPdf {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{
      items: unknown[];
      styles: Record<string, { fontFamily?: string }>;
    }>;
  }>;
}

interface Element { str: string; transform: number[]; width: number; fontName: string }

export interface TekstPdf {
  /** Linie z czcionki o stałej szerokości, w siatce znaków (puste, gdy brak). */
  linieMono: string[];
  /** Cały tekst w kolejności czytania (do dokumentów bez siatki, np. ControlExpert). */
  pelnyTekst: string;
}

export async function wyciagnijTekst(doc: DokumentPdf): Promise<TekstPdf> {
  const linieMono: string[] = [];
  const pelne: string[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const strona = await doc.getPage(n);
    const tc = await strona.getTextContent();
    const elementy = (tc.items as Element[]).filter((e) => typeof e.str === "string" && e.str.length > 0);

    // pełny tekst: grupowanie po wierszach (y), w wierszu po x, ze spacją między elementami
    const wiersze = new Map<number, Element[]>();
    for (const e of elementy) {
      const y = Math.round(e.transform[5] / 2);
      wiersze.set(y, [...(wiersze.get(y) ?? []), e]);
    }
    for (const y of [...wiersze.keys()].sort((a, b) => b - a)) {
      const w = wiersze.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
      pelne.push(w.map((e) => e.str).join(" ").replace(/\s+/g, " ").trim());
    }

    // siatka dla czcionki o stałej szerokości
    const mono = elementy.filter((e) => tc.styles[e.fontName]?.fontFamily === "monospace");
    if (mono.length === 0) continue;
    const szerokosci = mono.filter((e) => e.str.length > 0).map((e) => e.width / e.str.length).sort((a, b) => a - b);
    const cw = szerokosci[Math.floor(szerokosci.length / 2)];
    if (!cw) continue;
    const lewa = Math.min(...mono.map((e) => e.transform[4]));
    const siatka = new Map<number, Map<number, string>>();
    for (const e of mono) {
      const y = Math.round(e.transform[5] / 2);
      const wiersz = siatka.get(y) ?? new Map<number, string>();
      const kol0 = Math.round((e.transform[4] - lewa) / cw);
      [...e.str].forEach((znak, i) => {
        if (znak !== " " || !wiersz.has(kol0 + i)) wiersz.set(kol0 + i, znak);
      });
      siatka.set(y, wiersz);
    }
    for (const y of [...siatka.keys()].sort((a, b) => b - a)) {
      const w = siatka.get(y)!;
      const max = Math.max(...w.keys());
      let s = "";
      for (let i = 0; i <= max; i++) s += w.get(i) ?? " ";
      linieMono.push(s.trimEnd());
    }
  }
  return { linieMono, pelnyTekst: pelne.join("\n") };
}
