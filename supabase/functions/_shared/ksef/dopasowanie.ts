// Dopasowanie pozycji faktury zakupowej do zlecenia i kategorii kosztu.
// Szukamy wyłącznie wśród znanych, otwartych zleceń; nie zgadujemy numerów z powietrza.
import type { Faktura, PozycjaFaktury } from "./fa3.ts";

export interface Kandydat {
  id: string;
  numer: string; // 26-0412
  nrRej: string | null;
  vin: string | null;
  /** Znormalizowane numery katalogowe części z kosztorysów tego zlecenia. */
  indeksy: string[];
}

export interface Regula {
  nipDostawcy: string | null;
  wzorzec: string | null; // wyrażenie regularne na nazwę lub indeks; null = cały dostawca
  kategoria: Kategoria;
}

export type Kategoria = "czesc" | "lakier" | "material" | "koszt_ogolny" | "koszt_sprawy" | "nieustalona";
export type Sposob = "nr_zlecenia" | "rejestracja_vin" | "indeks_kosztorysu" | "regula" | "reczne" | "brak";

export interface Wynik {
  zlecenieId: string | null;
  sposob: Sposob;
  /** 0..1. Od PROG_AUTOMATYCZNY wzwyż pozycja przypisuje się sama, poniżej trafia do kolejki. */
  pewnosc: number;
  kategoria: Kategoria;
  /** Zlecenia, które pasują, gdy nie da się wskazać jednego. */
  propozycje: string[];
}

export const PROG_AUTOMATYCZNY = 0.9;

/** Jak norm_indeks w bazie: tylko litery i cyfry, wielkie litery. */
export const normIndeks = (t: string | null | undefined): string =>
  (t ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const normTekst = (t: string) => t.toUpperCase().replace(/[\s\-.]/g, "");

/** Numery zleceń, rejestracje i VIN-y otwartych zleceń, które występują w tekście. */
function znajdzWTekscie(tekst: string, kandydaci: Kandydat[]): { k: Kandydat; sposob: Sposob; pewnosc: number }[] {
  const wyniki: { k: Kandydat; sposob: Sposob; pewnosc: number }[] = [];
  const zwarty = normTekst(tekst);
  for (const k of kandydaci) {
    if (new RegExp(`(^|[^0-9])${k.numer.replace("-", "[-/ ]?")}([^0-9]|$)`).test(tekst)) {
      wyniki.push({ k, sposob: "nr_zlecenia", pewnosc: 0.99 });
    } else if (k.vin && k.vin.length === 17 && zwarty.includes(k.vin.toUpperCase())) {
      wyniki.push({ k, sposob: "rejestracja_vin", pewnosc: 0.98 });
    } else if (k.nrRej && normTekst(k.nrRej).length >= 5 && zwarty.includes(normTekst(k.nrRej))) {
      wyniki.push({ k, sposob: "rejestracja_vin", pewnosc: 0.95 });
    }
  }
  return wyniki;
}

const SLOWA: [Kategoria, RegExp][] = [
  ["lakier", /\b(LAKIER|BAZA|BAZOW|PODK[ŁL]AD|UTWARDZACZ|ROZCIE[ŃN]CZALNIK|KLAR|BEZBARWN|PIGMENT|MIESZALNIK)/i],
  ["material", /\b(PAPIER|[ŚS]CIERN|KR[ĄA][ŻZ]EK|TA[ŚS]MA|MASKUJ|FOLIA|SZPACHL|R[ĘE]KAWIC|ODT[ŁL]USZCZ|POLER|PAST[AY]|KLEJ|USZCZELNIACZ|ŚCIERECZK|SCIERECZK)/i],
];

function kategoriaZRegul(f: Faktura, p: PozycjaFaktury, reguly: Regula[]): Kategoria | null {
  for (const r of reguly) {
    if (r.nipDostawcy && r.nipDostawcy !== f.sprzedawca.nip) continue;
    if (r.wzorzec && !new RegExp(r.wzorzec, "i").test(`${p.nazwa} ${p.indeks ?? ""}`)) continue;
    return r.kategoria;
  }
  return null;
}

export function dopasujPozycje(
  f: Faktura,
  p: PozycjaFaktury,
  kandydaci: Kandydat[],
  reguly: Regula[] = [],
): Wynik {
  const zReguly = kategoriaZRegul(f, p, reguly);
  const zeSlow = SLOWA.find(([, re]) => re.test(p.nazwa))?.[0] ?? null;

  // 1. Odniesienie w samej pozycji (np. rejestracja dopisana do nazwy części)
  const wPozycji = znajdzWTekscie(`${p.nazwa} ${p.indeks ?? ""}`, kandydaci);
  // 2. Odniesienie w całej fakturze (uwagi, nr zamówienia, stopka); ważne, gdy wskazuje jedno zlecenie
  const wFakturze = znajdzWTekscie(f.teksty.join("\n"), kandydaci);
  const unikalne = (xs: { k: Kandydat }[]) => [...new Map(xs.map((x) => [x.k.id, x])).values()];

  const pozycjaU = unikalne(wPozycji);
  if (pozycjaU.length === 1) {
    const [{ k, sposob, pewnosc }] = wPozycji;
    return { zlecenieId: k.id, sposob, pewnosc, kategoria: zReguly ?? zeSlow ?? "czesc", propozycje: [] };
  }

  // 3. Numer katalogowy z kosztorysu
  const ind = normIndeks(p.indeks);
  const poIndeksie = ind.length >= 5 ? kandydaci.filter((k) => k.indeksy.includes(ind)) : [];

  const fakturaU = unikalne(wFakturze);
  if (fakturaU.length === 1) {
    const { k, sposob, pewnosc } = fakturaU[0] as { k: Kandydat; sposob: Sposob; pewnosc: number };
    return { zlecenieId: k.id, sposob, pewnosc, kategoria: zReguly ?? zeSlow ?? "czesc", propozycje: [] };
  }
  if (fakturaU.length > 1) {
    // Faktura zbiorcza dla kilku aut: rozstrzyga numer katalogowy, inaczej decyzja należy do człowieka
    const wspolne = poIndeksie.filter((k) => fakturaU.some((x) => x.k.id === k.id));
    if (wspolne.length === 1) {
      return { zlecenieId: wspolne[0].id, sposob: "indeks_kosztorysu", pewnosc: 0.95, kategoria: "czesc", propozycje: [] };
    }
    return {
      zlecenieId: null, sposob: "brak", pewnosc: 0.5, kategoria: zReguly ?? zeSlow ?? "czesc",
      propozycje: (wspolne.length ? wspolne : fakturaU.map((x) => x.k)).map((k) => k.id),
    };
  }

  if (poIndeksie.length === 1) {
    return { zlecenieId: poIndeksie[0].id, sposob: "indeks_kosztorysu", pewnosc: 0.92, kategoria: "czesc", propozycje: [] };
  }
  if (poIndeksie.length > 1) {
    return { zlecenieId: null, sposob: "brak", pewnosc: 0.5, kategoria: "czesc", propozycje: poIndeksie.map((k) => k.id) };
  }

  // 4. Brak powiązania z autem: lakier i materiały rozdzielamy miesięcznie, resztę rozstrzyga człowiek
  const kategoria = zReguly ?? zeSlow ?? "nieustalona";
  const pewnosc = zReguly ? 0.95 : kategoria === "nieustalona" ? 0 : 0.6;
  return { zlecenieId: null, sposob: zReguly ? "regula" : "brak", pewnosc, kategoria, propozycje: [] };
}

/** Czy pozycja trafia do kolejki do sprawdzenia. */
export const doKolejki = (w: Wynik) => w.pewnosc < PROG_AUTOMATYCZNY;
