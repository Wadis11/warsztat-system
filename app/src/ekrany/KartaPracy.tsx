// Karta pracy do wydruku: numer zlecenia, auto, zakres prac. Bez cen.
import { useEffect, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db } from "../supabase.ts";

interface Zlecenie { numer: string; nr_rej: string | null; vin: string | null; marka: string | null; model: string | null;
  zakres_prac: string | null; data_przyjecia: string; nr_szkody: string | null }
interface Operacja { kolejnosc: number; rodzaj: string; opis: string }

export function KartaPracy({ zlecenieId, przejdz }: Kontekst & { zlecenieId: string }) {
  const [z, ustawZ] = useState<Zlecenie | null>(null);
  const [operacje, ustawOperacje] = useState<Operacja[]>([]);

  useEffect(() => {
    db.from("zlecenia").select("numer, nr_rej, vin, marka, model, zakres_prac, data_przyjecia, nr_szkody").eq("id", zlecenieId).single()
      .then(({ data }) => ustawZ(data as Zlecenie));
    db.from("zlecenia_operacje").select("kolejnosc, rodzaj, opis").eq("zlecenie_id", zlecenieId).order("kolejnosc")
      .then(({ data }) => ustawOperacje((data ?? []) as Operacja[]));
  }, [zlecenieId]);

  if (!z) return null;
  const linie = [
    ...(z.zakres_prac ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    ...operacje.map((o) => o.opis),
  ];

  return (
    <div className="kolumna karta-pracy">
      <div className="przyciski bez-druku">
        <button className="przycisk" onClick={() => window.print()}>Drukuj</button>
        <button className="przycisk drugi" onClick={() => przejdz({ ekran: "zlecenia" })}>← Zlecenia</button>
      </div>
      <section className="karta"><div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="cichy">KARTA PRACY · przyjęte {z.data_przyjecia}</div>
        <h1>{z.numer}</h1>
        <div className="duzy">{[z.marka, z.model].filter(Boolean).join(" ")} · {z.nr_rej}</div>
        <div className="cichy">VIN: {z.vin ?? "—"}{z.nr_szkody ? ` · szkoda ${z.nr_szkody}` : ""}</div>
        <h2>Zakres prac</h2>
        {linie.length ? <ol>{linie.map((l, i) => <li key={i}>{l}</li>)}</ol> : <p className="cichy">Brak opisu zakresu prac.</p>}
        <p className="cichy" style={{ marginTop: 24 }}>Przy zamawianiu części i mieszaniu lakieru podawaj numer {z.numer} albo rejestrację {z.nr_rej}.</p>
      </div></section>
    </div>
  );
}
