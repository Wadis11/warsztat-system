// Lista zleceń. Właściciel widzi przychód i koszty przypisane z faktur; pracownik tylko dane auta i status.
import { useEffect, useState } from "react";
import { type Kontekst, widziKwoty } from "../App.tsx";
import { db, zl } from "../supabase.ts";
import { type Klient, SEGMENTY } from "./WyborKlienta.tsx";

interface Wiersz {
  id: string; numer: string; nr_rej: string | null; marka: string | null; model: string | null; status: string;
  data_przyjecia: string; klient_id?: string | null; klient?: string | null; segment?: string | null; wersja_kosztorysu?: string | null;
  przychod_kosztorys?: number | null; przychod_faktura?: number | null; rbh?: number | null;
  koszt_czesci?: number | null; koszt_lakier_materialy?: number | null; pozycji_kosztowych?: number | null;
}
const STATUSY: Record<string, string> = { umowione: "Umówione", przyjete: "Przyjęte", w_naprawie: "W naprawie", gotowe: "Gotowe", wydane: "Wydane", anulowane: "Anulowane" };

export function Zlecenia({ rola, przejdz }: Kontekst) {
  const [wiersze, ustawWiersze] = useState<Wiersz[] | null>(null);
  const [szukaj, ustawSzukaj] = useState("");
  const [klienci, ustawKlientow] = useState<Klient[]>([]);
  const [filtr, ustawFiltr] = useState({ segment: "", klient: "", status: "otwarte" });
  const wlasciciel = widziKwoty(rola);

  async function wczytaj() {
    const { data } = wlasciciel
      ? await db.from("zlecenia_wyniki").select("*").order("data_przyjecia", { ascending: false }).limit(300)
      : await db.from("zlecenia").select("id, numer, nr_rej, marka, model, status, data_przyjecia").order("data_przyjecia", { ascending: false }).limit(300);
    ustawWiersze((data ?? []) as Wiersz[]);
    if (wlasciciel) {
      const k = await db.from("klienci").select("id, nazwa, segment").order("nazwa");
      ustawKlientow((k.data ?? []) as Klient[]);
    }
  }

  async function zmienKlienta(id: string, klientId: string) {
    await db.from("zlecenia").update({ klient_id: klientId || null }).eq("id", id);
    await wczytaj();
  }
  useEffect(() => { wczytaj(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function zmienStatus(id: string, status: string) {
    const zmiana: Record<string, string | null> = { status };
    if (status === "wydane") zmiana.data_wydania = new Date().toISOString().slice(0, 10);
    if (status === "przyjete") zmiana.data_przyjecia = new Date().toLocaleDateString("sv-SE");
    await db.from("zlecenia").update(zmiana).eq("id", id);
    await wczytaj();
  }

  const q = szukaj.toUpperCase().replace(/\s/g, "");
  const OTWARTE = ["umowione", "przyjete", "w_naprawie", "gotowe"];
  const widoczne = (wiersze ?? []).filter((w) =>
    (!filtr.status || (filtr.status === "otwarte" ? OTWARTE.includes(w.status) : w.status === filtr.status)) &&
    (!filtr.segment || w.segment === filtr.segment) && (!filtr.klient || w.klient_id === filtr.klient)).filter((w) => !q || `${w.numer}${w.nr_rej}${w.marka}${w.model}${w.klient ?? ""}`.toUpperCase().replace(/\s/g, "").includes(q));

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>Zlecenia</h1>
          <p className="podtytul">{wlasciciel ? "Marża przed robocizną = przychód − części − lakier i materiały przypisane z faktur." : "Aktualne zlecenia warsztatu."}</p></div>
      </div>
      <div className="przyciski" style={{ alignItems: "flex-end" }}>
        <label>Szukaj<input type="search" placeholder="numer, rejestracja, marka" value={szukaj} onChange={(e) => ustawSzukaj(e.target.value)} /></label>
        <label>Status<select value={filtr.status} onChange={(e) => ustawFiltr({ ...filtr, status: e.target.value })}>
          <option value="otwarte">Otwarte</option><option value="">Wszystkie</option>
          {Object.entries(STATUSY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {wlasciciel && <>
          <label>Rodzaj klienta<select value={filtr.segment} onChange={(e) => ustawFiltr({ ...filtr, segment: e.target.value, klient: "" })}>
            <option value="">Wszyscy</option>
            {Object.entries(SEGMENTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Klient<select value={filtr.klient} onChange={(e) => ustawFiltr({ ...filtr, klient: e.target.value })}>
            <option value="">Wszyscy</option>
            {klienci.filter((k) => !filtr.segment || k.segment === filtr.segment).map((k) => <option key={k.id} value={k.id}>{k.nazwa}</option>)}</select></label>
        </>}
        <span className="cichy" style={{ alignSelf: "center" }}>{widoczne.length} zleceń{wlasciciel && widoczne.length > 0 && (() => {
          const p = widoczne.reduce((a, w) => a + (w.przychod_faktura ?? w.przychod_kosztorys ?? 0), 0);
          const k = widoczne.reduce((a, w) => a + (w.koszt_czesci ?? 0) + (w.koszt_lakier_materialy ?? 0), 0);
          return ` · przychód ${zl(p)} · koszty z faktur ${zl(k)} · marża przed robocizną ${zl(p - k)}`;
        })()}</span>
      </div>
      <section className="karta">
        {wiersze && widoczne.length === 0 ? <div className="pusto">Brak zleceń. Załóż pierwsze przez „Wgraj kosztorys” albo „Nowe zlecenie”.</div> : (
          <div className="przewijanie"><table style={{ minWidth: wlasciciel ? 1100 : 700 }}>
            <thead><tr>
              <th>Zlecenie</th><th>Status</th>
              {wlasciciel && <><th>Klient</th><th className="liczba">Przychód</th><th className="liczba">Części</th><th className="liczba">Lakier i mat.</th><th className="liczba">Marża przed robocizną</th><th className="liczba">RBH</th></>}
              <th></th>
            </tr></thead>
            <tbody>{widoczne.map((w) => {
              const przychod = w.przychod_faktura ?? w.przychod_kosztorys ?? null;
              const marza = przychod === null ? null : przychod - (w.koszt_czesci ?? 0) - (w.koszt_lakier_materialy ?? 0);
              return (
                <tr key={w.id}>
                  <td><button className="link" onClick={() => przejdz({ ekran: "zlecenie", zlecenieId: w.id })}><strong>{w.numer}</strong></button><div className="cichy">{[w.marka, w.model].filter(Boolean).join(" ")} · {w.nr_rej} · {w.data_przyjecia}</div></td>
                  <td><select aria-label={`Status ${w.numer}`} value={w.status} onChange={(e) => zmienStatus(w.id, e.target.value)}>
                    {Object.entries(STATUSY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></td>
                  {wlasciciel && <>
                    <td><select aria-label={`Klient ${w.numer}`} value={w.klient_id ?? ""} onChange={(e) => zmienKlienta(w.id, e.target.value)}>
                      <option value="">— brak —</option>
                      {klienci.map((k) => <option key={k.id} value={k.id}>{k.nazwa}</option>)}
                    </select>{w.segment && <div className="cichy">{SEGMENTY[w.segment]}</div>}</td>
                    <td className="liczba">{zl(przychod)}<div className="cichy">{w.przychod_faktura !== null && w.przychod_faktura !== undefined ? "z faktury" : w.wersja_kosztorysu ? `kosztorys: ${w.wersja_kosztorysu}` : ""}</div></td>
                    <td className="liczba">{zl(w.koszt_czesci)}</td>
                    <td className="liczba">{zl(w.koszt_lakier_materialy)}</td>
                    <td className={`liczba ${marza !== null && marza < 0 ? "minus" : ""}`}>{zl(marza)}</td>
                    <td className="liczba">{w.rbh ? w.rbh.toLocaleString("pl-PL") : "—"}</td>
                  </>}
                  <td><div className="przyciski">
                    <button className="przycisk drugi" onClick={() => przejdz({ ekran: "zlecenie", zlecenieId: w.id })}>Otwórz</button>
                    <button className="przycisk drugi" onClick={() => przejdz({ ekran: "karta", zlecenieId: w.id })}>Karta pracy</button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
