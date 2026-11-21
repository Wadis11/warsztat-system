import { test } from "node:test";
import assert from "node:assert/strict";
import { linia, oczysc, plikPli, type Przelew, tytul, walidacja } from "./pli.ts";

const firma = { rachunek: "13160011140004070963852001", nazwa: "Auto-Lack Grzegorz Wadowski", adres: "SKRAJNA 13|31-331 KRAKÓW" };
const zwykly: Przelew = {
  rachunekOdbiorcy: "43160010550002321858585001", nazwaOdbiorcy: "Biuro Podróży \"Żagiel\"", adresOdbiorcy: "Hallera 1234|81-000 Gdańsk",
  kwota: 123, numerFaktury: "FV/2026/11/12", mpp: false, kwotaVat: 23, nipOdbiorcy: "555-555-55-55",
};

test("zwykły przelew: układ pól jak w specyfikacji banku", () => {
  assert.equal(linia(zwykly, firma, "20261124"),
    '110,20261124,12300,16001114,0,"13160011140004070963852001","43160010550002321858585001",' +
    '"AUTO-LACK GRZEGORZ WADOWSKI||SKRAJNA 13|31-331 KRAKÓW","BIURO PODRÓŻY ŻAGIEL||HALLERA 1234|81-000 GDAŃSK",' +
    '0,16001055,"FAKTURA FV/2026/11/12","","","51","FV/2026/11/12||5555555555"');
});

test("podzielona płatność: klasyfikacja 53 i bloki /VAT/ /IDC/ /INV/ /TXT/ w liniach po 35 znaków", () => {
  const p = { ...zwykly, mpp: true, kwota: 18450, kwotaVat: 3450 };
  const t = tytul(p);
  assert.equal(t.replace(/\|/g, ""), "/VAT/3450,00/IDC/5555555555/INV/FV/2026/11/12/TXT/FAKTURA FV/2026/11/12");
  assert.ok(t.split("|").every((l) => l.length <= 35) && t.split("|").length <= 4);
  assert.match(linia(p, firma, "20261124"), /,"53","FV\/2026\/11\/12\|\|5555555555"$/);
});

test("kodowanie CP852 polskich liter, CR LF na końcu linii", () => {
  const b = plikPli([zwykly], firma, "20261124");
  assert.ok(b.includes(0xe0) && b.includes(0xbd) && b.includes(0xe3)); // Ó Ż Ń
  assert.deepEqual([...b.slice(-2)], [0x0d, 0x0a]);
  assert.ok(![...b].includes(0x3f), "brak znaków zastępczych");
});

test("czyszczenie tekstu i walidacja", () => {
  assert.equal(oczysc("Müller | „Ćma” \"x\""), "MULLER ĆMA X");
  assert.equal(walidacja({ ...zwykly, kwota: -10 }), "kwota nie jest dodatnia (korekta?)");
  assert.equal(walidacja({ ...zwykly, rachunekOdbiorcy: "123" }), "brak poprawnego rachunku odbiorcy");
  assert.equal(walidacja(zwykly), null);
});
