// Paczka przelewów w formacie MultiCash PLI (Elixir-O) do importu w BNP Paribas GOonline Biznes.
// Specyfikacja banku: „Import płatności w GOonline Biznes”, rozdz. 3 (obowiązuje od 15.11.2026).
// Jedna linia = jeden przelew, pola po przecinku, tekst w cudzysłowie, linie pola rozdzielone „|”,
// wielkie litery, strona kodowa CP852, koniec linii CR LF. Podzielona płatność: klasyfikacja 53
// i tytuł w blokach /VAT/ /IDC/ /INV/ /TXT/.

export interface Przelew {
  rachunekOdbiorcy: string;  // NRB, 26 cyfr
  nazwaOdbiorcy: string;
  adresOdbiorcy: string | null; // linie rozdzielone „|”
  kwota: number;             // brutto w zł
  numerFaktury: string;
  mpp: boolean;
  kwotaVat: number;
  nipOdbiorcy: string | null;
}

export interface Zleceniodawca { rachunek: string; nazwa: string; adres: string }

const POLSKIE = "ĄĆĘŁŃÓŚŹŻ";
const CP852: Record<string, number> = { Ą: 0xa4, Ć: 0x8f, Ę: 0xa8, Ł: 0x9d, Ń: 0xe3, Ó: 0xe0, Ś: 0x97, Ź: 0x8d, Ż: 0xbd };

/** Wielkie litery; polskie znaki zostają, inne litery ze znakami bez znaków; cudzysłów i „|” usunięte. */
export function oczysc(t: string): string {
  return [...t.toLocaleUpperCase("pl-PL")]
    .map((z) => (POLSKIE.includes(z) ? z : z.normalize("NFD").replace(/[̀-ͯ]/g, "")))
    .join("")
    .replace(/["|]/g, " ")
    .replace(/[^\x20-\x7eĄĆĘŁŃÓŚŹŻ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tekst w liniach po 35 znaków, najwyżej 4 linie, rozdzielone „|”. */
function linie(tekst: string, maks = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i < tekst.length && out.length < maks; i += 35) out.push(tekst.slice(i, i + 35));
  return out;
}

function nazwaIAdres(nazwa: string, adres: string | null): string {
  const n = linie(oczysc(nazwa), 2);
  const a = (adres ?? "").split("|").map(oczysc).filter(Boolean).map((x) => x.slice(0, 35)).slice(0, 2);
  return [n[0] ?? "", n[1] ?? "", a[0] ?? "", a[1] ?? ""].join("|");
}

const nrRozliczeniowy = (nrb: string) => nrb.slice(2, 10);
const kwotaPrzecinek = (n: number) => n.toFixed(2).replace(".", ",");

export function tytul(p: Przelew): string {
  if (!p.mpp) return linie(oczysc(`FAKTURA ${p.numerFaktury}`)).join("|");
  const nip = (p.nipOdbiorcy ?? "").replace(/\D/g, "").slice(0, 14);
  const inv = oczysc(p.numerFaktury).slice(0, 35);
  const txt = oczysc(`FAKTURA ${p.numerFaktury}`).slice(0, 33);
  return linie(`/VAT/${kwotaPrzecinek(p.kwotaVat)}/IDC/${nip}/INV/${inv}/TXT/${txt}`).join("|");
}

export function walidacja(p: Przelew): string | null {
  if (!/^\d{26}$/.test(p.rachunekOdbiorcy)) return "brak poprawnego rachunku odbiorcy";
  if (!(p.kwota > 0)) return "kwota nie jest dodatnia (korekta?)";
  if (p.mpp && !(p.nipOdbiorcy ?? "").replace(/\D/g, "")) return "podzielona płatność bez NIP odbiorcy";
  if (p.mpp && p.kwotaVat > p.kwota) return "VAT większy od kwoty przelewu";
  return null;
}

/** Jedna linia pliku (bez CR LF). data: RRRRMMDD. */
export function linia(p: Przelew, z: Zleceniodawca, data: string): string {
  const grosze = Math.round(p.kwota * 100);
  const ref = oczysc(p.numerFaktury).replace(/:/g, " ").replace(/^-+/, "").slice(0, 16);
  const nip = (p.nipOdbiorcy ?? "").replace(/\D/g, "");
  return [
    "110", data, String(grosze), nrRozliczeniowy(z.rachunek), "0",
    `"${z.rachunek}"`, `"${p.rachunekOdbiorcy}"`,
    `"${nazwaIAdres(z.nazwa, z.adres)}"`, `"${nazwaIAdres(p.nazwaOdbiorcy, p.adresOdbiorcy)}"`,
    "0", nrRozliczeniowy(p.rachunekOdbiorcy),
    `"${tytul(p)}"`, `""`, `""`, `"${p.mpp ? "53" : "51"}"`, `"${ref}||${nip}"`,
  ].join(",");
}

/** Cały plik w CP852. */
export function plikPli(przelewy: Przelew[], z: Zleceniodawca, data: string): Uint8Array {
  const tekst = przelewy.map((p) => linia(p, z, data) + "\r\n").join("");
  const bajty = new Uint8Array(tekst.length);
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    const kod = c.charCodeAt(0);
    bajty[i] = kod < 0x80 ? kod : CP852[c] ?? 0x3f;
  }
  return bajty;
}
