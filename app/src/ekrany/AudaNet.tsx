// Sprawy z AudaNet: import eksportu „Master Worklist”, porównanie z fakturami sprzedaży i zleceniami,
// zakładanie zlecenia jednym kliknięciem.
import { useEffect, useMemo, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db, zl } from "../supabase.ts";
import { czyAyvens, dekoduj, parsujWorklist, type SprawaAudanet } from "../audanet/worklist.ts";

interface Sprawa {
  nr_szkody: string; vin: string | null; nr_rej: string | null; producent: string | null; model: string | null;
  status_biznesowy: string | null; typ_szkody: string | null; netto: number | null; brutto: number | null;
  pierwsze_utworzenie: string; ostatnie_utworzenie: string; kopii: number; ukryta: boolean;
  zlecenie_id: string | null; zlecenie_numer: string | null; zlecenie_status: string | null;
  faktura_szkoda: string | null; faktura_szkoda_data: string | null; faktura_rej: string | null; faktura_rej_data: string | null;
  inne_szkody_auta: number; stan: "otwarta" | "zafakturowana_rej" | "zafakturowana" | "zlecenie" | "ukryta";
}

const ZAKLADKI: [Sprawa["stan"], string, string][] = [
  ["otwarta", "Otwarte", "Brak zlecenia w aplikacji i brak faktury sprzedaży z tym numerem szkody ani rejestracją."],
  ["zafakturowana_rej", "Do potwierdzenia", "Jest faktura sprzedaży na tę rejestrację wystawiona po utworzeniu sprawy, ale bez numeru szkody — przy kilku szkodach jednego auta sprawdź, czy obejmuje też tę."],
  ["zafakturowana", "Zafakturowane", "Faktura sprzedaży zawiera numer tej szkody."],
  ["zlecenie", "W aplikacji", "Zlecenie z tym numerem szkody jest już w aplikacji."],
  ["ukryta", "Ukryte", "Ręcznie oznaczone jako naprawione bez faktury w KSeF, wycofane albo nieaktualne."],
];
const dzien = (t: string) => new Date(t).toLocaleDateString("pl-PL");

export function AudaNet({ przejdz }: Kontekst) {
  const [sprawy, ustawSprawy] = useState<Sprawa[] | null>(null);
  const [zakladka, ustawZakladke] = useState<Sprawa["stan"]>("otwarta");
  const [szukaj, ustawSzukaj] = useState("");
  const [komunikat, ustawKomunikat] = useState<string | null>(null);
  const [blad, ustawBlad] = useState<string | null>(null);
  const [trwa, ustawTrwa] = useState<string | null>(null);
  const [przed, ustawPrzed] = useState("");

  async function wczytaj() {
    const { data, error } = await db.from("audanet_stan").select("*").order("pierwsze_utworzenie", { ascending: false });
    if (error) { ustawBlad(error.message); return; }
    ustawSprawy(data as Sprawa[]);
  }
  useEffect(() => { void wczytaj(); }, []);

  async function importuj(pliki: FileList | null) {
    if (!pliki?.length) return;
    ustawBlad(null); ustawKomunikat(null); ustawTrwa("Wczytuję pliki…");
    try {
      const wiersze: SprawaAudanet[] = [];
      for (const p of Array.from(pliki)) wiersze.push(...parsujWorklist(dekoduj(new Uint8Array(await p.arrayBuffer()))));
      if (!wiersze.length) throw new Error("W plikach nie ma żadnych spraw.");
      // Ta sama szkoda może być w kilku plikach — wysyłamy całość naraz, baza scala kopie
      const { data, error } = await db.rpc("importuj_audanet", { wiersze });
      if (error) throw new Error(error.message);
      const w = (data as { nowe: number; zaktualizowane: number }[])[0];
      ustawKomunikat(`Wczytano ${wiersze.length} wierszy z ${pliki.length} ${pliki.length === 1 ? "pliku" : "plików"}: ${w.nowe} nowych spraw, ${w.zaktualizowane} już znanych (zaktualizowane).`);
      await wczytaj();
    } catch (e) {
      ustawBlad((e as Error).message);
    } finally { ustawTrwa(null); }
  }

  async function ukryj(nr: string[], ukryta: boolean) {
    const { data: u } = await db.auth.getUser();
    const { error } = await db.from("audanet_sprawy").update({ ukryta, ukryl: ukryta ? u.user?.id ?? null : null }).in("nr_szkody", nr);
    if (error) { ustawBlad(error.message); return; }
    await wczytaj();
  }

  async function zalozZlecenie(s: Sprawa) {
    ustawBlad(null); ustawTrwa(`Zakładam zlecenie ${s.nr_rej ?? s.nr_szkody}…`);
    const ayvens = czyAyvens(s.nr_szkody);
    let klient_id: string | null = null;
    if (ayvens) {
      const { data } = await db.from("klienci").select("id").eq("segment", "ayvens").order("nazwa").limit(1);
      klient_id = data?.[0]?.id ?? null;
    }
    const { data, error } = await db.from("zlecenia").insert({
      nr_rej: s.nr_rej, vin: s.vin, marka: s.producent?.toUpperCase() ?? null, model: s.model, nr_szkody: s.nr_szkody,
      klient_id, rodzaj: ayvens ? "ayvens" : "ubezpieczenie",
    }).select("id").single();
    ustawTrwa(null);
    if (error) { ustawBlad(`Nie założono zlecenia: ${error.message}`); return; }
    przejdz({ ekran: "zlecenie", zlecenieId: data.id });
  }

  const ile = (st: Sprawa["stan"]) => (sprawy ?? []).filter((s) => s.stan === st).length;
  const widoczne = useMemo(() => {
    const q = szukaj.toUpperCase().replace(/\s/g, "");
    return (sprawy ?? []).filter((s) => s.stan === zakladka)
      .filter((s) => !q || `${s.nr_szkody}${s.nr_rej}${s.vin}${s.producent}${s.model}`.toUpperCase().replace(/\s/g, "").includes(q));
  }, [sprawy, zakladka, szukaj]);
  const doUkrycia = przed ? widoczne.filter((s) => s.pierwsze_utworzenie.slice(0, 10) < przed) : [];

  return (
    <div className="kolumna">
      <section className="karta"><div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ margin: 0 }}>W AudaNet: lista spraw → eksport do CSV. Wgraj tu jeden albo kilka plików naraz — kopie tej samej szkody scalą się,
          a sprawy z fakturą sprzedaży w KSeF same przejdą do „Zafakturowane”. Plik można wgrywać co dzień; znane sprawy tylko się zaktualizują.</p>
        <label className="przycisk" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
          {trwa ?? "Wgraj listę z AudaNet (CSV)"}
          <input type="file" accept=".csv,.txt,text/csv" multiple hidden disabled={!!trwa} onChange={(e) => { void importuj(e.target.files); e.target.value = ""; }} />
        </label>
        {komunikat && <div className="info" role="status">{komunikat}</div>}
        {blad && <div className="blad" role="alert">{blad}</div>}
      </div></section>

      <div className="przyciski" role="tablist" aria-label="Stan spraw">
        {ZAKLADKI.map(([k, v]) => <button key={k} role="tab" aria-selected={zakladka === k} className={`przycisk ${zakladka === k ? "" : "drugi"}`}
          onClick={() => ustawZakladke(k)}>{v}{sprawy ? ` (${ile(k)})` : ""}</button>)}
      </div>
      <p className="podtytul" style={{ margin: 0 }}>{ZAKLADKI.find(([k]) => k === zakladka)?.[2]}</p>
      <div className="przyciski" style={{ alignItems: "flex-end" }}>
        <label>Szukaj<input type="search" placeholder="nr szkody, rejestracja, VIN, marka" value={szukaj} onChange={(e) => ustawSzukaj(e.target.value)} /></label>
        {(zakladka === "otwarta" || zakladka === "zafakturowana_rej") && <>
          <label>Ukryj utworzone przed<input type="date" value={przed} onChange={(e) => ustawPrzed(e.target.value)} /></label>
          <button className="przycisk drugi" disabled={!doUkrycia.length}
            onClick={() => { if (confirm(`Ukryć ${doUkrycia.length} spraw utworzonych przed ${przed}? Można je przywrócić w zakładce „Ukryte”.`)) void ukryj(doUkrycia.map((s) => s.nr_szkody), true); }}>
            Ukryj {doUkrycia.length || ""}</button>
        </>}
      </div>

      <section className="karta">
        {!sprawy ? <div className="pusto">Wczytywanie…</div> : widoczne.length === 0 ? <div className="pusto">{sprawy.length ? "Brak spraw w tej zakładce." : "Wgraj pierwszą listę z AudaNet."}</div> : (
          <div className="przewijanie"><table style={{ minWidth: 900 }}>
            <thead><tr><th>Szkoda</th><th>Auto</th><th>Utworzona</th><th className="liczba">Kalkulacja netto</th><th>Uwagi</th><th></th></tr></thead>
            <tbody>{widoczne.map((s) => (
              <tr key={s.nr_szkody}>
                <td><strong>{s.nr_szkody}</strong><div className="cichy">{czyAyvens(s.nr_szkody) ? "Ayvens" : s.typ_szkody || "ubezpieczyciel"}{s.status_biznesowy ? ` · ${s.status_biznesowy}` : ""}</div></td>
                <td><strong>{s.nr_rej}</strong><div className="cichy">{[s.producent, s.model].filter(Boolean).join(" ") || "—"}{s.vin ? ` · ${s.vin}` : ""}</div></td>
                <td>{dzien(s.pierwsze_utworzenie)}{s.kopii > 1 && <div className="cichy">{s.kopii} kopie, ostatnia {dzien(s.ostatnie_utworzenie)}</div>}</td>
                <td className="liczba">{s.netto !== null ? zl(s.netto) : <span className="cichy">bez kalkulacji</span>}</td>
                <td className="cichy">
                  {s.faktura_szkoda && <div>Faktura {s.faktura_szkoda} z {s.faktura_szkoda_data}</div>}
                  {!s.faktura_szkoda && s.faktura_rej && <div>Faktura {s.faktura_rej} z {s.faktura_rej_data} (po rejestracji)</div>}
                  {s.inne_szkody_auta > 0 && <div>To auto ma jeszcze {s.inne_szkody_auta} {s.inne_szkody_auta === 1 ? "inną szkodę" : "inne szkody"} na liście</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {s.zlecenie_id ? <button className="link" onClick={() => przejdz({ ekran: "zlecenie", zlecenieId: s.zlecenie_id! })}>Zlecenie {s.zlecenie_numer}</button> : <>
                    {s.stan !== "zafakturowana" && s.stan !== "ukryta" && <button className="przycisk" disabled={!!trwa} onClick={() => void zalozZlecenie(s)}>Załóż zlecenie</button>}{" "}
                    {s.stan === "ukryta" ? <button className="przycisk drugi" onClick={() => void ukryj([s.nr_szkody], false)}>Przywróć</button>
                      : s.stan !== "zafakturowana" && <button className="przycisk drugi" onClick={() => void ukryj([s.nr_szkody], true)}>Ukryj</button>}
                  </>}
                </td>
              </tr>))}</tbody>
          </table></div>)}
      </section>
    </div>
  );
}
