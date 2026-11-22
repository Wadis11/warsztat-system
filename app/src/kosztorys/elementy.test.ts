import { test } from "node:test";
import assert from "node:assert/strict";
import { elementyZKosztorysu, elementZNazwy } from "./elementy.ts";

test("nazwy części Audatex na elementy rysunku", () => {
  const przyklady: [string, string | null][] = [
    ["DRZWI T P", "drzwi_tylne_p"], ["DRZWI PRZ L POW LIST", "drzwi_przednie_l"], ["BŁOTNIK PRZ L", "blotnik_przedni_l"],
    ["BLOTNIK P L", "blotnik_przedni_l"], ["SCIANA BOCZNA T L", "blotnik_tylny_l"], ["ZDERZAK T", "zderzak_tylny"],
    ["NAKŁADKA ZDERZAKA PRZ", "zderzak_przedni"], ["POKRYWA L ZDERZ PRZ", "zderzak_przedni"], ["MASKA SILNIKA", "maska"],
    ["POKRYWA PRZEDNIA", "maska"], ["POKRYWA BAGAŻNIKA", "klapa_tylna"], ["POKRYWA TYL", "klapa_tylna"],
    ["OBRĘCZ/OGUMIENIE TYL L", "felga_lt"], ["LUSTERKO ZEWN P", "lusterko_p"], ["PRÓG L", "prog_l"], ["KRATA CZOLOWA", "grill"],
    ["UCHW PRZ BLOTN PRZ L", null], ["CZUJN P Ś P WSPO PAR", null], ["REFLEKTOR L KPL", null], ["NADKOLE T L", null],
  ];
  for (const [n, el] of przyklady) assert.equal(elementZNazwy(n), el, n);
});

test("sekcje robocizny i lakierowania", () => {
  const p = (kod: string, reszta: string) => kod.padEnd(13) + reszta;
  const linie = [
    "R O B O C I Z N A  BAZA CZASOWA     10 JC=1 RBG  CENA/KL  1 =180.00  PLN/RBG",
    p("63 69 55 00)", "NAKŁADKA ZDERZAKA TYL WYMIENIĆ              2       5    90.00"),
    p("58 51 19 00", "DRZWI TYLNE P WYBUD/WBUD                    2       4    72.00"),
    p("3481", "SCIANA BOCZNA T L NAPRAWA                   3      30*  540.00"),
    "----------------------------------------------------------------------------",
    "L A K I E R O W A N I E (według  AZT)",
    p("2583", "NAKŁADKA ZDERZAKA T  LAK.NOW.CZ.ST.1 K1R           15"),
    p("1782", "DRZWI T P            ODNOWA LAKIERU                15"),
    p("0995", "UCHW PRZ BLOTN PRZ L LAK. WIERZCHNIE ST 2           4"),
    "MATERIAŁ LAKIERNICZY NA CZĘŚĆ",
    p("1782", "DRZWI T P            ODNOWA LAKIERU            405.37"),
  ];
  const e = elementyZKosztorysu(linie, [{ nazwa: "MASKA SILNIKA" }]);
  assert.deepEqual(Object.fromEntries([...e].map(([k, v]) => [k, [...v].sort()])), {
    zderzak_tylny: ["lakierowanie", "wymiana"], blotnik_tylny_l: ["blacharka"], drzwi_tylne_p: ["lakierowanie"], maska: ["wymiana"],
  });
});
