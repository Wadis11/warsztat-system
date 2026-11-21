import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { synchronizuj, type Magazyn, type ZapisFaktury } from "./synchronizacja.ts";
import type { KlientKsef, MetadaneFaktury, StronaMetadanych, TypPodmiotu } from "./klient.ts";
import { normIndeks } from "./dopasowanie.ts";

const TERAZ = new Date("2026-11-21T12:00:00Z");
const xml = (n: string) => readFileSync(new URL(`./testy/${n}`, import.meta.url), "utf8");

const meta = (nr: string, data: string): MetadaneFaktury => ({
  ksefNumber: nr, invoiceNumber: nr, issueDate: data.slice(0, 10), permanentStorageDate: data,
  seller: { nip: "9990000001" }, netAmount: 0, grossAmount: 0, vatAmount: 0, invoiceType: "Vat",
});

/** Atrapa KSeF: faktury zakupowe na dwóch stronach, jedna sprzedażowa. */
function ksef(opcje: { zepsuta?: string } = {}) {
  const zakupy = [
    meta("Z1", "2026-11-19T10:00:00Z"), meta("Z2", "2026-11-20T10:00:00Z"),
    meta("Z3", "2026-11-20T11:00:00Z"), meta("Z4", "2026-11-21T09:00:00Z"),
  ];
  const pliki: Record<string, string> = {
    Z1: xml("zakup_czesci.xml"), Z2: xml("zakup_zbiorczy.xml"), Z3: xml("zakup_lakier.xml"), Z4: xml("korekta.xml"),
    S1: xml("sprzedaz.xml"),
  };
  const pobrane: string[] = [];
  const zapytania: [string, string][] = [];
  const klient = {
    async metadane(typ: TypPodmiotu, od: string, strona = 0, _r = 250, doD?: string): Promise<StronaMetadanych> {
      // Jak prawdziwy KSeF: zakres dat najwyżej 100 dni (błąd 21405)
      const koniec = doD ?? TERAZ.toISOString();
      if (Date.parse(koniec) - Date.parse(od) > 100 * 864e5) throw new Error("KSeF 400: 'dateRange' must not exceed 100 days.");
      zapytania.push([od, koniec]);
      const zrodlo = typ === "Subject2" ? zakupy : [meta("S1", "2026-11-21T08:00:00Z")];
      const pasujace = zrodlo.filter((m) => m.permanentStorageDate >= od && m.permanentStorageDate <= koniec);
      const porcja = pasujace.slice(strona * 2, strona * 2 + 2);
      return { hasMore: pasujace.length > (strona + 1) * 2, isTruncated: false,
        permanentStorageHwmDate: "2026-11-21T10:00:00Z", invoices: porcja };
    },
    async pobierzXml(nr: string) {
      pobrane.push(nr);
      if (nr === opcje.zepsuta) return "<to nie jest xml";
      return pliki[nr];
    },
  };
  return { klient: klient as unknown as KlientKsef, pobrane, zapytania };
}

function magazyn() {
  const punkty = new Map<TypPodmiotu, string>();
  const zapisane = new Map<string, ZapisFaktury>();
  const m: Magazyn = {
    async punktKontynuacji(t) { return punkty.get(t) ?? null; },
    async ustawPunktKontynuacji(t, iso) { punkty.set(t, iso); },
    async znaneNumery(nr) { return new Set(nr.filter((n) => zapisane.has(n))); },
    async kandydaci() {
      return [
        { id: "z-mondeo", numer: "26-0412", nrRej: "WE 5V073", vin: null, indeksy: ["1904748", "2337652", "1899683"] },
        { id: "z-rav4", numer: "26-0415", nrRej: "WI473NE", vin: null, indeksy: [normIndeks("1EX354 887-011")] },
      ];
    },
    async reguly() { return []; },
    async zapisz(z) { zapisane.set(z.meta.ksefNumber, z); },
  };
  return { m, punkty, zapisane };
}

test("pełna synchronizacja: wszystkie faktury, punkt kontynuacji = HWM", async () => {
  const { klient } = ksef();
  const { m, punkty, zapisane } = magazyn();
  const r = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", teraz: TERAZ });
  assert.deepEqual(r.pobrano, { zakup: 4, sprzedaz: 1 });
  assert.equal(r.dokonczone, true);
  assert.equal(punkty.get("Subject2"), "2026-11-21T10:00:00Z");
  assert.equal(zapisane.get("S1")!.zlecenieId, "z-mondeo");
  // korekta zmniejsza koszt zlecenia o zwróconą część
  const kor = zapisane.get("Z4")!;
  assert.equal(kor.pozycje.reduce((a, p) => a + p.wartosc, 0), -187.25);
  assert.ok(kor.pozycje.every((p) => p.wynik.zlecenieId === "z-mondeo"));
});

test("powtórne uruchomienie niczego nie pobiera drugi raz", async () => {
  const { klient, pobrane } = ksef();
  const { m } = magazyn();
  await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", teraz: TERAZ });
  const ile = pobrane.length;
  const r = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", teraz: TERAZ });
  assert.equal(pobrane.length, ile);
  assert.deepEqual(r.pobrano, { zakup: 0, sprzedaz: 0 });
});

test("limit pobrań: przerwa w połowie, następne uruchomienie kończy bez luk", async () => {
  const { klient } = ksef();
  const { m, zapisane } = magazyn();
  const r1 = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", maksPobran: 3, teraz: TERAZ });
  assert.equal(r1.dokonczone, false);
  assert.equal(zapisane.size, 3);
  const r2 = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", maksPobran: 10, teraz: TERAZ });
  assert.equal(r2.dokonczone, true);
  assert.deepEqual([...zapisane.keys()].sort(), ["S1", "Z1", "Z2", "Z3", "Z4"]);
});

test("uszkodzona faktura: błąd w raporcie, punkt nie przeskakuje jej, reszta czeka", async () => {
  const { klient } = ksef({ zepsuta: "Z2" });
  const { m, punkty, zapisane } = magazyn();
  const r = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", teraz: TERAZ });
  assert.equal(r.bledy.length, 1);
  assert.match(r.bledy[0], /^Z2:/);
  assert.ok(zapisane.has("Z1") && !zapisane.has("Z2") && !zapisane.has("Z3"));
  assert.equal(punkty.get("Subject2"), "2026-11-19T10:00:00Z"); // od Z1 włącznie, więc Z2 wróci
});

test("zaległości od lutego: zapytania oknami po 90 dni, punkt przesuwa się do HWM", async () => {
  const { klient, zapytania } = ksef();
  const { m, punkty } = magazyn();
  const r = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", teraz: TERAZ });
  assert.equal(r.dokonczone, true);
  assert.ok(zapytania.length >= 4, `okien: ${zapytania.length}`);
  for (const [od, doD] of zapytania) assert.ok(Date.parse(doD) - Date.parse(od) <= 100 * 864e5);
  assert.equal(punkty.get("Subject1"), "2026-11-21T10:00:00Z");
});

test("limit czasu: przerwa przed przekroczeniem, stan zapisany, kolejne uruchomienie kontynuuje", async () => {
  const { klient } = ksef();
  const { m, zapisane } = magazyn();
  const r1 = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", teraz: TERAZ, terminMs: Date.now() - 1 });
  assert.equal(r1.dokonczone, false);
  assert.equal(zapisane.size, 0);
  const r2 = await synchronizuj(klient, m, { start: "2026-02-01T00:00:00Z", teraz: TERAZ });
  assert.equal(r2.dokonczone, true);
  assert.equal(zapisane.size, 5);
});
