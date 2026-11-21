// Zlecenie bez kosztorysu (np. naprawa prywatna): krótki formularz i od razu karta pracy.
import { type FormEvent, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db } from "../supabase.ts";
import { WyborKlienta } from "./WyborKlienta.tsx";

export function NoweZlecenie({ przejdz }: Kontekst) {
  const [f, ustawF] = useState({ nr_rej: "", vin: "", marka: "", model: "", nr_szkody: "", zakres_prac: "" });
  const [klient, ustawKlienta] = useState("");
  const [blad, ustawBlad] = useState<string | null>(null);
  const [trwa, ustawTrwa] = useState(false);
  const pole = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => ustawF({ ...f, [k]: e.target.value }) });

  async function zapisz(e: FormEvent) {
    e.preventDefault();
    ustawTrwa(true);
    ustawBlad(null);
    const { data, error } = await db.from("zlecenia").insert({
      nr_rej: f.nr_rej.trim().toUpperCase() || null,
      vin: f.vin.trim().toUpperCase() || null,
      marka: f.marka.trim().toUpperCase() || null,
      model: f.model.trim() || null,
      nr_szkody: f.nr_szkody.trim() || null,
      zakres_prac: f.zakres_prac.trim() || null,
      klient_id: klient || null,
    }).select("id").single();
    ustawTrwa(false);
    if (error) { ustawBlad(`Nie zapisano: ${error.message}`); return; }
    przejdz({ ekran: "karta", zlecenieId: data.id });
  }

  return (
    <form className="kolumna" onSubmit={zapisz}>
      <div className="naglowek"><div><h1>Nowe zlecenie</h1>
        <p className="podtytul">Numer zlecenia nadaje się sam. Zlecenia z kosztorysem Audatex zakładaj przez „Wgraj kosztorys”.</p></div></div>
      <section className="karta"><div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="siatka">
          <label>Numer rejestracyjny<input required {...pole("nr_rej")} placeholder="KR 12345" /></label>
          <label>VIN<input {...pole("vin")} maxLength={17} placeholder="17 znaków" /></label>
          <label>Marka<input {...pole("marka")} /></label>
          <label>Model<input {...pole("model")} /></label>
          <label>Nr szkody (jeśli jest)<input {...pole("nr_szkody")} /></label>
          <WyborKlienta wartosc={klient} onChange={ustawKlienta} podpowiedzSegmentu="prywatny" />
        </div>
        <label>Zakres prac dla pracownika
          <textarea {...pole("zakres_prac")} placeholder={"Jedna czynność w wierszu, np.\nZderzak przedni: naprawa i lakierowanie\nLusterko lewe: wymiana obudowy"} />
        </label>
        {blad && <div className="blad" role="alert">{blad}</div>}
        <div className="przyciski"><button className="przycisk" disabled={trwa}>{trwa ? "Zapisywanie…" : "Zapisz i pokaż kartę pracy"}</button></div>
      </div></section>
    </form>
  );
}
