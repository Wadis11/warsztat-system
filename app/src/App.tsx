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

export type Rola = "wlasciciel" | "pracownik";
export type Widok =
  | { ekran: "kolejka" }
  | { ekran: "zlecenia" }
  | { ekran: "nowe" }
  | { ekran: "kosztorys" }
  | { ekran: "pracownicy" }
  | { ekran: "platnosci" }
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
  const [widok, ustawWidok] = useState<Widok>({ ekran: "zlecenia" });
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

  // Właściciel zaczyna dzień od kolejki
  useEffect(() => { if (rola === "wlasciciel") ustawWidok({ ekran: "kolejka" }); }, [rola]);

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
  if (poziom.obecny !== "aal2" && (rola === "wlasciciel" || poziom.wymagany === "aal2")) {
    return <DrugiSkladnik obowiazkowy={rola === "wlasciciel"} gotowe={odswiezPoziom} />;
  }

  const k: Kontekst = { rola, przejdz: ustawWidok };
  const pozycja = (w: Widok["ekran"], etykieta: string, licznik?: number | null) => (
    <button aria-current={widok.ekran === w ? "page" : undefined} onClick={() => ustawWidok({ ekran: w } as Widok)}>
      {etykieta}{licznik ? <span className="licznik">{licznik}</span> : null}
    </button>
  );

  return (
    <div className="uklad">
      <nav className="menu" aria-label="Menu główne">
        <div className="marka">Warsztat · Rentowność</div>
        {rola === "wlasciciel" && pozycja("kolejka", "Do sprawdzenia", wKolejce)}
        {pozycja("zlecenia", "Zlecenia")}
        {pozycja("nowe", "Nowe zlecenie")}
        {rola === "wlasciciel" && pozycja("platnosci", "Płatności", wTerminie)}
        {rola === "wlasciciel" && pozycja("pracownicy", "Pracownicy")}
        <div className="stopka">
          {sesja.user.email}<br />
          <button style={{ padding: "8px 0", color: "#aeb6c2" }} onClick={() => db.auth.signOut()}>Wyloguj</button>
        </div>
      </nav>
      <main className="tresc">
        {widok.ekran === "kolejka" && <Kolejka {...k} poZmianie={odswiezLicznik} />}
        {widok.ekran === "zlecenia" && <Zlecenia {...k} />}
        {widok.ekran === "nowe" && <NoweZlecenie {...k} />}
        {widok.ekran === "kosztorys" && <NoweZlecenie {...k} tryb="kosztorys" />}
        {widok.ekran === "platnosci" && <Platnosci {...k} />}
        {widok.ekran === "pracownicy" && <Pracownicy {...k} />}
        {widok.ekran === "zlecenie" && <Zlecenie key={widok.zlecenieId} {...k} zlecenieId={widok.zlecenieId} />}
        {widok.ekran === "karta" && <KartaPracy {...k} zlecenieId={widok.zlecenieId} />}
      </main>
    </div>
  );
}
