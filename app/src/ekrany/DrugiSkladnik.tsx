// Drugi składnik logowania: kod z aplikacji uwierzytelniającej (TOTP).
// Przy pierwszym logowaniu konfiguracja (kod QR), potem tylko wpisanie 6 cyfr.
import { type FormEvent, useEffect, useState } from "react";
import { db } from "../supabase.ts";

export function DrugiSkladnik({ obowiazkowy, gotowe }: { obowiazkowy: boolean; gotowe: () => Promise<void> }) {
  const [czynnikId, ustawCzynnik] = useState<string | null>(null);
  const [qr, ustawQr] = useState<string | null>(null);
  const [sekret, ustawSekret] = useState<string | null>(null);
  const [kod, ustawKod] = useState("");
  const [blad, ustawBlad] = useState<string | null>(null);
  const [trwa, ustawTrwa] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await db.auth.mfa.listFactors();
      const zweryfikowany = data?.totp.find((f) => f.status === "verified");
      if (zweryfikowany) { ustawCzynnik(zweryfikowany.id); return; }
      // Porzucone, niedokończone konfiguracje blokują nową: usuwamy je
      for (const f of data?.all ?? []) if (f.status !== "verified") await db.auth.mfa.unenroll({ factorId: f.id });
      const { data: nowy, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "Telefon" });
      if (error || !nowy) { ustawBlad("Nie udało się rozpocząć konfiguracji. Odśwież stronę."); return; }
      ustawCzynnik(nowy.id);
      ustawQr(nowy.totp.qr_code);
      ustawSekret(nowy.totp.secret);
    })();
  }, []);

  async function potwierdz(e: FormEvent) {
    e.preventDefault();
    if (!czynnikId) return;
    ustawTrwa(true);
    ustawBlad(null);
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId: czynnikId, code: kod.replace(/\s/g, "") });
    ustawTrwa(false);
    if (error) { ustawBlad("Kod nieprawidłowy albo wygasł. Wpisz aktualny kod z aplikacji."); return; }
    await gotowe();
  }

  return (
    <div className="logowanie">
      <form className="karta" onSubmit={potwierdz}>
        <h1>{qr ? "Zabezpiecz konto" : "Kod z telefonu"}</h1>
        {qr ? (
          <>
            <p>Zeskanuj kod aplikacją uwierzytelniającą (Google Authenticator, Microsoft Authenticator, 1Password) i wpisz 6 cyfr, które pokaże.</p>
            <img src={qr} alt="Kod QR do aplikacji uwierzytelniającej" width={200} height={200} style={{ alignSelf: "center" }} />
            {sekret && <p className="cichy">Nie możesz zeskanować? Wpisz ręcznie: <code>{sekret}</code></p>}
          </>
        ) : (
          <p>Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej na telefonie.</p>
        )}
        {obowiazkowy && !qr && <p className="cichy">Dla konta właściciela kod jest wymagany przy każdym logowaniu.</p>}
        <label>Kod
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus value={kod} onChange={(e) => ustawKod(e.target.value)} />
        </label>
        {blad && <div className="blad" role="alert">{blad}</div>}
        <button className="przycisk" disabled={trwa || !czynnikId}>{trwa ? "Sprawdzanie…" : "Potwierdź"}</button>
        <button type="button" className="przycisk drugi" onClick={() => db.auth.signOut()}>Wyloguj</button>
      </form>
    </div>
  );
}
