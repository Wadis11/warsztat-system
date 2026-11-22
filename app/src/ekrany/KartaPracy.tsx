// Karta pracy do wydruku: numer zlecenia, auto, zakres prac. Bez cen.
import { useEffect, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db } from "../supabase.ts";
import { RODZAJE } from "./WyborKlienta.tsx";
import { Legenda, opisElementu, Rysunek, wczytajZaznaczenia, type Zaznaczenia } from "./SchematAuta.tsx";

interface Zlecenie { numer: string; rodzaj: string; numer_rodzaju: string; nr_rej: string | null; vin: string | null; marka: string | null; model: string | null;
  zakres_prac: string | null; data_przyjecia: string; nr_szkody: string | null; kod_lakieru: string | null }

export function KartaPracy({ zlecenieId, przejdz }: Kontekst & { zlecenieId: string }) {
  const [z, ustawZ] = useState<Zlecenie | null>(null);
  const [elementy, ustawElementy] = useState<Zaznaczenia>({});

  useEffect(() => {
    db.from("zlecenia").select("numer, rodzaj, numer_rodzaju, nr_rej, vin, marka, model, zakres_prac, data_przyjecia, nr_szkody, kod_lakieru").eq("id", zlecenieId).single()
      .then(({ data }) => ustawZ(data as Zlecenie));
    wczytajZaznaczenia(zlecenieId).then(ustawElementy);
  }, [zlecenieId]);

  if (!z) return null;
  const zRysunku = Object.entries(elementy).map(([id, v]) => opisElementu(id, v));
  const linie = [
    ...zRysunku,
    ...(z.zakres_prac ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
  ];

  return (
    <div className="kolumna karta-pracy">
      <div className="przyciski bez-druku">
        <button className="przycisk" onClick={() => window.print()}>Drukuj</button>
        <button className="przycisk drugi" onClick={() => przejdz({ ekran: "zlecenia" })}>← Zlecenia</button>
      </div>
      <section className="karta"><div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="cichy">KARTA PRACY · przyjęte {z.data_przyjecia}</div>
        <h1>{RODZAJE[z.rodzaj]} {z.numer_rodzaju}</h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ border: "2px solid #000", borderRadius: 8, padding: "6px 12px", fontSize: 18 }}>Nr do mieszalnika: <strong>{z.numer}</strong></div>
          <div style={{ border: "2px solid #000", borderRadius: 8, padding: "6px 12px", fontSize: 18 }}>Numer lakieru: <strong>{z.kod_lakieru ?? "______________"}</strong></div>
        </div>
        <div className="duzy">{[z.marka, z.model].filter(Boolean).join(" ")} · {z.nr_rej}</div>
        <div className="cichy">VIN: {z.vin ?? "—"}{z.nr_szkody ? ` · szkoda ${z.nr_szkody}` : ""}</div>
        {zRysunku.length > 0 && <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Rysunek zaznaczenia={elementy} szerokosc={300} />
          <div style={{ paddingTop: 8 }}><Legenda /></div>
        </div>}
        <h2>Zakres prac</h2>
        {linie.length ? <ol>{linie.map((l, i) => <li key={i}>{l}</li>)}</ol> : <p className="cichy">Brak opisu zakresu prac.</p>}
        <p className="cichy" style={{ marginTop: 24 }}>Przy zamawianiu części i mieszaniu lakieru podawaj numer {z.numer} albo rejestrację {z.nr_rej}.</p>
      </div></section>
    </div>
  );
}
