// Szyfrowanie tokena KSeF kluczem publicznym Ministerstwa Finansów (RSA-OAEP, SHA-256).
// Klucz przychodzi jako certyfikat X.509 (DER, Base64); WebCrypto przyjmuje tylko SubjectPublicKeyInfo,
// więc wycinamy go z certyfikatu minimalnym parserem DER.

interface Element { tag: number; start: number; contentStart: number; end: number }

function czytaj(der: Uint8Array, pos: number): Element {
  const tag = der[pos];
  let len = der[pos + 1];
  let contentStart = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("Nieobsługiwana długość DER");
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | der[pos + 2 + i];
    contentStart += n;
  }
  const end = contentStart + len;
  if (end > der.length) throw new Error("Uszkodzony certyfikat DER");
  return { tag, start: pos, contentStart, end };
}

function dzieci(der: Uint8Array, el: Element): Element[] {
  const out: Element[] = [];
  for (let p = el.contentStart; p < el.end;) {
    const e = czytaj(der, p);
    out.push(e);
    p = e.end;
  }
  return out;
}

/** Certificate ::= SEQUENCE { tbsCertificate, ... }; tbs: [0] version?, serial, sigAlg, issuer, validity, subject, SPKI */
export function spkiZCertyfikatu(der: Uint8Array): Uint8Array<ArrayBuffer> {
  const cert = czytaj(der, 0);
  const tbs = dzieci(der, cert)[0];
  const pola = dzieci(der, tbs);
  const przesuniecie = pola[0].tag === 0xa0 ? 1 : 0; // opcjonalna wersja [0]
  const spki = pola[przesuniecie + 5];
  if (!spki || spki.tag !== 0x30) throw new Error("Nie znaleziono klucza publicznego w certyfikacie");
  return new Uint8Array(der.slice(spki.start, spki.end));
}

export const zBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const doBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Zwraca Base64 szyfrogramu „{token}|{timestampMs}”, jak wymaga POST /auth/ksef-token. */
export async function zaszyfrujToken(token: string, timestampMs: number, certyfikatB64: string): Promise<string> {
  const spki = spkiZCertyfikatu(zBase64(certyfikatB64));
  const klucz = await crypto.subtle.importKey("spki", spki, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const dane = new TextEncoder().encode(`${token}|${timestampMs}`);
  const szyfrogram = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, klucz, dane));
  return doBase64(szyfrogram);
}
