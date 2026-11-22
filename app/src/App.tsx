import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { db } from "./supabase.ts";
import { Logowanie } from "./ekrany/Logowanie.tsx";
import { DrugiSkladnik } from "./ekrany/DrugiSkladnik.tsx";
import { Kolejka } from "./ekrany/Kolejka.tsx";
import { Zlecenia } from "./ekrany/Zlecenia.tsx";
import { NoweZlecenie } from "./ekrany/NoweZlecenie.tsx";
import { KartaPracy } from "./ekrany/KartaPracy.tsx";
import { Zlecenie } from "./ekrany/Zlecenie.tsx";
import { Pracownicy } from "./ekrany/Pracownicy.tsx";
import { Platnosci } from "./ekrany/Platnosci.tsx";
import { Material } from "./ekrany/Material.tsx";
import { Lakiery } from "./ekrany/Lakiery.tsx";
import { Pulpit } from "./ekrany/Pulpit.tsx";
import { Zastepcze, AutoZastepcze, NoweWypozyczenie, Umowa } from "./ekrany/Zastepcze.tsx";
import { ZmianaHasla } from "./ekrany/ZmianaHasla.tsx";

export type Rola = "wlasciciel" | "biuro" | "pracownik";
/** Czy rola widzi kwoty (kosztorysy, koszty, rentowność). Płatności widzi tylko właściciel. */
export const widziKwoty = (r: Rola) => r !== "pracownik";
export type Widok =
  | { ekran: "pulpit" }
  | { ekran: "kolejka" }
  | { ekran: "zastepcze" }
  | { ekran: "auto_zastepcze"; autoId: string }
  | { ekran: "wypozyczenie"; autoId?: string; zlecenieId?: string; od?: string; wypozyczenieId?: string }
  | { ekran: "umowa"; wypozyczenieId: string }
  | { ekran: "haslo" }
  | { ekran: "zlecenia" }
  | { ekran: "nowe" }
  | { ekran: "kosztorys" }
  | { ekran: "pracownicy" }
  | { ekran: "platnosci" }
  | { ekran: "material" }
  | { ekran: "lakiery" }
  | { ekran: "zlecenie"; zlecenieId: string }
  | { ekran: "karta"; zlecenieId: string };

export interface Kontekst {
  rola: Rola;
  przejdz: (w: Widok) => void;
}

export function App() {
  const [sesja, ustawSesje] = useState<Session | null | undefined>(undefined);
  const [poziom, ustawPoziom] = useState<{ obecny: string; wymagany: string } | null>(null);
  const [rola, ustawRole] = useState<Rola | null | undefined>(undefined);
  const [widok, ustawWidok] = useState<Widok>({ ekran: "pulpit" });
  const [wKolejce, ustawWKolejce] = useState<number | null>(null);
  const [wTerminie, ustawWTerminie] = useState<number | null>(null);

  useEffect(() => {
    db.auth.getSession().then(({ data }) => ustawSesje(data.session));
    const { data } = db.auth.onAuthStateChange((_z, s) => ustawSesje(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const odswiezPoziom = useCallback(async () => {
    const { data } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data) ustawPoziom({ obecny: data.currentLevel ?? "aal1", wymagany: data.nextLevel ?? "aal1" });
  }, []);

  useEffect(() => {
    if (!sesja) { ustawRole(undefined); ustawPoziom(null); return; }
    odswiezPoziom();
    db.rpc("moja_rola").then(({ data }) => ustawRole((data as Rola | null) ?? null));
  }, [sesja, odswiezPoziom]);


  const odswiezLicznik = useCallback(async () => {
    if (rola !== "wlasciciel" || poziom?.obecny !== "aal2") return;
    const { count } = await db.from("kolejka_pozycji").select("id", { count: "exact", head: true });
    ustawWKolejce(count ?? 0);
    // Płatności po terminie albo do 3 dni
    const t = await db.from("platnosci").select("id", { count: "exact", head: true }).eq("status", "do_zaplaty").lte("dni_do_terminu", 3);
    ustawWTerminie(t.count ?? 0);
  }, [rola, poziom]);
  useEffect(() => { odswiezLicznik(); }, [odswiezLicznik, widok]);

  if (sesja === undefined) return null;
  if (!sesja) return <Logowanie />;
  if (rola === undefined || poziom === null) return null;
  if (rola === null) {
    return (
      <div className="logowanie"><div className="karta">
        <h1>Brak dostępu</h1>
        <p>To konto nie ma przypisanej roli. Poproś właściciela o aktywację.</p>
        <button className="przycisk drugi" onClick={() => db.auth.signOut()}>Wyloguj</button>
      </div></div>
    );
  }
  // Drugi składnik: obowiązkowy dla właściciela; dla pracownika, jeśli go skonfigurował
  if (poziom.obecny !== "aal2" && (widziKwoty(rola) || poziom.wymagany === "aal2")) {
    return <DrugiSkladnik obowiazkowy={widziKwoty(rola)} gotowe={odswiezPoziom} />;
  }

  const k: Kontekst = { rola, przejdz: ustawWidok };
  const GRUPY: Partial<Record<Widok["ekran"], Widok["ekran"]>> = { kolejka: "platnosci", auto_zastepcze: "zastepcze", wypozyczenie: "zastepcze", umowa: "zastepcze", zlecenie: "zlecenia", karta: "zlecenia", kosztorys: "nowe" };
  const aktywny = GRUPY[widok.ekran] ?? widok.ekran;
  const pozycja = (w: Widok["ekran"], etykieta: string, licznik?: number | null) => (
    <button aria-current={aktywny === w ? "page" : undefined} onClick={() => ustawWidok({ ekran: w } as Widok)}>
      {etykieta}{licznik ? <span className="licznik">{licznik}</span> : null}
    </button>
  );

  return (
    <div className="uklad">
      <nav className="menu" aria-label="Menu główne">
        <div className="marka">Warsztat · Rentowność</div>
        {pozycja("pulpit", "Pulpit")}
        {pozycja("zlecenia", "Zlecenia")}
        {pozycja("nowe", "Nowe zlecenie")}
        {pozycja("zastepcze", "Auta zastępcze")}
        {rola === "wlasciciel" && pozycja("platnosci", "Płatności", (wTerminie ?? 0) + (wKolejce ?? 0))}
        {widziKwoty(rola) && pozycja("material", "Materiał")}
        {widziKwoty(rola) && pozycja("lakiery", "Lakiery")}
        {widziKwoty(rola) && pozycja("pracownicy", "Pracownicy")}
        <div className="stopka">
          {sesja.user.email}<br />
          <button style={{ padding: "8px 0", color: "#aeb6c2" }} onClick={() => ustawWidok({ ekran: "haslo" })}>Zmień hasło</button>
          <button style={{ padding: "8px 0", color: "#aeb6c2" }} onClick={() => db.auth.signOut()}>Wyloguj</button>
        </div>
      </nav>
      <main className="tresc">
        {widok.ekran === "pulpit" && <Pulpit {...k} />}
        {(widok.ekran === "platnosci" || widok.ekran === "kolejka") && (
          <div className="przyciski" style={{ marginBottom: 16 }}>
            <button className={`przycisk ${widok.ekran === "platnosci" ? "" : "drugi"}`} onClick={() => ustawWidok({ ekran: "platnosci" })}>Do zapłaty{wTerminie ? ` (${wTerminie})` : ""}</button>
            <button className={`przycisk ${widok.ekran === "kolejka" ? "" : "drugi"}`} onClick={() => ustawWidok({ ekran: "kolejka" })}>Do sprawdzenia{wKolejce ? ` (${wKolejce})` : ""}</button>
          </div>)}
        {widok.ekran === "kolejka" && <Kolejka {...k} poZmianie={odswiezLicznik} />}
        {widok.ekran === "zastepcze" && <Zastepcze {...k} />}
        {widok.ekran === "auto_zastepcze" && <AutoZastepcze key={widok.autoId} {...k} autoId={widok.autoId} />}
        {widok.ekran === "wypozyczenie" && <NoweWypozyczenie {...k} {...widok} />}
        {widok.ekran === "haslo" && <ZmianaHasla {...k} />}
        {widok.ekran === "umowa" && <Umowa {...k} wypozyczenieId={widok.wypozyczenieId} />}
        {widok.ekran === "zlecenia" && <Zlecenia {...k} />}
        {widok.ekran === "nowe" && <NoweZlecenie {...k} />}
        {widok.ekran === "kosztorys" && <NoweZlecenie {...k} tryb="kosztorys" />}
        {widok.ekran === "platnosci" && <Platnosci {...k} />}
        {widok.ekran === "material" && <Material {...k} />}
        {widok.ekran === "lakiery" && <Lakiery {...k} />}
        {widok.ekran === "pracownicy" && <Pracownicy {...k} />}
        {widok.ekran === "zlecenie" && <Zlecenie key={widok.zlecenieId} {...k} zlecenieId={widok.zlecenieId} />}
        {widok.ekran === "karta" && <KartaPracy {...k} zlecenieId={widok.zlecenieId} />}
      </main>
    </div>
  );
}
