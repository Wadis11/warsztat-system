import { test } from "node:test";
import assert from "node:assert/strict";
import { czyAyvens, dekoduj, kwota, model, parsujWorklist, producent } from "./worklist.ts";

const h = "VIN\tNumer szkody\tData utworzenia\tNumer rejestracyjny\tStatus biznesowy\tStatus zadania\tProducent\tModel\tKwota całkowita naprawy\tKwota całkowita naprawy z VAT\tTyp szkody";
const tekst = [h,
  "WVWZZZ3CZPE043911\t2605050104\t08.05.2026 06:19\twi257mw\tSprawa wysłana\tCopied\tVW [06]\tPassat (od 07/'19)                       [E3]   [V][R][M]\t5 865,83\t7 214,97\t\t",
  "U5YPB814ACL148415\tCA20/112511/26\t12.06.2026 15:17\tKR8XF23\tKosztorys uzgodniony\tCopied\tKIA [28]\tSportage III (od 07/'10)      [50]   [V][R][M]\t2 858,53\t3 515,99\tAuto Casco\t",
  "WAUZZZF35P1086295\t2606240044\t24.06.2026 14:22\tWI376MS\tSprawa wysłana\tCopied\t\t\t\t\t\t",
  ""].join("\r\n");

test("UTF-16 z BOM i bez BOM", () => {
  const u16 = (s: string) => { const b = new Uint8Array(s.length * 2); s.split("").forEach((c, i) => { b[2 * i] = c.charCodeAt(0) & 255; b[2 * i + 1] = c.charCodeAt(0) >> 8; }); return b; };
  assert.equal(dekoduj(new Uint8Array([0xff, 0xfe, ...u16("VIN\tą")])), "VIN\tą");
  assert.equal(dekoduj(u16("VIN\tą")), "VIN\tą");
  assert.equal(dekoduj(new TextEncoder().encode("﻿VIN")), "VIN");
});

test("kwoty, marka, model", () => {
  assert.equal(kwota("44 986,44"), 44986.44);
  assert.equal(kwota("108"), 108);
  assert.equal(kwota(""), null);
  assert.equal(producent("MERCEDES-BENZ [03]"), "MERCEDES-BENZ");
  assert.equal(model("RAV 4 (od 11/'18)(AXA#/MXA#)                [R5]   [V][R][M]"), "RAV 4 (od 11/'18)(AXA#/MXA#)");
});

test("wiersze listy", () => {
  const w = parsujWorklist(tekst);
  assert.equal(w.length, 3);
  assert.deepEqual({ ...w[0], utworzono: undefined }, {
    nr_szkody: "2605050104", vin: "WVWZZZ3CZPE043911", nr_rej: "WI257MW", producent: "VW", model: "Passat (od 07/'19)",
    status_biznesowy: "Sprawa wysłana", typ_szkody: "", netto: 5865.83, brutto: 7214.97, utworzono: undefined });
  assert.equal(w[0].utworzono, new Date(2026, 4, 8, 6, 19).toISOString());
  assert.equal(w[1].typ_szkody, "Auto Casco");
  assert.equal(w[2].netto, null);
  assert.equal(w[2].producent, "");
});

test("Ayvens po formacie numeru szkody", () => {
  assert.ok(czyAyvens("2611130003"));
  assert.ok(!czyAyvens("WA50/30374/26"));
});

test("inny plik — czytelny błąd", () => {
  assert.throws(() => parsujWorklist("a;b;c\n1;2;3"), /AudaNet/);
});
