import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsujFakture } from "./fa3.ts";
import { dopasujPozycje, doKolejki, type Kandydat, normIndeks } from "./dopasowanie.ts";

const wczytaj = (n: string) => parsujFakture(readFileSync(new URL(`./testy/${n}`, import.meta.url), "utf8"));

const mondeo: Kandydat = {
  id: "z-mondeo", numer: "26-0412", nrRej: "WE 5V073", vin: "WF0FXXWPCHME30786",
  indeksy: ["1904748", "2337652", "1899683"].map(normIndeks),
};
const rav4: Kandydat = {
  id: "z-rav4", numer: "26-0415", nrRej: "WI473NE", vin: "JTMW53FV60D519997",
  indeksy: ["1EX354 887-011", "OE5271142140B0"].map(normIndeks),
};
const kandydaci = [mondeo, rav4];

test("numer zlecenia w uwagach przypisuje wszystkie pozycje", () => {
  const f = wczytaj("zakup_czesci.xml");
  for (const p of f.pozycje) {
    const w = dopasujPozycje(f, p, kandydaci);
    assert.equal(w.zlecenieId, "z-mondeo", p.nazwa);
    assert.equal(w.sposob, "nr_zlecenia");
    assert.equal(doKolejki(w), false);
  }
});

test("faktura zbiorcza dla dwóch aut: rozstrzyga numer katalogowy z kosztorysu", () => {
  const f = wczytaj("zakup_zbiorczy.xml");
  const [listwa, reflektor, spinka] = f.pozycje.map((p) => dopasujPozycje(f, p, kandydaci));
  assert.equal(listwa.zlecenieId, "z-mondeo");
  assert.equal(listwa.sposob, "indeks_kosztorysu");
  assert.equal(reflektor.zlecenieId, "z-rav4");
  // spinki nie ma w żadnym kosztorysie: do kolejki z dwiema propozycjami
  assert.equal(spinka.zlecenieId, null);
  assert.equal(doKolejki(spinka), true);
  assert.deepEqual(spinka.propozycje.sort(), ["z-mondeo", "z-rav4"]);
});

test("bez odniesień do auta: numer katalogowy z jednego kosztorysu wystarcza", () => {
  const f = wczytaj("zakup_czesci.xml");
  const bezUwag = { ...f, teksty: [] };
  const owiewka = f.pozycje[2];
  const w = dopasujPozycje(bezUwag, owiewka, kandydaci);
  assert.equal(w.zlecenieId, "z-rav4");
  assert.equal(w.sposob, "indeks_kosztorysu");
});

test("lakier i materiały bez auta: kategoria ze słów, do kolejki do potwierdzenia", () => {
  const f = wczytaj("zakup_lakier.xml");
  const [lakier, papier] = f.pozycje.map((p) => dopasujPozycje(f, p, kandydaci));
  assert.equal(lakier.kategoria, "lakier");
  assert.equal(papier.kategoria, "material");
  assert.equal(lakier.zlecenieId, null);
  assert.equal(doKolejki(lakier), true);
});

test("po zatwierdzeniu reguła dostawcy przypisuje kategorię bez kolejki", () => {
  const f = wczytaj("zakup_lakier.xml");
  const reguly = [{ nipDostawcy: "9990000002", wzorzec: null, kategoria: "lakier" as const }];
  const w = dopasujPozycje(f, f.pozycje[0], kandydaci, reguly);
  assert.equal(w.kategoria, "lakier");
  assert.equal(w.sposob, "regula");
  assert.equal(doKolejki(w), false);
});

test("rejestracja zapisana inaczej (bez spacji) też pasuje", () => {
  const f = wczytaj("sprzedaz.xml");
  const w = dopasujPozycje(f, f.pozycje[0], kandydaci);
  assert.equal(w.zlecenieId, "z-mondeo");
  assert.equal(w.sposob, "rejestracja_vin");
});

test("liczba przypominająca numer zlecenia, ale nieistniejąca, niczego nie przypisuje", () => {
  const f = { ...wczytaj("zakup_lakier.xml"), teksty: ["Okres 11-2026, zamówienie 26-9999"] };
  const w = dopasujPozycje(f, f.pozycje[0], kandydaci);
  assert.equal(w.zlecenieId, null);
});
