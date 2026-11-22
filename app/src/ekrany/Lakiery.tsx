// Lakiery dorabiane u dostawców pod konkretne auto: przypisanie pozycji z faktur do zlecenia.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db, normRej, zl } from "../supabase.ts";

interface Lakier {
  pozycja_id: string; faktura: string; data: string; dostawca: string | null; teksty: string[] | null;
  nazwa: string; ilosc: number | null; jednostka: string | null; wartosc: number;
  zlecenie_id: string | null; zlecenie: string | null; nr_rej: string | null; marka: string | null; model: string | null;
  status: "zlecenie" | "ogolny" | "do_przypisania";
}
interface Zl { id: string; numer: string; nr_rej: string | null; marka: string | null; model: string | null; data_przyjecia: string; data_wydania: string | null; status: string }

const dni = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 864e5;
const etykieta = (z: Zl) => `${z.numer} · ${[z.marka, z.model].filter(Boolean).join(" ")} · ${z.nr_rej ?? ""}`;

/** Zlecenia pasujące do zakupu: rejestracja w opisie faktury, potem auta na warsztacie w dniu zakupu. */
function propozycje(l: Lakier, zlecenia: Zl[]): Zl[] {
  const tekst = normRej([l.nazwa, ...(l.teksty ?? [])].join(" ")) ?? "";
  const zRej = zlecenia.filter((z) => z.nr_rej && normRej(z.nr_rej)!.length >= 5 && tekst.includes(normRej(z.nr_rej)!));
  const naWarsztacie = zlecenia.filter((z) => dni(l.data, z.data_przyjecia) >= -2 && (!z.data_wydania || dni(z.data_wydania, l.data) >= -1))
    .sort((a, b) => Math.abs(dni(l.data, a.data_przyjecia)) - Math.abs(dni(l.data, b.data_przyjecia)));
  return [...new Map([...zRej, ...naWarsztacie].map((z) => [z.id, z])).values()].slice(0, 8);
}

export function Lakiery(_: Kontekst) {
  const [lista, ustawListe] = useState<Lakier[] | null>(null);
  const [zlecenia, ustawZlecenia] = useState<Zl[]>([]);
  const [status, ustawStatus] = useState<"do_przypisania" | "zlecenie" | "ogolny" | "">("do_przypisania");
  const [wybor, ustawWybor] = useState<Record<string, string>>({});
  const [zaznaczone, ustawZaznaczone] = useState<Set<string>>(new Set());
  const [zbiorczo, ustawZbiorczo] = useState("");
  const [blad, ustawBlad] = useState<string | null>(null);

  const wczytaj = useCallback(async () => {
    const [l, z] = await Promise.all([
      db.from("lakiery_zakupy").select("*").order("data", { ascending: false }).limit(2000),
      db.from("zlecenia").select("id, numer, nr_rej, marka, model, data_przyjecia, data_wydania, status").neq("status", "anulowane")
        .order("data_przyjecia", { ascending: false }).limit(1000),
    ]);
    if (l.error) { ustawBlad(l.error.message); return; }
    ustawListe(l.data as Lakier[]); ustawZlecenia((z.data ?? []) as Zl[]);
  }, []);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  async function ustaw(ids: string[], zlecenieId: string | null, ogolny = false) {
    const { data: u } = await db.auth.getUser();
    const zmiana = zlecenieId || ogolny
      ? { zlecenie_id: zlecenieId, kategoria: "lakier", sposob: "reczne", pewnosc: 1, zatwierdzono: new Date().toISOString(), zatwierdzil: u.user?.id ?? null }
      : { zlecenie_id: null, sposob: "brak", pewnosc: 0, zatwierdzono: null, zatwierdzil: null };
    const { error } = await db.from("pozycje_faktur").update(zmiana).in("id", ids);
    ustawBlad(error ? `Nie zapisano: ${error.message}` : null);
    ustawZaznaczone(new Set()); await wczytaj();
  }

  const widoczne = (lista ?? []).filter((l) => !status || l.status === status);
  const miesiac = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const tenMiesiac = (lista ?? []).filter((l) => l.data.startsWith(miesiac));
  const suma = (xs: Lakier[]) => xs.reduce((a, l) => a + Number(l.wartosc), 0);
  const ileDo = (lista ?? []).filter((l) => l.status === "do_przypisania");
  const aktywne = useMemo(() => zlecenia.filter((z) => z.status !== "wydane"), [zlecenia]);

  const wyborZlecenia = (wartosc: string, zmien: (v: string) => void, prop: Zl[]) => (
    <select aria-label="Zlecenie" value={wartosc} onChange={(e) => zmien(e.target.value)} style={{ maxWidth: 320 }}>
      <option value="">— zlecenie —</option>
      {prop.length > 0 && <optgroup label="Pasujące">{prop.map((z) => <option key={z.id} value={z.id}>{etykieta(z)}</option>)}</optgroup>}
      <optgroup label="Na warsztacie">{aktywne.map((z) => <option key={z.id} value={z.id}>{etykieta(z)}</option>)}</optgroup>
      <optgroup label="Wydane">{zlecenia.filter((z) => z.status === "wydane").slice(0, 200).map((z) => <option key={z.id} value={z.id}>{etykieta(z)}</option>)}</optgroup>
    </select>
  );

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>Lakiery</h1>
          <p className="podtytul">Lakiery dorabiane u dostawców pod konkretne auto (kupowane na litry). Przypisany lakier liczy się w koszcie zlecenia; bazy do własnego mieszalnika tu nie trafiają.</p></div>
        <div className="przyciski">
          {([["do_przypisania", `Do przypisania (${ileDo.length})`], ["zlecenie", "Na zleceniach"], ["ogolny", "Koszt ogólny"], ["", "Wszystkie"]] as const).map(([k, t]) =>
            <button key={k} className={`przycisk ${status === k ? "" : "drugi"}`} onClick={() => ustawStatus(k)}>{t}</button>)}
        </div>
      </div>
      {blad && <div className="blad">{blad}</div>}

      <section className="karta"><div className="srodek siatka">
        <div><div className="cichy">Do przypisania</div><strong style={{ fontSize: 20 }} className={ileDo.length ? "minus" : ""}>{zl(suma(ileDo))}</strong><div className="cichy">{ileDo.length} pozycji</div></div>
        <div><div className="cichy">Ten miesiąc — na zleceniach</div><strong style={{ fontSize: 20 }}>{zl(suma(tenMiesiac.filter((l) => l.status === "zlecenie")))}</strong></div>
        <div><div className="cichy">Ten miesiąc — razem</div><strong style={{ fontSize: 20 }}>{zl(suma(tenMiesiac))}</strong></div>
      </div></section>

      <section className="karta">
        {zaznaczone.size > 0 && <div className="tytul">
          <span className="cichy">Zaznaczono {zaznaczone.size} · {zl(suma((lista ?? []).filter((l) => zaznaczone.has(l.pozycja_id))))}</span>
          <div className="przyciski" style={{ alignItems: "center" }}>
            {wyborZlecenia(zbiorczo, ustawZbiorczo, [])}
            <button className="przycisk" disabled={!zbiorczo} onClick={() => ustaw([...zaznaczone], zbiorczo)}>Przypisz zaznaczone</button>
            <button className="przycisk drugi" onClick={() => ustaw([...zaznaczone], null, true)}>Jako koszt ogólny</button>
          </div>
        </div>}
        {lista && widoczne.length === 0 ? <div className="pusto">{status === "do_przypisania" ? "Wszystkie lakiery są przypisane." : "Brak pozycji."}</div> : (
          <div className="przewijanie"><table style={{ minWidth: 960 }}>
            <thead><tr><th></th><th>Data</th><th>Lakier</th><th className="liczba">Ilość</th><th className="liczba">Netto</th><th>Zlecenie</th><th></th></tr></thead>
            <tbody>{widoczne.map((l) => {
              const prop = l.status === "do_przypisania" ? propozycje(l, zlecenia) : [];
              const w = wybor[l.pozycja_id] ?? prop[0]?.id ?? "";
              return (
                <tr key={l.pozycja_id}>
                  <td><input type="checkbox" aria-label={`Zaznacz ${l.nazwa}`} style={{ minHeight: 0 }} checked={zaznaczone.has(l.pozycja_id)}
                    onChange={(e) => { const s = new Set(zaznaczone); if (e.target.checked) s.add(l.pozycja_id); else s.delete(l.pozycja_id); ustawZaznaczone(s); }} /></td>
                  <td>{l.data}<div className="cichy">{l.faktura}</div></td>
                  <td>{l.nazwa}<div className="cichy">{l.dostawca}{l.teksty?.length ? ` · ${l.teksty.join(" · ")}` : ""}</div></td>
                  <td className="liczba">{Number(l.ilosc ?? 0).toLocaleString("pl-PL")} {l.jednostka}</td>
                  <td className="liczba">{zl(Number(l.wartosc))}</td>
                  <td>{l.status === "zlecenie" ? <><strong>{l.zlecenie}</strong><div className="cichy">{[l.marka, l.model].filter(Boolean).join(" ")} · {l.nr_rej}</div></>
                    : l.status === "ogolny" ? <span className="znacznik">koszt ogólny</span>
                    : wyborZlecenia(w, (v) => ustawWybor({ ...wybor, [l.pozycja_id]: v }), prop)}</td>
                  <td><div className="przyciski">
                    {l.status === "do_przypisania" ? <>
                      <button className="przycisk" disabled={!w} onClick={() => ustaw([l.pozycja_id], w)}>Przypisz</button>
                      <button className="przycisk drugi" title="Lakier nie do konkretnego auta: wchodzi w miesięczny koszt lakieru" onClick={() => ustaw([l.pozycja_id], null, true)}>Ogólny</button>
                    </> : <button className="przycisk drugi" onClick={() => ustaw([l.pozycja_id], null)}>Cofnij</button>}
                  </div></td>
                </tr>);
            })}</tbody>
          </table></div>)}
      </section>
      <p className="cichy" style={{ margin: 0 }}>Propozycja zlecenia: rejestracja z opisu na fakturze, a bez niej auta, które były na warsztacie w dniu zakupu. Poproś dostawców, żeby przy dorabianym lakierze wpisywali rejestrację — wtedy propozycja jest pewna.</p>
    </div>
  );
}
