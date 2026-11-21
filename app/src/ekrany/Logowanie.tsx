import { type FormEvent, useState } from "react";
import { db } from "../supabase.ts";

export function Logowanie() {
  const [email, ustawEmail] = useState("");
  const [haslo, ustawHaslo] = useState("");
  const [blad, ustawBlad] = useState<string | null>(null);
  const [trwa, ustawTrwa] = useState(false);

  async function zaloguj(e: FormEvent) {
    e.preventDefault();
    ustawTrwa(true);
    ustawBlad(null);
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password: haslo });
    ustawTrwa(false);
    if (error) ustawBlad("Nieprawidłowy e-mail lub hasło.");
  }

  return (
    <div className="logowanie">
      <form className="karta" onSubmit={zaloguj}>
        <h1>Warsztat · Rentowność</h1>
        <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => ustawEmail(e.target.value)} /></label>
        <label>Hasło<input type="password" autoComplete="current-password" required value={haslo} onChange={(e) => ustawHaslo(e.target.value)} /></label>
        {blad && <div className="blad" role="alert">{blad}</div>}
        <button className="przycisk" disabled={trwa}>{trwa ? "Logowanie…" : "Zaloguj"}</button>
      </form>
    </div>
  );
}
