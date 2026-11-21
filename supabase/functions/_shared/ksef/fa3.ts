// Odczyt faktury w strukturze FA(3) (KSeF 2.0) do postaci używanej przez system.
// Zależność: fast-xml-parser (Deno: przez import map "npm:fast-xml-parser").
import { XMLParser } from "fast-xml-parser";

export interface PozycjaFaktury {
  lp: number;
  nazwa: string;
  indeks: string | null;
  ilosc: number | null;
  jednostka: string | null;
  cenaNetto: number | null;
  netto: number;
  stawkaVat: string | null;
  /** W fakturze korygującej: wiersz opisujący stan przed korektą. */
  stanPrzed: boolean;
}

export interface Faktura {
  numer: string;
  dataWystawienia: string;
  rodzaj: string; // VAT, KOR, ZAL, ROZ, UPR, KOR_ZAL, KOR_ROZ
  waluta: string;
  sprzedawca: { nip: string | null; nazwa: string | null };
  nabywca: { nip: string | null; nazwa: string | null };
  netto: number;
  vat: number;
  brutto: number;
  korygowanaNrKsef: string | null;
  pozycje: PozycjaFaktury[];
  /** Teksty, w których dostawca może podać numer zlecenia, rejestrację lub VIN. */
  teksty: string[];
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // wszystko jako tekst: numery katalogowe z zerami wiodącymi zostają nietknięte
  trimValues: true,
  isArray: (name) =>
    ["FaWiersz", "DodatkowyOpis", "Zamowienia", "NrZamowienia", "DaneFaKorygowanej", "StopkaFaktury", "Informacje"]
      .includes(name),
});

// deno-lint-ignore no-explicit-any
type X = any;

const txt = (v: X): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(typeof v === "object" ? v["#text"] ?? "" : v).trim();
  return s === "" ? null : s;
};

const num = (v: X): number | null => {
  const s = txt(v);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const sum = (fa: X, keys: string[]) =>
  round2(keys.reduce((acc, k) => acc + (num(fa[k]) ?? 0), 0));

const round2 = (n: number) => Math.round(n * 100) / 100;

// Część dostawców wystawia faktury „od brutto”: wiersz ma tylko P_11A (wartość brutto).
// Wtedy netto wiersza = brutto / (1 + stawka); stawki nienumeryczne (zw, np, oo) liczymy jako 0%.
function nettoWiersza(w: X): number {
  const netto = num(w.P_11);
  if (netto !== null) return netto;
  const brutto = num(w.P_11A);
  if (brutto === null) return 0;
  const stawka = Number(txt(w.P_12));
  return round2(brutto / (1 + (Number.isFinite(stawka) ? stawka / 100 : 0)));
}

// Pola P_13_x to kwoty netto w poszczególnych stawkach, P_14_x to VAT.
const NETTO = ["P_13_1", "P_13_2", "P_13_3", "P_13_4", "P_13_5", "P_13_6_1", "P_13_6_2", "P_13_6_3", "P_13_7", "P_13_8", "P_13_9", "P_13_10", "P_13_11"];
const VAT = ["P_14_1", "P_14_2", "P_14_3", "P_14_4", "P_14_5"];

export function parsujFakture(xml: string): Faktura {
  const doc = parser.parse(xml);
  const f = doc.Faktura;
  if (!f) throw new Error("To nie jest faktura FA: brak elementu Faktura");
  const fa = f.Fa;
  if (!fa) throw new Error("Brak sekcji Fa");

  const pozycje: PozycjaFaktury[] = (fa.FaWiersz ?? []).map((w: X, i: number) => ({
    // Kolejny numer wiersza w dokumencie. NrWierszaFa bywa powtórzony (korekty: wiersz „przed” i „po”
    // mają ten sam numer; niektóre programy też go dublują), więc nie nadaje się na klucz.
    lp: i + 1,
    nazwa: txt(w.P_7) ?? "(bez nazwy)",
    indeks: txt(w.Indeks),
    ilosc: num(w.P_8B),
    jednostka: txt(w.P_8A),
    cenaNetto: num(w.P_9A),
    // P_11 = wartość netto wiersza; przy fakturach liczonych od brutto bywa tylko P_11A
    netto: nettoWiersza(w),
    stawkaVat: txt(w.P_12),
    stanPrzed: txt(w.StanPrzed) === "1",
  }));

  const teksty: string[] = [];
  for (const d of fa.DodatkowyOpis ?? []) {
    const t = [txt(d.Klucz), txt(d.Wartosc)].filter(Boolean).join(": ");
    if (t) teksty.push(t);
  }
  for (const z of fa.WarunkiTransakcji?.Zamowienia ?? []) {
    for (const nr of z.NrZamowienia ?? []) {
      const t = txt(nr);
      if (t) teksty.push(`Zamówienie: ${t}`);
    }
  }
  for (const info of f.Stopka?.Informacje ?? []) {
    for (const s of info.StopkaFaktury ?? []) {
      const t = txt(s);
      if (t) teksty.push(t);
    }
  }
  const nrKlienta = txt(f.Podmiot2?.NrKlienta);
  if (nrKlienta) teksty.push(`Nr klienta: ${nrKlienta}`);

  const kor = (fa.DaneFaKorygowanej ?? [])[0];
  const netto = sum(fa, NETTO);
  const vat = sum(fa, VAT);

  return {
    numer: txt(fa.P_2) ?? "",
    dataWystawienia: txt(fa.P_1) ?? "",
    rodzaj: txt(fa.RodzajFaktury) ?? "VAT",
    waluta: txt(fa.KodWaluty) ?? "PLN",
    sprzedawca: { nip: txt(f.Podmiot1?.DaneIdentyfikacyjne?.NIP), nazwa: txt(f.Podmiot1?.DaneIdentyfikacyjne?.Nazwa) },
    nabywca: { nip: txt(f.Podmiot2?.DaneIdentyfikacyjne?.NIP), nazwa: txt(f.Podmiot2?.DaneIdentyfikacyjne?.Nazwa) },
    netto,
    vat,
    brutto: num(fa.P_15) ?? round2(netto + vat),
    korygowanaNrKsef: kor ? txt(kor.NrKSeFFaKorygowanej) : null,
    pozycje,
    teksty,
  };
}

/**
 * Wartość pozycji do rozliczenia na zleceniu.
 * W korekcie wiersz „stan przed” odejmujemy, a wiersz „stan po” dodajemy; różnica to faktyczna zmiana kosztu.
 */
export function wartoscDoRozliczenia(p: PozycjaFaktury): number {
  return p.stanPrzed ? -p.netto : p.netto;
}
