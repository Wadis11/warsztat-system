import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsujFakture, wartoscDoRozliczenia } from "./fa3.ts";

const wczytaj = (n: string) => readFileSync(new URL(`./testy/${n}`, import.meta.url), "utf8");

test("faktura zakupu części: nagłówek, kwoty, pozycje, uwagi", () => {
  const f = parsujFakture(wczytaj("zakup_czesci.xml"));
  assert.equal(f.numer, "FV/2026/11/4412");
  assert.equal(f.dataWystawienia, "2026-11-19");
  assert.equal(f.rodzaj, "VAT");
  assert.equal(f.sprzedawca.nip, "9990000001");
  assert.equal(f.nabywca.nip, "1111111111");
  assert.equal(f.netto, 3816.15);
  assert.equal(f.vat, 877.71);
  assert.equal(f.brutto, 4693.86);
  assert.equal(f.pozycje.length, 3);
  assert.deepEqual(f.pozycje[0], {
    lp: 1, nazwa: "ZDERZAK TYLNY", indeks: "1 904 748", ilosc: 1, jednostka: "szt.",
    cenaNetto: 2270, netto: 2270, stawkaVat: "23", stanPrzed: false,
  });
  assert.ok(f.teksty.some((t) => t.includes("26-0412")));
  // suma pozycji zgadza się z nagłówkiem
  assert.equal(Math.round(f.pozycje.reduce((a, p) => a + p.netto, 0) * 100) / 100, f.netto);
});

test("numer katalogowy z zerami wiodącymi zostaje tekstem", () => {
  const f = parsujFakture(wczytaj("zakup_lakier.xml"));
  assert.equal(f.pozycje[0].indeks, "00412-1L");
  assert.equal(f.pozycje[1].indeks, null);
});

test("numery zamówień z warunków transakcji trafiają do tekstów", () => {
  const f = parsujFakture(wczytaj("zakup_zbiorczy.xml"));
  assert.deepEqual(f.teksty, ["Zamówienie: 26-0412", "Zamówienie: 26-0415"]);
});

test("korekta: numer korygowanej faktury i zmiana kosztu ze „stanu przed”", () => {
  const f = parsujFakture(wczytaj("korekta.xml"));
  assert.equal(f.rodzaj, "KOR");
  assert.equal(f.korygowanaNrKsef, "9990000001-20261119-0A1B2C3D4E5F-AB");
  assert.equal(f.netto, -187.25);
  const zmiana = f.pozycje.reduce((a, p) => a + wartoscDoRozliczenia(p), 0);
  assert.equal(zmiana, -187.25);
});

test("dokument, który nie jest fakturą, daje czytelny błąd", () => {
  assert.throws(() => parsujFakture("<Inny/>"), /brak elementu Faktura/);
});
