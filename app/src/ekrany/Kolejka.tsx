// Kolejka do sprawdzenia: pozycje faktur zakupowych, których system nie przypisał sam.
// Każda decyzja to jedno kliknięcie; opcjonalnie zapamiętuje regułę dla dostawcy.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db, zl } from "../supabase.ts";

interface Pozycja {
  id: string; faktura_id: string; lp: number; nazwa: string; indeks: string | null; wartosc: number | null; netto: number;
  kategoria: string; propozycje: string[]; numer_faktury: string; nazwa_kontrahenta: string | null;
  nip_kontrahenta: string | null; data_wystawienia: string;
}
interface ZlecenieKrotko { id: string; numer: string; nr_rej: string | null; marka: string | null; model: string | null }

const KATEGORIE = [
  { k: "lakier", etykieta: "Lakier" },
  { k: "material", etykieta: "Materiał" },
  { k: "koszt_ogolny", etykieta: "Koszt ogólny" },
] as const;

export function Kolejka({ poZmianie }: Kontekst & { poZmianie: () => void }) {
  const [pozycje, ustawPozycje] = useState<Pozycja[] | null>(null);
  const [zlecenia, ustawZlecenia] = useState<ZlecenieKrotko[]>([]);
  const [wybor, ustawWybor] = useState<Record<string, string>>({});
  const [zapamietaj, ustawZapamietaj] = useState<Record<string, boolean>>({});
  const [blad, ustawBlad] = useState<string | null>(null);

  const wczytaj = useCallback(async () => {
    const [p, z] = await Promise.all([
      db.from("kolejka_pozycji").select("*").order("data_wystawienia").order("lp").limit(200),
      db.from("zlecenia").select("id, numer, nr_rej, marka, model").neq("status", "anulowane").order("utworzono", { ascending: false }).limit(300),
    ]);
    if (p.error || z.error) { ustawBlad("Nie udało się wczytać kolejki."); return; }
    ustawPozycje(p.data as Pozycja[]);
    ustawZlecenia(z.data as ZlecenieKrotko[]);
  }, []);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  const poId = useMemo(() => new Map(zlecenia.map((z) => [z.id, z])), [zlecenia]);
  const opis = (z?: ZlecenieKrotko) => z ? `${z.numer} · ${[z.marka, z.model].filter(Boolean).join(" ")} · ${z.nr_rej ?? ""}` : "";

  async function zatwierdz(p: Pozycja, zmiany: { zlecenie_id: string | null; kategoria: string }) {
    ustawBlad(null);
    const { data: u } = await db.auth.getUser();
    const { error } = await db.from("pozycje_faktur").update({
      ...zmiany, sposob: "reczne", pewnosc: 1, zatwierdzil: u.user?.id, zatwierdzono: new Date().toISOString(),
    }).eq("id", p.id);
    if (error) { ustawBlad(`Nie zapisano: ${error.message}`); return; }

    // Reguła dla dostawcy: ta sama kategoria dla jego kolejnych faktur (tylko gdy bez auta)
    if (zapamietaj[p.id] && !zmiany.zlecenie_id && p.nip_kontrahenta) {
      await db.from("reguly").insert({ nip_dostawcy: p.nip_kontrahenta, wzorzec: null, kategoria: zmiany.kategoria,
        rozdzielaj_miesiecznie: zmiany.kategoria !== "koszt_ogolny" });
      // Od razu porządkuje pozostałe pozycje tego dostawcy bez propozycji auta
      const reszta = (pozycje ?? []).filter((x) => x.id !== p.id && x.nip_kontrahenta === p.nip_kontrahenta && x.propozycje.length === 0);
      if (reszta.length) {
        await db.from("pozycje_faktur").update({ kategoria: zmiany.kategoria, sposob: "regula", pewnosc: 0.95,
          zatwierdzil: u.user?.id, zatwierdzono: new Date().toISOString() }).in("id", reszta.map((x) => x.id));
      }
    }
    await wczytaj();
    poZmianie();
  }

  const pojedyncze = (pozycje ?? []).filter((p) => p.propozycje.length === 1);
  async function zatwierdzWszystkiePropozycje() {
    for (const p of pojedyncze) await zatwierdz(p, { zlecenie_id: p.propozycje[0], kategoria: p.kategoria === "nieustalona" ? "czesc" : p.kategoria });
  }

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div>
          <h1>Do sprawdzenia</h1>
          <p className="podtytul">{pozycje === null ? "Wczytywanie…" : `${pozycje.length} pozycji faktur bez pewnego przypisania`}</p>
        </div>
        {pojedyncze.length > 0 && (
          <button className="przycisk drugi" onClick={zatwierdzWszystkiePropozycje}>Zatwierdź wszystkie propozycje ({pojedyncze.length})</button>
        )}
      </div>
      {blad && <div className="blad" role="alert">{blad}</div>}

      <section className="karta" aria-label="Pozycje faktur">
        {pozycje && pozycje.length === 0 ? (
          <div className="pusto">Kolejka pusta. Wszystkie koszty są przypisane.</div>
        ) : (
          <div className="przewijanie">
            <table style={{ minWidth: 980 }}>
              <thead><tr><th>Faktura</th><th>Pozycja</th><th className="liczba">Netto</th><th>Zlecenie</th><th>Decyzja</th></tr></thead>
              <tbody>
                {(pozycje ?? []).map((p) => {
                  const wybrane = wybor[p.id] ?? p.propozycje[0] ?? "";
                  return (
                    <tr key={p.id}>
                      <td><div style={{ fontWeight: 500 }}>{p.nazwa_kontrahenta ?? p.nip_kontrahenta}</div>
                        <div className="cichy">{p.numer_faktury} · {p.data_wystawienia}</div></td>
                      <td>{p.nazwa}{p.indeks && <div className="cichy">{p.indeks}</div>}
                        {p.kategoria !== "nieustalona" && <div><span className="znacznik">{p.kategoria}</span></div>}</td>
                      <td className="liczba">{zl(p.wartosc ?? p.netto)}</td>
                      <td style={{ minWidth: 240 }}>
                        <label style={{ fontWeight: 400 }}>
                          <span className="cichy">{p.propozycje.length ? `Propozycja systemu (${p.propozycje.length})` : "Wybierz auto"}</span>
                          <select value={wybrane} onChange={(e) => ustawWybor({ ...wybor, [p.id]: e.target.value })}>
                            <option value="">— bez auta —</option>
                            {p.propozycje.filter((id) => poId.has(id)).map((id) => <option key={id} value={id}>★ {opis(poId.get(id))}</option>)}
                            {zlecenia.filter((z) => !p.propozycje.includes(z.id)).map((z) => <option key={z.id} value={z.id}>{opis(z)}</option>)}
                          </select>
                        </label>
                      </td>
                      <td>
                        <div className="przyciski">
                          <button className="przycisk" disabled={!wybrane}
                            onClick={() => zatwierdz(p, { zlecenie_id: wybrane, kategoria: p.kategoria === "nieustalona" ? "czesc" : p.kategoria })}>
                            Do zlecenia
                          </button>
                          {KATEGORIE.map((c) => (
                            <button key={c.k} className="przycisk drugi" onClick={() => zatwierdz(p, { zlecenie_id: null, kategoria: c.k })}>{c.etykieta}</button>
                          ))}
                        </div>
                        {p.nip_kontrahenta && (
                          <label style={{ flexDirection: "row", alignItems: "center", fontWeight: 400, marginTop: 6 }} className="cichy">
                            <input type="checkbox" style={{ minHeight: 0 }} checked={!!zapamietaj[p.id]}
                              onChange={(e) => ustawZapamietaj({ ...zapamietaj, [p.id]: e.target.checked })} />
                            zapamiętaj kategorię dla tego dostawcy
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
