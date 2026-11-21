// Wgranie kosztorysu PDF: odczyt w przeglądarce, podgląd do sprawdzenia, zapis do zlecenia.
// Plik nie wychodzi nigdzie poza bazę firmy (magazyn 'kosztorysy', tylko właściciel).
import { useState } from "react";
import * as pdfjs from "pdfjs-dist";
import robotnikPdf from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Kontekst } from "../App.tsx";
import { db, normRej, zl } from "../supabase.ts";
import { type Kosztorys, parsujKosztorys } from "../kosztorys/parser.ts";
import { type DokumentPdf, wyciagnijTekst } from "../kosztorys/tekstPdf.ts";
import { WyborKlienta } from "./WyborKlienta.tsx";

pdfjs.GlobalWorkerOptions.workerSrc = robotnikPdf;

type Wersja = "zlozony" | "zaakceptowany" | "wycena_ubezpieczyciela";
const WERSJE: Record<Wersja, string> = {
  zlozony: "Złożony (nasz kosztorys)",
  zaakceptowany: "Zaakceptowany przez płatnika",
  wycena_ubezpieczyciela: "Wycena ubezpieczyciela (zaniżona)",
};

interface Formularz {
  nr_rej: string; vin: string; marka: string; model: string; nr_szkody: string;
  nr_kalkulacji: string; data: string; autor: string;
  stawka_blach: string; stawka_lak: string; rbh_blach: string; rbh_lak: string;
  robocizna_blach: string; robocizna_lak: string; material_lak: string; czesci: string; normalia: string;
  koszty_dodatkowe: string; netto: string;
}
interface ZlecenieKrotko { id: string; numer: string; nr_rej: string | null; vin: string | null; marka: string | null; model: string | null; klient_id: string | null }

const naIso = (d: string | null) => (d && /^\d\d\.\d\d\.\d{4}$/.test(d) ? `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : "");
const t = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));

function zFormatu(k: Kosztorys): { f: Formularz; wersja: Wersja; segment: string } {
  const pusty: Formularz = {
    nr_rej: "", vin: "", marka: "", model: "", nr_szkody: "", nr_kalkulacji: "", data: "", autor: "",
    stawka_blach: "", stawka_lak: "", rbh_blach: "", rbh_lak: "", robocizna_blach: "", robocizna_lak: "",
    material_lak: "", czesci: "", normalia: "", koszty_dodatkowe: "", netto: "",
  };
  if (k.format === "audatex") {
    const ayvens = k.autor === "warsztat" || k.autor === "Ayvens";
    return {
      wersja: k.autor === "UNIQA" ? "wycena_ubezpieczyciela" : k.autor === "Ayvens" ? "zaakceptowany" : "zlozony",
      segment: ayvens ? "ayvens" : "ubezpieczyciel",
      f: {
        ...pusty, nr_rej: k.nrRej ?? "", vin: k.vin ?? "", marka: k.marka ?? "", model: k.model ?? "", // Ayvens nadaje numer szkody równy numerowi kalkulacji (np. 2611130003)
        nr_szkody: k.nrSzkody ?? (ayvens ? k.sygnatura ?? k.nrKalkulacji ?? "" : ""),
        nr_kalkulacji: k.nrKalkulacji ?? "", data: naIso(k.data), autor: k.autor ?? "",
        stawka_blach: t(k.stawkaBlach), stawka_lak: t(k.stawkaLak), rbh_blach: t(k.rbhBlach), rbh_lak: t(k.rbhLak),
        robocizna_blach: t(k.robociznaBlach), robocizna_lak: t(k.robociznaLak), material_lak: t(k.materialLak),
        czesci: t(k.czesci), normalia: t(k.normalia), koszty_dodatkowe: t(k.kosztyDodatkowe), netto: t(k.netto),
      },
    };
  }
  if (k.format === "controlexpert") {
    const [marka, ...model] = (k.pojazd ?? "").trim().split(/\s+/);
    return {
      wersja: "zaakceptowany", segment: "ubezpieczyciel",
      f: {
        ...pusty, nr_rej: k.nrRej ?? "", marka: marka ?? "", model: model.join(" "), nr_szkody: k.nrSzkody ?? "",
        data: naIso(k.data), autor: "ControlExpert",
        stawka_blach: t(k.stawkaZaakceptowana?.blach), stawka_lak: t(k.stawkaZaakceptowana?.lak),
        robocizna_blach: t(k.robocizna?.zaakceptowane), robocizna_lak: t(k.robociznaLak?.zaakceptowane),
        material_lak: t(k.materialLak?.zaakceptowane), czesci: t(k.czesci?.zaakceptowane),
        normalia: t(k.normalia?.zaakceptowane), netto: t(k.netto?.zaakceptowane),
      },
    };
  }
  return { wersja: "zaakceptowany", segment: "ubezpieczyciel", f: pusty };
}

export function WgrajKosztorys({ przejdz }: Kontekst) {
  const [plik, ustawPlik] = useState<File | null>(null);
  const [odczyt, ustawOdczyt] = useState<Kosztorys | null>(null);
  const [f, ustawF] = useState<Formularz | null>(null);
  const [wersja, ustawWersje] = useState<Wersja>("zlozony");
  const [segment, ustawSegment] = useState("ayvens");
  const [klient, ustawKlienta] = useState("");
  const [zlecenia, ustawZlecenia] = useState<ZlecenieKrotko[]>([]);
  const [doZlecenia, ustawDoZlecenia] = useState<string>("__nowe");
  const [blad, ustawBlad] = useState<string | null>(null);
  const [trwa, ustawTrwa] = useState<string | null>(null);

  async function wczytajPlik(p: File) {
    ustawBlad(null); ustawPlik(p); ustawOdczyt(null); ustawF(null);
    ustawTrwa("Odczytuję PDF…");
    try {
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await p.arrayBuffer()) }).promise;
      const tekst = await wyciagnijTekst(pdf as unknown as DokumentPdf);
      const k = parsujKosztorys(tekst.linieMono, tekst.pelnyTekst);
      const { f: nowy, wersja: w, segment: s } = zFormatu(k);
      ustawOdczyt(k); ustawF(nowy); ustawWersje(w); ustawSegment(s); ustawKlienta("");

      // Otwarte zlecenia tego auta: VIN albo rejestracja
      const { data } = await db.from("zlecenia").select("id, numer, nr_rej, vin, marka, model, klient_id")
        .not("status", "in", "(wydane,anulowane)").order("utworzono", { ascending: false }).limit(500);
      const pasujace = ((data ?? []) as ZlecenieKrotko[]).filter((z) =>
        (nowy.vin && z.vin && z.vin.toUpperCase() === nowy.vin.toUpperCase()) ||
        (nowy.nr_rej && normRej(z.nr_rej) === normRej(nowy.nr_rej)));
      ustawZlecenia(pasujace);
      ustawDoZlecenia(pasujace[0]?.id ?? "__nowe");
      if (pasujace[0]?.klient_id) ustawKlienta(pasujace[0].klient_id);
    } catch (e) {
      ustawBlad(`Nie udało się odczytać pliku: ${(e as Error).message}`);
    } finally {
      ustawTrwa(null);
    }
  }

  async function zapisz() {
    if (!f || !plik) return;
    const netto = num(f.netto);
    if (netto === null || Number.isNaN(netto)) { ustawBlad("Wpisz kwotę netto kosztorysu."); return; }
    if (!f.nr_rej.trim() && !f.vin.trim()) { ustawBlad("Potrzebna rejestracja albo VIN, żeby faktury trafiały do tego auta."); return; }
    if (!klient) { ustawBlad("Wybierz klienta (płatnika) — bez niego zlecenie nie trafi do rentowności klienta."); return; }
    ustawBlad(null);
    try {
      ustawTrwa("Zapisuję zlecenie…");
      let zlecenieId = doZlecenia;
      const noweZlecenie = doZlecenia === "__nowe";
      if (noweZlecenie) {
        const { data, error } = await db.from("zlecenia").insert({
          nr_rej: f.nr_rej.trim().toUpperCase() || null, vin: f.vin.trim().toUpperCase() || null,
          marka: f.marka.trim().toUpperCase() || null, model: f.model.trim() || null,
          nr_szkody: f.nr_szkody.trim() || null, klient_id: klient || null,
        }).select("id").single();
        if (error) throw error;
        zlecenieId = data.id;
      } else {
        // Uzupełnij brakujące dane auta w istniejącym zleceniu
        const z = zlecenia.find((x) => x.id === doZlecenia)!;
        const uzup: Record<string, string> = {};
        if (!z.vin && f.vin.trim()) uzup.vin = f.vin.trim().toUpperCase();
        if (klient && z.klient_id !== klient) uzup.klient_id = klient;
        if (f.nr_szkody.trim()) uzup.nr_szkody = f.nr_szkody.trim();
        if (Object.keys(uzup).length) await db.from("zlecenia").update(uzup).eq("id", zlecenieId);
      }

      ustawTrwa("Wysyłam PDF…");
      const sciezka = `${zlecenieId}/${Date.now()}_${plik.name.replace(/[^\w.-]+/g, "_")}`;
      const wysylka = await db.storage.from("kosztorysy").upload(sciezka, plik, { contentType: "application/pdf" });
      if (wysylka.error) throw wysylka.error;

      ustawTrwa("Zapisuję kosztorys…");
      const { data: k, error: bk } = await db.from("kosztorysy").insert({
        zlecenie_id: zlecenieId, wersja, zrodlo: odczyt?.format ?? "reczny", autor: f.autor || null,
        nr_kalkulacji: f.nr_kalkulacji || null, data: f.data || null,
        stawka_blach: num(f.stawka_blach), stawka_lak: num(f.stawka_lak), rbh_blach: num(f.rbh_blach), rbh_lak: num(f.rbh_lak),
        robocizna_blach: num(f.robocizna_blach), robocizna_lak: num(f.robocizna_lak), material_lak: num(f.material_lak),
        czesci: num(f.czesci), normalia: num(f.normalia), koszty_dodatkowe: num(f.koszty_dodatkowe),
        netto, plik: sciezka, potwierdzony: true,
      }).select("id").single();
      if (bk) throw bk;

      const czesci = odczyt?.format === "audatex" ? odczyt.pozycjeCzesci : [];
      if (czesci.length) {
        const { error } = await db.from("kosztorysy_czesci").insert(czesci.map((c) => ({
          kosztorys_id: k.id, kod: c.kod, nazwa: c.nazwa, nr_katalogowy: c.nrKatalogowy || null, cena: c.cena,
        })));
        if (error) throw error;
      }

      // Karta pracy: tylko przy pierwszym kosztorysie zlecenia, żeby nie dublować czynności
      const { count } = await db.from("zlecenia_operacje").select("id", { count: "exact", head: true }).eq("zlecenie_id", zlecenieId);
      if (!count) {
        const operacje = czesci.map((c, i) => ({ zlecenie_id: zlecenieId, kolejnosc: i + 1, rodzaj: "blacharka", opis: `Wymiana: ${c.nazwa}` }));
        if ((num(f.rbh_lak) ?? 0) > 0 || (num(f.robocizna_lak) ?? 0) > 0)
          operacje.push({ zlecenie_id: zlecenieId, kolejnosc: operacje.length + 1, rodzaj: "lakier", opis: "Lakierowanie według kosztorysu" });
        if (operacje.length) await db.from("zlecenia_operacje").insert(operacje);
      }
      przejdz({ ekran: "karta", zlecenieId });
    } catch (e) {
      ustawBlad(`Nie zapisano: ${(e as Error).message}`);
    } finally {
      ustawTrwa(null);
    }
  }

  const pole = (k: keyof Formularz, etykieta: string, typ: "text" | "date" = "text") => (
    <label>{etykieta}<input type={typ} value={f?.[k] ?? ""} onChange={(e) => f && ustawF({ ...f, [k]: e.target.value })} /></label>
  );
  const kontrole = odczyt?.format === "audatex"
    ? [
        { ok: odczyt.kontrolaSumy, opis: "Suma składników zgadza się z kwotą netto" },
        ...(odczyt.kontrolaCzesci === null ? [] : [{ ok: odczyt.kontrolaCzesci, opis: `Suma ${odczyt.pozycjeCzesci.length} części zgadza się z pozycją „Części”` }]),
      ]
    : [];

  return (
    <div className="kolumna">
      <p className="cichy" style={{ margin: 0 }}>Audatex (nasz, Ayvens, UNIQA) albo weryfikacja ControlExpert. Jeśli to auto ma już otwarte zlecenie, kosztorys dopnie się do niego (np. weryfikacja ubezpieczyciela do naszego kosztorysu).</p>
      <section className="karta"><div className="srodek">
        <input type="file" accept="application/pdf" aria-label="Plik PDF kosztorysu"
          onChange={(e) => e.target.files?.[0] && wczytajPlik(e.target.files[0])} />
      </div></section>

      {trwa && <div className="info">{trwa}</div>}
      {blad && <div className="blad" role="alert">{blad}</div>}

      {odczyt && f && (
        <section className="karta"><div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {odczyt.format === "skan" && <div className="uwaga">To skan bez warstwy tekstowej (np. ERGO z odręcznymi poprawkami). Przepisz kwoty po korektach z dokumentu; PDF i tak zostanie dołączony do zlecenia.</div>}
          {kontrole.map((k, i) => <div key={i} className={k.ok ? "info" : "uwaga"}>{k.ok ? "✓" : "⚠"} {k.opis}{k.ok ? "" : " — sprawdź kwoty z dokumentem"}</div>)}

          <h2>Auto</h2>
          <div className="siatka">
            {pole("nr_rej", "Rejestracja")}{pole("vin", "VIN")}{pole("marka", "Marka")}{pole("model", "Model")}{pole("nr_szkody", "Nr szkody")}
          </div>

          <h2>Zlecenie i płatnik</h2>
          <div className="siatka">
            <label>Dopisz do
              <select value={doZlecenia} onChange={(e) => ustawDoZlecenia(e.target.value)}>
                {zlecenia.map((z) => <option key={z.id} value={z.id}>{z.numer} · {[z.marka, z.model].filter(Boolean).join(" ")} · {z.nr_rej}</option>)}
                <option value="__nowe">Nowe zlecenie</option>
              </select>
            </label>
            <WyborKlienta key={segment} wartosc={klient} onChange={ustawKlienta} podpowiedzSegmentu={segment} />
            <label>Wersja kosztorysu
              <select value={wersja} onChange={(e) => ustawWersje(e.target.value as Wersja)}>
                {Object.entries(WERSJE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>

          <h2>Kwoty netto</h2>
          <div className="siatka">
            {pole("stawka_blach", "Stawka blacharska zł/RBH")}{pole("stawka_lak", "Stawka lakiernicza zł/RBH")}
            {pole("rbh_blach", "RBH blacharskie")}{pole("rbh_lak", "RBH lakiernicze")}
            {pole("robocizna_blach", "Robocizna blacharska")}{pole("robocizna_lak", "Robocizna lakiernicza")}
            {pole("material_lak", "Materiał lakierniczy")}{pole("czesci", "Części")}
            {pole("normalia", "Normalia")}{pole("koszty_dodatkowe", "Koszty dodatkowe")}
            {pole("netto", "Razem netto")}{pole("data", "Data kosztorysu", "date")}
          </div>

          {odczyt.format === "audatex" && odczyt.pozycjeCzesci.length > 0 && (
            <details><summary>Części z kosztorysu ({odczyt.pozycjeCzesci.length}) — do dopasowania faktur po numerze katalogowym</summary>
              <table><thead><tr><th>Nazwa</th><th>Nr katalogowy</th><th className="liczba">Cena</th></tr></thead>
                <tbody>{odczyt.pozycjeCzesci.map((c, i) => <tr key={i}><td>{c.nazwa}</td><td>{c.nrKatalogowy}</td><td className="liczba">{zl(c.cena)}</td></tr>)}</tbody>
              </table>
            </details>
          )}

          <div className="przyciski"><button className="przycisk" disabled={!!trwa} onClick={zapisz}>Zapisz kosztorys i pokaż kartę pracy</button></div>
        </div></section>
      )}
    </div>
  );
}
