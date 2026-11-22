import { useEffect, useState } from "react";
import { db } from "../supabase.ts";

export interface Klient { id: string; nazwa: string; segment: string }
export const SEGMENTY: Record<string, string> = {
  ayvens: "Ayvens", ubezpieczyciel: "Ubezpieczyciel", prywatny: "Klient prywatny", powiazany: "Firma powiązana", pozostali: "Pozostali",
};
/** Rodzaje zleceń — każdy ma osobną numerację NN/MM/RRRR. */
export const RODZAJE: Record<string, string> = {
  ayvens: "Ayvens", ubezpieczenie: "Ubezpieczalnia", prywatne: "Naprawy prywatne", powiazani: "Powiązani", inne: "Inne",
};
export const RODZAJ_Z_SEGMENTU: Record<string, string> = {
  ayvens: "ayvens", ubezpieczyciel: "ubezpieczenie", prywatny: "prywatne", powiazany: "powiazani", pozostali: "inne",
};

/** Wybór klienta z listy albo dodanie nowego w miejscu. Zwraca id przez onChange. */
export function WyborKlienta({ wartosc, onChange, podpowiedzSegmentu }: {
  wartosc: string; onChange: (id: string, segment?: string) => void; podpowiedzSegmentu?: string;
}) {
  const [klienci, ustawKlientow] = useState<Klient[]>([]);
  const [nowy, ustawNowy] = useState(false);
  const [nazwa, ustawNazwe] = useState("");
  const [segment, ustawSegment] = useState(podpowiedzSegmentu ?? "prywatny");
  const [blad, ustawBlad] = useState<string | null>(null);

  async function wczytaj() {
    const { data } = await db.from("klienci").select("id, nazwa, segment").order("nazwa");
    ustawKlientow((data ?? []) as Klient[]);
    return (data ?? []) as Klient[];
  }
  useEffect(() => {
    wczytaj().then((k) => {
      // Podpowiedź: jedyny klient segmentu (np. Ayvens) wybierany od razu
      if (!wartosc && podpowiedzSegmentu) {
        const pasujacy = k.filter((x) => x.segment === podpowiedzSegmentu);
        if (pasujacy.length === 1) onChange(pasujacy[0].id, pasujacy[0].segment);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podpowiedzSegmentu]);

  async function dodaj() {
    if (!nazwa.trim()) return;
    const { data, error } = await db.from("klienci").insert({ nazwa: nazwa.trim(), segment }).select("id").single();
    if (error) { ustawBlad(error.message); return; }
    await wczytaj();
    onChange(data.id, segment);
    ustawNowy(false);
    ustawNazwe("");
  }

  if (nowy) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label>Nazwa nowego klienta<input value={nazwa} onChange={(e) => ustawNazwe(e.target.value)} autoFocus /></label>
        <label>Rodzaj
          <select value={segment} onChange={(e) => ustawSegment(e.target.value)}>
            {Object.entries(SEGMENTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {blad && <div className="blad">{blad}</div>}
        <div className="przyciski">
          <button type="button" className="przycisk" onClick={dodaj}>Dodaj klienta</button>
          <button type="button" className="przycisk drugi" onClick={() => ustawNowy(false)}>Anuluj</button>
        </div>
      </div>
    );
  }
  return (
    <label>Klient (płatnik)
      <select value={wartosc} onChange={(e) => (e.target.value === "__nowy" ? ustawNowy(true) : onChange(e.target.value, klienci.find((k) => k.id === e.target.value)?.segment))}>
        <option value="">— wybierz —</option>
        {klienci.map((k) => <option key={k.id} value={k.id}>{k.nazwa} ({SEGMENTY[k.segment]})</option>)}
        <option value="__nowy">+ Nowy klient…</option>
      </select>
    </label>
  );
}
