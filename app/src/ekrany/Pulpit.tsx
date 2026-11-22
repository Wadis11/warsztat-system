// Pulpit: skróty do zakładek, auta na warsztacie (z podziałem na pracowników) i tydzień umówionych przyjęć.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Kontekst, Widok } from "../App.tsx";
import { db, zl } from "../supabase.ts";

interface Zl {
  id: string; numer: string; nr_rej: string | null; marka: string | null; model: string | null; status: string;
  termin: string | null; data_przyjecia: string; zastepcze_potrzebne: boolean; klienci: { nazwa: string } | null;
}
interface Wyp { id: string; zlecenie_id: string | null; wydanie: string; planowany_zwrot: string | null; zwrot: string | null; auta_zastepcze: { nr_rej: string } | null }

const W_SERWISIE = ["przyjete", "w_naprawie", "gotowe"];
const STATUS: Record<string, string> = { umowione: "Umówione", przyjete: "Przyjęte", w_naprawie: "W naprawie", gotowe: "Gotowe" };
const DNI = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const godzina = (t: string) => new Date(t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
const poniedzialek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const auto = (z: Zl) => [z.marka, z.model].filter(Boolean).join(" ");

export function Pulpit({ rola, przejdz }: Kontekst) {
  const wlasciciel = rola === "wlasciciel";
  const [zlecenia, ustawZlecenia] = useState<Zl[] | null>(null);
  const [przydzial, ustawPrzydzial] = useState<{ zlecenie_id: string; pracownik_id: string }[]>([]);
  const [pracownicy, ustawPracownikow] = useState<{ id: string; imie: string; aktywny: boolean }[]>([]);
  const [wypozyczenia, ustawWypozyczenia] = useState<Wyp[]>([]);
  const [flota, ustawFlote] = useState(0);
  const [terminyFloty, ustawTerminyFloty] = useState(0);
  const [liczniki, ustawLiczniki] = useState<{ kolejka: number; poTerminie: number; doTygodnia: number; sumaTydzien: number; lakiery: number } | null>(null);
  const [tydzien, ustawTydzien] = useState(() => poniedzialek(new Date()));

  const wczytaj = useCallback(async () => {
    const teraz = new Date().toISOString();
    const za30 = iso(new Date(Date.now() + 30 * 864e5));
    const [z, zp, p, w, a, t] = await Promise.all([
      db.from("zlecenia").select("id, numer, nr_rej, marka, model, status, termin, data_przyjecia, zastepcze_potrzebne, klienci(nazwa)")
        .in("status", ["umowione", ...W_SERWISIE]).order("termin", { ascending: true, nullsFirst: false }).limit(500),
      db.from("zlecenia_pracownicy").select("zlecenie_id, pracownik_id"),
      db.from("pracownicy").select("id, imie, aktywny").order("imie"),
      db.from("wypozyczenia").select("id, zlecenie_id, wydanie, planowany_zwrot, zwrot, auta_zastepcze(nr_rej)").or(`zwrot.is.null,zwrot.gte.${teraz}`),
      db.from("auta_zastepcze").select("id", { count: "exact", head: true }).eq("aktywne", true),
      db.from("auta_zastepcze_terminy").select("auto_id", { count: "exact", head: true }).lte("data", za30),
    ]);
    ustawZlecenia((z.data ?? []) as unknown as Zl[]);
    ustawPrzydzial((zp.data ?? []) as { zlecenie_id: string; pracownik_id: string }[]);
    ustawPracownikow((p.data ?? []) as { id: string; imie: string; aktywny: boolean }[]);
    ustawWypozyczenia((w.data ?? []) as unknown as Wyp[]);
    ustawFlote(a.count ?? 0); ustawTerminyFloty(t.count ?? 0);
    if (wlasciciel) {
      const [k, po, tyd, l] = await Promise.all([
        db.from("kolejka_pozycji").select("id", { count: "exact", head: true }),
        db.from("platnosci").select("id", { count: "exact", head: true }).eq("status", "do_zaplaty").lt("dni_do_terminu", 0),
        db.from("platnosci").select("do_zaplaty").eq("status", "do_zaplaty").gte("dni_do_terminu", 0).lte("dni_do_terminu", 7),
        db.from("lakiery_zakupy").select("pozycja_id", { count: "exact", head: true }).eq("status", "do_przypisania"),
      ]);
      const tydz = (tyd.data ?? []) as { do_zaplaty: number }[];
      ustawLiczniki({ kolejka: k.count ?? 0, poTerminie: po.count ?? 0, doTygodnia: tydz.length,
        sumaTydzien: tydz.reduce((s, x) => s + Number(x.do_zaplaty), 0), lakiery: l.count ?? 0 });
    }
  }, [wlasciciel]);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  const wSerwisie = (zlecenia ?? []).filter((z) => W_SERWISIE.includes(z.status));
  const teraz = Date.now();
  const wydaneTeraz = wypozyczenia.filter((w) => Date.parse(w.wydanie) <= teraz && !w.zwrot);
  const naPracownika = useMemo(() => {
    const aktywne = new Set(wSerwisie.map((z) => z.id));
    const m = new Map<string, Set<string>>();
    for (const p of przydzial) if (aktywne.has(p.zlecenie_id)) m.set(p.pracownik_id, (m.get(p.pracownik_id) ?? new Set()).add(p.zlecenie_id));
    const przypisane = new Set(przydzial.filter((p) => aktywne.has(p.zlecenie_id)).map((p) => p.zlecenie_id));
    return { m, bez: wSerwisie.filter((z) => !przypisane.has(z.id)) };
  }, [wSerwisie, przydzial]);

  const dniTygodnia = Array.from({ length: 7 }, (_, i) => { const d = new Date(tydzien); d.setDate(d.getDate() + i); return d; });
  const dzienZlecenia = (z: Zl) => z.termin ? iso(new Date(z.termin)) : z.status === "umowione" ? z.data_przyjecia : null;
  const zastepczeDla = (z: Zl) => wypozyczenia.find((w) => w.zlecenie_id === z.id);
  const pokazNiedziele = (zlecenia ?? []).some((z) => dzienZlecenia(z) === iso(dniTygodnia[6]));
  const koniecTygodnia = new Date(tydzien); koniecTygodnia.setDate(koniecTygodnia.getDate() + 6);

  const kafel = (tytul: string, wartosc: string | number, opis: string, cel: Widok, alarm = false) => (
    <button className="karta" onClick={() => przejdz(cel)} style={{ all: "unset", cursor: "pointer", background: "var(--karta)", border: "1px solid var(--ramka)", borderRadius: 12, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="cichy">{tytul}</span>
      <strong style={{ fontSize: 22 }} className={alarm ? "minus" : ""}>{wartosc}</strong>
      <span className="cichy" style={{ fontSize: 12 }}>{opis}</span>
    </button>
  );

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>Pulpit</h1><p className="podtytul">{new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}</p></div>
        <div className="przyciski">
          <button className="przycisk" onClick={() => przejdz({ ekran: "nowe" })}>+ Nowe zlecenie / umów auto</button>
          <button className="przycisk drugi" onClick={() => przejdz({ ekran: "wypozyczenie" })}>Wydaj auto zastępcze</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {kafel("Auta na warsztacie", wSerwisie.length, `${wSerwisie.filter((z) => z.status === "gotowe").length} gotowych do wydania`, { ekran: "zlecenia" })}
        {kafel("Umówione", (zlecenia ?? []).filter((z) => z.status === "umowione").length, "czekają na przyjęcie", { ekran: "zlecenia" })}
        {kafel("Auta zastępcze", `${wydaneTeraz.length} / ${flota}`, terminyFloty ? `${terminyFloty} terminów w 30 dni` : "wydane / wszystkie", { ekran: "zastepcze" }, terminyFloty > 0)}
        {wlasciciel && liczniki && <>
          {kafel("Do zapłaty w 7 dni", zl(liczniki.sumaTydzien), liczniki.poTerminie ? `${liczniki.poTerminie} faktur po terminie` : `${liczniki.doTygodnia} faktur`, { ekran: "platnosci" }, liczniki.poTerminie > 0)}
          {kafel("Do sprawdzenia", liczniki.kolejka, "pozycje z faktur", { ekran: "kolejka" }, liczniki.kolejka > 0)}
          {kafel("Lakiery", liczniki.lakiery, "do przypisania do zleceń", { ekran: "lakiery" }, liczniki.lakiery > 0)}
          {kafel("Materiał", "Ceny", "porównanie dostawców", { ekran: "material" })}
          {kafel("Pracownicy", pracownicy.filter((p) => p.aktywny).length, "wyniki i RBH", { ekran: "pracownicy" })}
        </>}
      </div>

      <section className="karta">
        <div className="tytul">
          <button className="przycisk drugi" aria-label="Poprzedni tydzień" onClick={() => { const d = new Date(tydzien); d.setDate(d.getDate() - 7); ustawTydzien(d); }}>←</button>
          <h2>Umówione przyjęcia · {tydzien.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })} – {koniecTygodnia.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</h2>
          <div className="przyciski">
            <button className="przycisk drugi" onClick={() => ustawTydzien(poniedzialek(new Date()))}>Ten tydzień</button>
            <button className="przycisk drugi" aria-label="Następny tydzień" onClick={() => { const d = new Date(tydzien); d.setDate(d.getDate() + 7); ustawTydzien(d); }}>→</button>
          </div>
        </div>
        <div className="srodek">
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${pokazNiedziele ? 7 : 6}, minmax(140px, 1fr))`, gap: 8, overflowX: "auto" }}>
            {dniTygodnia.slice(0, pokazNiedziele ? 7 : 6).map((d, i) => {
              const dzien = iso(d);
              const auta = (zlecenia ?? []).filter((z) => dzienZlecenia(z) === dzien).sort((a, b) => (a.termin ?? "").localeCompare(b.termin ?? ""));
              const dzis = dzien === iso(new Date());
              return (
                <div key={dzien} style={{ border: `1px solid ${dzis ? "var(--akcent)" : "var(--linia)"}`, borderRadius: 10, padding: 8, minHeight: 120, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{DNI[i]} {d.getDate()}.{String(d.getMonth() + 1).padStart(2, "0")}</div>
                  {auta.length === 0 && <span className="cichy" style={{ fontSize: 12 }}>—</span>}
                  {auta.map((z) => {
                    const w = zastepczeDla(z);
                    return (
                      <button key={z.id} onClick={() => przejdz({ ekran: "zlecenie", zlecenieId: z.id })}
                        style={{ all: "unset", cursor: "pointer", background: "#f4f7fd", borderRadius: 8, padding: "6px 8px", fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                        <strong>{z.termin ? `${godzina(z.termin)} · ` : ""}{z.nr_rej ?? z.numer}</strong>
                        <span>{auto(z)}{z.klienci?.nazwa ? ` · ${z.klienci.nazwa}` : ""}</span>
                        {z.status !== "umowione" && <span className="cichy">{STATUS[z.status]}</span>}
                        {w ? <span style={{ color: "var(--dobrze)" }}>zastępcze: {w.auta_zastepcze?.nr_rej}</span>
                          : z.zastepcze_potrzebne ? <span className="minus">potrzebne zastępcze — brak</span>
                          : <span className="cichy">bez zastępczego</span>}
                      </button>);
                  })}
                </div>);
            })}
          </div>
        </div>
      </section>

      <section className="karta">
        <div className="tytul"><h2>Na warsztacie: {wSerwisie.length} aut</h2></div>
        <div className="srodek" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {pracownicy.filter((p) => p.aktywny).map((p) => {
            const ids = naPracownika.m.get(p.id);
            const auta = wSerwisie.filter((z) => ids?.has(z.id));
            return (
              <div key={p.id} style={{ border: "1px solid var(--linia)", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><strong>{p.imie}</strong><span className="licznik">{auta.length}</span></div>
                {auta.map((z) => <button key={z.id} className="link" style={{ display: "block", fontSize: 13, marginTop: 4 }} onClick={() => przejdz({ ekran: "zlecenie", zlecenieId: z.id })}>
                  {z.nr_rej} · {auto(z)} <span className="cichy">({STATUS[z.status]})</span></button>)}
              </div>);
          })}
          <div style={{ border: "1px dashed var(--ramka)", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><strong>Bez przypisanego pracownika</strong><span className="licznik" style={{ background: naPracownika.bez.length ? "var(--zle)" : undefined }}>{naPracownika.bez.length}</span></div>
            {naPracownika.bez.slice(0, 12).map((z) => <button key={z.id} className="link" style={{ display: "block", fontSize: 13, marginTop: 4 }} onClick={() => przejdz({ ekran: "zlecenie", zlecenieId: z.id })}>
              {z.nr_rej} · {auto(z)}</button>)}
            {pracownicy.length === 0 && wlasciciel && <p className="cichy" style={{ fontSize: 12 }}>Dodaj pracowników w zakładce Pracownicy, potem przypisuj ich w zleceniu.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
