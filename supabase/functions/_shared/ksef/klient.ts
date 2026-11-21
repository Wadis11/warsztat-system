// Klient KSeF API 2.0: uwierzytelnienie tokenem KSeF, lista metadanych faktur, pobranie XML.
// Dokumentacja: https://github.com/CIRFMF/ksef-docs (uwierzytelnianie.md, pobieranie-faktur/, limity/)
import { zaszyfrujToken } from "./szyfrowanie.ts";

export const SRODOWISKA = {
  test: "https://api-test.ksef.mf.gov.pl/v2",
  demo: "https://api-demo.ksef.mf.gov.pl/v2",
  prod: "https://api.ksef.mf.gov.pl/v2",
} as const;

export type TypPodmiotu = "Subject1" | "Subject2"; // 1 = my sprzedajemy, 2 = my kupujemy

export interface MetadaneFaktury {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  permanentStorageDate: string;
  seller: { nip: string; name?: string };
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  invoiceType: string;
}

export interface StronaMetadanych {
  hasMore: boolean;
  isTruncated: boolean;
  permanentStorageHwmDate?: string;
  invoices: MetadaneFaktury[];
}

export class BladKsef extends Error {
  status: number;
  szczegoly: string;
  constructor(status: number, szczegoly: string) {
    super(`KSeF ${status}: ${szczegoly}`);
    this.status = status;
    this.szczegoly = szczegoly;
  }
}

type Fetch = typeof fetch;
const czekaj = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KlientKsef {
  private accessToken: string | null = null;
  private baseUrl: string;
  private opcje: { fetch?: Fetch; maksCzekanieMs?: number };

  constructor(baseUrl: string, opcje: { fetch?: Fetch; maksCzekanieMs?: number } = {}) {
    this.baseUrl = baseUrl;
    this.opcje = opcje;
  }

  private get f(): Fetch {
    return this.opcje.fetch ?? fetch;
  }

  /** Wywołanie z obsługą 429 (Retry-After) i jednolitym raportowaniem błędów. */
  private async zadanie(sciezka: string, init: RequestInit = {}, token?: string, proby = 3): Promise<Response> {
    const naglowki = new Headers(init.headers);
    naglowki.set("Accept", naglowki.get("Accept") ?? "application/json");
    if (init.body) naglowki.set("Content-Type", "application/json");
    const bearer = token ?? this.accessToken;
    if (bearer) naglowki.set("Authorization", `Bearer ${bearer}`);

    const res = await this.f(`${this.baseUrl}${sciezka}`, { ...init, headers: naglowki });
    if (res.status === 429 && proby > 0) {
      const sek = Number(res.headers.get("Retry-After") ?? "5");
      const ms = (Number.isFinite(sek) ? sek : 5) * 1000;
      // Limit godzinowy (Retry-After w minutach): nie czekamy, kolejne uruchomienie dokończy pracę.
      if (ms > (this.opcje.maksCzekanieMs ?? 60_000)) {
        throw new BladKsef(429, (await res.text()).slice(0, 500));
      }
      await res.body?.cancel();
      await czekaj(ms);
      return this.zadanie(sciezka, init, token, proby - 1);
    }
    if (!res.ok) throw new BladKsef(res.status, (await res.text()).slice(0, 500));
    return res;
  }

  private async json<T>(sciezka: string, init: RequestInit = {}, token?: string): Promise<T> {
    return (await this.zadanie(sciezka, init, token)).json() as Promise<T>;
  }

  /** Pełne uwierzytelnienie tokenem KSeF w kontekście NIP firmy. */
  async zaloguj(nip: string, tokenKsef: string, opcje = { proby: 20, odstepMs: 1500 }): Promise<void> {
    const certy = await this.json<{ certificate: string; usage: string[]; validFrom: string; validTo: string }[]>(
      "/security/public-key-certificates",
    );
    const teraz = Date.now();
    const cert = certy.find((c) =>
      c.usage.includes("KsefTokenEncryption") && Date.parse(c.validFrom) <= teraz && teraz <= Date.parse(c.validTo)
    );
    if (!cert) throw new Error("KSeF nie udostępnił ważnego klucza do szyfrowania tokena");

    const wyzwanie = await this.json<{ challenge: string; timestampMs: number }>("/auth/challenge", { method: "POST" });
    const encryptedToken = await zaszyfrujToken(tokenKsef, wyzwanie.timestampMs, cert.certificate);

    const init = await this.json<{ referenceNumber: string; authenticationToken: { token: string } }>(
      "/auth/ksef-token",
      {
        method: "POST",
        body: JSON.stringify({
          challenge: wyzwanie.challenge,
          contextIdentifier: { type: "Nip", value: nip },
          encryptedToken,
        }),
      },
    );
    const tokenOperacji = init.authenticationToken.token;

    for (let i = 0; i < opcje.proby; i++) {
      const st = await this.json<{ status: { code: number; description: string; details?: string[] } }>(
        `/auth/${init.referenceNumber}`, {}, tokenOperacji,
      );
      if (st.status.code === 200) break;
      if (st.status.code !== 100) {
        throw new BladKsef(st.status.code, [st.status.description, ...(st.status.details ?? [])].join(" — "));
      }
      if (i === opcje.proby - 1) throw new Error("Uwierzytelnianie KSeF trwa zbyt długo");
      await czekaj(opcje.odstepMs);
    }

    const tokeny = await this.json<{ accessToken: { token: string } }>(
      "/auth/token/redeem", { method: "POST" }, tokenOperacji,
    );
    this.accessToken = tokeny.accessToken.token;
  }

  /** Jedna strona metadanych faktur po dacie trwałego zapisu, ograniczona do HWM (dane kompletne). */
  async metadane(typ: TypPodmiotu, od: string, strona = 0, rozmiar = 250, doDaty?: string): Promise<StronaMetadanych> {
    return this.json<StronaMetadanych>(
      `/invoices/query/metadata?pageOffset=${strona}&pageSize=${rozmiar}&sortOrder=Asc`,
      {
        method: "POST",
        body: JSON.stringify({
          subjectType: typ,
          dateRange: { dateType: "PermanentStorage", from: od, to: doDaty, restrictToPermanentStorageHwmDate: true },
        }),
      },
    );
  }

  async pobierzXml(numerKsef: string): Promise<string> {
    const res = await this.zadanie(`/invoices/ksef/${encodeURIComponent(numerKsef)}`, {
      headers: { Accept: "application/xml" },
    });
    return res.text();
  }
}
