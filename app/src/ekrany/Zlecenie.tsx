// Zlecenie: dane auta, czynności, pracownicy; dla właściciela także kosztorysy, koszty z faktur i wynik.
import { useCallback, useEffect, useState } from "react";
import { type Kontekst, widziKwoty } from "../App.tsx";
import { db, zl } from "../supabase.ts";
import { WyborKlienta } from "./WyborKlienta.tsx";
import { ROLE, type Pracownik } from "./Pracownicy.tsx";

interface Dane {
  numer: string; nr_rej: string | null; vin: string | null; marka: string | null; model: string | null;
  nr_szkody: string | null; zakres_prac: string | null; status: string; klient_id: string | null;
  data_przyjecia: string; data_wydania: string | null; termin: string | null; zastepcze_potrzebne: boolean;
}
interface WypZl { id: string; numer: string; wydanie: string; planowany_zwrot: string | null; zwrot: string | null; najemca_nazwa: string; auta_zastepcze: { nr_rej: string; marka: string | null; model: string | null } | null }
interface Operacja { id?: string; kolejnosc: number; rodzaj: string; opis: string }
interface Przypisanie { pracownik_id: string; rola: string }
interface Kosztorys { id: string; wersja: string; zrodlo: string; autor: string | null; data: string | null; netto: number;
  rbh_blach: number | null; rbh_lak: number | null; plik: string | null; utworzono: string }
interface PozycjaKosztu { id: string; nazwa: string; indeks: string | null; wartosc: number | null; netto: number; kategoria: string; sposob: string;
  faktury: { numer: string; nazwa_kontrahenta: string | null; data_wystawienia: string } | null }
interface FakturaSprzedazy { id: string; numer: string; nazwa_kontrahenta: string | null; data_wystawienia: string; netto: number; zlecenie_id: string | null }
interface Wynik { przychod_kosztorys: number | null; przychod_faktura: number | null; koszt_czesci: number; koszt_lakier_materialy: number; rbh: number }

const STATUSY: Record<string, string> = { umowione: "Umówione", przyjete: "Przyjęte", w_naprawie: "W naprawie", gotowe: "Gotowe", wydane: "Wydane", anulowane: "Anulowane" };
const WERSJE: Record<string, string> = { zlozony: "Złożony", zaakceptowany: "Zaakceptowany", wycena_ubezpieczyciela: "Wycena ubezpieczyciela" };
const KATEGORIE: Record<string, string> = { czesc: "Część", lakier: "Lakier", material: "Materiał", koszt_ogolny: "Koszt ogólny", koszt_sprawy: "Koszt sprawy", nieustalona: "Nieustalona" };
const RODZAJE: Record<string, string> = { blacharka: "Blacharka", lakier: "Lakier", mechanika: "Mechanika", inne: "Inne" };

export function Zlecenie({ rola, przejdz, zlecenieId }: Kontekst & { zlecenieId: string }) {
  const wlasciciel = widziKwoty(rola);
  const [d, ustawD] = useState<Dane | null>(null);
  const [operacje, ustawOperacje] = useState<Operacja[]>([]);
  const [pracownicy, ustawPracownikow] = useState<Pracownik[]>([]);
  const [przypisani, ustawPrzypisanych] = useState<Przypisanie[]>([]);
  const [kosztorysy, ustawKosztorysy] = useState<Kosztorys[]>([]);
  const [koszty, ustawKoszty] = useState<PozycjaKosztu[]>([]);
  const [sprzedaz, ustawSprzedaz] = useState<FakturaSprzedazy[]>([]);
  const [wolneSprzedaz, ustawWolneSprzedaz] = useState<FakturaSprzedazy[]>([]);
  const [wynik, ustawWynik] = useState<Wynik | null>(null);
  const [komunikat, ustawKomunikat] = useState<{ blad: boolean; tekst: string } | null>(null);
  const [zastepcze, ustawZastepcze] = useState<WypZl[]>([]);
  const [nowyPracownik, ustawNowegoPracownika] = useState({ id: "", rola: "blacharz" });

  const wczytaj = useCallback(async () => {
    const [z, o, p, zp, wz] = await Promise.all([
      db.from("zlecenia").select("numer, nr_rej, vin, marka, model, nr_szkody, zakres_prac, status, klient_id, data_przyjecia, data_wydania, termin, zastepcze_potrzebne").eq("id", zlecenieId).single(),
      db.from("zlecenia_operacje").select("id, kolejnosc, rodzaj, opis").eq("zlecenie_id", zlecenieId).order("kolejnosc"),
      db.from("pracownicy").select("id, imie, specjalizacja, aktywny").order("imie"),
      db.from("zlecenia_pracownicy").select("pracownik_id, rola").eq("zlecenie_id", zlecenieId),
      db.from("wypozyczenia").select("id, numer, wydanie, planowany_zwrot, zwrot, najemca_nazwa, auta_zastepcze(nr_rej, marka, model)").eq("zlecenie_id", zlecenieId).order("wydanie"),
    ]);
    ustawZastepcze((wz.data ?? []) as unknown as WypZl[]);
    ustawD(z.data as Dane);
    ustawOperacje((o.data ?? []) as Operacja[]);
    ustawPracownikow((p.data ?? []) as Pracownik[]);
    ustawPrzypisanych((zp.data ?? []) as Przypisanie[]);
    if (!wlasciciel) return;
    const [k, pk, fs, w, wolne] = await Promise.all([
      db.from("kosztorysy").select("id, wersja, zrodlo, autor, data, netto, rbh_blach, rbh_lak, plik, utworzono").eq("zlecenie_id", zlecenieId).order("utworzono"),
      db.from("pozycje_faktur").select("id, nazwa, indeks, wartosc, netto, kategoria, sposob, faktury(numer, nazwa_kontrahenta, data_wystawienia)").eq("zlecenie_id", zlecenieId),
      db.from("faktury").select("id, numer, nazwa_kontrahenta, data_wystawienia, netto, zlecenie_id").eq("kierunek", "sprzedaz").eq("zlecenie_id", zlecenieId),
      db.from("zlecenia_wyniki").select("przychod_kosztorys, przychod_faktura, koszt_czesci, koszt_lakier_materialy, rbh").eq("id", zlecenieId).single(),
      db.from("faktury").select("id, numer, nazwa_kontrahenta, data_wystawienia, netto, zlecenie_id").eq("kierunek", "sprzedaz").is("zlecenie_id", null)
        .order("data_wystawienia", { ascending: false }).limit(150),
    ]);
    ustawKosztorysy((k.data ?? []) as Kosztorys[]);
    ustawKoszty((pk.data ?? []) as unknown as PozycjaKosztu[]);
    ustawSprzedaz((fs.data ?? []) as FakturaSprzedazy[]);
    ustawWynik(w.data as Wynik);
    ustawWolneSprzedaz((wolne.data ?? []) as FakturaSprzedazy[]);
  }, [zlecenieId, wlasciciel]);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  async function wykonaj(akcja: PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    const { error } = await akcja;
    ustawKomunikat(error ? { blad: true, tekst: `Nie zapisano: ${error.message}` } : ok ? { blad: false, tekst: ok } : null);
    await wczytaj();
    return !error;
  }

  if (!d) return null;
  const pole = (k: keyof Dane, etykieta: string, typ = "text") => (
    <label>{etykieta}<input type={typ} value={String(d[k] ?? "")} onChange={(e) => ustawD({ ...d, [k]: e.target.value })} /></label>
  );

  function zapiszDane() {
    const n = (s: string | null) => (s && s.trim() ? s.trim() : null);
    return wykonaj(db.from("zlecenia").update({
      nr_rej: n(d!.nr_rej)?.toUpperCase() ?? null, vin: n(d!.vin)?.toUpperCase() ?? null, marka: n(d!.marka)?.toUpperCase() ?? null,
      model: n(d!.model), nr_szkody: n(d!.nr_szkody), zakres_prac: n(d!.zakres_prac), status: d!.status,
      klient_id: d!.klient_id || null, data_przyjecia: d!.data_przyjecia,
      termin: d!.termin ? new Date(d!.termin).toISOString() : null, zastepcze_potrzebne: d!.zastepcze_potrzebne,
      data_wydania: d!.data_wydania || (d!.status === "wydane" ? new Date().toISOString().slice(0, 10) : null),
    }).eq("id", zlecenieId), "Zapisano dane zlecenia.");
  }

  async function zapiszOperacje() {
    const zapis = operacje.map((o, i) => ({ ...o, kolejnosc: i + 1, opis: o.opis.trim() })).filter((o) => o.opis);
    const istniejace = zapis.filter((o) => o.id);
    const nowe = zapis.filter((o) => !o.id).map(({ id: _, ...o }) => ({ ...o, zlecenie_id: zlecenieId }));
    const zachowane = new Set(istniejace.map((o) => o.id));
    const { data: wszystkie } = await db.from("zlecenia_operacje").select("id").eq("zlecenie_id", zlecenieId);
    const doUsuniecia = (wszystkie ?? []).map((o) => o.id as string).filter((id) => !zachowane.has(id));
    if (doUsuniecia.length) await db.from("zlecenia_operacje").delete().in("id", doUsuniecia);
    for (const o of istniejace) await db.from("zlecenia_operacje").update({ kolejnosc: o.kolejnosc, rodzaj: o.rodzaj, opis: o.opis }).eq("id", o.id!);
    await wykonaj(nowe.length ? db.from("zlecenia_operacje").insert(nowe) : Promise.resolve({ error: null }), "Zapisano czynności.");
  }

  async function otworzPdf(plik: string) {
    const { data, error } = await db.storage.from("kosztorysy").createSignedUrl(plik, 120);
    if (error) { ustawKomunikat({ blad: true, tekst: `Nie udało się otworzyć PDF: ${error.message}` }); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function usunKosztorys(k: Kosztorys) {
    if (!window.confirm(`Usunąć kosztorys ${WERSJE[k.wersja]} na ${zl(k.netto)}?`)) return;
    if (k.plik) await db.storage.from("kosztorysy").remove([k.plik]);
    await wykonaj(db.from("kosztorysy").delete().eq("id", k.id), "Usunięto kosztorys.");
  }

  async function usunZlecenie() {
    if (!window.confirm(`Usunąć zlecenie ${d!.numer} razem z kosztorysami? Faktury zostaną, wrócą do nieprzypisanych.`)) return;
    await db.from("pozycje_faktur").update({ zlecenie_id: null, zatwierdzono: null, sposob: "brak", pewnosc: 0 }).eq("zlecenie_id", zlecenieId);
    await db.from("faktury").update({ zlecenie_id: null }).eq("zlecenie_id", zlecenieId);
    const pliki = kosztorysy.map((k) => k.plik).filter(Boolean) as string[];
    if (pliki.length) await db.storage.from("kosztorysy").remove(pliki);
    const { error } = await db.from("zlecenia").delete().eq("id", zlecenieId);
    if (error) ustawKomunikat({ blad: true, tekst: `Nie usunięto: ${error.message}` });
    else przejdz({ ekran: "zlecenia" });
  }

  const przychod = wynik ? wynik.przychod_faktura ?? wynik.przychod_kosztorys : null;
  const marza = przychod === null || !wynik ? null : przychod - wynik.koszt_czesci - wynik.koszt_lakier_materialy;
  const imie = (id: string) => pracownicy.find((p) => p.id === id)?.imie ?? "?";

  return (
    <div className="kolumna">
      <div className="naglowek">
        <div><h1>{d.numer}</h1><p className="podtytul">{[d.marka, d.model].filter(Boolean).join(" ")} · {d.nr_rej}</p></div>
        <div className="przyciski">
          <button className="przycisk drugi" onClick={() => przejdz({ ekran: "karta", zlecenieId })}>Karta pracy</button>
          <button className="przycisk drugi" onClick={() => przejdz({ ekran: "zlecenia" })}>← Zlecenia</button>
        </div>
      </div>
      {komunikat && <div className={komunikat.blad ? "blad" : "info"} role="status">{komunikat.tekst}</div>}

      {wlasciciel && wynik && (
        <section className="karta"><div className="srodek siatka">
          <div><div className="cichy">Przychód netto</div><strong>{zl(przychod)}</strong>
            <div className="cichy">{wynik.przychod_faktura !== null ? "z faktury sprzedaży" : "z kosztorysu"}</div></div>
          <div><div className="cichy">Części</div><strong>{zl(wynik.koszt_czesci)}</strong></div>
          <div><div className="cichy">Lakier i materiały</div><strong>{zl(wynik.koszt_lakier_materialy)}</strong></div>
          <div><div className="cichy">Marża przed robocizną</div><strong className={marza !== null && marza < 0 ? "minus" : ""}>{zl(marza)}</strong></div>
          <div><div className="cichy">RBH</div><strong>{wynik.rbh ? wynik.rbh.toLocaleString("pl-PL") : "—"}</strong></div>
        </div></section>
      )}

      <section className="karta">
        <div className="tytul"><h2>Dane zlecenia</h2></div>
        <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="siatka">
            {pole("nr_rej", "Rejestracja")}{pole("vin", "VIN")}{pole("marka", "Marka")}{pole("model", "Model")}
            {pole("nr_szkody", "Nr szkody")}
            <WyborKlienta wartosc={d.klient_id ?? ""} onChange={(id) => ustawD({ ...d, klient_id: id })} />
            <label>Status
              <select value={d.status} onChange={(e) => ustawD({ ...d, status: e.target.value })}>
                {Object.entries(STATUSY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {pole("data_przyjecia", "Data przyjęcia", "date")}{pole("data_wydania", "Data wydania", "date")}
            <label>Umówiony termin<input type="datetime-local" value={d.termin ? new Date(new Date(d.termin).getTime() - new Date(d.termin).getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ""}
              onChange={(e) => ustawD({ ...d, termin: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "end" }}>
              <input type="checkbox" style={{ minHeight: 0 }} checked={d.zastepcze_potrzebne} onChange={(e) => ustawD({ ...d, zastepcze_potrzebne: e.target.checked })} /> potrzebne auto zastępcze</label>
          </div>
          <label>Zakres prac (opis ogólny)
            <textarea value={d.zakres_prac ?? ""} onChange={(e) => ustawD({ ...d, zakres_prac: e.target.value })} /></label>
          <div className="przyciski"><button className="przycisk" onClick={zapiszDane}>Zapisz dane</button></div>
        </div>
      </section>

      <section className="karta">
        <div className="tytul"><h2>Auto zastępcze</h2>
          <button className="przycisk drugi" onClick={() => przejdz({ ekran: "wypozyczenie", zlecenieId })}>Wydaj auto zastępcze</button></div>
        <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {zastepcze.length === 0 ? <div className="cichy">{d.zastepcze_potrzebne ? "Klient potrzebuje auta zastępczego — jeszcze nie wydano." : "Bez auta zastępczego."}</div> :
            zastepcze.map((w) => <div key={w.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{w.auta_zastepcze?.nr_rej}</strong><span>{[w.auta_zastepcze?.marka, w.auta_zastepcze?.model].filter(Boolean).join(" ")}</span>
              <span className="cichy">{w.numer} · {w.najemca_nazwa} · {new Date(w.wydanie).toLocaleDateString("pl-PL")} – {w.zwrot ? new Date(w.zwrot).toLocaleDateString("pl-PL") : w.planowany_zwrot ? `${new Date(w.planowany_zwrot).toLocaleDateString("pl-PL")} (plan)` : "…"}</span>
              <button className="przycisk drugi" onClick={() => przejdz({ ekran: "wypozyczenie", wypozyczenieId: w.id })}>Otwórz</button>
              <button className="przycisk drugi" onClick={() => przejdz({ ekran: "umowa", wypozyczenieId: w.id })}>Umowa</button>
            </div>)}
        </div>
      </section>

      <section className="karta">
        <div className="tytul"><h2>Czynności na karcie pracy</h2>
          <button className="przycisk drugi" onClick={() => ustawOperacje([...operacje, { kolejnosc: operacje.length + 1, rodzaj: "blacharka", opis: "" }])}>+ Dodaj czynność</button></div>
        <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {operacje.length === 0 && <div className="cichy">Brak czynności.</div>}
          {operacje.map((o, i) => (
            <div key={o.id ?? `n${i}`} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select aria-label="Rodzaj" value={o.rodzaj} onChange={(e) => ustawOperacje(operacje.map((x, j) => (j === i ? { ...x, rodzaj: e.target.value } : x)))}>
                {Object.entries(RODZAJE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input aria-label="Opis czynności" style={{ flex: "1 1 300px" }} value={o.opis}
                onChange={(e) => ustawOperacje(operacje.map((x, j) => (j === i ? { ...x, opis: e.target.value } : x)))} />
              <button className="przycisk drugi" aria-label="Usuń czynność" onClick={() => ustawOperacje(operacje.filter((_, j) => j !== i))}>Usuń</button>
            </div>
          ))}
          <div className="przyciski"><button className="przycisk" onClick={zapiszOperacje}>Zapisz czynności</button></div>
        </div>
      </section>

      <section className="karta">
        <div className="tytul"><h2>Pracownicy przy zleceniu</h2></div>
        <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {przypisani.length === 0 && <div className="cichy">Nikt nie jest przypisany.</div>}
          {przypisani.map((p) => (
            <div key={p.pracownik_id + p.rola} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <strong>{imie(p.pracownik_id)}</strong><span className="znacznik">{ROLE[p.rola]}</span>
              {wlasciciel && <button className="przycisk drugi" onClick={() => wykonaj(db.from("zlecenia_pracownicy").delete()
                .eq("zlecenie_id", zlecenieId).eq("pracownik_id", p.pracownik_id).eq("rola", p.rola))}>Usuń</button>}
            </div>
          ))}
          {wlasciciel && (pracownicy.length === 0
            ? <div className="cichy">Najpierw dodaj pracowników w zakładce „Pracownicy”.</div>
            : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select aria-label="Pracownik" value={nowyPracownik.id} onChange={(e) => {
                  const p = pracownicy.find((x) => x.id === e.target.value);
                  ustawNowegoPracownika({ id: e.target.value, rola: p?.specjalizacja ?? nowyPracownik.rola });
                }}>
                  <option value="">— pracownik —</option>
                  {pracownicy.filter((p) => p.aktywny).map((p) => <option key={p.id} value={p.id}>{p.imie}</option>)}
                </select>
                <select aria-label="Rola" value={nowyPracownik.rola} onChange={(e) => ustawNowegoPracownika({ ...nowyPracownik, rola: e.target.value })}>
                  {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className="przycisk drugi" disabled={!nowyPracownik.id} onClick={() => wykonaj(db.from("zlecenia_pracownicy")
                  .insert({ zlecenie_id: zlecenieId, pracownik_id: nowyPracownik.id, rola: nowyPracownik.rola }))}>Przypisz</button>
              </div>)}
        </div>
      </section>

      {wlasciciel && <>
        <section className="karta">
          <div className="tytul"><h2>Kosztorysy</h2><button className="przycisk drugi" onClick={() => przejdz({ ekran: "kosztorys" })}>Wgraj kolejny</button></div>
          {kosztorysy.length === 0 ? <div className="pusto">Brak kosztorysu.</div> : (
            <div className="przewijanie"><table><thead><tr><th>Wersja</th><th>Źródło</th><th className="liczba">RBH</th><th className="liczba">Netto</th><th></th></tr></thead>
              <tbody>{kosztorysy.map((k) => (
                <tr key={k.id}>
                  <td><select aria-label="Wersja kosztorysu" value={k.wersja} onChange={(e) => wykonaj(db.from("kosztorysy").update({ wersja: e.target.value }).eq("id", k.id))}>
                    {Object.entries(WERSJE).map(([w, v]) => <option key={w} value={w}>{v}</option>)}
                  </select></td>
                  <td>{k.autor ?? k.zrodlo}<div className="cichy">{k.data ?? k.utworzono.slice(0, 10)}</div></td>
                  <td className="liczba">{((k.rbh_blach ?? 0) + (k.rbh_lak ?? 0)).toLocaleString("pl-PL")}</td>
                  <td className="liczba">{zl(k.netto)}</td>
                  <td><div className="przyciski">
                    {k.plik && <button className="przycisk drugi" onClick={() => otworzPdf(k.plik!)}>PDF</button>}
                    <button className="przycisk drugi" onClick={() => usunKosztorys(k)}>Usuń</button>
                  </div></td>
                </tr>))}</tbody></table></div>)}
          <div className="srodek cichy">Do wyniku liczy się kosztorys zaakceptowany, a bez niego — najnowszy.</div>
        </section>

        <section className="karta">
          <div className="tytul"><h2>Faktura sprzedaży</h2></div>
          <div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sprzedaz.map((f) => (
              <div key={f.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{f.numer}</strong><span>{f.nazwa_kontrahenta}</span><span className="cichy">{f.data_wystawienia}</span><span>{zl(f.netto)}</span>
                <button className="przycisk drugi" onClick={() => wykonaj(db.from("faktury").update({ zlecenie_id: null }).eq("id", f.id))}>Odepnij</button>
              </div>))}
            <label>Podepnij fakturę z KSeF
              <select value="" onChange={(e) => e.target.value && wykonaj(db.from("faktury").update({ zlecenie_id: zlecenieId }).eq("id", e.target.value), "Podpięto fakturę.")}>
                <option value="">— wybierz fakturę sprzedaży —</option>
                {wolneSprzedaz.map((f) => <option key={f.id} value={f.id}>{f.numer} · {f.nazwa_kontrahenta} · {f.data_wystawienia} · {zl(f.netto)}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="karta">
          <div className="tytul"><h2>Koszty z faktur zakupu</h2></div>
          {koszty.length === 0 ? <div className="pusto">Żadna pozycja z faktur nie jest jeszcze przypisana do tego zlecenia.</div> : (
            <div className="przewijanie"><table><thead><tr><th>Pozycja</th><th>Faktura</th><th>Kategoria</th><th className="liczba">Wartość</th><th></th></tr></thead>
              <tbody>{koszty.map((p) => (
                <tr key={p.id}>
                  <td>{p.nazwa}{p.indeks && <div className="cichy">{p.indeks}</div>}</td>
                  <td>{p.faktury?.nazwa_kontrahenta}<div className="cichy">{p.faktury?.numer} · {p.faktury?.data_wystawienia}</div></td>
                  <td>{KATEGORIE[p.kategoria]}<div className="cichy">{p.sposob === "reczne" ? "ręcznie" : "automatycznie"}</div></td>
                  <td className="liczba">{zl(p.wartosc ?? p.netto)}</td>
                  <td><button className="przycisk drugi" onClick={() => wykonaj(db.from("pozycje_faktur")
                    .update({ zlecenie_id: null, zatwierdzono: null, zatwierdzil: null, sposob: "brak", pewnosc: 0 }).eq("id", p.id), "Odpięto — pozycja wróciła do kolejki.")}>Odepnij</button></td>
                </tr>))}</tbody></table></div>)}
        </section>

        {rola === "wlasciciel" && <div className="przyciski"><button className="przycisk drugi" style={{ color: "var(--zle)" }} onClick={usunZlecenie}>Usuń zlecenie</button></div>}
      </>}
    </div>
  );
}
