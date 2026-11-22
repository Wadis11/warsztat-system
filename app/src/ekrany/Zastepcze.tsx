// Auta zastępcze: flota, grafik wypożyczeń, terminy (ubezpieczenie, przegląd, serwis), wypożyczenie z umową.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db, zl } from "../supabase.ts";

export interface Auto {
  id: string; nr_rej: string; marka: string | null; model: string | null; rok: number | null; vin: string | null; kolor: string | null;
  paliwo: string | null; opony_lato: string | null; opony_zima: string | null; ubezpieczenie_do: string | null; ubezpieczyciel: string | null;
  nr_polisy: string | null; przeglad_do: string | null; serwis_co_km: number | null; serwis_co_mies: number | null; aktywne: boolean; uwagi: string | null;
}
interface Wypozyczenie {
  id: string; numer: string; auto_id: string; zlecenie_id: string | null; rodzaj: "najem" | "uzyczenie"; wydanie: string;
  planowany_zwrot: string | null; zwrot: string | null; najemca_nazwa: string; najemca_adres: string | null; najemca_dokument: string | null;
  najemca_prawo_jazdy: string | null; najemca_telefon: string | null; najemca_nip: string | null; stawka_netto: number | null; kaucja: number | null;
  cesja: boolean; przebieg_wydania: number | null; przebieg_zwrotu: number | null; paliwo_wydania: string | null; paliwo_zwrotu: string | null;
  stan_wydania: string | null; stan_zwrotu: string | null; uwagi: string | null;
  zlecenia?: { numer: string; nr_rej: string | null; nr_szkody: string | null } | null;
}
interface Termin { auto_id: string; nr_rej: string; marka: string | null; model: string | null; rodzaj: "ubezpieczenie" | "przeglad" | "serwis"; data: string }

const RODZAJ_TERMINU = { ubezpieczenie: "Koniec ubezpieczenia", przeglad: "Przegląd techniczny", serwis: "Serwis okresowy" };
const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const dniDo = (data: string) => Math.round((Date.parse(data) - Date.parse(iso(new Date()))) / 864e5);
const dataGodz = (t: string | null) => (t ? new Date(t).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const doLokalnego = (t: string | null) => (t ? new Date(new Date(t).getTime() - new Date(t).getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : "");
const zLokalnego = (s: string) => (s ? new Date(s).toISOString() : null);
const nazwaAuta = (a: Pick<Auto, "marka" | "model" | "nr_rej">) => `${[a.marka, a.model].filter(Boolean).join(" ")} · ${a.nr_rej}`;
const koniec = (w: Wypozyczenie) => w.zwrot ?? w.planowany_zwrot;

function Alarm({ data }: { data: string | null }) {
  if (!data) return <span className="cichy">—</span>;
  const d = dniDo(data);
  return <span className={d < 0 ? "minus" : ""} style={d >= 0 && d <= 30 ? { color: "var(--uwaga)", fontWeight: 600 } : undefined}>
    {data}<span className="cichy" style={{ fontWeight: 400 }}> · {d < 0 ? `${-d} dni po` : d === 0 ? "dziś" : `za ${d} dni`}</span></span>;
}

export function Zastepcze({ przejdz }: Kontekst) {
  const [auta, ustawAuta] = useState<Auto[] | null>(null);
  const [wyp, ustawWyp] = useState<Wypozyczenie[]>([]);
  const [terminy, ustawTerminy] = useState<Termin[]>([]);
  const [start, ustawStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; });
  const [nowe, ustawNowe] = useState<{ nr_rej: string; marka: string; model: string } | null>(null);
  const [blad, ustawBlad] = useState<string | null>(null);

  const wczytaj = useCallback(async () => {
    const od = new Date(Date.now() - 120 * 864e5).toISOString();
    const [a, w, t] = await Promise.all([
      db.from("auta_zastepcze").select("*").order("aktywne", { ascending: false }).order("nr_rej"),
      db.from("wypozyczenia").select("*, zlecenia(numer, nr_rej, nr_szkody)").or(`zwrot.is.null,zwrot.gte.${od}`).order("wydanie"),
      db.from("auta_zastepcze_terminy").select("*").order("data"),
    ]);
    ustawAuta((a.data ?? []) as Auto[]); ustawWyp((w.data ?? []) as unknown as Wypozyczenie[]); ustawTerminy((t.data ?? []) as Termin[]);
  }, []);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  async function dodaj() {
    if (!nowe?.nr_rej.trim()) return;
    const { data, error } = await db.from("auta_zastepcze").insert({ nr_rej: nowe.nr_rej.trim().toUpperCase(), marka: nowe.marka.trim().toUpperCase() || null, model: nowe.model.trim() || null }).select("id").single();
    if (error) { ustawBlad(error.message); return; }
    przejdz({ ekran: "auto_zastepcze", autoId: data.id });
  }

  const dni = Array.from({ length: 21 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const teraz = Date.now();
  const wDniu = (autoId: string, d: Date) => {
    const p = d.getTime(), k = p + 864e5;
    return wyp.find((w) => w.auto_id === autoId && Date.parse(w.wydanie) < k && (koniec(w) ? Date.parse(koniec(w)!) > p : true));
  };
  const aktywne = (auta ?? []).filter((a) => a.aktywne);

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>Auta zastępcze</h1><p className="podtytul">Grafik wypożyczeń, umowy najmu i użyczenia, terminy ubezpieczeń, przeglądów i serwisów.</p></div>
        <div className="przyciski">
          <button className="przycisk" onClick={() => przejdz({ ekran: "wypozyczenie" })}>Wydaj auto</button>
          <button className="przycisk drugi" onClick={() => ustawNowe({ nr_rej: "", marka: "", model: "" })}>+ Auto do floty</button>
        </div>
      </div>
      {blad && <div className="blad">{blad}</div>}
      {nowe && <section className="karta"><div className="srodek siatka" style={{ alignItems: "end" }}>
        <label>Rejestracja<input value={nowe.nr_rej} onChange={(e) => ustawNowe({ ...nowe, nr_rej: e.target.value })} autoFocus /></label>
        <label>Marka<input value={nowe.marka} onChange={(e) => ustawNowe({ ...nowe, marka: e.target.value })} /></label>
        <label>Model<input value={nowe.model} onChange={(e) => ustawNowe({ ...nowe, model: e.target.value })} /></label>
        <div className="przyciski"><button className="przycisk" onClick={dodaj}>Dodaj i uzupełnij dane</button><button className="przycisk drugi" onClick={() => ustawNowe(null)}>Anuluj</button></div>
      </div></section>}

      <section className="karta">
        <div className="tytul">
          <button className="przycisk drugi" aria-label="Wcześniej" onClick={() => { const d = new Date(start); d.setDate(d.getDate() - 7); ustawStart(d); }}>←</button>
          <h2>Grafik · od {start.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</h2>
          <button className="przycisk drugi" aria-label="Później" onClick={() => { const d = new Date(start); d.setDate(d.getDate() + 7); ustawStart(d); }}>→</button>
        </div>
        {aktywne.length === 0 ? <div className="pusto">Dodaj auta zastępcze do floty.</div> : (
          <div className="przewijanie"><table style={{ minWidth: 980, tableLayout: "fixed" }}>
            <thead><tr><th style={{ width: 170 }}>Auto</th>{dni.map((d) => <th key={iso(d)} style={{ textAlign: "center", padding: "6px 0", fontSize: 11, background: iso(d) === iso(new Date()) ? "#e8effc" : undefined }}>
              {["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"][d.getDay()]}<br />{d.getDate()}</th>)}</tr></thead>
            <tbody>{aktywne.map((a) => (
              <tr key={a.id}>
                <td><button className="link" onClick={() => przejdz({ ekran: "auto_zastepcze", autoId: a.id })}><strong>{a.nr_rej}</strong></button>
                  <div className="cichy" style={{ fontSize: 12 }}>{[a.marka, a.model].filter(Boolean).join(" ")}</div></td>
                {dni.map((d) => {
                  const w = wDniu(a.id, d);
                  const trwa = w && Date.parse(w.wydanie) <= teraz && !w.zwrot;
                  return <td key={iso(d)} style={{ padding: 2 }}>
                    <button title={w ? `${w.numer} · ${w.najemca_nazwa}${w.zlecenia ? ` · zlecenie ${w.zlecenia.numer}` : ""}` : "Wolne — kliknij, żeby wydać"}
                      onClick={() => w ? przejdz({ ekran: "wypozyczenie", wypozyczenieId: w.id }) : przejdz({ ekran: "wypozyczenie", autoId: a.id, od: iso(d) })}
                      style={{ all: "unset", cursor: "pointer", display: "block", height: 26, borderRadius: 4, background: w ? (trwa ? "var(--akcent)" : w.zwrot ? "#aeb6c2" : "#8fb3f5") : "var(--tlo)" }} />
                  </td>;
                })}
              </tr>))}</tbody>
          </table></div>)}
        <div className="srodek cichy" style={{ fontSize: 12 }}>
          <span style={{ display: "inline-block", width: 12, height: 12, background: "var(--akcent)", borderRadius: 3, verticalAlign: "middle" }} /> wydane teraz ·{" "}
          <span style={{ display: "inline-block", width: 12, height: 12, background: "#8fb3f5", borderRadius: 3, verticalAlign: "middle" }} /> zarezerwowane ·{" "}
          <span style={{ display: "inline-block", width: 12, height: 12, background: "#aeb6c2", borderRadius: 3, verticalAlign: "middle" }} /> zwrócone. Kliknij wolny dzień, żeby wydać auto.
        </div>
      </section>

      <section className="karta">
        <div className="tytul"><h2>Terminy floty</h2></div>
        {terminy.length === 0 ? <div className="pusto">Uzupełnij daty ubezpieczenia i przeglądu w danych aut.</div> : (
          <div className="przewijanie"><table><thead><tr><th>Termin</th><th>Auto</th><th>Co</th></tr></thead>
            <tbody>{terminy.map((t) => <tr key={t.auto_id + t.rodzaj}>
              <td><Alarm data={t.data} /></td>
              <td><button className="link" onClick={() => przejdz({ ekran: "auto_zastepcze", autoId: t.auto_id })}>{nazwaAuta(t)}</button></td>
              <td>{RODZAJ_TERMINU[t.rodzaj]}</td></tr>)}</tbody></table></div>)}
      </section>

      <section className="karta">
        <div className="tytul"><h2>Wypożyczenia</h2></div>
        {wyp.length === 0 ? <div className="pusto">Brak wypożyczeń.</div> : (
          <div className="przewijanie"><table style={{ minWidth: 820 }}>
            <thead><tr><th>Umowa</th><th>Auto</th><th>Kto</th><th>Od – do</th><th>Zlecenie</th><th></th></tr></thead>
            <tbody>{[...wyp].reverse().map((w) => {
              const a = (auta ?? []).find((x) => x.id === w.auto_id);
              const poTerminie = !w.zwrot && w.planowany_zwrot && Date.parse(w.planowany_zwrot) < teraz;
              return <tr key={w.id}>
                <td>{w.numer}<div className="cichy">{w.rodzaj === "najem" ? "najem" : "użyczenie"}</div></td>
                <td>{a?.nr_rej}<div className="cichy">{[a?.marka, a?.model].filter(Boolean).join(" ")}</div></td>
                <td>{w.najemca_nazwa}<div className="cichy">{w.najemca_telefon}</div></td>
                <td>{dataGodz(w.wydanie)}<div className={poTerminie ? "minus" : "cichy"}>{w.zwrot ? `zwrot ${dataGodz(w.zwrot)}` : `do ${dataGodz(w.planowany_zwrot)}${poTerminie ? " — po terminie" : ""}`}</div></td>
                <td>{w.zlecenia ? <button className="link" onClick={() => przejdz({ ekran: "zlecenie", zlecenieId: w.zlecenie_id! })}>{w.zlecenia.numer}</button> : <span className="cichy">—</span>}</td>
                <td><div className="przyciski">
                  <button className="przycisk drugi" onClick={() => przejdz({ ekran: "wypozyczenie", wypozyczenieId: w.id })}>{w.zwrot ? "Szczegóły" : "Zwrot / zmień"}</button>
                  <button className="przycisk drugi" onClick={() => przejdz({ ekran: "umowa", wypozyczenieId: w.id })}>Umowa</button>
                </div></td>
              </tr>;
            })}</tbody></table></div>)}
      </section>
    </div>
  );
}

export function AutoZastepcze({ autoId, przejdz }: Kontekst & { autoId: string }) {
  const [a, ustawA] = useState<Auto | null>(null);
  const [serwis, ustawSerwis] = useState<{ id: string; data: string; przebieg: number | null; opis: string }[]>([]);
  const [historia, ustawHistorie] = useState<Wypozyczenie[]>([]);
  const [nowySerwis, ustawNowySerwis] = useState({ data: iso(new Date()), przebieg: "", opis: "" });
  const [komunikat, ustawKomunikat] = useState<{ blad: boolean; tekst: string } | null>(null);

  const wczytaj = useCallback(async () => {
    const [x, s, h] = await Promise.all([
      db.from("auta_zastepcze").select("*").eq("id", autoId).single(),
      db.from("auta_zastepcze_serwis").select("id, data, przebieg, opis").eq("auto_id", autoId).order("data", { ascending: false }),
      db.from("wypozyczenia").select("*, zlecenia(numer, nr_rej, nr_szkody)").eq("auto_id", autoId).order("wydanie", { ascending: false }).limit(100),
    ]);
    ustawA(x.data as Auto); ustawSerwis((s.data ?? []) as typeof serwis); ustawHistorie((h.data ?? []) as unknown as Wypozyczenie[]);
  }, [autoId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { wczytaj(); }, [wczytaj]);

  if (!a) return null;
  const pole = (k: keyof Auto, etykieta: string, typ = "text") => (
    <label>{etykieta}<input type={typ} value={(a[k] as string | number | null) ?? ""} onChange={(e) => ustawA({ ...a, [k]: e.target.value })} /></label>);

  async function zapisz() {
    const n = (v: unknown) => (v === "" || v === undefined ? null : v);
    const { error } = await db.from("auta_zastepcze").update({
      nr_rej: String(a!.nr_rej).trim().toUpperCase(), marka: n(a!.marka), model: n(a!.model), rok: n(a!.rok), vin: n(a!.vin), kolor: n(a!.kolor), paliwo: n(a!.paliwo),
      opony_lato: n(a!.opony_lato), opony_zima: n(a!.opony_zima), ubezpieczenie_do: n(a!.ubezpieczenie_do), ubezpieczyciel: n(a!.ubezpieczyciel),
      nr_polisy: n(a!.nr_polisy), przeglad_do: n(a!.przeglad_do), serwis_co_km: n(a!.serwis_co_km), serwis_co_mies: n(a!.serwis_co_mies), uwagi: n(a!.uwagi), aktywne: a!.aktywne,
    }).eq("id", autoId);
    ustawKomunikat(error ? { blad: true, tekst: error.message } : { blad: false, tekst: "Zapisano." });
  }
  async function dodajSerwis() {
    if (!nowySerwis.opis.trim()) return;
    const { error } = await db.from("auta_zastepcze_serwis").insert({ auto_id: autoId, data: nowySerwis.data, przebieg: nowySerwis.przebieg ? Number(nowySerwis.przebieg) : null, opis: nowySerwis.opis.trim() });
    ustawKomunikat(error ? { blad: true, tekst: error.message } : null);
    ustawNowySerwis({ data: iso(new Date()), przebieg: "", opis: "" }); await wczytaj();
  }
  const ostatni = serwis[0];
  const ostatniPrzebieg = Math.max(0, ...historia.map((w) => w.przebieg_zwrotu ?? w.przebieg_wydania ?? 0), ...serwis.map((s) => s.przebieg ?? 0));

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>{a.nr_rej}</h1><p className="podtytul">{[a.marka, a.model, a.rok].filter(Boolean).join(" ")}</p></div>
        <div className="przyciski">
          <button className="przycisk" onClick={() => przejdz({ ekran: "wypozyczenie", autoId })}>Wydaj to auto</button>
          <button className="przycisk drugi" onClick={() => przejdz({ ekran: "zastepcze" })}>← Auta zastępcze</button>
        </div>
      </div>
      {komunikat && <div className={komunikat.blad ? "blad" : "info"}>{komunikat.tekst}</div>}

      <section className="karta"><div className="srodek siatka">
        <div><div className="cichy">Ubezpieczenie do</div><Alarm data={a.ubezpieczenie_do} /></div>
        <div><div className="cichy">Przegląd do</div><Alarm data={a.przeglad_do} /></div>
        <div><div className="cichy">Ostatni serwis</div>{ostatni ? <span>{ostatni.data}{ostatni.przebieg ? ` · ${ostatni.przebieg.toLocaleString("pl-PL")} km` : ""}</span> : <span className="cichy">brak wpisu</span>}</div>
        <div><div className="cichy">Następny serwis</div>{ostatni && (a.serwis_co_mies || a.serwis_co_km) ? <span>
          {a.serwis_co_mies ? (() => { const d = new Date(ostatni.data); d.setMonth(d.getMonth() + a.serwis_co_mies!); return <Alarm data={iso(d)} />; })() : null}
          {a.serwis_co_km && ostatni.przebieg ? <div>przy {(ostatni.przebieg + a.serwis_co_km).toLocaleString("pl-PL")} km{ostatniPrzebieg ? <span className="cichy"> (ostatnio {ostatniPrzebieg.toLocaleString("pl-PL")} km)</span> : ""}</div> : null}
        </span> : <span className="cichy">ustaw interwał</span>}</div>
        <div><div className="cichy">Opony lato / zima</div>{a.opony_lato ?? "—"} / {a.opony_zima ?? "—"}</div>
      </div></section>

      <section className="karta">
        <div className="tytul"><h2>Dane auta</h2></div>
        <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="siatka">
            {pole("nr_rej", "Rejestracja")}{pole("marka", "Marka")}{pole("model", "Model")}{pole("rok", "Rok", "number")}{pole("vin", "VIN")}
            {pole("kolor", "Kolor")}{pole("paliwo", "Paliwo")}{pole("opony_lato", "Opony letnie (rozmiar)")}{pole("opony_zima", "Opony zimowe (rozmiar)")}
            {pole("ubezpieczyciel", "Ubezpieczyciel")}{pole("nr_polisy", "Nr polisy")}{pole("ubezpieczenie_do", "Ubezpieczenie do", "date")}
            {pole("przeglad_do", "Przegląd ważny do", "date")}{pole("serwis_co_mies", "Serwis co (miesięcy)", "number")}{pole("serwis_co_km", "Serwis co (km)", "number")}
          </div>
          <label>Uwagi (wyposażenie, karta paliwowa, znane uszkodzenia)<textarea value={a.uwagi ?? ""} onChange={(e) => ustawA({ ...a, uwagi: e.target.value })} /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" style={{ minHeight: 0 }} checked={a.aktywne} onChange={(e) => ustawA({ ...a, aktywne: e.target.checked })} /> auto we flocie (odznacz po sprzedaży)</label>
          <div className="przyciski"><button className="przycisk" onClick={zapisz}>Zapisz dane</button></div>
        </div>
      </section>

      <section className="karta">
        <div className="tytul"><h2>Historia serwisowa</h2></div>
        <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="siatka" style={{ alignItems: "end" }}>
            <label>Data<input type="date" value={nowySerwis.data} onChange={(e) => ustawNowySerwis({ ...nowySerwis, data: e.target.value })} /></label>
            <label>Przebieg (km)<input inputMode="numeric" value={nowySerwis.przebieg} onChange={(e) => ustawNowySerwis({ ...nowySerwis, przebieg: e.target.value.replace(/\D/g, "") })} /></label>
            <label style={{ gridColumn: "span 2" }}>Co zrobiono<input value={nowySerwis.opis} onChange={(e) => ustawNowySerwis({ ...nowySerwis, opis: e.target.value })} placeholder="np. olej 5W30, filtr oleju i powietrza, klocki przód" /></label>
            <button className="przycisk drugi" onClick={dodajSerwis}>Dodaj wpis</button>
          </div>
          {serwis.length === 0 ? <div className="cichy">Brak wpisów.</div> : <table><thead><tr><th>Data</th><th className="liczba">Przebieg</th><th>Co zrobiono</th></tr></thead>
            <tbody>{serwis.map((s) => <tr key={s.id}><td>{s.data}</td><td className="liczba">{s.przebieg?.toLocaleString("pl-PL") ?? "—"}</td><td>{s.opis}</td></tr>)}</tbody></table>}
        </div>
      </section>

      <section className="karta">
        <div className="tytul"><h2>Wypożyczenia tego auta</h2></div>
        {historia.length === 0 ? <div className="pusto">Jeszcze nie było wypożyczane.</div> : (
          <div className="przewijanie"><table><thead><tr><th>Umowa</th><th>Kto</th><th>Od</th><th>Do</th><th>Zlecenie</th><th className="liczba">Km</th><th></th></tr></thead>
            <tbody>{historia.map((w) => <tr key={w.id}><td>{w.numer}</td><td>{w.najemca_nazwa}</td><td>{dataGodz(w.wydanie)}</td><td>{dataGodz(koniec(w))}{!w.zwrot && <div className="cichy">planowany</div>}</td>
              <td>{w.zlecenia?.numer ?? "—"}</td><td className="liczba">{w.przebieg_zwrotu && w.przebieg_wydania ? (w.przebieg_zwrotu - w.przebieg_wydania).toLocaleString("pl-PL") : "—"}</td>
              <td><button className="przycisk drugi" onClick={() => przejdz({ ekran: "wypozyczenie", wypozyczenieId: w.id })}>Otwórz</button></td></tr>)}</tbody></table></div>)}
      </section>
    </div>
  );
}

type Formularz = Omit<Wypozyczenie, "id" | "numer" | "zlecenia"> & { id?: string; numer?: string };

export function NoweWypozyczenie({ rola, przejdz, autoId, zlecenieId, od, wypozyczenieId }: Kontekst & { autoId?: string; zlecenieId?: string; od?: string; wypozyczenieId?: string }) {
  const [auta, ustawAuta] = useState<Auto[]>([]);
  const [zlecenia, ustawZlecenia] = useState<{ id: string; numer: string; nr_rej: string | null; marka: string | null; model: string | null; status: string; klienci: { nazwa: string; segment: string } | null }[]>([]);
  const [f, ustawF] = useState<Formularz | null>(null);
  const [blad, ustawBlad] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [a, z] = await Promise.all([
        db.from("auta_zastepcze").select("*").eq("aktywne", true).order("nr_rej"),
        db.from("zlecenia").select("id, numer, nr_rej, marka, model, status, klienci(nazwa, segment)").in("status", ["umowione", "przyjete", "w_naprawie", "gotowe"]).order("data_przyjecia", { ascending: false }).limit(300),
      ]);
      ustawAuta((a.data ?? []) as Auto[]);
      ustawZlecenia((z.data ?? []) as unknown as typeof zlecenia);
      if (wypozyczenieId) {
        const { data } = await db.from("wypozyczenia").select("*").eq("id", wypozyczenieId).single();
        ustawF(data as Formularz);
      } else {
        const start = od ? new Date(`${od}T08:00`) : new Date();
        const zl = ((z.data ?? []) as unknown as typeof zlecenia).find((x) => x.id === zlecenieId);
        ustawF({
          auto_id: autoId ?? "", zlecenie_id: zlecenieId ?? null, rodzaj: "najem", wydanie: start.toISOString(), planowany_zwrot: null, zwrot: null,
          najemca_nazwa: zl?.klienci?.segment === "prywatny" ? zl.klienci.nazwa : "", najemca_adres: null, najemca_dokument: null, najemca_prawo_jazdy: null,
          najemca_telefon: null, najemca_nip: null, stawka_netto: null, kaucja: null, cesja: zl?.klienci?.segment === "ubezpieczyciel",
          przebieg_wydania: null, przebieg_zwrotu: null, paliwo_wydania: null, paliwo_zwrotu: null, stan_wydania: null, stan_zwrotu: null, uwagi: null,
        });
      }
    })();
  }, [autoId, zlecenieId, od, wypozyczenieId]);

  if (!f) return null;
  const t = (k: keyof Formularz, etykieta: string, opcje: { typ?: string; pelne?: boolean; ph?: string } = {}) => (
    <label style={opcje.pelne ? { gridColumn: "1 / -1" } : undefined}>{etykieta}<input type={opcje.typ ?? "text"} placeholder={opcje.ph}
      value={(f[k] as string | number | null) ?? ""} onChange={(e) => ustawF({ ...f, [k]: opcje.typ === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })} /></label>);
  const czas = (k: "wydanie" | "planowany_zwrot" | "zwrot", etykieta: string) => (
    <label>{etykieta}<input type="datetime-local" value={doLokalnego(f[k])} onChange={(e) => ustawF({ ...f, [k]: zLokalnego(e.target.value) })} /></label>);

  async function zapisz(potem: "umowa" | "lista") {
    if (!f!.auto_id || !f!.najemca_nazwa.trim() || !f!.wydanie) { ustawBlad("Wybierz auto, wpisz kto bierze auto i datę wydania."); return; }
    const { id: _i, numer: _n, ...dane } = f as Formularz & { zlecenia?: unknown };
    delete (dane as { zlecenia?: unknown }).zlecenia;
    const puste = Object.fromEntries(Object.entries(dane).map(([k, v]) => [k, v === "" ? null : v]));
    const zapytanie = f!.id ? db.from("wypozyczenia").update(puste).eq("id", f!.id).select("id").single() : db.from("wypozyczenia").insert(puste).select("id").single();
    const { data, error } = await zapytanie;
    if (error) {
      ustawBlad(error.code === "23P01" ? "To auto jest już wydane albo zarezerwowane w tym czasie — zmień auto albo daty (sprawdź grafik)." : `Nie zapisano: ${error.message}`);
      return;
    }
    if (f!.zlecenie_id) await db.from("zlecenia").update({ zastepcze_potrzebne: true }).eq("id", f!.zlecenie_id);
    przejdz(potem === "umowa" ? { ekran: "umowa", wypozyczenieId: data.id } : { ekran: "zastepcze" });
  }

  const auto = auta.find((a) => a.id === f.auto_id);
  const doby = f.planowany_zwrot || f.zwrot ? Math.max(1, Math.ceil((Date.parse((f.zwrot ?? f.planowany_zwrot)!) - Date.parse(f.wydanie)) / 864e5)) : null;
  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>{f.id ? `Wypożyczenie ${f.numer}` : "Wydanie auta zastępczego"}</h1>
          <p className="podtytul">{f.id ? "Zwrot: wpisz datę, przebieg i paliwo przy oddaniu auta." : "Po zapisie otworzy się umowa do wydruku i podpisu."}</p></div>
        <div className="przyciski">
          {f.id && <button className="przycisk drugi" onClick={() => przejdz({ ekran: "umowa", wypozyczenieId: f.id! })}>Umowa</button>}
          <button className="przycisk drugi" onClick={() => przejdz({ ekran: "zastepcze" })}>← Auta zastępcze</button>
        </div>
      </div>
      {blad && <div className="blad" role="alert">{blad}</div>}

      <section className="karta"><div className="tytul"><h2>Auto i okres</h2></div><div className="srodek siatka">
        <label>Auto zastępcze<select value={f.auto_id} onChange={(e) => ustawF({ ...f, auto_id: e.target.value })}>
          <option value="">— wybierz —</option>{auta.map((a) => <option key={a.id} value={a.id}>{nazwaAuta(a)}</option>)}</select></label>
        <label>Za zlecenie<select value={f.zlecenie_id ?? ""} onChange={(e) => {
          const z = zlecenia.find((x) => x.id === e.target.value);
          ustawF({ ...f, zlecenie_id: e.target.value || null, najemca_nazwa: f.najemca_nazwa || (z?.klienci?.segment === "prywatny" ? z.klienci.nazwa : ""), cesja: z?.klienci?.segment === "ubezpieczyciel" ? true : f.cesja });
        }}>
          <option value="">— bez zlecenia —</option>{zlecenia.map((z) => <option key={z.id} value={z.id}>{z.numer} · {[z.marka, z.model].filter(Boolean).join(" ")} · {z.nr_rej}{z.klienci ? ` · ${z.klienci.nazwa}` : ""}</option>)}</select></label>
        <label>Rodzaj umowy<select value={f.rodzaj} onChange={(e) => ustawF({ ...f, rodzaj: e.target.value as "najem" | "uzyczenie" })}>
          <option value="najem">Najem (odpłatny)</option><option value="uzyczenie">Użyczenie (bezpłatne)</option></select></label>
        {czas("wydanie", "Wydanie")}{czas("planowany_zwrot", "Planowany zwrot")}{f.id && czas("zwrot", "Faktyczny zwrot")}
      </div></section>

      <section className="karta"><div className="tytul"><h2>{f.rodzaj === "najem" ? "Najemca" : "Biorący do używania"}</h2></div><div className="srodek siatka">
        {t("najemca_nazwa", "Imię i nazwisko / firma")}{t("najemca_telefon", "Telefon")}{t("najemca_adres", "Adres", { pelne: true })}
        {t("najemca_dokument", "Dowód osobisty (seria i nr)")}{t("najemca_prawo_jazdy", "Prawo jazdy (nr)")}{t("najemca_nip", "NIP (firma)")}
      </div></section>

      {f.rodzaj === "najem" && <section className="karta"><div className="tytul"><h2>Warunki najmu</h2></div><div className="srodek siatka">
        {t("stawka_netto", "Stawka netto za dobę (zł)", { typ: "number" })}{t("kaucja", "Kaucja (zł)", { typ: "number" })}
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" style={{ minHeight: 0 }} checked={f.cesja} onChange={(e) => ustawF({ ...f, cesja: e.target.checked })} /> rozliczenie z ubezpieczycielem sprawcy (cesja)</label>
        {rola === "wlasciciel" && f.stawka_netto && doby ? <div className="cichy" style={{ alignSelf: "center" }}>{doby} dób × {zl(f.stawka_netto)} = {zl(doby * f.stawka_netto)} netto</div> : null}
      </div></section>}

      <section className="karta"><div className="tytul"><h2>Stan auta</h2></div><div className="srodek siatka">
        {t("przebieg_wydania", "Przebieg przy wydaniu (km)", { typ: "number" })}{t("paliwo_wydania", "Paliwo przy wydaniu", { ph: "np. pełny bak, 1/2" })}
        {t("stan_wydania", "Uszkodzenia / uwagi przy wydaniu", { pelne: true })}
        {f.id && <>{t("przebieg_zwrotu", "Przebieg przy zwrocie (km)", { typ: "number" })}{t("paliwo_zwrotu", "Paliwo przy zwrocie")}{t("stan_zwrotu", "Uszkodzenia / uwagi przy zwrocie", { pelne: true })}</>}
        {t("uwagi", "Uwagi", { pelne: true })}
      </div></section>
      {auto && <p className="cichy" style={{ margin: 0 }}>{nazwaAuta(auto)}{auto.ubezpieczenie_do && dniDo(auto.ubezpieczenie_do) < 14 ? ` — uwaga: ubezpieczenie do ${auto.ubezpieczenie_do}` : ""}{auto.przeglad_do && dniDo(auto.przeglad_do) < 14 ? ` — przegląd do ${auto.przeglad_do}` : ""}</p>}

      <div className="przyciski">
        <button className="przycisk" onClick={() => zapisz("umowa")}>{f.id ? "Zapisz i pokaż umowę" : "Zapisz i drukuj umowę"}</button>
        <button className="przycisk drugi" onClick={() => zapisz("lista")}>Zapisz</button>
      </div>
    </div>
  );
}

export function Umowa({ wypozyczenieId, przejdz }: Kontekst & { wypozyczenieId: string }) {
  const [w, ustawW] = useState<Wypozyczenie | null>(null);
  const [a, ustawA] = useState<Auto | null>(null);
  const [firma, ustawFirme] = useState<{ firma_nazwa: string; firma_adres: string; firma_nip: string } | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await db.from("wypozyczenia").select("*, zlecenia(numer, nr_rej, nr_szkody)").eq("id", wypozyczenieId).single();
      const x = data as unknown as Wypozyczenie; ustawW(x);
      const [au, u] = await Promise.all([db.from("auta_zastepcze").select("*").eq("id", x.auto_id).single(), db.from("ustawienia").select("firma_nazwa, firma_adres, firma_nip").eq("id", 1).single()]);
      ustawA(au.data as Auto); ustawFirme(u.data as typeof firma);
    })();
  }, [wypozyczenieId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!w || !a || !firma) return null;

  const najem = w.rodzaj === "najem";
  const strona = najem ? "Najemca" : "Biorący";
  const brutto = w.stawka_netto ? Math.round(w.stawka_netto * 123) / 100 : null;
  const linia = (t: string | null | undefined) => t || "........................................";
  const adresFirmy = firma.firma_adres.split("|").join(", ");
  const P = ({ n, children }: { n: number; children: ReactNode }) => <div><h3 style={{ textAlign: "center", fontSize: 14, margin: "14px 0 6px" }}>§ {n}</h3>{children}</div>;
  let n = 0;

  return (
    <div className="kolumna umowa" style={{ maxWidth: 820 }}>
      <div className="przyciski bez-druku">
        <button className="przycisk" onClick={() => window.print()}>Drukuj (2 egzemplarze)</button>
        <button className="przycisk drugi" onClick={() => przejdz({ ekran: "wypozyczenie", wypozyczenieId })}>← Wypożyczenie</button>
        <span className="cichy" style={{ alignSelf: "center" }}>Wzór umowy przygotowany ogólnie — przed pierwszym użyciem daj go do sprawdzenia prawnikowi.</span>
      </div>
      <section className="karta"><div className="srodek" style={{ fontSize: 13, lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ textAlign: "center", fontSize: 18 }}>{najem ? "UMOWA NAJMU POJAZDU ZASTĘPCZEGO" : "UMOWA UŻYCZENIA POJAZDU"} nr {w.numer}</h1>
        <p style={{ textAlign: "center", margin: 0 }}>zawarta w Krakowie dnia {new Date(w.wydanie).toLocaleDateString("pl-PL")} pomiędzy:</p>
        <p><strong>{firma.firma_nazwa}</strong>, {adresFirmy}, NIP {firma.firma_nip}, zwanym dalej <strong>{najem ? "Wynajmującym" : "Użyczającym"}</strong>,<br />
          a <strong>{w.najemca_nazwa}</strong>, {linia(w.najemca_adres)}{w.najemca_nip ? `, NIP ${w.najemca_nip}` : ""}, legitymującym(-ą) się dowodem osobistym {linia(w.najemca_dokument)},
          prawem jazdy nr {linia(w.najemca_prawo_jazdy)}, tel. {linia(w.najemca_telefon)}, zwanym(-ą) dalej <strong>{strona}m</strong>.</p>

        <P n={++n}><p>{najem ? "Wynajmujący oddaje Najemcy do używania" : "Użyczający oddaje Biorącemu do bezpłatnego używania"} samochód osobowy marki {[a.marka, a.model].filter(Boolean).join(" ")},
          nr rej. <strong>{a.nr_rej}</strong>{a.vin ? `, VIN ${a.vin}` : ""}{a.rok ? `, rok produkcji ${a.rok}` : ""}, wraz z dowodem rejestracyjnym, potwierdzeniem ubezpieczenia OC i kluczykami,
          {w.zlecenia ? ` na czas naprawy pojazdu nr rej. ${w.zlecenia.nr_rej ?? ""} (zlecenie ${w.zlecenia.numer}${w.zlecenia.nr_szkody ? `, szkoda nr ${w.zlecenia.nr_szkody}` : ""})` : ""}.</p></P>

        <P n={++n}><p>Umowa zostaje zawarta na okres od {dataGodz(w.wydanie)} do {dataGodz(w.planowany_zwrot)}. Strony mogą przedłużyć okres umowy w formie dokumentowej (np. SMS, e-mail).
          {strona} zobowiązuje się zwrócić pojazd w siedzibie {najem ? "Wynajmującego" : "Użyczającego"} najpóźniej w dniu zakończenia umowy, a także niezwłocznie na wezwanie, gdy naprawa jego pojazdu zostanie zakończona.</p></P>

        {najem && <P n={++n}><p>Czynsz najmu wynosi <strong>{w.stawka_netto ? `${zl(w.stawka_netto)} netto (${zl(brutto)} brutto)` : "........ zł netto"}</strong> za każdą rozpoczętą dobę najmu.
          {w.kaucja ? ` Najemca wpłaca kaucję w wysokości ${zl(w.kaucja)}, zwracaną po zwrocie pojazdu w stanie niepogorszonym, po potrąceniu należności wynikających z umowy.` : ""}
          {w.cesja ? " Strony ustalają, że należność z tytułu najmu może zostać rozliczona bezpośrednio z zakładem ubezpieczeń odpowiedzialnym za szkodę, na podstawie odrębnej umowy przelewu wierzytelności (cesji). W zakresie, w jakim ubezpieczyciel odmówi zapłaty, należność pokrywa Najemca." : " Należność płatna na podstawie faktury VAT w terminie w niej wskazanym."}</p></P>}

        <P n={++n}><p>{strona} zobowiązuje się: używać pojazdu zgodnie z jego przeznaczeniem i z należytą starannością; nie oddawać pojazdu osobom trzecim ani go nie podnajmować;
          nie wyjeżdżać poza granice Polski bez pisemnej zgody; nie palić tytoniu w pojeździe; nie prowadzić pojazdu pod wpływem alkoholu lub środków odurzających; tankować paliwo właściwego rodzaju;
          niezwłocznie zawiadomić o każdej szkodzie, awarii, kradzieży lub zdarzeniu drogowym, a w razie zdarzenia z udziałem innego pojazdu — spisać oświadczenie sprawcy lub wezwać Policję.</p></P>

        <P n={++n}><p>{strona} ponosi odpowiedzialność za szkody powstałe w pojeździe w okresie umowy, w zakresie nieobjętym ubezpieczeniem pojazdu lub z niego wyłączonym
          (w szczególności szkody spowodowane umyślnie, pod wpływem alkoholu albo przez osobę nieuprawnioną), oraz za mandaty, opłaty za parkowanie i przejazdy w tym okresie.
          Za każdą rozpoczętą dobę opóźnienia w zwrocie pojazdu {najem ? "Najemca zapłaci czynsz w wysokości jak w § 3" : "Biorący zapłaci kwotę ........ zł"}.</p></P>

        <P n={++n}><p>Pojazd zostanie zwrócony w stanie niepogorszonym ponad normalne zużycie, z tą samą ilością paliwa co przy wydaniu; brakujące paliwo zostanie doliczone według ceny z dnia zwrotu.
          Stan pojazdu przy wydaniu i zwrocie strony potwierdzają w protokole poniżej, stanowiącym część umowy.</p></P>

        <P n={++n}><p>W sprawach nieuregulowanych stosuje się przepisy Kodeksu cywilnego {najem ? "o najmie (art. 659 i nast.)" : "o użyczeniu (art. 710 i nast.)"}.
          Dane osobowe {strona === "Najemca" ? "Najemcy" : "Biorącego"} są przetwarzane w celu zawarcia i wykonania umowy (art. 6 ust. 1 lit. b RODO); administratorem jest {firma.firma_nazwa}.
          Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.</p></P>

        <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Protokół zdawczo-odbiorczy</h3>
        <table style={{ fontSize: 12 }}><thead><tr><th></th><th>Wydanie</th><th>Zwrot</th></tr></thead><tbody>
          <tr><td>Data i godzina</td><td>{dataGodz(w.wydanie)}</td><td>{w.zwrot ? dataGodz(w.zwrot) : ""}</td></tr>
          <tr><td>Przebieg (km)</td><td>{w.przebieg_wydania?.toLocaleString("pl-PL") ?? ""}</td><td>{w.przebieg_zwrotu?.toLocaleString("pl-PL") ?? ""}</td></tr>
          <tr><td>Paliwo</td><td>{w.paliwo_wydania ?? ""}</td><td>{w.paliwo_zwrotu ?? ""}</td></tr>
          <tr><td>Uszkodzenia, uwagi</td><td style={{ height: 48 }}>{w.stan_wydania ?? ""}</td><td>{w.stan_zwrotu ?? ""}</td></tr>
          <tr><td>Dokumenty, kluczyki</td><td>dowód rej., polisa OC, kluczyki: ....</td><td></td></tr>
        </tbody></table>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 48, gap: 40 }}>
          <div style={{ flex: 1, borderTop: "1px solid #000", textAlign: "center", paddingTop: 4 }}>{najem ? "Wynajmujący" : "Użyczający"}</div>
          <div style={{ flex: 1, borderTop: "1px solid #000", textAlign: "center", paddingTop: 4 }}>{strona}</div>
        </div>
      </div></section>
    </div>
  );
}

