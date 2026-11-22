import { test } from "node:test";
import assert from "node:assert/strict";
import { odczytajFakture, parsujPozycje } from "./odczyt.ts";

// Teksty w układzie, jaki daje pdf.js (wiersz = linia). Dane zmyślone.
const sklepNetto = `Faktura VAT nr FV/2026/11/0457
Data wystawienia: 18.11.2026
Sprzedawca: Narzędziownia Online Sp. z o.o.
ul. Przykładowa 5, 00-001 Warszawa
NIP: 525-000-11-22
Nabywca: AUTO-LACK GRZEGORZ WADOWSKI NIP 9451284984
Lp. Nazwa Ilość J.m. Cena netto Wartość netto VAT Kwota VAT Wartość brutto
1 Rękawice nitrylowe czarne L 100 szt. 2 op. 25,00 50,00 23% 11,50 61,50
2 Tarcza do cięcia 125x1,0 mm 10 szt. 3,20 32,00 23% 7,36 39,36
3 Śruby M6x20 ocynk
(opakowanie 50 szt.) 1 op. 12,50 12,50 23% 2,88 15,38
Razem 94,50 21,74 116,24
Do zapłaty: 116,24 zł`;

const sklepBrutto = `FAKTURA 2026/11/A/123
Wystawiono: 2026-11-20
Sprzedający
Sklep Warsztatowy Jan Nowak
NIP PL 6790000000
Lp Nazwa towaru Ilość Cena brutto Wartość brutto
1 Klej do szyb kartusz 310 ml 2 szt 36,90 73,80
2 Taśma izolacyjna czarna 5 szt 4,92 24,60
Suma brutto 98,40`;

test("faktura w netto: sprzedawca, NIP, numer, data, pozycje z nazwą w dwóch liniach", () => {
  const f = odczytajFakture(sklepNetto);
  assert.equal(f.numer, "FV/2026/11/0457");
  assert.equal(f.data, "2026-11-18");
  assert.equal(f.sprzedawca, "Narzędziownia Online Sp. z o.o.");
  assert.equal(f.nip, "5250001122");
  assert.equal(f.sumaBrutto, 116.24);
  assert.equal(f.pozycje.length, 3);
  assert.deepEqual(f.pozycje[0], { nazwa: "Rękawice nitrylowe czarne L 100 szt.", ilosc: 2, jednostka: "op", cenaNetto: 25, wartoscNetto: 50, stawka: 23 });
  assert.equal(f.pozycje[1].wartoscNetto, 32);
  assert.equal(f.pozycje[2].nazwa, "Śruby M6x20 ocynk (opakowanie 50 szt.)");
  assert.equal(f.pozycje.reduce((a, p) => a + p.wartoscNetto, 0), 94.5);
});

test("faktura od brutto: netto przeliczone stawką 23%", () => {
  const f = odczytajFakture(sklepBrutto);
  assert.equal(f.numer, "2026/11/A/123");
  assert.equal(f.data, "2026-11-20");
  assert.equal(f.sprzedawca, "Sklep Warsztatowy Jan Nowak");
  assert.equal(f.nip, "6790000000");
  assert.equal(f.pozycje.length, 2);
  assert.equal(f.pozycje[0].ilosc, 2);
  assert.equal(f.pozycje[0].wartoscNetto, 60);   // 73,80 / 1,23
  assert.equal(f.pozycje[1].wartoscNetto, 20);   // 24,60 / 1,23
});

test("kwoty z odstępem tysięcy", () => {
  const p = parsujPozycje("1 Kompresor 1 szt. 1 234,00 1 234,00 23% 283,82 1 517,82");
  assert.equal(p?.wartoscNetto, 1234);
  assert.equal(p?.ilosc, 1);
});

test("sprzedawca i nabywca w dwóch kolumnach", () => {
  const f = odczytajFakture("Faktura VAT nr A/1/2026\nSprzedawca: Nabywca:\nSklep ABC Sp. z o.o. AUTO-LACK GRZEGORZ WADOWSKI\nLp. Nazwa Ilość Cena netto Wartość netto VAT Brutto\n1 Taśma 2 szt. 5,00 10,00 23% 12,30");
  assert.equal(f.sprzedawca, "Sklep ABC Sp. z o.o.");
  assert.equal(f.pozycje[0].wartoscNetto, 10);
});
