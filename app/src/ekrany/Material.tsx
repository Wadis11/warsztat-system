// Materiał: porównanie cen u głównych dostawców, przypisywanie produktów z faktur, materiały pomocnicze.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db, zl } from "../supabase.ts";
import { MaterialyPomocnicze } from "./MaterialyPomocnicze.tsx";

interface WierszPorownania {
  material_id: string; kategoria: string; nazwa: string; wariant: string | null; jednostka: string | null; uwagi: string | null;
  nip: string; dostawca: string; cena: number | null; zrodlo: "faktura" | "oferta" | null; data_faktury: string | null;
  data_oferty: string | null; wydano_12m: number;
}
interface Zakup {
  pozycja_id: string; faktura: string; data: string; nip: string; dostawca: string; indeks: string | null; indeks_norm: string;
  nazwa: string; ilosc: number | null; jednostka: string | null; cena_netto: number | null; wartosc: number;
  material_id: string | null; mnoznik: number | null; cena_katalogowa: number | null; rodzaj: string; pominiety: boolean; lakier: boolean;
}
interface Produkt {
  id: string; kategoria: string; nazwa: string; wariant: string | null; jednostka: string | null; uwagi: string | null;
  ceny: Map<string, WierszPorownania>; wydano: number;
}

const cena = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 3 : 2 }) + " zł");
const opis = (p: { nazwa: string; wariant: string | null }) => [p.nazwa, p.wariant].filter(Boolean).join(" · ");
const slowa = (t: string) => new Set(t.toUpperCase().replace(/[^A-ZĄĆĘŁŃÓŚŹŻ0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));

/** Podobieństwo nazwy z faktury do produktu z katalogu: wspólne słowa i liczby (np. P400, 750ML). */
function podobienstwo(a: string, b: string) {
  const A = slowa(a), B = slowa(b);
  let w = 0;
  for (const x of A) for (const y of B) if (x === y || (x.length > 3 && y.length > 3 && (x.startsWith(y) || y.startsWith(x)))) { w++; break; }
  return w / Math.max(1, Math.min(A.size, B.size));
}

export function Material(k: Kontekst) {
  const [zakladka, ustawZakladke] = useState<"porownanie" | "przypisz" | "pomocnicze">("porownanie");
  const [porownanie, ustawPorownanie] = useState<WierszPorownania[] | null>(null);
  const [zakupy, ustawZakupy] = useState<Zakup[]>([]);
  const [dostawcy, ustawDostawcow] = useState<{ nip: string; nazwa: string; rodzaj: string }[]>([]);
  const [blad, ustawBlad] = useState<string | null>(null);

  const wczytaj = useCallback(async () => {
    const [p, z, d] = await Promise.all([
      db.from("materialy_porownanie").select("*").eq("aktywny", true).order("kategoria").order("nazwa").order("wariant").limit(5000),
      db.from("materialy_zakupy").select("*").order("data", { ascending: false }).limit(5000),
      db.from("dostawcy_materialow").select("*").order("nazwa"),
    ]);
    if (p.error || z.error) { ustawBlad((p.error ?? z.error)!.message); return; }
    ustawPorownanie(p.data as WierszPorownania[]);
    ustawZakupy(z.data as Zakup[]);
    ustawDostawcow((d.data ?? []) as { nip: string; nazwa: string; rodzaj: string }[]);
  }, []);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  const glowni = dostawcy.filter((d) => d.rodzaj === "glowny");
  const produkty = useMemo(() => {
    const m = new Map<string, Produkt>();
    for (const w of porownanie ?? []) {
      const p = m.get(w.material_id) ?? { id: w.material_id, kategoria: w.kategoria, nazwa: w.nazwa, wariant: w.wariant, jednostka: w.jednostka, uwagi: w.uwagi, ceny: new Map(), wydano: 0 };
      p.ceny.set(w.nip, w); p.wydano += Number(w.wydano_12m); m.set(w.material_id, p);
    }
    return [...m.values()];
  }, [porownanie]);
  const doPrzypisania = useMemo(() => {
    const m = new Map<string, { nip: string; dostawca: string; indeks_norm: string; indeks: string | null; nazwa: string; jednostka: string | null; n: number; suma: number; cena: number | null; data: string }>();
    for (const z of zakupy) {
      if (z.material_id || z.pominiety || z.lakier || z.rodzaj !== "glowny" || !z.indeks_norm) continue;
      const kl = `${z.nip}|${z.indeks_norm}`;
      const w = m.get(kl) ?? { nip: z.nip, dostawca: z.dostawca, indeks_norm: z.indeks_norm, indeks: z.indeks, nazwa: z.nazwa, jednostka: z.jednostka, n: 0, suma: 0, cena: z.cena_netto, data: z.data };
      w.n++; w.suma += Number(z.wartosc); m.set(kl, w);
    }
    return [...m.values()].sort((a, b) => b.suma - a.suma);
  }, [zakupy]);

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>Materiał</h1>
          <p className="podtytul">Ceny netto u Moto Color i CSV z faktur KSeF (a bez faktury — z cennika/arkusza) oraz zakupy materiałów pomocniczych.</p></div>
        <div className="przyciski">
          <button className={`przycisk ${zakladka === "porownanie" ? "" : "drugi"}`} onClick={() => ustawZakladke("porownanie")}>Porównanie cen</button>
          <button className={`przycisk ${zakladka === "przypisz" ? "" : "drugi"}`} onClick={() => ustawZakladke("przypisz")}>
            Do przypisania{doPrzypisania.length ? ` (${doPrzypisania.length})` : ""}</button>
          <button className={`przycisk ${zakladka === "pomocnicze" ? "" : "drugi"}`} onClick={() => ustawZakladke("pomocnicze")}>Pomocnicze</button>
        </div>
      </div>
      {blad && <div className="blad">{blad}</div>}
      {zakladka === "porownanie" && <Porownanie produkty={produkty} glowni={glowni} zakupy={zakupy} odswiez={wczytaj} gotowe={porownanie !== null} />}
      {zakladka === "przypisz" && <DoPrzypisania lista={doPrzypisania} produkty={produkty} zakupy={zakupy} odswiez={wczytaj} />}
      {zakladka === "pomocnicze" && <MaterialyPomocnicze {...k} dostawcy={dostawcy} zakupyKsef={zakupy.filter((z) => z.rodzaj === "pomocniczy")} odswiez={wczytaj} />}
    </div>
  );
}

function Porownanie({ produkty, glowni, zakupy, odswiez, gotowe }: {
  produkty: Produkt[]; glowni: { nip: string; nazwa: string }[]; zakupy: Zakup[]; odswiez: () => Promise<void>; gotowe: boolean;
}) {
  const [szukaj, ustawSzukaj] = useState("");
  const [kategoria, ustawKategorie] = useState("");
  const [tylkoObie, ustawTylkoObie] = useState(false);
  const [rozwiniety, ustawRozwiniety] = useState<string | null>(null);
  const [nowy, ustawNowy] = useState<{ kategoria: string; nazwa: string; wariant: string; jednostka: string } | null>(null);
  const [oferta, ustawOferte] = useState<{ nip: string; cena: string }>({ nip: "", cena: "" });
  const [blad, ustawBlad] = useState<string | null>(null);

  const kategorie = [...new Set(produkty.map((p) => p.kategoria))].sort((a, b) => a.localeCompare(b, "pl"));
  const q = szukaj.trim().toUpperCase();
  const [a, b] = glowni;
  const porownaj = (p: Produkt) => {
    const ca = a ? p.ceny.get(a.nip)?.cena ?? null : null, cb = b ? p.ceny.get(b.nip)?.cena ?? null : null;
    if (ca === null || cb === null || ca <= 0 || cb <= 0) return null;
    const tanszy = ca <= cb ? a : b;
    const roznica = Math.abs(ca - cb) / Math.max(ca, cb);
    return { tanszy, roznica, ca, cb };
  };
  const widoczne = produkty.filter((p) => (!kategoria || p.kategoria === kategoria) &&
    (!q || `${p.nazwa} ${p.wariant ?? ""} ${p.kategoria}`.toUpperCase().includes(q)) && (!tylkoObie || porownaj(p)));

  // Ile kosztowało kupowanie u droższego (12 mies.), przy cenach z porównania
  const oszczednosc = produkty.reduce((s, p) => {
    const c = porownaj(p); if (!c) return s;
    const drozszy = c.tanszy === a ? b : a;
    const wydanoUDrozszego = Number(p.ceny.get(drozszy.nip)?.wydano_12m ?? 0);
    return s + wydanoUDrozszego * c.roznica;
  }, 0);
  const zObiema = produkty.filter((p) => porownaj(p)).length;
  const wygrywa = glowni.map((d) => ({ d, n: produkty.filter((p) => porownaj(p)?.tanszy === d).length }));

  async function dodajProdukt() {
    if (!nowy?.nazwa.trim() || !nowy.kategoria.trim()) return;
    const { error } = await db.from("materialy").insert({ kategoria: nowy.kategoria.trim(), nazwa: nowy.nazwa.trim(), wariant: nowy.wariant.trim() || null, jednostka: nowy.jednostka.trim() || null });
    ustawBlad(error?.message ?? null); if (!error) { ustawNowy(null); await odswiez(); }
  }
  async function dodajOferte(materialId: string) {
    const c = Number(oferta.cena.replace(",", "."));
    if (!oferta.nip || !(c > 0)) return;
    const { error } = await db.from("materialy_ceny_ofert").insert({ material_id: materialId, nip_dostawcy: oferta.nip, cena_netto: c, zrodlo: "reczna" });
    ustawBlad(error?.message ?? null); ustawOferte({ nip: "", cena: "" }); await odswiez();
  }
  async function zmienMnoznik(nip: string, indeksNorm: string, m: number) {
    if (!(m > 0)) return;
    const { error } = await db.from("materialy_kody").update({ mnoznik: m }).eq("nip_dostawcy", nip).eq("indeks_norm", indeksNorm);
    ustawBlad(error?.message ?? null); await odswiez();
  }
  async function odepnij(nip: string, indeksNorm: string) {
    const { error } = await db.from("materialy_kody").delete().eq("nip_dostawcy", nip).eq("indeks_norm", indeksNorm);
    ustawBlad(error?.message ?? null); await odswiez();
  }
  async function ukryj(id: string) {
    const { error } = await db.from("materialy").update({ aktywny: false }).eq("id", id);
    ustawBlad(error?.message ?? null); await odswiez();
  }

  let ostatniaKategoria = "";
  return (<>
    {a && b && <section className="karta"><div className="srodek siatka">
      <div><div className="cichy">Produkty z ceną u obu</div><strong style={{ fontSize: 20 }}>{zObiema}</strong><div className="cichy">z {produkty.length} w katalogu</div></div>
      {wygrywa.map(({ d, n }) => <div key={d.nip}><div className="cichy">Taniej u {d.nazwa}</div><strong style={{ fontSize: 20 }}>{n}</strong><div className="cichy">produktów</div></div>)}
      <div><div className="cichy">Przepłacone w 12 mies.</div><strong style={{ fontSize: 20 }} className={oszczednosc > 0 ? "minus" : ""}>{zl(oszczednosc)}</strong>
        <div className="cichy">zakupy u droższego dostawcy</div></div>
    </div></section>}

    <section className="karta">
      <div className="tytul">
        <div className="przyciski" style={{ alignItems: "center" }}>
          <input type="search" aria-label="Szukaj" placeholder="Szukaj produktu" value={szukaj} onChange={(e) => ustawSzukaj(e.target.value)} />
          <select aria-label="Kategoria" value={kategoria} onChange={(e) => ustawKategorie(e.target.value)}>
            <option value="">Wszystkie kategorie</option>{kategorie.map((x) => <option key={x}>{x}</option>)}</select>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" style={{ minHeight: 0 }} checked={tylkoObie} onChange={(e) => ustawTylkoObie(e.target.checked)} /> tylko z ceną u obu</label>
        </div>
        <button className="przycisk drugi" onClick={() => ustawNowy({ kategoria: kategoria, nazwa: "", wariant: "", jednostka: "szt" })}>+ Produkt</button>
      </div>
      {blad && <div className="srodek"><div className="blad">{blad}</div></div>}
      {nowy && <div className="srodek siatka" style={{ borderBottom: "1px solid var(--linia)", alignItems: "end" }}>
        <label>Kategoria<input list="kategorie" value={nowy.kategoria} onChange={(e) => ustawNowy({ ...nowy, kategoria: e.target.value })} /></label>
        <datalist id="kategorie">{kategorie.map((x) => <option key={x} value={x} />)}</datalist>
        <label>Nazwa<input value={nowy.nazwa} onChange={(e) => ustawNowy({ ...nowy, nazwa: e.target.value })} /></label>
        <label>Wariant<input value={nowy.wariant} onChange={(e) => ustawNowy({ ...nowy, wariant: e.target.value })} /></label>
        <label>Jednostka porównania<input value={nowy.jednostka} onChange={(e) => ustawNowy({ ...nowy, jednostka: e.target.value })} /></label>
        <div className="przyciski"><button className="przycisk" onClick={dodajProdukt}>Dodaj</button><button className="przycisk drugi" onClick={() => ustawNowy(null)}>Anuluj</button></div>
      </div>}
      {!gotowe ? null : widoczne.length === 0 ? <div className="pusto">Brak produktów dla tego filtra.</div> : (
        <div className="przewijanie"><table style={{ minWidth: 880 }}>
          <thead><tr><th>Produkt</th>{glowni.map((d) => <th key={d.nip} className="liczba">{d.nazwa} netto</th>)}<th>Taniej</th><th className="liczba">Wydano 12 mies.</th><th></th></tr></thead>
          <tbody>{widoczne.map((p) => {
            const c = porownaj(p);
            const naglowekKat = p.kategoria !== ostatniaKategoria ? (ostatniaKategoria = p.kategoria) : null;
            const otwarty = rozwiniety === p.id;
            const historia = zakupy.filter((z) => z.material_id === p.id);
            const kody = [...new Map(historia.map((z) => [`${z.nip}|${z.indeks_norm}`, z])).values()];
            return (<Fragment key={p.id}>
              {naglowekKat && <tr><td colSpan={glowni.length + 4} style={{ background: "var(--tlo)", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em" }}>{naglowekKat}</td></tr>}
              <tr>
                <td>{opis(p)}<div className="cichy">{p.jednostka ? `za ${p.jednostka}` : "jednostka nieustalona"}</div></td>
                {glowni.map((d) => {
                  const w = p.ceny.get(d.nip);
                  const tanszy = c && c.tanszy === d;
                  return <td key={d.nip} className="liczba" style={tanszy ? { color: "var(--dobrze)", fontWeight: 600 } : undefined}>{cena(w?.cena)}
                    <div className="cichy" style={{ fontWeight: 400 }}>{w?.zrodlo === "faktura" ? `faktura ${w.data_faktury}` : w?.zrodlo === "oferta" ? "cennik" : ""}</div></td>;
                })}
                <td>{c ? <><strong>{c.tanszy.nazwa}</strong><div className="cichy">o {Math.round(c.roznica * 100)}%</div></> : <span className="cichy">—</span>}</td>
                <td className="liczba">{p.wydano ? zl(p.wydano) : "—"}</td>
                <td><button className="przycisk drugi" onClick={() => ustawRozwiniety(otwarty ? null : p.id)}>{otwarty ? "Zwiń" : "Szczegóły"}</button></td>
              </tr>
              {otwarty && <tr><td colSpan={glowni.length + 4}><div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 0" }}>
                {p.uwagi && <div className="cichy">{p.uwagi}</div>}
                <div><strong>Produkty dostawców przypisane do tej pozycji</strong>
                  {kody.length === 0 ? <div className="cichy">Żaden produkt z faktur nie jest jeszcze przypisany — cena pochodzi z cennika.</div> :
                    kody.map((z) => <div key={z.pozycja_id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                      <span className="znacznik">{z.dostawca}</span><span>{z.nazwa}</span><span className="cichy">{z.indeks}</span>
                      <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }} title="Ile jednostek porównania jest w jednej jednostce z faktury">
                        mnożnik<input style={{ width: 90 }} defaultValue={String(z.mnoznik ?? 1)} onBlur={(e) => Number(e.target.value.replace(",", ".")) !== z.mnoznik && zmienMnoznik(z.nip, z.indeks_norm, Number(e.target.value.replace(",", ".")))} /></label>
                      <button className="przycisk drugi" onClick={() => odepnij(z.nip, z.indeks_norm)}>Odepnij</button>
                    </div>)}
                </div>
                {historia.length > 0 && <div><strong>Zakupy</strong>
                  <table><thead><tr><th>Data</th><th>Dostawca</th><th>Faktura</th><th className="liczba">Ilość</th><th className="liczba">Cena z faktury</th><th className="liczba">Za {p.jednostka ?? "jedn."}</th></tr></thead>
                    <tbody>{historia.slice(0, 20).map((z) => <tr key={z.pozycja_id}><td>{z.data}</td><td>{z.dostawca}</td><td>{z.faktura}</td>
                      <td className="liczba">{z.ilosc} {z.jednostka}</td><td className="liczba">{cena(z.cena_netto)}</td><td className="liczba">{cena(z.cena_katalogowa)}</td></tr>)}</tbody></table></div>}
                <div className="przyciski" style={{ alignItems: "flex-end" }}>
                  <label>Cena z oferty — dostawca<select value={oferta.nip} onChange={(e) => ustawOferte({ ...oferta, nip: e.target.value })}>
                    <option value="">—</option>{glowni.map((d) => <option key={d.nip} value={d.nip}>{d.nazwa}</option>)}</select></label>
                  <label>netto za {p.jednostka ?? "jedn."}<input style={{ width: 110 }} value={oferta.cena} onChange={(e) => ustawOferte({ ...oferta, cena: e.target.value })} /></label>
                  <button className="przycisk drugi" onClick={() => dodajOferte(p.id)}>Zapisz cenę</button>
                  <button className="przycisk drugi" onClick={() => ukryj(p.id)}>Ukryj produkt</button>
                </div>
              </div></td></tr>}
            </Fragment>);
          })}</tbody>
        </table></div>)}
    </section>
  </>);
}

function DoPrzypisania({ lista, produkty, zakupy, odswiez }: {
  lista: { nip: string; dostawca: string; indeks_norm: string; indeks: string | null; nazwa: string; jednostka: string | null; n: number; suma: number; cena: number | null; data: string }[];
  produkty: Produkt[]; zakupy: Zakup[]; odswiez: () => Promise<void>;
}) {
  const [wybor, ustawWybor] = useState<Record<string, { material: string; mnoznik: string }>>({});
  const [blad, ustawBlad] = useState<string | null>(null);
  const posortowane = [...produkty].sort((a, b) => a.kategoria.localeCompare(b.kategoria, "pl") || opis(a).localeCompare(opis(b), "pl"));

  async function zapisz(w: typeof lista[number], materialId: string | null, mnoznik = 1, pominiety = false, lakier = false) {
    const { error } = await db.from("materialy_kody").upsert({
      material_id: materialId, nip_dostawcy: w.nip, indeks_norm: w.indeks_norm, nazwa_dostawcy: w.nazwa, mnoznik, pominiety, lakier,
    }, { onConflict: "nip_dostawcy,indeks_norm" });
    ustawBlad(error?.message ?? null); if (!error) await odswiez();
  }
  async function nowyProdukt(w: typeof lista[number]) {
    const { data, error } = await db.from("materialy").insert({ kategoria: "Nowe z faktur", nazwa: w.nazwa, jednostka: w.jednostka }).select("id").single();
    if (error) { ustawBlad(error.message); return; }
    await zapisz(w, data.id);
  }

  if (lista.length === 0) return <section className="karta"><div className="pusto">Wszystkie produkty z faktur Moto Color i CSV są przypisane.</div></section>;
  return (
    <section className="karta">
      <div className="srodek cichy">Produkty z faktur, których jeszcze nie ma w katalogu — od największych wydatków. Przypisz do pozycji z arkusza, dodaj jako nowy produkt
        „To lakier”, gdy to lakier dorabiany pod auto (przejdzie do zakładki Lakiery), albo pomiń. Mnożnik: ile jednostek z katalogu jest w jednej jednostce z faktury (arkusz z paczki 50 szt. = 0,02).</div>
      {blad && <div className="srodek"><div className="blad">{blad}</div></div>}
      <div className="przewijanie"><table style={{ minWidth: 960 }}>
        <thead><tr><th>Produkt dostawcy</th><th className="liczba">Zakupy</th><th className="liczba">Ostatnia cena</th><th>Przypisz do</th><th></th></tr></thead>
        <tbody>{lista.map((w) => {
          const kl = `${w.nip}|${w.indeks_norm}`;
          const propozycje = produkty.map((p) => ({ p, s: podobienstwo(w.nazwa, `${p.nazwa} ${p.wariant ?? ""} ${p.kategoria}`) }))
            .filter((x) => x.s >= 0.34).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.p);
          const wyb = wybor[kl] ?? { material: propozycje[0]?.id ?? "", mnoznik: "1" };
          const mn = Number(wyb.mnoznik.replace(",", ".")) || 1;
          const docelowy = produkty.find((p) => p.id === wyb.material);
          const innaCena = docelowy ? [...docelowy.ceny.values()].find((c) => c.cena)?.cena : null;
          const poPrzeliczeniu = w.cena !== null ? w.cena / mn : null;
          const podejrzane = innaCena && poPrzeliczeniu && (poPrzeliczeniu / innaCena > 2.5 || poPrzeliczeniu / innaCena < 0.4);
          return (
            <tr key={kl}>
              <td><span className="znacznik">{w.dostawca}</span> {w.nazwa}<div className="cichy">{w.indeks} · ostatnio {w.data}</div></td>
              <td className="liczba">{zl(w.suma)}<div className="cichy">{w.n}×</div></td>
              <td className="liczba">{cena(w.cena)}<div className="cichy">za {w.jednostka ?? "jedn."}</div></td>
              <td style={{ minWidth: 300 }}>
                <select aria-label="Produkt z katalogu" value={wyb.material} onChange={(e) => ustawWybor({ ...wybor, [kl]: { ...wyb, material: e.target.value } })}>
                  <option value="">— wybierz —</option>
                  {propozycje.length > 0 && <optgroup label="Podobne">{propozycje.map((p) => <option key={p.id} value={p.id}>{opis(p)} ({p.kategoria})</option>)}</optgroup>}
                  <optgroup label="Cały katalog">{posortowane.map((p) => <option key={p.id} value={p.id}>{p.kategoria}: {opis(p)}</option>)}</optgroup>
                </select>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>mnożnik
                    <input style={{ width: 80 }} value={wyb.mnoznik} onChange={(e) => ustawWybor({ ...wybor, [kl]: { ...wyb, mnoznik: e.target.value } })} /></label>
                  {docelowy && poPrzeliczeniu !== null && <span className={podejrzane ? "minus" : "cichy"} style={{ fontSize: 12 }}>
                    = {cena(poPrzeliczeniu)} za {docelowy.jednostka ?? "jedn."}{innaCena ? ` (w katalogu ${cena(innaCena)})` : ""}{podejrzane ? " — sprawdź mnożnik" : ""}</span>}
                </div>
              </td>
              <td><div className="przyciski">
                <button className="przycisk" disabled={!wyb.material} onClick={() => zapisz(w, wyb.material, mn)}>Przypisz</button>
                <button className="przycisk drugi" onClick={() => nowyProdukt(w)}>Nowy produkt</button>
                <button className="przycisk drugi" title="Lakier dorabiany pod auto — trafi do zakładki Lakiery" onClick={() => zapisz(w, null, 1, false, true)}>To lakier</button>
                <button className="przycisk drugi" onClick={() => zapisz(w, null, 1, true)}>Pomiń</button>
              </div></td>
            </tr>);
        })}</tbody>
      </table></div>
      <div className="srodek cichy">Pozycji z faktur: {zakupy.length}. Przypisanie działa wstecz i na przyszłe faktury z tym samym kodem.</div>
    </section>
  );
}
