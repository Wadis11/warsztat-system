// Rysunek auta w rozkładzie (góra + boki), klikalne elementy nadwozia i zaznaczone czynności.
import { useCallback, useEffect, useState } from "react";
import { db } from "../supabase.ts";

export const CZYNNOSCI = {
  wymiana: { nazwa: "Wymiana", skrot: "W", kolor: "#b42318" },
  blacharka: { nazwa: "Naprawa blacharska", skrot: "B", kolor: "#dd6b20" },
  lakierowanie: { nazwa: "Lakierowanie", skrot: "L", kolor: "#1f5fd1" },
  cieniowanie: { nazwa: "Cieniowanie", skrot: "C", kolor: "#7aa7f0" },
  polerowanie: { nazwa: "Polerowanie", skrot: "P", kolor: "#2f9e6b" },
} as const;
export type Czynnosc = keyof typeof CZYNNOSCI;

interface Ksztalt { d?: string; x?: number; y?: number; w?: number; h?: number; r?: number; cx?: number; cy?: number }
interface Element { id: string; nazwa: string; ksztalt: Ksztalt; lustro?: boolean; etykieta?: [number, number] }

// Układ 420 × 560: środek — auto z góry, po bokach — boki rozłożone na zewnątrz (przód u góry, nadkola na zewnątrz).
// Elementy prawej strony to lustrzane odbicie lewej.
const prostokat = (x: number, y: number, w: number, h: number, r = 8): Ksztalt => ({ x, y, w, h, r });
// [id, nazwa, kształt lewej strony, czy „lewe/prawe” (rodzaj nijaki i liczba mnoga)]
const BOKI: [string, string, Ksztalt, boolean, [number, number]?][] = [
  ["blotnik_przedni", "Błotnik przedni", { d: "M68 62 Q96 56 122 64 L122 172 L66 172 L66 142 A26 26 0 0 0 66 90 Z" }, false, [104, 117]],
  ["drzwi_przednie", "Drzwi przednie", { d: "M66 178 L122 178 L122 294 L66 294 Q62 236 66 178 Z" }, true],
  ["drzwi_tylne", "Drzwi tylne", { d: "M66 300 L122 300 L122 400 L72 406 Q62 352 66 300 Z" }, true],
  ["blotnik_tylny", "Błotnik tylny", { d: "M72 412 L122 406 L122 520 Q96 528 68 520 L66 494 A26 26 0 0 0 66 442 Z" }, false, [104, 468]],
  ["prog", "Próg", prostokat(46, 178, 14, 228, 5), false],
  ["lusterko", "Lusterko", { d: "M126 186 L146 180 L148 196 L128 200 Z" }, true],
  ["slupek_a", "Słupek A", prostokat(128, 206, 12, 38, 4), false],
];
const FELGI: [string, string, number, boolean][] = [["felga_lp", "Felga lewa przednia", 116, false], ["felga_lt", "Felga lewa tylna", 468, false],
  ["felga_pp", "Felga prawa przednia", 116, true], ["felga_pt", "Felga prawa tylna", 468, true]];
const ELEMENTY: Element[] = [
  { id: "zderzak_przedni", nazwa: "Zderzak przedni", ksztalt: { d: "M152 20 Q210 8 268 20 L278 48 Q210 58 142 48 Z" } },
  { id: "grill", nazwa: "Atrapa / grill", ksztalt: prostokat(180, 52, 60, 9, 4) },
  { id: "maska", nazwa: "Maska", ksztalt: { d: "M148 66 Q210 60 272 66 L266 170 Q210 178 154 170 Z" } },
  { id: "dach", nazwa: "Dach", ksztalt: prostokat(158, 224, 104, 154, 16) },
  { id: "klapa_tylna", nazwa: "Klapa tylna", ksztalt: { d: "M154 428 Q210 420 266 428 L272 498 Q210 504 148 498 Z" } },
  { id: "zderzak_tylny", nazwa: "Zderzak tylny", ksztalt: { d: "M142 506 Q210 514 278 506 L268 534 Q210 546 152 534 Z" } },
  ...BOKI.flatMap(([id, nazwa, k, nijaki, etykieta]) => [
    { id: `${id}_l`, nazwa: `${nazwa} ${nijaki ? "lewe" : "lewy"}`, ksztalt: k, etykieta },
    { id: `${id}_p`, nazwa: `${nazwa} ${nijaki ? "prawe" : "prawy"}`, ksztalt: k, lustro: true, etykieta },
  ]),
  ...FELGI.map(([id, nazwa, cy, lustro]) => ({ id, nazwa, ksztalt: { cx: 66, cy, r: 18 }, lustro })),
];
export const NAZWY_ELEMENTOW: Record<string, string> = Object.fromEntries(ELEMENTY.map((e) => [e.id, e.nazwa]));

export type Zaznaczenia = Record<string, { czynnosci: Czynnosc[]; uwagi: string | null }>;
const KOLEJNOSC: Czynnosc[] = ["wymiana", "blacharka", "lakierowanie", "cieniowanie", "polerowanie"];

function srodek(e: Element): [number, number] {
  const k = e.ksztalt;
  let p: [number, number];
  if (e.etykieta) p = e.etykieta;
  else if (k.cx !== undefined) p = [k.cx, k.cy!];
  else if (k.x !== undefined) p = [k.x + k.w! / 2, k.y! + k.h! / 2];
  else {
    // środek z punktów ścieżki (pomijamy promienie i flagi łuków)
    const punkty = [...k.d!.matchAll(/(?:^|[MLQ ]\s*)(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const xs = punkty.map((q) => q[0]), ys = punkty.map((q) => q[1]);
    p = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return e.lustro ? [420 - p[0], p[1]] : p;
}

/** Sam rysunek: do edycji (onWybierz) albo do wydruku. */
export function Rysunek({ zaznaczenia, wybrany, onWybierz, szerokosc = 420 }: {
  zaznaczenia: Zaznaczenia; wybrany?: string | null; onWybierz?: (id: string) => void; szerokosc?: number;
}) {
  return (
    <svg viewBox="0 0 420 560" width={szerokosc} role="img" aria-label="Schemat nadwozia" style={{ maxWidth: "100%", height: "auto", userSelect: "none" }}>
      {/* obrys nadwozia, szyby i okna — tylko tło */}
      <path d="M150 14 Q210 2 270 14 Q286 30 284 60 L280 500 Q282 540 266 546 Q210 556 154 546 Q138 540 140 500 L136 60 Q134 30 150 14 Z" fill="none" stroke="#d5dbe4" strokeWidth="1.5" />

      <path d="M154 178 Q210 172 266 178 L262 216 L158 216 Z" fill="#e6edf7" stroke="#b8c2d0" />
      <path d="M158 384 L262 384 L266 420 Q210 414 154 420 Z" fill="#e6edf7" stroke="#b8c2d0" />
      <text x="91" y="548" textAnchor="middle" fontSize="11" fill="#8a94a6">LEWY BOK</text>
      <text x="329" y="548" textAnchor="middle" fontSize="11" fill="#8a94a6">PRAWY BOK</text>
      <text x="210" y="556" textAnchor="middle" fontSize="11" fill="#8a94a6">TYŁ</text>
      {ELEMENTY.map((e) => {
        const z = zaznaczenia[e.id];
        const cz = z ? KOLEJNOSC.filter((c) => z.czynnosci.includes(c)) : [];
        const kolor = cz.length ? CZYNNOSCI[cz[0]].kolor : "#f3f5f8";
        const wspolne = {
          fill: kolor, fillOpacity: cz.length ? 0.85 : 1, stroke: wybrany === e.id ? "#111" : "#9aa3b2", strokeWidth: wybrany === e.id ? 2.5 : 1.2,
          style: { cursor: onWybierz ? "pointer" : "default" } as const,
          onClick: onWybierz ? () => onWybierz(e.id) : undefined,
        };
        const k = e.ksztalt;
        return (
          <g key={e.id}>
            <g transform={e.lustro ? "translate(420 0) scale(-1 1)" : undefined}>
            <title>{`${e.nazwa}${cz.length ? `: ${cz.map((c) => CZYNNOSCI[c].nazwa.toLowerCase()).join(", ")}` : ""}`}</title>
            {k.d ? <path d={k.d} {...wspolne} /> : k.cx !== undefined ? <circle cx={k.cx} cy={k.cy} r={k.r} {...wspolne} />
              : <rect x={k.x} y={k.y} width={k.w} height={k.h} rx={k.r} {...wspolne} />}
            </g>
          </g>
        );
      })}
      {[false, true].map((lustro) => <g key={String(lustro)} transform={lustro ? "translate(420 0) scale(-1 1)" : undefined} pointerEvents="none" fill="#dfe7f3" fillOpacity="0.75">
        <path d="M106 186 L118 186 L118 286 L106 286 Z" /><path d="M106 306 L118 306 L118 392 L108 396 Z" />
      </g>)}
      {ELEMENTY.map((e) => {
        const z = zaznaczenia[e.id];
        const cz = z ? KOLEJNOSC.filter((c) => z.czynnosci.includes(c)) : [];
        if (!cz.length) return null;
        const [sx, sy] = srodek(e);
        const maly = (e.ksztalt.w !== undefined && e.ksztalt.w < 20) || e.id.startsWith("lusterko");
        return <text key={e.id} x={sx} y={sy + 4} textAnchor="middle" fontSize={maly ? 8 : 12} fontWeight="700" fill="#fff" stroke="#00000055" strokeWidth="0.6" pointerEvents="none">
          {cz.map((c) => CZYNNOSCI[c].skrot).join("")}</text>;
      })}
    </svg>
  );
}

export function Legenda() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
      {KOLEJNOSC.map((c) => <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: CZYNNOSCI[c].kolor, display: "inline-block" }} />
        {CZYNNOSCI[c].skrot} — {CZYNNOSCI[c].nazwa.toLowerCase()}</span>)}
    </div>
  );
}

export const opisElementu = (id: string, z: { czynnosci: Czynnosc[]; uwagi: string | null }) =>
  `${NAZWY_ELEMENTOW[id] ?? id}: ${KOLEJNOSC.filter((c) => z.czynnosci.includes(c)).map((c) => CZYNNOSCI[c].nazwa.toLowerCase()).join(", ")}${z.uwagi ? ` (${z.uwagi})` : ""}`;

export async function wczytajZaznaczenia(zlecenieId: string): Promise<Zaznaczenia> {
  const { data } = await db.from("zlecenia_elementy").select("element, czynnosci, uwagi").eq("zlecenie_id", zlecenieId);
  return Object.fromEntries((data ?? []).map((r: { element: string; czynnosci: Czynnosc[]; uwagi: string | null }) => [r.element, { czynnosci: r.czynnosci, uwagi: r.uwagi }]));
}

/** Edytor w zleceniu: klik w element → wybór czynności, zapis od razu. */
export function SchematAuta({ zlecenieId }: { zlecenieId: string }) {
  const [z, ustawZ] = useState<Zaznaczenia>({});
  const [wybrany, ustawWybrany] = useState<string | null>(null);
  const [blad, ustawBlad] = useState<string | null>(null);
  const wczytaj = useCallback(async () => ustawZ(await wczytajZaznaczenia(zlecenieId)), [zlecenieId]);
  useEffect(() => { wczytaj(); }, [wczytaj]);

  async function zapisz(element: string, czynnosci: Czynnosc[], uwagi: string | null) {
    const { error } = czynnosci.length
      ? await db.from("zlecenia_elementy").upsert({ zlecenie_id: zlecenieId, element, czynnosci, uwagi, zmieniono: new Date().toISOString() })
      : await db.from("zlecenia_elementy").delete().eq("zlecenie_id", zlecenieId).eq("element", element);
    ustawBlad(error ? `Nie zapisano: ${error.message}` : null);
    await wczytaj();
  }
  function przelacz(c: Czynnosc) {
    if (!wybrany) return;
    const obecne = z[wybrany]?.czynnosci ?? [];
    let nowe = obecne.includes(c) ? obecne.filter((x) => x !== c) : [...obecne, c];
    // Cieniowanie to przejście kolorem na sąsiedni element — wyklucza pełne lakierowanie tego samego elementu
    if (c === "cieniowanie" && nowe.includes("cieniowanie")) nowe = nowe.filter((x) => x !== "lakierowanie");
    if (c === "lakierowanie" && nowe.includes("lakierowanie")) nowe = nowe.filter((x) => x !== "cieniowanie");
    ustawZ({ ...z, [wybrany]: { czynnosci: nowe, uwagi: z[wybrany]?.uwagi ?? null } });
    zapisz(wybrany, nowe, z[wybrany]?.uwagi ?? null);
  }
  const zaznaczone = Object.entries(z).filter(([, v]) => v.czynnosci.length);

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: "0 1 420px" }}>
        <Rysunek zaznaczenia={z} wybrany={wybrany} onWybierz={ustawWybrany} />
        <Legenda />
      </div>
      <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 12 }}>
        {blad && <div className="blad">{blad}</div>}
        {!wybrany ? <p className="cichy" style={{ margin: 0 }}>Kliknij element na rysunku i wybierz, co przy nim zrobić. Zaznaczone elementy trafią na kartę pracy.</p> : (
          <div style={{ border: "1px solid var(--linia)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <strong>{NAZWY_ELEMENTOW[wybrany]}</strong>
            {KOLEJNOSC.map((c) => (
              <label key={c} style={{ flexDirection: "row", alignItems: "center", gap: 8, fontWeight: 400 }}>
                <input type="checkbox" style={{ minHeight: 0, width: 18, height: 18, accentColor: CZYNNOSCI[c].kolor }} checked={z[wybrany]?.czynnosci.includes(c) ?? false} onChange={() => przelacz(c)} />
                {CZYNNOSCI[c].nazwa}
              </label>))}
            <label>Uwagi do elementu<input defaultValue={z[wybrany]?.uwagi ?? ""} key={wybrany} placeholder="np. wgniecenie 10 cm, rysa do podkładu"
              onBlur={(e) => z[wybrany]?.czynnosci.length && zapisz(wybrany, z[wybrany].czynnosci, e.target.value.trim() || null)} /></label>
            <div className="przyciski">
              <button className="przycisk drugi" onClick={() => { zapisz(wybrany, [], null); }}>Wyczyść element</button>
              <button className="przycisk drugi" onClick={() => ustawWybrany(null)}>Gotowe</button>
            </div>
          </div>)}
        {zaznaczone.length > 0 && <div>
          <strong>Zaznaczone ({zaznaczone.length})</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {zaznaczone.map(([id, v]) => <li key={id}><button className="link" onClick={() => ustawWybrany(id)}>{opisElementu(id, v)}</button></li>)}
          </ul>
        </div>}
      </div>
    </div>
  );
}
