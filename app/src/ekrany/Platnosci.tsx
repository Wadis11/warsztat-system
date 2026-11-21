// Płatności: faktury zakupu z KSeF do zapłaty — terminy, dane do przelewu, biała lista VAT, kalendarz.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db, zl } from "../supabase.ts";

interface Platnosc {
  id: string; numer: string; nip_kontrahenta: string | null; nazwa_kontrahenta: string | null; data_wystawienia: string;
  rodzaj: string | null; vat: number; brutto: number; do_zaplaty: number | null; waluta: string; termin_platnosci: string | null;
  forma_platnosci: number | null; rachunek: string | null; bank: string | null; rachunek_wirtualny: boolean; mpp: boolean;
  oplacono: string | null; bl_wynik: string | null; bl_sprawdzono: string | null; bl_id: string | null;
  status: string; dni_do_terminu: number | null;
}

const dzisIso = () => new Date().toLocaleDateString("sv-SE"); // RRRR-MM-DD w czasie lokalnym
const nrb = (r: string | null) => (r ? r.replace(/^(\d{2})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})$/, "$1 $2 $3 $4 $5 $6 $7") : "—");
const kwota = (n: number) => n.toFixed(2).replace(".", ",");
const DNI = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const MIESIACE = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

function opisTerminu(p: Platnosc) {
  if (!p.termin_platnosci) return { tekst: "brak terminu", klasa: "uwaga" };
  const d = p.dni_do_terminu ?? 0;
  if (d < 0) return { tekst: `${-d} dni po terminie`, klasa: "minus" };
  if (d === 0) return { tekst: "dziś", klasa: "minus" };
  if (d <= 7) return { tekst: `za ${d} ${d === 1 ? "dzień" : "dni"}`, klasa: "" };
  return { tekst: `za ${d} dni`, klasa: "cichy" };
}

function Kopiuj({ tekst, etykieta }: { tekst: string; etykieta: string }) {
  const [ok, ustawOk] = useState(false);
  return (
    <button className="przycisk drugi" style={{ minHeight: 30, padding: "0 10px" }} onClick={async () => {
      try { await navigator.clipboard.writeText(tekst); ustawOk(true); setTimeout(() => ustawOk(false), 1200); } catch { /* brak dostępu do schowka */ }
    }}>{ok ? "Skopiowano" : etykieta}</button>
  );
}

function BialaLista({ p }: { p: Platnosc }) {
  if (p.rachunek_wirtualny) return <span className="znacznik" title="Rachunek wirtualny (np. do rozliczeń masowych) — na białej liście widnieje rachunek główny">rachunek wirtualny</span>;
  if (!p.bl_wynik) return <span className="znacznik">biała lista: czeka</span>;
  if (p.bl_wynik === "TAK") return <span className="znacznik" style={{ background: "#e3f4ea", color: "var(--dobrze)" }} title={`Sprawdzono ${p.bl_sprawdzono?.slice(0, 10)}, id MF: ${p.bl_id}`}>biała lista ✓</span>;
  if (p.bl_wynik === "NIE") return <span className="znacznik" style={{ background: "var(--zle-tlo)", color: "var(--zle)" }}>RACHUNKU NIE MA na białej liście</span>;
  return <span className="znacznik">biała lista: błąd sprawdzenia</span>;
}

function DanePrzelewu({ p }: { p: Platnosc }) {
  const kw = p.do_zaplaty ?? p.brutto;
  const nip = (p.nip_kontrahenta ?? "").replace(/\D/g, "");
  const mppTytul = `/VAT/${kwota(p.vat)}/IDC/${nip}/INV/${p.numer}/TXT/Faktura ${p.numer}`;
  const wiersz = (etykieta: string, wartosc: string, kopia = wartosc) => (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span className="cichy" style={{ width: 140 }}>{etykieta}</span><strong style={{ flex: "1 1 260px", wordBreak: "break-all" }}>{wartosc}</strong>
      <Kopiuj tekst={kopia} etykieta="Kopiuj" />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" }}>
      {wiersz("Odbiorca", p.nazwa_kontrahenta ?? "—")}
      {wiersz("Rachunek", nrb(p.rachunek), p.rachunek ?? "")}
      {p.bank && <div className="cichy" style={{ paddingLeft: 150 }}>{p.bank}</div>}
      {wiersz("Kwota", `${kwota(kw)} ${p.waluta}`, kwota(kw))}
      {p.mpp ? <>
        <div className="uwaga">Podzielona płatność (MPP) — w banku wybierz przelew „split payment”: kwota VAT {kwota(p.vat)} zł, NIP {nip}, faktura {p.numer}.</div>
        {wiersz("Kwota VAT", kwota(p.vat))}
        {wiersz("NIP dostawcy", nip)}
        {wiersz("Tytuł (format MPP)", mppTytul)}
      </> : wiersz("Tytuł", `Faktura ${p.numer}`)}
    </div>
  );
}

export function Platnosci(_: Kontekst) {
  const [lista, ustawListe] = useState<Platnosc[] | null>(null);
  const [widok, ustawWidok] = useState<"lista" | "kalendarz">("lista");
  const [pokazZaplacone, ustawPokazZaplacone] = useState(false);
  const [dzien, ustawDzien] = useState<string | null>(null);
  const [szukaj, ustawSzukaj] = useState("");
  const [rozwiniete, ustawRozwiniete] = useState<Set<string>>(new Set());
  const [zaznaczone, ustawZaznaczone] = useState<Set<string>>(new Set());
  const [miesiac, ustawMiesiac] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [granica, ustawGranice] = useState<string>("");
  const [blad, ustawBlad] = useState<string | null>(null);

  const wczytaj = useCallback(async () => {
    const statusy = pokazZaplacone ? ["do_zaplaty", "zaplacona"] : ["do_zaplaty"];
    const [p, u] = await Promise.all([
      db.from("platnosci").select("*").in("status", statusy).order("termin_platnosci", { ascending: true, nullsFirst: true }).limit(1000),
      db.from("ustawienia").select("platnosci_od").eq("id", 1).single(),
    ]);
    if (p.error) { ustawBlad(p.error.message); return; }
    ustawListe(p.data as Platnosc[]);
    ustawGranice((u.data as { platnosci_od: string } | null)?.platnosci_od ?? "");
  }, [pokazZaplacone]);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  async function oznacz(ids: string[], zaplacone: boolean) {
    const { data: u } = await db.auth.getUser();
    const { error } = await db.from("faktury").update(zaplacone ? { oplacono: dzisIso(), oplacil: u.user?.id } : { oplacono: null, oplacil: null }).in("id", ids);
    ustawBlad(error ? error.message : null);
    ustawZaznaczone(new Set());
    await wczytaj();
  }

  async function zmienGranice(d: string) {
    const { error } = await db.from("ustawienia").update({ platnosci_od: d }).eq("id", 1);
    ustawBlad(error ? error.message : null);
    await wczytaj();
  }

  const q = szukaj.trim().toUpperCase();
  const widoczne = useMemo(() => (lista ?? []).filter((p) =>
    (!dzien || p.termin_platnosci === dzien) &&
    (!q || `${p.nazwa_kontrahenta} ${p.numer} ${p.nip_kontrahenta}`.toUpperCase().includes(q))), [lista, dzien, q]);
  const doZaplaty = (lista ?? []).filter((p) => p.status === "do_zaplaty");
  const suma = (xs: Platnosc[]) => xs.reduce((a, p) => a + (p.do_zaplaty ?? p.brutto), 0);
  const po = doZaplaty.filter((p) => (p.dni_do_terminu ?? 0) < 0);
  const tydzien = doZaplaty.filter((p) => (p.dni_do_terminu ?? 0) >= 0 && (p.dni_do_terminu ?? 0) <= 7);
  const pozniej = doZaplaty.filter((p) => (p.dni_do_terminu ?? 0) > 7);
  const zaznaczoneLista = (lista ?? []).filter((p) => zaznaczone.has(p.id));

  const kafel = (tytul: string, xs: Platnosc[], klasa = "") => (
    <div><div className="cichy">{tytul}</div><strong className={klasa} style={{ fontSize: 20 }}>{zl(suma(xs))}</strong><div className="cichy">{xs.length} faktur</div></div>
  );

  // Kalendarz: dni miesiąca od poniedziałku
  const dniKalendarza = useMemo(() => {
    const start = new Date(miesiac); start.setDate(1 - ((miesiac.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [miesiac]);
  const naDzien = useMemo(() => {
    const m = new Map<string, Platnosc[]>();
    for (const p of doZaplaty) if (p.termin_platnosci) m.set(p.termin_platnosci, [...(m.get(p.termin_platnosci) ?? []), p]);
    return m;
  }, [doZaplaty]);
  const dzis = dzisIso();

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>Płatności</h1>
          <p className="podtytul">Faktury zakupu z KSeF czekające na przelew. Dane do przelewu, termin i podzielona płatność pochodzą z faktury; rachunki sprawdzamy na białej liście VAT.</p></div>
        <div className="przyciski">
          <button className={`przycisk ${widok === "lista" ? "" : "drugi"}`} onClick={() => ustawWidok("lista")}>Lista</button>
          <button className={`przycisk ${widok === "kalendarz" ? "" : "drugi"}`} onClick={() => ustawWidok("kalendarz")}>Kalendarz</button>
        </div>
      </div>
      {blad && <div className="blad">{blad}</div>}

      <section className="karta"><div className="srodek siatka">
        {kafel("Po terminie", po, po.length ? "minus" : "")}
        {kafel("W ciągu 7 dni", tydzien)}
        {kafel("Później", pozniej)}
        {kafel("Razem do zapłaty", doZaplaty)}
      </div></section>

      {widok === "kalendarz" && (
        <section className="karta">
          <div className="tytul">
            <button className="przycisk drugi" onClick={() => ustawMiesiac(new Date(miesiac.getFullYear(), miesiac.getMonth() - 1, 1))}>←</button>
            <h2>{MIESIACE[miesiac.getMonth()]} {miesiac.getFullYear()}</h2>
            <button className="przycisk drugi" onClick={() => ustawMiesiac(new Date(miesiac.getFullYear(), miesiac.getMonth() + 1, 1))}>→</button>
          </div>
          <div className="srodek">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
              {DNI.map((d) => <div key={d} className="cichy" style={{ textAlign: "center", fontWeight: 600 }}>{d}</div>)}
              {dniKalendarza.map((d) => {
                const iso = d.toLocaleDateString("sv-SE");
                const xs = naDzien.get(iso) ?? [];
                const wMiesiacu = d.getMonth() === miesiac.getMonth();
                const poTerminie = iso < dzis && xs.length > 0;
                return (
                  <button key={iso} onClick={() => { ustawDzien(dzien === iso ? null : iso); ustawWidok("lista"); }}
                    style={{ all: "unset", cursor: xs.length ? "pointer" : "default", minHeight: 64, padding: 6, borderRadius: 8,
                      border: `1px solid ${iso === dzis ? "var(--akcent)" : "var(--linia)"}`, opacity: wMiesiacu ? 1 : 0.4,
                      background: poTerminie ? "var(--zle-tlo)" : xs.length ? "#f4f7fd" : "transparent" }}>
                    <div className="cichy">{d.getDate()}</div>
                    {xs.length > 0 && <><div style={{ fontWeight: 600, fontSize: 13 }} className={poTerminie ? "minus" : ""}>{zl(suma(xs))}</div>
                      <div className="cichy">{xs.length} {xs.length === 1 ? "faktura" : "faktur"}</div></>}
                  </button>
                );
              })}
            </div>
            {doZaplaty.some((p) => !p.termin_platnosci) && <p className="cichy">Faktury bez terminu płatności nie są w kalendarzu — są na liście.</p>}
          </div>
        </section>
      )}

      {widok === "lista" && (
        <section className="karta">
          <div className="tytul">
            <div className="przyciski" style={{ alignItems: "center" }}>
              <input type="search" aria-label="Szukaj" placeholder="Dostawca, numer, NIP" value={szukaj} onChange={(e) => ustawSzukaj(e.target.value)} />
              {dzien && <button className="przycisk drugi" onClick={() => ustawDzien(null)}>Termin {dzien} ✕</button>}
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" style={{ minHeight: 0 }} checked={pokazZaplacone} onChange={(e) => ustawPokazZaplacone(e.target.checked)} /> pokaż zapłacone
              </label>
            </div>
            {zaznaczoneLista.length > 0 && <div className="przyciski" style={{ alignItems: "center" }}>
              <span className="cichy">Zaznaczono {zaznaczoneLista.length} · {zl(suma(zaznaczoneLista))}</span>
              <button className="przycisk" onClick={() => oznacz([...zaznaczone], true)}>Oznacz jako zapłacone</button>
            </div>}
          </div>
          {lista && widoczne.length === 0 ? <div className="pusto">{lista.length === 0 ? "Nic do zapłaty." : "Brak faktur dla tego filtra."}</div> : (
            <div className="przewijanie"><table style={{ minWidth: 900 }}>
              <thead><tr><th></th><th>Termin</th><th>Dostawca</th><th>Faktura</th><th className="liczba">Do zapłaty</th><th>Rachunek</th><th></th></tr></thead>
              <tbody>{widoczne.map((p) => {
                const t = opisTerminu(p);
                const otwarte = rozwiniete.has(p.id);
                const zaplacona = p.status === "zaplacona";
                return (
                  <Fragment key={p.id}>
                    <tr style={zaplacona ? { opacity: 0.55 } : undefined}>
                      <td><input type="checkbox" aria-label={`Zaznacz ${p.numer}`} style={{ minHeight: 0 }} disabled={zaplacona} checked={zaznaczone.has(p.id)}
                        onChange={(e) => { const s = new Set(zaznaczone); if (e.target.checked) s.add(p.id); else s.delete(p.id); ustawZaznaczone(s); }} /></td>
                      <td>{p.termin_platnosci ?? "—"}<div className={t.klasa} style={{ fontSize: 12 }}>{zaplacona ? `zapłacono ${p.oplacono}` : t.tekst}</div></td>
                      <td>{p.nazwa_kontrahenta}<div className="cichy">NIP {p.nip_kontrahenta ?? "—"}</div></td>
                      <td>{p.numer}<div className="cichy">wyst. {p.data_wystawienia}{p.rodzaj?.startsWith("KOR") ? " · korekta" : ""}</div></td>
                      <td className={`liczba ${(p.do_zaplaty ?? 0) < 0 ? "plus" : ""}`}>{zl(p.do_zaplaty ?? p.brutto)}{p.waluta !== "PLN" ? ` ${p.waluta}` : ""}
                        {p.mpp && <div><span className="znacznik" style={{ background: "var(--uwaga-tlo)", color: "var(--uwaga)" }}>MPP</span></div>}</td>
                      <td><span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{nrb(p.rachunek)}</span>
                        <div style={{ marginTop: 4 }}>{p.rachunek ? <BialaLista p={p} /> : <span className="znacznik">brak rachunku na fakturze</span>}</div></td>
                      <td><div className="przyciski">
                        <button className="przycisk drugi" onClick={() => { const s = new Set(rozwiniete); if (otwarte) s.delete(p.id); else s.add(p.id); ustawRozwiniete(s); }}>{otwarte ? "Zwiń" : "Przelew"}</button>
                        {zaplacona
                          ? <button className="przycisk drugi" onClick={() => oznacz([p.id], false)}>Cofnij</button>
                          : <button className="przycisk drugi" onClick={() => oznacz([p.id], true)}>Zapłacone</button>}
                      </div></td>
                    </tr>
                    {otwarte && <tr><td></td><td colSpan={6}><DanePrzelewu p={p} /></td></tr>}
                  </Fragment>
                );
              })}</tbody>
            </table></div>
          )}
        </section>
      )}

      <details className="karta"><summary className="srodek" style={{ cursor: "pointer" }}>Ustawienia i wyjaśnienia</summary>
        <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ maxWidth: 320 }}>Faktury z terminem przed tą datą uznaję za rozliczone (archiwum)
            <input type="date" value={granica} onChange={(e) => e.target.value && zmienGranice(e.target.value)} /></label>
          <p className="cichy">Gotówka i karta (forma płatności z faktury) oraz faktury oznaczone przez dostawcę jako zapłacone nie trafiają na listę.
            Korekty in minus mają kwotę ujemną — pomniejszają przelew do tego samego dostawcy.</p>
          <p className="cichy">Biała lista: od 15 000 zł brutto przelew na rachunek spoza wykazu odbiera prawo do zaliczenia wydatku w koszty i grozi współodpowiedzialnością za VAT dostawcy.
            Rachunki sprawdzamy automatycznie dwa razy dziennie, a identyfikator zapytania MF zapisujemy jako dowód.</p>
        </div>
      </details>
    </div>
  );
}
