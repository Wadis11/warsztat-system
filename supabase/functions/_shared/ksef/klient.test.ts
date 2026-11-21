// Klient KSeF przeciwko atrapie API, która zachowuje się jak opisuje dokumentacja MF:
// odszyfrowuje token kluczem prywatnym i odrzuca złe wyzwanie, zwraca 429 z Retry-After.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { constants, createPrivateKey, privateDecrypt } from "node:crypto";
import { KlientKsef, BladKsef } from "./klient.ts";
import { spkiZCertyfikatu, zBase64 } from "./szyfrowanie.ts";

const sciezka = (n: string) => new URL(`./testy/${n}`, import.meta.url);
const CERT = readFileSync(sciezka("certyfikat-testowy.b64"), "utf8").trim();
const KLUCZ = createPrivateKey(readFileSync(sciezka("klucz-testowy-NIE-PRODUKCYJNY.pem")));
const XML = readFileSync(sciezka("zakup_czesci.xml"), "utf8");

function atrapa(opcje: { token: string; nip: string; statusy?: number[]; limitRaz?: boolean; retryAfter?: string }) {
  const log: string[] = [];
  const statusy = [...(opcje.statusy ?? [200])];
  let limitWykorzystany = false;
  const TS = 1763715600123;

  const fetchAtrapa = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const p = u.pathname.replace(/^\/v2/, "");
    const auth = new Headers(init.headers).get("Authorization");
    log.push(`${init.method ?? "GET"} ${p}`);
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

    if (p === "/security/public-key-certificates") {
      return json([{ certificate: CERT, certificateId: "c1", publicKeyId: "k1", usage: ["KsefTokenEncryption"],
        validFrom: "2025-01-01T00:00:00Z", validTo: "2099-01-01T00:00:00Z" }]);
    }
    if (p === "/auth/challenge") return json({ challenge: "20261121-CR-ABC", timestamp: "", timestampMs: TS, clientIp: "1.1.1.1" });
    if (p === "/auth/ksef-token") {
      const body = JSON.parse(String(init.body));
      const jawny = privateDecrypt(
        { key: KLUCZ, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        Buffer.from(body.encryptedToken, "base64"),
      ).toString("utf8");
      if (jawny !== `${opcje.token}|${TS}` || body.challenge !== "20261121-CR-ABC" || body.contextIdentifier.value !== opcje.nip) {
        return json({ exception: "zły token" }, 400);
      }
      return json({ referenceNumber: "REF-1", authenticationToken: { token: "op-jwt", validUntil: "" } }, 202);
    }
    if (p === "/auth/REF-1") {
      assert.equal(auth, "Bearer op-jwt");
      const code = statusy.length > 1 ? statusy.shift()! : statusy[0];
      return json({ status: { code, description: code === 450 ? "Token unieważniony" : "ok" } });
    }
    if (p === "/auth/token/redeem") return json({ accessToken: { token: "dostep-jwt" }, refreshToken: { token: "r" } });

    assert.equal(auth, "Bearer dostep-jwt", `brak tokena dostępu dla ${p}`);
    if (p === "/invoices/query/metadata") {
      if (opcje.limitRaz && !limitWykorzystany) {
        limitWykorzystany = true;
        return new Response("{}", { status: 429, headers: { "Retry-After": opcje.retryAfter ?? "1" } });
      }
      const body = JSON.parse(String(init.body));
      assert.equal(body.subjectType, "Subject2");
      assert.equal(body.dateRange.dateType, "PermanentStorage");
      assert.equal(body.dateRange.restrictToPermanentStorageHwmDate, true);
      return json({ hasMore: false, isTruncated: false, permanentStorageHwmDate: "2026-11-21T03:00:00Z", invoices: [] });
    }
    if (p.startsWith("/invoices/ksef/")) return new Response(XML, { status: 200, headers: { "Content-Type": "application/xml" } });
    return json({}, 404);
  };
  return { fetch: fetchAtrapa as typeof fetch, log };
}

const BAZA = "https://api-test.ksef.mf.gov.pl/v2";

test("klucz publiczny wycinany z certyfikatu X.509", () => {
  const spki = spkiZCertyfikatu(zBase64(CERT));
  assert.equal(spki[0], 0x30);
  assert.ok(spki.length > 250 && spki.length < 320, `SPKI RSA-2048 ma ok. 294 bajty, jest ${spki.length}`);
});

test("logowanie tokenem: szyfrowanie, oczekiwanie na status, wymiana na token dostępu", async () => {
  const a = atrapa({ token: "TOKEN-TESTOWY", nip: "1111111111", statusy: [100, 100, 200] });
  const k = new KlientKsef(BAZA, { fetch: a.fetch });
  await k.zaloguj("1111111111", "TOKEN-TESTOWY", { proby: 5, odstepMs: 1 });
  const s = await k.metadane("Subject2", "2026-02-01T00:00:00Z");
  assert.equal(s.permanentStorageHwmDate, "2026-11-21T03:00:00Z");
  assert.equal(a.log.filter((l) => l === "GET /auth/REF-1").length, 3);
  assert.match(await k.pobierzXml("9990000001-20261119-0A1B2C3D4E5F-AB"), /FV\/2026\/11\/4412/);
});

test("zły token: czytelny błąd zamiast cichej porażki", async () => {
  const a = atrapa({ token: "INNY", nip: "1111111111" });
  const k = new KlientKsef(BAZA, { fetch: a.fetch });
  await assert.rejects(k.zaloguj("1111111111", "TOKEN-TESTOWY", { proby: 2, odstepMs: 1 }), (e: unknown) => {
    assert.ok(e instanceof BladKsef);
    assert.equal(e.status, 400);
    return true;
  });
});

test("unieważniony token: status 450 przerywa logowanie", async () => {
  const a = atrapa({ token: "T", nip: "1111111111", statusy: [100, 450] });
  const k = new KlientKsef(BAZA, { fetch: a.fetch });
  await assert.rejects(k.zaloguj("1111111111", "T", { proby: 5, odstepMs: 1 }), /450.*unieważniony/);
});

test("limit 429: czeka zgodnie z Retry-After i ponawia", async () => {
  const a = atrapa({ token: "T", nip: "1111111111", limitRaz: true });
  const k = new KlientKsef(BAZA, { fetch: a.fetch, maksCzekanieMs: 2000 });
  await k.zaloguj("1111111111", "T", { proby: 2, odstepMs: 1 });
  const s = await k.metadane("Subject2", "2026-02-01T00:00:00Z");
  assert.equal(s.hasMore, false);
  assert.equal(a.log.filter((l) => l === "POST /invoices/query/metadata").length, 2);
});

test("limit godzinowy 429 (Retry-After w minutach): błąd od razu, bez czekania", async () => {
  const a = atrapa({ token: "T", nip: "1111111111", limitRaz: true, retryAfter: "3221" });
  const k = new KlientKsef(BAZA, { fetch: a.fetch, maksCzekanieMs: 20_000 });
  await k.zaloguj("1111111111", "T", { proby: 2, odstepMs: 1 });
  const start = Date.now();
  await assert.rejects(k.metadane("Subject2", "2026-02-01T00:00:00Z"), (e: unknown) => e instanceof BladKsef && e.status === 429);
  assert.ok(Date.now() - start < 1000);
});
