// Zmiana hasła przez zalogowanego użytkownika (po pierwszym logowaniu na haśle tymczasowym).
import { type FormEvent, useState } from "react";
import type { Kontekst } from "../App.tsx";
import { db } from "../supabase.ts";

export function ZmianaHasla({ przejdz }: Kontekst) {
  const [haslo, ustawHaslo] = useState("");
  const [powtorz, ustawPowtorz] = useState("");
  const [komunikat, ustawKomunikat] = useState<{ blad: boolean; tekst: string } | null>(null);

  async function zapisz(e: FormEvent) {
    e.preventDefault();
    if (haslo.length < 12) { ustawKomunikat({ blad: true, tekst: "Hasło musi mieć co najmniej 12 znaków." }); return; }
    if (haslo !== powtorz) { ustawKomunikat({ blad: true, tekst: "Hasła się różnią." }); return; }
    const { error } = await db.auth.updateUser({ password: haslo });
    ustawKomunikat(error ? { blad: true, tekst: `Nie zmieniono hasła: ${error.message}` } : { blad: false, tekst: "Hasło zmienione. Przy następnym logowaniu użyj nowego." });
    if (!error) { ustawHaslo(""); ustawPowtorz(""); }
  }

  return (
    <form className="kolumna" style={{ maxWidth: 480 }} onSubmit={zapisz}>
      <div className="naglowek"><div><h1>Zmiana hasła</h1><p className="podtytul">Co najmniej 12 znaków. Najlepiej kilka słów, których nie używasz nigdzie indziej.</p></div></div>
      <section className="karta"><div className="srodek" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label>Nowe hasło<input type="password" autoComplete="new-password" value={haslo} onChange={(e) => ustawHaslo(e.target.value)} /></label>
        <label>Powtórz nowe hasło<input type="password" autoComplete="new-password" value={powtorz} onChange={(e) => ustawPowtorz(e.target.value)} /></label>
        {komunikat && <div className={komunikat.blad ? "blad" : "info"} role="status">{komunikat.tekst}</div>}
        <div className="przyciski"><button className="przycisk">Zmień hasło</button>
          <button type="button" className="przycisk drugi" onClick={() => przejdz({ ekran: "pulpit" })}>Wróć</button></div>
      </div></section>
    </form>
  );
}
