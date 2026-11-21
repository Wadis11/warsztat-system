// Porównanie parsera TS z prototypem Pythona na lokalnych PDF-ach (dane klientów, poza repozytorium).
// Użycie: node --experimental-strip-types tools/porownaj_parser.ts <katalog_pdf> <wynik_pythona.json>
import * as pdfjs from "../app/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { wyciagnijTekst } from "../app/src/kosztorys/tekstPdf.ts";
import { parsujKosztorys } from "../app/src/kosztorys/parser.ts";
const oczek = JSON.parse(readFileSync(process.argv[3], "utf8"));
const map: Record<string,string> = { nr_rej:"nrRej", vin:"vin", stawka_blach:"stawkaBlach", stawka_lak:"stawkaLak", rbh_blach:"rbhBlach", rbh_lak:"rbhLak",
 robocizna_blach:"robociznaBlach", koszty_dodatkowe:"kosztyDodatkowe", robocizna_lak:"robociznaLak", material_lak:"materialLak", czesci:"czesci", normalia:"normalia",
 netto:"netto", vat:"vat", brutto:"brutto", kontrola_sumy:"kontrolaSumy", nr_kalkulacji:"nrKalkulacji", marka:"marka", data:"data" };
let bledy = 0;
for (const f of readdirSync(process.argv[2])) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2] + "/" + f)), isEvalSupported: false }).promise;
  const t = await wyciagnijTekst(doc as any);
  const r: any = parsujKosztorys(t.linieMono, t.pelnyTekst);
  const e = oczek[f];
  if (e.format === "audatex") {
    for (const [py, ts] of Object.entries(map)) if (JSON.stringify(e[py]) !== JSON.stringify(r[ts] ?? null)) { bledy++; console.log(f, py, "PY:", e[py], "TS:", r[ts]); }
    const pyP = e.pozycje_czesci.map((p: any) => [p.nazwa, p.nr_katalogowy, p.cena].join("|"));
    const tsP = r.pozycjeCzesci.map((p: any) => [p.nazwa, p.nrKatalogowy, p.cena].join("|"));
    if (JSON.stringify(pyP) !== JSON.stringify(tsP)) { bledy++; console.log(f, "czesci roznia sie", pyP.length, tsP.length, pyP.filter((x: string) => !tsP.includes(x)).slice(0,3), tsP.filter((x: string) => !pyP.includes(x)).slice(0,3)); }
    console.log("OK?", f.slice(9,30), r.format, r.autor, r.kontrolaSumy, r.kontrolaCzesci, r.pozycjeCzesci.length);
  } else console.log(f.slice(9,30), "py:", e.format, "ts:", r.format, r.format === "controlexpert" ? JSON.stringify(r.netto) + JSON.stringify(r.stawkaZaakceptowana) : "");
}
console.log("roznice:", bledy);
if (bledy) process.exitCode = 1;
