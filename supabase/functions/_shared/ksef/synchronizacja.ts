// Przyrostowa synchronizacja faktur z KSeF do lokalnej bazy.
// Okna czasowe po dacie trwałego zapisu (PermanentStorage) ograniczone do HWM: to, co już pobrane, jest kompletne.
// Przy małym wolumenie pobieramy faktury pojedynczo (GET /invoices/ksef/{nr}, limit 64/h).
import { type Faktura, parsujFakture, wartoscDoRozliczenia } from "./fa3.ts";
import { dopasujPozycje, type Kandydat, type Regula, type Wynik } from "./dopasowanie.ts";
import type { KlientKsef, MetadaneFaktury, TypPodmiotu } from "./klient.ts";

export type Kierunek = "zakup" | "sprzedaz";

export interface ZapisFaktury {
  kierunek: Kierunek;
  meta: MetadaneFaktury;
  xml: string;
  faktura: Faktura;
  /** Faktura sprzedaży: zlecenie, którego dotyczy (jeśli jednoznaczne). */
  zlecenieId: string | null;
  /** Faktura zakupu: wynik dopasowania każdej pozycji, w kolejności pozycji. */
  pozycje: { lp: number; wartosc: number; wynik: Wynik }[];
}

export interface Magazyn {
  punktKontynuacji(typ: TypPodmiotu): Promise<string | null>;
  ustawPunktKontynuacji(typ: TypPodmiotu, iso: string): Promise<void>;
  znaneNumery(numery: string[]): Promise<Set<string>>;
  kandydaci(): Promise<Kandydat[]>;
  reguly(): Promise<Regula[]>;
  zapisz(z: ZapisFaktury): Promise<void>;
}

export interface Raport {
  pobrano: { zakup: number; sprzedaz: number };
  doKolejki: number;
  dokonczone: boolean; // false = limit pobrań wyczerpany, reszta w kolejnym uruchomieniu
  bledy: string[];
}

const TYPY: [TypPodmiotu, Kierunek][] = [["Subject2", "zakup"], ["Subject1", "sprzedaz"]];
const OKNO_MS = 90 * 24 * 3600 * 1000; // KSeF: zakres dat najwyżej 100 dni

export async function synchronizuj(
  klient: KlientKsef,
  magazyn: Magazyn,
  opcje: { start: string; maksPobran?: number; teraz?: Date },
): Promise<Raport> {
  const raport: Raport = { pobrano: { zakup: 0, sprzedaz: 0 }, doKolejki: 0, dokonczone: true, bledy: [] };
  let pozostalo = opcje.maksPobran ?? 50;
  const [kandydaci, reguly] = await Promise.all([magazyn.kandydaci(), magazyn.reguly()]);

  const teraz = opcje.teraz ?? new Date();

  for (const [typ, kierunek] of TYPY) {
    let od = (await magazyn.punktKontynuacji(typ)) ?? opcje.start;

    // KSeF przyjmuje zakres najwyżej 100 dni: idziemy oknami po 90 dni aż do teraz.
    while (true) {
      const koniecOkna = new Date(Math.min(Date.parse(od) + OKNO_MS, teraz.getTime()));
      const ostatnieOkno = koniecOkna.getTime() >= teraz.getTime();
      const doIso = koniecOkna.toISOString();
      let strona = 0;
      let hwm: string | undefined;
      let ostatniPrzetworzony: string | null = null;
      let przerwano = false;

      while (true) {
        const s = await klient.metadane(typ, od, strona, 250, doIso);
        hwm = s.permanentStorageHwmDate ?? hwm;
        const znane = await magazyn.znaneNumery(s.invoices.map((m) => m.ksefNumber));

        for (const meta of s.invoices) {
          if (znane.has(meta.ksefNumber)) {
            ostatniPrzetworzony = meta.permanentStorageDate;
            continue;
          }
          if (pozostalo <= 0) {
            przerwano = true;
            break;
          }
          pozostalo--;
          try {
            const xml = await klient.pobierzXml(meta.ksefNumber);
            const faktura = parsujFakture(xml);
            const zapis = przygotuj(kierunek, meta, xml, faktura, kandydaci, reguly);
            await magazyn.zapisz(zapis);
            raport.pobrano[kierunek]++;
            raport.doKolejki += zapis.pozycje.filter((p) => p.wynik.pewnosc < 0.9).length;
            ostatniPrzetworzony = meta.permanentStorageDate;
          } catch (e) {
            // Zatrzymujemy się na tej fakturze: następne uruchomienie zacznie od niej, nic nie zginie.
            raport.bledy.push(`${meta.ksefNumber}: ${e instanceof Error ? e.message : String(e)}`);
            przerwano = true;
            break;
          }
        }
        if (przerwano || !s.hasMore) break;
        strona++;
      }

      if (przerwano) {
        raport.dokonczone = false;
        // Początek następnego okna = data ostatniej przetworzonej faktury (włącznie; duplikaty odsiewa numer KSeF)
        if (ostatniPrzetworzony) await magazyn.ustawPunktKontynuacji(typ, ostatniPrzetworzony);
        break;
      }
      // Okno kompletne: dane są pewne do końca okna, ale nie dalej niż do HWM.
      const pewneDo = hwm && Date.parse(hwm) < koniecOkna.getTime() ? hwm : doIso;
      await magazyn.ustawPunktKontynuacji(typ, pewneDo);
      if (ostatnieOkno || pewneDo !== doIso) break;
      od = doIso;
    }
  }
  return raport;
}

export function przygotuj(
  kierunek: Kierunek,
  meta: MetadaneFaktury,
  xml: string,
  faktura: Faktura,
  kandydaci: Kandydat[],
  reguly: Regula[],
): ZapisFaktury {
  if (kierunek === "sprzedaz") {
    // Faktura sprzedaży dotyczy jednego auta: szukamy numeru zlecenia, rejestracji lub VIN w całej fakturze
    const sztuczna = { lp: 0, nazwa: faktura.pozycje.map((p) => p.nazwa).join(" "), indeks: null, ilosc: null,
      jednostka: null, cenaNetto: null, netto: 0, stawkaVat: null, stanPrzed: false };
    const w = dopasujPozycje(faktura, sztuczna, kandydaci, []);
    return { kierunek, meta, xml, faktura, zlecenieId: w.zlecenieId && w.pewnosc >= 0.9 ? w.zlecenieId : null, pozycje: [] };
  }
  return {
    kierunek, meta, xml, faktura, zlecenieId: null,
    pozycje: faktura.pozycje.map((p) => ({
      lp: p.lp,
      wartosc: wartoscDoRozliczenia(p),
      wynik: dopasujPozycje(faktura, p, kandydaci, reguly),
    })),
  };
}
