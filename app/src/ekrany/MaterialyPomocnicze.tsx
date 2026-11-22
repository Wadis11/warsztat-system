// Materiały pomocnicze: zakupy spoza głównych dostawców (internet, paragon) wgrywane z PDF albo wpisywane,
// plus faktury KSeF od dostawców oznaczonych jako „pomocniczy”.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import robotnikPdf from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Kontekst } from "../App.tsx";
import { db, zl } from "../supabase.ts";
import { type DokumentPdf, wyciagnijTekst } from "../kosztorys/tekstPdf.ts";
import { odczytajFakture } from "../faktury/odczyt.ts";

pdfjs.GlobalWorkerOptions.workerSrc = robotnikPdf;

interface ZakupKsef { pozycja_id: string; faktura: string; data: string; nip: string; dostawca: string; nazwa: string; ilosc: number | null; jednostka: string | null; cena_netto: number | null; wartosc: number }
interface Pozycja { id?: string; nazwa: string; ilosc: number; jednostka: string | null; cena_netto: number | null; wartosc_netto: number; stawka_vat: number | null }
interface Zakup { id: string; data: string; sprzedawca: string; numer: string | null; plik: string | null; zakupy_pomocnicze_pozycje: Pozycja[] }
interface Formularz { data: string; sprzedawca: string; numer: string; pozycje: { nazwa: string; ilosc: string; jednostka: string; wartosc: string; stawka: string }[]; sumaBrutto: number | null }

const dzis = () => new Date().toLocaleDateString("sv-SE");
const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
const pustyWiersz = () => ({ nazwa: "", ilosc: "1", jednostka: "szt", wartosc: "", stawka: "23" });
const miesiac = (d: string) => d.slice(0, 7);

export function MaterialyPomocnicze({ dostawcy, zakupyKsef, odswiez }: Kontekst & {
  dostawcy: { nip: string; nazwa: string; rodzaj: string }[]; zakupyKsef: ZakupKsef[]; odswiez: () => Promise<void>;
}) {
  const [zakupy, ustawZakupy] = useState<Zakup[] | null>(null);
  const [f, ustawF] = useState<Formularz | null>(null);
  const [plik, ustawPlik] = useState<File | null>(null);
  const [trwa, ustawTrwa] = useState<string | null>(null);
  const [blad, ustawBlad] = useState<string | null>(null);
  const [szukaj, ustawSzukaj] = useState("");
  const [rozwiniety, ustawRozwiniety] = useState<string | null>(null);
  const [kontrahenci, ustawKontrahentow] = useState<{ nip: string; nazwa: string }[]>([]);
  const [nowyDostawca, ustawNowegoDostawce] = useState("");

  const wczytaj = useCallback(async () => {
    const [z, k] = await Promise.all([
      db.from("zakupy_pomocnicze").select("id, data, sprzedawca, numer, plik, zakupy_pomocnicze_pozycje(*)").order("data", { ascending: false }).limit(500),
      db.from("faktury").select("nip_kontrahenta, nazwa_kontrahenta").eq("kierunek", "zakup").not("nip_kontrahenta", "is", null).limit(5000),
    ]);
    if (z.error) { ustawBlad(z.error.message); return; }
    ustawZakupy(z.data as unknown as Zakup[]);
    const m = new Map<string, string>();
    for (const r of (k.data ?? []) as { nip_kontrahenta: string; nazwa_kontrahenta: string | null }[]) m.set(r.nip_kontrahenta, r.nazwa_kontrahenta ?? r.nip_kontrahenta);
    ustawKontrahentow([...m].map(([nip, nazwa]) => ({ nip, nazwa })).sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl")));
  }, []);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  async function wczytajPlik(p: File) {
    ustawPlik(p); ustawBlad(null);
    if (p.type !== "application/pdf") {
      ustawF({ data: dzis(), sprzedawca: "", numer: "", pozycje: [pustyWiersz()], sumaBrutto: null });
      ustawBlad("Zdjęcie zostanie dołączone do zakupu, ale pozycje trzeba wpisać ręcznie (odczyt działa dla faktur PDF).");
      return;
    }
    ustawTrwa("Odczytuję fakturę…");
    try {
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await p.arrayBuffer()) }).promise;
      const { pelnyTekst } = await wyciagnijTekst(pdf as unknown as DokumentPdf);
      const o = odczytajFakture(pelnyTekst);
      ustawF({
        data: o.data ?? dzis(), sprzedawca: o.sprzedawca ?? "", numer: o.numer ?? "", sumaBrutto: o.sumaBrutto,
        pozycje: o.pozycje.length ? o.pozycje.map((x) => ({ nazwa: x.nazwa, ilosc: String(x.ilosc), jednostka: x.jednostka ?? "szt", wartosc: x.wartoscNetto.toFixed(2), stawka: String(x.stawka) })) : [pustyWiersz()],
      });
      if (!o.pozycje.length) ustawBlad(pelnyTekst.trim() ? "Nie rozpoznałem pozycji na tej fakturze — wpisz je ręcznie." : "PDF nie ma warstwy tekstowej (skan) — wpisz pozycje ręcznie.");
    } catch (e) {
      ustawBlad(`Nie udało się odczytać PDF: ${(e as Error).message}`);
      ustawF({ data: dzis(), sprzedawca: "", numer: "", pozycje: [pustyWiersz()], sumaBrutto: null });
    } finally { ustawTrwa(null); }
  }

  async function zapisz() {
    if (!f) return;
    const pozycje = f.pozycje.filter((p) => p.nazwa.trim() && num(p.wartosc) > 0);
    if (!f.sprzedawca.trim() || !pozycje.length) { ustawBlad("Potrzebny sprzedawca i co najmniej jedna pozycja z kwotą."); return; }
    ustawTrwa("Zapisuję…"); ustawBlad(null);
    try {
      const { data: z, error } = await db.from("zakupy_pomocnicze").insert({ data: f.data, sprzedawca: f.sprzedawca.trim(), numer: f.numer.trim() || null }).select("id").single();
      if (error) throw error;
      if (plik) {
        const sciezka = `${z.id}/${plik.name.replace(/[^\w.-]+/g, "_")}`;
        const w = await db.storage.from("zakupy").upload(sciezka, plik, { contentType: plik.type || undefined });
        if (w.error) throw w.error;
        await db.from("zakupy_pomocnicze").update({ plik: sciezka }).eq("id", z.id);
      }
      const { error: e2 } = await db.from("zakupy_pomocnicze_pozycje").insert(pozycje.map((p) => {
        const ilosc = num(p.ilosc) || 1, wartosc = num(p.wartosc);
        return { zakup_id: z.id, nazwa: p.nazwa.trim(), ilosc, jednostka: p.jednostka.trim() || null, wartosc_netto: wartosc,
          cena_netto: Math.round((wartosc / ilosc) * 100) / 100, stawka_vat: num(p.stawka) };
      }));
      if (e2) throw e2;
      ustawF(null); ustawPlik(null); await wczytaj();
    } catch (e) { ustawBlad(`Nie zapisano: ${(e as Error).message}`); } finally { ustawTrwa(null); }
  }

  async function usun(z: Zakup) {
    if (!window.confirm(`Usunąć zakup ${z.sprzedawca} z ${z.data}?`)) return;
    if (z.plik) await db.storage.from("zakupy").remove([z.plik]);
    await db.from("zakupy_pomocnicze").delete().eq("id", z.id);
    await wczytaj();
  }
  async function otworz(sciezka: string) {
    const { data, error } = await db.storage.from("zakupy").createSignedUrl(sciezka, 120);
    if (error) { ustawBlad(error.message); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  async function dodajDostawce() {
    const k = kontrahenci.find((x) => x.nip === nowyDostawca); if (!k) return;
    const { error } = await db.from("dostawcy_materialow").insert({ nip: k.nip, nazwa: k.nazwa, rodzaj: "pomocniczy" });
    ustawBlad(error?.message ?? null); ustawNowegoDostawce(""); await odswiez();
  }
  async function usunDostawce(nip: string) {
    await db.from("dostawcy_materialow").delete().eq("nip", nip); await odswiez();
  }

  // Wszystkie pozycje (ręczne + KSeF) do podsumowań i wyszukiwania ceny
  const wszystkie = useMemo(() => [
    ...(zakupy ?? []).flatMap((z) => z.zakupy_pomocnicze_pozycje.map((p) => ({ zrodlo: "ręcznie", data: z.data, sprzedawca: z.sprzedawca, nazwa: p.nazwa, ilosc: Number(p.ilosc), jednostka: p.jednostka, cena: p.cena_netto, wartosc: Number(p.wartosc_netto) }))),
    ...zakupyKsef.map((p) => ({ zrodlo: "KSeF", data: p.data, sprzedawca: p.dostawca, nazwa: p.nazwa, ilosc: Number(p.ilosc ?? 1), jednostka: p.jednostka, cena: p.cena_netto, wartosc: Number(p.wartosc) })),
  ], [zakupy, zakupyKsef]);
  const teraz = miesiac(dzis());
  const poprzedni = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString("sv-SE").slice(0, 7); })();
  const suma = (m: string) => wszystkie.filter((p) => miesiac(p.data) === m).reduce((a, p) => a + p.wartosc, 0);
  const q = szukaj.trim().toUpperCase();
  const wyniki = q ? wszystkie.filter((p) => p.nazwa.toUpperCase().includes(q)).sort((a, b) => (a.cena ?? 0) - (b.cena ?? 0)) : [];
  const pomocniczy = dostawcy.filter((d) => d.rodzaj === "pomocniczy");
  const sumaFormularza = f ? f.pozycje.reduce((a, p) => a + (num(p.wartosc) || 0) * (1 + (num(p.stawka) || 0) / 100), 0) : 0;

  return (<>
    <section className="karta"><div className="srodek siatka">
      <div><div className="cichy">Ten miesiąc</div><strong style={{ fontSize: 20 }}>{zl(suma(teraz))}</strong><div className="cichy">netto</div></div>
      <div><div className="cichy">Poprzedni miesiąc</div><strong style={{ fontSize: 20 }}>{zl(suma(poprzedni))}</strong><div className="cichy">netto</div></div>
      <div><div className="cichy">Zakupów wpisanych</div><strong style={{ fontSize: 20 }}>{zakupy?.length ?? "—"}</strong><div className="cichy">+ {pomocniczy.length} dostawców z KSeF</div></div>
    </div></section>

    <section className="karta">
      <div className="tytul"><h2>Dodaj zakup</h2>
        <div className="przyciski" style={{ alignItems: "center" }}>
          <input type="file" accept="application/pdf,image/*" aria-label="Faktura PDF lub zdjęcie" onChange={(e) => e.target.files?.[0] && wczytajPlik(e.target.files[0])} />
          <button className="przycisk drugi" onClick={() => { ustawPlik(null); ustawF({ data: dzis(), sprzedawca: "", numer: "", pozycje: [pustyWiersz()], sumaBrutto: null }); }}>Wpisz ręcznie (paragon)</button>
        </div>
      </div>
      {trwa && <div className="srodek"><div className="info">{trwa}</div></div>}
      {blad && <div className="srodek"><div className="uwaga">{blad}</div></div>}
      {f && <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="siatka">
          <label>Data<input type="date" value={f.data} onChange={(e) => ustawF({ ...f, data: e.target.value })} /></label>
          <label>Sprzedawca / sklep<input value={f.sprzedawca} onChange={(e) => ustawF({ ...f, sprzedawca: e.target.value })} /></label>
          <label>Numer dokumentu<input value={f.numer} onChange={(e) => ustawF({ ...f, numer: e.target.value })} /></label>
        </div>
        <div className="przewijanie"><table style={{ minWidth: 720 }}>
          <thead><tr><th>Nazwa</th><th>Ilość</th><th>J.m.</th><th className="liczba">Wartość netto</th><th>VAT %</th><th className="liczba">Cena netto / jedn.</th><th></th></tr></thead>
          <tbody>{f.pozycje.map((p, i) => {
            const zmien = (pole: keyof typeof p, v: string) => ustawF({ ...f, pozycje: f.pozycje.map((x, j) => (j === i ? { ...x, [pole]: v } : x)) });
            const c = num(p.wartosc) / (num(p.ilosc) || 1);
            return <tr key={i}>
              <td><input aria-label="Nazwa" style={{ width: "100%", minWidth: 240 }} value={p.nazwa} onChange={(e) => zmien("nazwa", e.target.value)} /></td>
              <td><input aria-label="Ilość" style={{ width: 70 }} value={p.ilosc} onChange={(e) => zmien("ilosc", e.target.value)} /></td>
              <td><input aria-label="Jednostka" style={{ width: 70 }} value={p.jednostka} onChange={(e) => zmien("jednostka", e.target.value)} /></td>
              <td><input aria-label="Wartość netto" style={{ width: 100, textAlign: "right" }} value={p.wartosc} onChange={(e) => zmien("wartosc", e.target.value)} /></td>
              <td><input aria-label="VAT" style={{ width: 56 }} value={p.stawka} onChange={(e) => zmien("stawka", e.target.value)} /></td>
              <td className="liczba">{Number.isFinite(c) && c > 0 ? zl(c) : "—"}</td>
              <td><button className="przycisk drugi" onClick={() => ustawF({ ...f, pozycje: f.pozycje.filter((_, j) => j !== i) })}>Usuń</button></td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="przyciski" style={{ alignItems: "center" }}>
          <button className="przycisk drugi" onClick={() => ustawF({ ...f, pozycje: [...f.pozycje, pustyWiersz()] })}>+ Pozycja</button>
          <span className="cichy">Razem brutto z pozycji: {zl(sumaFormularza)}{f.sumaBrutto !== null ? ` · na fakturze: ${zl(f.sumaBrutto)}` : ""}</span>
          {f.sumaBrutto !== null && Math.abs(sumaFormularza - f.sumaBrutto) > 0.05 && <span className="minus">— sumy się nie zgadzają, sprawdź pozycje</span>}
        </div>
        <p className="cichy" style={{ margin: 0 }}>Na paragonie bez VAT wpisz kwotę jako netto i VAT 0 — wtedy koszt to pełna zapłacona kwota.</p>
        <div className="przyciski"><button className="przycisk" disabled={!!trwa} onClick={zapisz}>Zapisz zakup</button>
          <button className="przycisk drugi" onClick={() => { ustawF(null); ustawPlik(null); ustawBlad(null); }}>Anuluj</button></div>
      </div>}
    </section>

    <section className="karta">
      <div className="tytul"><h2>Gdzie taniej?</h2>
        <input type="search" aria-label="Szukaj w zakupach" placeholder="np. rękawiczki, tarcza 125" value={szukaj} onChange={(e) => ustawSzukaj(e.target.value)} /></div>
      {q && (wyniki.length === 0 ? <div className="pusto">Nic takiego jeszcze nie kupowaliście.</div> :
        <div className="przewijanie"><table><thead><tr><th>Produkt</th><th>Sklep</th><th>Data</th><th className="liczba">Cena netto / jedn.</th></tr></thead>
          <tbody>{wyniki.slice(0, 50).map((p, i) => <tr key={i}><td>{p.nazwa}</td><td>{p.sprzedawca}<div className="cichy">{p.zrodlo}</div></td><td>{p.data}</td>
            <td className="liczba">{p.cena !== null ? zl(Number(p.cena)) : "—"}<div className="cichy">{p.ilosc} {p.jednostka ?? ""}</div></td></tr>)}</tbody></table></div>)}
    </section>

    <section className="karta">
      <div className="tytul"><h2>Zakupy</h2></div>
      {zakupy && zakupy.length === 0 && zakupyKsef.length === 0 ? <div className="pusto">Brak zakupów pomocniczych.</div> : (
        <div className="przewijanie"><table style={{ minWidth: 700 }}>
          <thead><tr><th>Data</th><th>Sprzedawca</th><th>Dokument</th><th className="liczba">Netto</th><th></th></tr></thead>
          <tbody>
            {(zakupy ?? []).map((z) => {
              const netto = z.zakupy_pomocnicze_pozycje.reduce((a, p) => a + Number(p.wartosc_netto), 0);
              return <Fragment key={z.id}>
                <tr><td>{z.data}</td><td>{z.sprzedawca}</td><td>{z.numer ?? "—"}<div className="cichy">{z.zakupy_pomocnicze_pozycje.length} poz.</div></td>
                  <td className="liczba">{zl(netto)}</td>
                  <td><div className="przyciski">
                    <button className="przycisk drugi" onClick={() => ustawRozwiniety(rozwiniety === z.id ? null : z.id)}>{rozwiniety === z.id ? "Zwiń" : "Pozycje"}</button>
                    {z.plik && <button className="przycisk drugi" onClick={() => otworz(z.plik!)}>Plik</button>}
                    <button className="przycisk drugi" onClick={() => usun(z)}>Usuń</button></div></td></tr>
                {rozwiniety === z.id && <tr><td colSpan={5}>{z.zakupy_pomocnicze_pozycje.map((p) =>
                  <div key={p.id} className="cichy">{p.nazwa} — {Number(p.ilosc)} {p.jednostka ?? ""} × {zl(Number(p.cena_netto ?? 0))} = {zl(Number(p.wartosc_netto))}</div>)}</td></tr>}
              </Fragment>;
            })}
            {zakupyKsef.slice(0, 200).map((p) => <tr key={p.pozycja_id}><td>{p.data}</td><td>{p.dostawca}<div className="cichy">KSeF</div></td>
              <td>{p.nazwa}<div className="cichy">{p.faktura}</div></td><td className="liczba">{zl(Number(p.wartosc))}</td><td></td></tr>)}
          </tbody>
        </table></div>)}
    </section>

    <details className="karta"><summary className="srodek" style={{ cursor: "pointer" }}>Dostawcy z KSeF liczeni jako pomocniczy ({pomocniczy.length})</summary>
      <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="cichy" style={{ margin: 0 }}>Sklepy internetowe, które wystawiają fakturę na NIP firmy, wysyłają ją do KSeF — wystarczy wskazać je tutaj i nic nie trzeba wpisywać.</p>
        {pomocniczy.map((d) => <div key={d.nip} style={{ display: "flex", gap: 10, alignItems: "center" }}><span>{d.nazwa}</span><span className="cichy">NIP {d.nip}</span>
          <button className="przycisk drugi" onClick={() => usunDostawce(d.nip)}>Usuń</button></div>)}
        <div className="przyciski" style={{ alignItems: "flex-end" }}>
          <label>Dostawca z faktur KSeF<select value={nowyDostawca} onChange={(e) => ustawNowegoDostawce(e.target.value)}>
            <option value="">— wybierz —</option>
            {kontrahenci.filter((k) => !dostawcy.some((d) => d.nip === k.nip)).map((k) => <option key={k.nip} value={k.nip}>{k.nazwa}</option>)}</select></label>
          <button className="przycisk drugi" disabled={!nowyDostawca} onClick={dodajDostawce}>Dodaj jako pomocniczy</button>
        </div>
      </div>
    </details>
  </>);
}
