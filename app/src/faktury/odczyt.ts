// Odczyt faktury PDF od dowolnego sprzedawcy (sklepy internetowe): sprzedawca, numer, data, pozycje z ceną.
// Układy faktur są różne, więc to heurystyka: wynik zawsze trafia do formularza do sprawdzenia.

export interface PozycjaOdczytana {
  nazwa: string;
  ilosc: number;
  jednostka: string | null;
  cenaNetto: number | null;   // za jednostkę
  wartoscNetto: number;
  stawka: number;             // VAT w %
}

export interface FakturaOdczytana {
  sprzedawca: string | null;
  nip: string | null;
  numer: string | null;
  data: string | null;        // RRRR-MM-DD
  pozycje: PozycjaOdczytana[];
  sumaBrutto: number | null;  // „Do zapłaty” / „Razem brutto”, do kontroli
}

const NASZ_NIP = "9451284984";
const KWOTA = /^-?\d{1,3}(?:[  ]\d{3})*[.,]\d{2}$|^-?\d+[.,]\d{2}$/;
const JEDNOSTKI = /^(szt|szt\.|sztuk|kpl|kpl\.|op|op\.|opak|opak\.|kg|g|l|litr|m|mb|m\.b\.|rolka|para|pary|usł|usł\.|usluga|usługa)$/i;
const KONIEC_POZYCJI = /^(razem|suma|podsumowanie|do zapłaty|do zaplaty|w tym|ogółem|ogolem|wartość netto|sposób zapłaty|forma płatności|stawka vat|zapłacono)/i;

export const liczba = (s: string) => Number(s.replace(/[  ]/g, "").replace(",", "."));
const r2 = (n: number) => Math.round(n * 100) / 100;

function data(t: string): string | null {
  const m = t.match(/(\d{4})-(\d{2})-(\d{2})/) ?? t.match(/(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
  if (!m) return null;
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
}

/** Tokeny linii: kwoty z groszami sklejamy, gdy tysiące są rozdzielone spacją („1 234,50”). */
function tokeny(linia: string): string[] {
  return linia.replace(/(\d{1,3})[  ](\d{3}[.,]\d{2})(?!\d)/g, "$1$2").split(/\s+/).filter(Boolean);
}

/** Jedna linia pozycji: „1 Rękawiczki nitrylowe 2 op. 25,00 50,00 23% 11,50 61,50” albo bez Lp. */
export function parsujPozycje(linia: string, cenyBrutto = false): PozycjaOdczytana | null {
  const t = tokeny(linia);
  if (t.length < 3) return null;
  const poczatek = /^\d{1,3}\.?$/.test(t[0]) ? 1 : 0; // Lp.
  const pierwszaKwota = t.findIndex((x, i) => i >= poczatek && KWOTA.test(x));
  if (pierwszaKwota < 0) return null;

  // Ilość: ostatnia para „liczba + jednostka” przed pierwszą kwotą („100 szt.” w nazwie zostaje nazwą),
  // a bez jednostki — liczba całkowita tuż przed kwotą.
  let ilosc = 1;
  let jednostka: string | null = null;
  let koniecNazwy = pierwszaKwota;
  const LICZBA = /^\d+(?:[.,]\d{1,3})?$/;
  if (JEDNOSTKI.test(t[pierwszaKwota - 1] ?? "") && LICZBA.test(t[pierwszaKwota - 2] ?? "") && pierwszaKwota - 2 >= poczatek) {
    ilosc = liczba(t[pierwszaKwota - 2]);
    jednostka = t[pierwszaKwota - 1].replace(/\.$/, "");
    koniecNazwy = pierwszaKwota - 2;
  } else if (LICZBA.test(t[pierwszaKwota - 1] ?? "") && pierwszaKwota - 1 > poczatek) {
    ilosc = liczba(t[pierwszaKwota - 1]);
    koniecNazwy = pierwszaKwota - 1;
  }
  const nazwa = t.slice(poczatek, koniecNazwy);
  const reszta = t.slice(pierwszaKwota);
  const kwoty = reszta.filter((x) => KWOTA.test(x)).map(liczba);
  if (!nazwa.length || kwoty.length < 1 || !(ilosc > 0)) return null;

  const stawkaTok = reszta.find((x) => /^(23|8|5|0)%$/.test(x)) ?? reszta.find((x) => /^(23|8|5)$/.test(x));
  const stawka = stawkaTok ? Number(stawkaTok.replace("%", "")) : 23;
  const k = 1 + stawka / 100;

  // Para netto → brutto w wierszu rozstrzyga wartość netto
  let wartoscNetto: number | null = null;
  if (!cenyBrutto) {
    for (let a = 0; a < kwoty.length && wartoscNetto === null; a++) {
      for (let b = a + 1; b < kwoty.length; b++) {
        if (Math.abs(kwoty[a] * k - kwoty[b]) <= Math.max(0.02, kwoty[b] * 0.003)) { wartoscNetto = kwoty[a]; break; }
      }
    }
  }
  let cenaNetto: number | null;
  if (wartoscNetto !== null) {
    const c = kwoty.find((x) => Math.abs(x * ilosc - wartoscNetto!) <= 0.02);
    cenaNetto = c ?? r2(wartoscNetto / ilosc);
  } else {
    // Bez pary: cena × ilość = wartość; w tabeli „brutto” przeliczamy stawką
    const cena = kwoty.find((x, j) => kwoty.slice(j + 1).some((y) => Math.abs(x * ilosc - y) <= 0.02));
    const wartosc = cena !== undefined ? kwoty.find((y) => Math.abs(cena * ilosc - y) <= 0.02)! : kwoty[kwoty.length - 1];
    wartoscNetto = cenyBrutto ? r2(wartosc / k) : wartosc;
    cenaNetto = r2(wartoscNetto / ilosc);
  }
  return { nazwa: nazwa.join(" ").replace(/^[-–•]\s*/, ""), ilosc, jednostka, cenaNetto, wartoscNetto: r2(wartoscNetto), stawka };
}

export function odczytajFakture(tekst: string): FakturaOdczytana {
  const linie = tekst.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const wynik: FakturaOdczytana = { sprzedawca: null, nip: null, numer: null, data: null, pozycje: [], sumaBrutto: null };

  for (const [i, l] of linie.entries()) {
    if (!wynik.numer) {
      const m = l.match(/faktura(?:\s+vat)?(?:\s+nr|\s+numer)?\.?:?\s+([A-Z0-9][A-Z0-9/\-_.]*\d[A-Z0-9/\-_.]*)/i);
      if (m) wynik.numer = m[1];
    }
    if (!wynik.data && /data wystawienia|wystawion/i.test(l)) wynik.data = data(l) ?? data(linie[i + 1] ?? "");
    if (!wynik.sprzedawca && /^(sprzedawca|sprzedający|wystawca|dostawca)\b/i.test(l)) {
      const reszta = l.replace(/^(sprzedawca|sprzedający|wystawca|dostawca):?/i, "").trim();
      wynik.sprzedawca = reszta.length > 2 && !/nabywca/i.test(reszta) ? reszta : linie[i + 1] ?? null;
    }
    for (const m of l.matchAll(/NIP:?\s*(?:PL)?\s*([\d\- ]{10,13})/gi)) {
      const nip = m[1].replace(/\D/g, "");
      if (nip.length === 10 && nip !== NASZ_NIP && !wynik.nip) wynik.nip = nip;
    }
    if (/do zapłaty|do zaplaty|razem brutto|suma brutto|wartość brutto razem/i.test(l)) {
      const k = tokeny(l).filter((x) => KWOTA.test(x)).map(liczba);
      if (k.length) wynik.sumaBrutto = k[k.length - 1];
    }
  }
  wynik.data ??= data(tekst);
  // Sprzedawca i nabywca bywają w dwóch kolumnach obok siebie: obcinamy naszą firmę z linii
  if (wynik.sprzedawca) wynik.sprzedawca = wynik.sprzedawca.replace(/\s*(AUTO[- ]?LACK|GRZEGORZ WADOWSKI|NABYWCA).*$/i, "").trim() || null;

  // Pozycje: od nagłówka tabeli (Lp/Nazwa) do podsumowania; nazwy w kilku liniach doklejamy
  const start = linie.findIndex((l) => /\b(lp\.?|l\.p\.)\b.*\b(nazwa|towar|opis)/i.test(l) || /^(nazwa towaru|towar|opis)\b/i.test(l));
  const naglowek = start >= 0 ? linie[start] : "";
  const cenyBrutto = /brutto/i.test(naglowek) && !/netto/i.test(naglowek);
  let ostatnia: PozycjaOdczytana | null = null;
  let poczatekNazwy: string | null = null; // pozycja, której nazwa zaczyna się linię wyżej niż kwoty
  for (const l of linie.slice(start >= 0 ? start + 1 : 0)) {
    if (KONIEC_POZYCJI.test(l)) { if (wynik.pozycje.length) break; continue; }
    const p = parsujPozycje(l, cenyBrutto);
    if (p) {
      if (poczatekNazwy) p.nazwa = `${poczatekNazwy} ${p.nazwa}`;
      poczatekNazwy = null;
      wynik.pozycje.push(p); ostatnia = p; continue;
    }
    if (start < 0 || /\d[.,]\d{2}/.test(l) || l.length >= 80) continue;
    const lp = l.match(/^\d{1,3}\.?\s+(.+)$/);
    if (lp) poczatekNazwy = lp[1];
    else if (poczatekNazwy) poczatekNazwy += ` ${l}`;
    else if (ostatnia) ostatnia.nazwa += ` ${l}`;
  }
  return wynik;
}
