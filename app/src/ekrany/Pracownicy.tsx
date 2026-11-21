// Pracownicy warsztatu i ich wyniki: zlecenia, RBH i robocizna z kosztorysów, w wybranym okresie.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db, zl } from "../supabase.ts";

export interface Pracownik { id: string; imie: string; specjalizacja: string; aktywny: boolean }
export const ROLE: Record<string, string> = {
  blacharz: "Blacharz", lakiernik: "Lakiernik", przygotowanie: "Przygotowanie", mechanik: "Mechanik", inne: "Inne",
};
interface Udzial { pracownik_id: string; zlecenie_id: string; rola: string; numer: string; status: string; data: string; rbh: number | null; robocizna: number | null }

const dzis = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function Pracownicy(_: Kontekst) {
  const [lista, ustawListe] = useState<Pracownik[]>([]);
  const [udzialy, ustawUdzialy] = useState<Udzial[]>([]);
  const [od, ustawOd] = useState(iso(new Date(dzis.getFullYear(), dzis.getMonth(), 1)));
  const [do_, ustawDo] = useState(iso(dzis));
  const [nowy, ustawNowy] = useState({ imie: "", specjalizacja: "blacharz" });
  const [blad, ustawBlad] = useState<string | null>(null);
  const [rozwiniety, ustawRozwiniety] = useState<string | null>(null);

  const wczytaj = useCallback(async () => {
    const [p, u] = await Promise.all([
      db.from("pracownicy").select("id, imie, specjalizacja, aktywny").order("aktywny", { ascending: false }).order("imie"),
      db.from("udzial_pracownikow").select("*").gte("data", od).lte("data", do_),
    ]);
    ustawListe((p.data ?? []) as Pracownik[]);
    ustawUdzialy((u.data ?? []) as Udzial[]);
  }, [od, do_]);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  async function zmien(id: string, zmiana: Partial<Pracownik>) {
    const { error } = await db.from("pracownicy").update(zmiana).eq("id", id);
    ustawBlad(error ? error.message : null);
    await wczytaj();
  }
  async function dodaj() {
    if (!nowy.imie.trim()) return;
    const { error } = await db.from("pracownicy").insert({ imie: nowy.imie.trim(), specjalizacja: nowy.specjalizacja });
    ustawBlad(error ? error.message : null);
    ustawNowy({ ...nowy, imie: "" });
    await wczytaj();
  }

  const statystyki = useMemo(() => {
    const m = new Map<string, { zlecenia: Set<string>; rbh: number; robocizna: number; wydane: Set<string> }>();
    for (const u of udzialy) {
      const s = m.get(u.pracownik_id) ?? { zlecenia: new Set(), rbh: 0, robocizna: 0, wydane: new Set() };
      s.zlecenia.add(u.zlecenie_id);
      if (u.status === "wydane") s.wydane.add(u.zlecenie_id);
      s.rbh += u.rbh ?? 0;
      s.robocizna += u.robocizna ?? 0;
      m.set(u.pracownik_id, s);
    }
    return m;
  }, [udzialy]);

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>Pracownicy</h1>
          <p className="podtytul">RBH i robocizna z obowiązującego kosztorysu zlecenia, dzielone po równo między osoby w tej samej roli. Okres liczony po dacie wydania (a bez niej — przyjęcia).</p></div>
        <div className="przyciski">
          <label>Od<input type="date" value={od} onChange={(e) => ustawOd(e.target.value)} /></label>
          <label>Do<input type="date" value={do_} onChange={(e) => ustawDo(e.target.value)} /></label>
        </div>
      </div>
      {blad && <div className="blad">{blad}</div>}

      <section className="karta">
        {lista.length === 0 ? <div className="pusto">Dodaj pracowników poniżej, potem przypisuj ich w zleceniu.</div> : (
          <div className="przewijanie"><table style={{ minWidth: 820 }}>
            <thead><tr><th>Pracownik</th><th>Specjalizacja</th><th className="liczba">Zleceń</th><th className="liczba">Wydanych</th>
              <th className="liczba">RBH</th><th className="liczba">Robocizna netto</th><th className="liczba">RBH / zlecenie</th><th></th></tr></thead>
            <tbody>{lista.map((p) => {
              const s = statystyki.get(p.id);
              const n = s?.zlecenia.size ?? 0;
              return (<Fragment key={p.id}>
                <tr style={p.aktywny ? undefined : { opacity: 0.55 }}>
                  <td><input aria-label="Imię" defaultValue={p.imie} onBlur={(e) => e.target.value.trim() && e.target.value !== p.imie && zmien(p.id, { imie: e.target.value.trim() })} /></td>
                  <td><select aria-label="Specjalizacja" value={p.specjalizacja} onChange={(e) => zmien(p.id, { specjalizacja: e.target.value })}>
                    {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                  <td className="liczba">{n}</td>
                  <td className="liczba">{s?.wydane.size ?? 0}</td>
                  <td className="liczba">{s ? s.rbh.toLocaleString("pl-PL", { maximumFractionDigits: 1 }) : "—"}</td>
                  <td className="liczba">{s ? zl(s.robocizna) : "—"}</td>
                  <td className="liczba">{n ? (s!.rbh / n).toLocaleString("pl-PL", { maximumFractionDigits: 1 }) : "—"}</td>
                  <td><div className="przyciski">
                    {n > 0 && <button className="przycisk drugi" onClick={() => ustawRozwiniety(rozwiniety === p.id ? null : p.id)}>{rozwiniety === p.id ? "Zwiń" : "Zlecenia"}</button>}
                    <button className="przycisk drugi" onClick={() => zmien(p.id, { aktywny: !p.aktywny })}>{p.aktywny ? "Dezaktywuj" : "Przywróć"}</button>
                  </div></td>
                </tr>
                {rozwiniety === p.id && <tr><td colSpan={8}>
                  {udzialy.filter((u) => u.pracownik_id === p.id).map((u) => (
                    <div key={u.zlecenie_id + u.rola} className="cichy">{u.numer} · {ROLE[u.rola]} · {u.data} · {u.rbh?.toLocaleString("pl-PL") ?? "—"} RBH · {zl(u.robocizna)}</div>))}
                </td></tr>}
              </Fragment>);
            })}</tbody>
          </table></div>)}
        <div className="srodek" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--linia)" }}>
          <label>Nowy pracownik<input value={nowy.imie} onChange={(e) => ustawNowy({ ...nowy, imie: e.target.value })} placeholder="Imię i nazwisko" /></label>
          <label>Specjalizacja<select value={nowy.specjalizacja} onChange={(e) => ustawNowy({ ...nowy, specjalizacja: e.target.value })}>
            {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <button className="przycisk" onClick={dodaj}>Dodaj</button>
        </div>
      </section>
    </div>
  );
}
