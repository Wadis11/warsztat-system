"""Prototyp parsera kosztorysów (Audatex, Audatex w piśmie ubezpieczyciela, weryfikacja ControlExpert).

Użycie: python3 -I audatex.py plik1.pdf [plik2.pdf ...] > wynik.json
"""
import json
import re
import statistics
import sys

import pdfplumber


def num(s):
    """'1 234.56' / '1 234,56' / '24.0' -> float"""
    s = s.replace("zł", "").replace(" ", " ").strip()
    s = s.replace(" ", "")
    if "," in s and "." not in s:
        s = s.replace(",", ".")
    return float(s)


# ---------- tekst stron w siatce znaków (Audatex używa czcionki Courier) ----------

def grid_lines(page):
    """Odtwarza linie strony z zachowaniem kolumn dla znaków o stałej szerokości."""
    mono = [c for c in page.chars if "Courier" in c["fontname"]]
    if not mono:
        return []
    rows = {}
    for c in mono:
        rows.setdefault(round(c["top"] / 2), []).append(c)
    widths = []
    for cs in rows.values():
        cs.sort(key=lambda c: c["x0"])
        widths += [b["x0"] - a["x0"] for a, b in zip(cs, cs[1:]) if 0 < b["x0"] - a["x0"] < 12]
    if not widths:
        return []
    cw = statistics.median(widths)
    left = min(c["x0"] for c in mono)
    out = []
    for key in sorted(rows):
        line = {}
        for c in rows[key]:
            line[round((c["x0"] - left) / cw)] = c["text"]
        width = max(line) + 1
        out.append("".join(line.get(i, " ") for i in range(width)).rstrip())
    return out


def page_texts(pdf):
    return [p.extract_text() or "" for p in pdf.pages]


# ---------- Audatex ----------

def find(pattern, text, group=1, conv=None, flags=0):
    m = re.search(pattern, text, flags)
    if not m:
        return None
    v = m.group(group).strip()
    return conv(v) if conv else v


AMOUNT = r"(\d{1,3}(?: \d{3})*\.\d{2})"


def parse_parts(lines):
    parts = []
    header = None
    for ln in lines:
        if ln.startswith("KOD CZ") and "OKRE" in ln and "CENA" in ln and "KOSZT" not in ln:
            okr = ln.index("OKRE")
            kat = ln.index("NUMER KATALOGOWY") if "NUMER KATALOGOWY" in ln else None
            header = (okr, kat)
            continue
        if header is None:
            continue
        if ln.startswith("---") or "SYSTEM AUDATEX" in ln or "K A L K U L A C J A" in ln:
            header = None if ln.startswith("---") else header
            continue
        m = re.match(r"^(\d{4}|KN|BRAK NR)\s", ln)
        pm = re.search(r"(\d+\.\d{2})[*I]*$", ln)
        if not m or not pm:
            continue
        okr, kat = header
        qty_txt = ln[len(m.group(1)):okr].strip()
        if kat:
            name = ln[okr:kat - 1].strip()
            flag = ln[kat - 1:kat].strip()
            catalog = ln[kat:pm.start()].strip()
        else:
            name, flag, catalog = ln[okr:pm.start()].strip(), "", ""
        parts.append({
            "kod": m.group(1),
            "ilosc": qty_txt or "1",
            "nazwa": name,
            "nr_katalogowy": catalog,
            "znacznik": flag or None,
            "cena": float(pm.group(1)),
        })
    return parts


def parse_audatex(pdf, texts):
    full = "\n".join(texts)
    lines = [ln for p in pdf.pages for ln in grid_lines(p)]
    grid = "\n".join(lines)

    r = {"format": "audatex"}
    r["nr_kalkulacji"] = find(r"K A L K U L A C J A\s+N A P R A W Y\s+NR\s+(\S+)", grid or full)
    r["sygnatura"] = find(r"SYGNATURA AKT[^:]*:\s*([^/\n]+)", grid or full)
    r["data"] = find(r"DATA WYLICZENIA\s*:\s*(\d\d\.\d\d\.\d{4})", grid or full)
    r["marka"] = find(r"MARKA\s*:\s*(.+)", grid or full)
    r["model"] = find(r"TYP/MODEL\s*:\s*(.+)", grid or full)
    reg = re.search(r"NR\s+REJESTRACYJNY/NR\s+IDENT\.\s*:\s*(\S+)\s*/\s*(\S+)", grid or full)
    if reg:
        r["nr_rej"], r["vin"] = reg.group(1), reg.group(2)
    r["nr_szkody"] = find(r"NUMER SZKODY:\s*(\S+)", full)
    r["rodzaj_szkody"] = find(r"RODZAJ SZKODY\s*:\s*\S+\s*/\s*(\S+)", grid or full)
    r["przebieg_km"] = find(r"PRZEBIEG\s*:\s*(\d+)", grid or full, conv=int)

    # kto sporządził
    if "UNIQA" in full[:3000]:
        r["autor"] = "UNIQA (wycena ubezpieczyciela)"
    elif re.search(r"FIRMA NAPRAWCZA\s*:\s*AYVENS", grid or full):
        r["autor"] = "Ayvens"
    elif "AUTO-LACK" in (grid or full)[:400]:
        r["autor"] = "warsztat (własny kosztorys)"
    else:
        r["autor"] = None

    # stawki
    r["stawka_blach"] = find(r"MECH-BLACH\.\s*:\s*([\d.]+)", grid, conv=float) or \
        find(r"CENA(?:/KL\s+\d)?\s*=\s*([\d.]+)\s*PLN/RBG", grid, conv=float)
    r["stawka_lak"] = find(r"LAKIEROWANIE - AZT\s*:\s*([\d.]+)", grid, conv=float) or \
        find(r"WSPÓŁCZYNNIK\s+([\d.]+)\s*PLN/RBG", grid, conv=float)
    jc_base = find(r"(\d+)\s*JC\s*=\s*1\s*RBG", grid, conv=int) or 10

    # kalkulacja końcowa
    km = re.search(r"K\s+O\s+Ń\s+C\s+O\s+W\s+A", grid)
    k = grid[km.start():] if km else grid
    rob = re.split(r"L\s?A\s?K\s?I\s?E\s?R\s?O\s?W", k)[0]
    jc_blach = sum(num(x) for x in re.findall(r"RAZEM(?:\s+KL\s+\d)?\s+([\d.]+)\s+JC\s+X", rob))
    r["rbh_blach"] = round(jc_blach / jc_base, 2)
    r["robocizna_blach"] = find(r"RAZEM\s+ROBOCIZNA\s*\.+\s*" + AMOUNT, k, conv=num)
    r["stala_robocizna"] = find(r"STAŁA\s+ROBOCIZNA\s+" + AMOUNT, k, conv=num)
    r["koszty_dodatkowe"] = find(r"RAZEM\s+KOSZTY\s+DODATKOWE\s*\.+\s*" + AMOUNT, k, conv=num)
    r["rbh_lak"] = find(r"KOŃCOWA\s+ROBOCIZNA\s+LAKIER\s+\d+\s+JC/RBG\s*:\s*([\d.]+)", grid, conv=lambda v: round(float(v) / jc_base, 2))
    r["robocizna_lak"] = find(r"KOSZTY\s+ROBOCIZNY\s+" + AMOUNT, k, conv=num)
    r["material_lak"] = find(r"KOSZTY\s+MATERIAŁU\s+" + AMOUNT, k, conv=num)
    r["czesci"] = find(r"C\s?Z\s?Ę\s?Ś\s?C\s?I\s+Z\s?A\s?M\s?I\s?E\s?N\s?N\s?E\s+" + AMOUNT, k, conv=num)
    r["normalia"] = find(r"NORMALIA\s*\(\s*[\d.]+\s*%\)\s+" + AMOUNT, k, conv=num)
    r["netto"] = find(r"N\s?A\s?P\s?R\s?A\s?W\s?Y\s+BEZ\s+VAT\s*\.+\s*" + AMOUNT, k, conv=num)
    r["vat"] = find(r"VAT\s+[\d.]+\s*%\s+" + AMOUNT, k, conv=num)
    r["brutto"] = find(r"N\s?A\s?P\s?R\s?A\s?W\s?Y\s+Z\s+VAT\s*\.+\s*" + AMOUNT, k, conv=num)

    r["pozycje_czesci"] = parse_parts(lines)

    # kontrola: suma składników = netto
    skl = sum(v or 0 for v in [r["robocizna_blach"], r["koszty_dodatkowe"], r["robocizna_lak"],
                               r["material_lak"], r["czesci"], r["normalia"]])
    r["kontrola_sumy"] = r["netto"] is not None and abs(skl - r["netto"]) < 0.02
    if r["czesci"] is not None:
        r["kontrola_czesci"] = abs(sum(p["cena"] for p in r["pozycje_czesci"]) - r["czesci"]) < 0.02
    return r


# ---------- weryfikacja ControlExpert ----------

def parse_controlexpert(texts):
    full = "\n".join(texts)
    r = {"format": "weryfikacja ControlExpert"}
    r["nr_szkody"] = find(r"Numer szkody:\s*(\S+)", full)
    r["data"] = find(r"Data:\s*(\d\d\.\d\d\.\d{4})", full)
    r["pojazd"] = find(r"Pojazd:\s*(.+)", full)
    r["nr_rej"] = find(r"Numer rejestracyjny:\s*(\S+)", full)
    r["rodzaj_szkody"] = find(r"Rodzaj szkody:\s*(.+)", full)
    A = r"([\d ]+,\d{2}) zł"
    rows = {"robocizna": "Robocizna", "robocizna_lak": "Robocizna lakiernicza",
            "material_lak": "Materiał lakierniczy", "czesci": "Części zamienne",
            "normalia": "Normalia", "netto": "Suma całkowita netto"}
    for key, label in rows.items():
        m = re.search(r"^\s*" + re.escape(label) + r"\s+" + A + r"\s+" + A + r"\s+" + A, full, re.M)
        if m:
            r[key] = {"zlozone": num(m.group(1)), "korekta": num(m.group(2)), "zaakceptowane": num(m.group(3))}
    for key, label in {"stawka_zlozona": "Złożone", "stawka_korekta": "Korekta", "stawka_zaakceptowana": "Zaakceptowane"}.items():
        m = re.search(r"^" + label + r"\s+" + A + r"\s+" + A, full, re.M)
        if m:
            r[key] = {"blach": num(m.group(1)), "lak": num(m.group(2))}
    return r


# ---------- skan z naniesioną weryfikacją (np. ERGO Hestia) ----------

LABELS = [("stawka_zaakceptowana", r"BAZA\s*CZASOWA"), ("robocizna", r"RAZEM\s*ROBOCIZNA"),
          ("robocizna_lak", r"KOSZTY\s*ROBOCIZNY"), ("material_lak", r"KOSZTY\s*MATERIA"),
          ("czesci", r"CZ.{0,3}CI\s*ZAMIENNE"), ("normalia", r"NORMALIA"),
          ("netto", r"BEZ\s*VAT"), ("brutto", r"Z\s+VAT")]


def parse_scan_with_annotations(path, pdf):
    """Podstawa to obraz (OCR), poprawki ubezpieczyciela to warstwa tekstowa naniesiona na skan."""
    import csv, subprocess, tempfile, os
    r = {"format": "skan z weryfikacją ubezpieczyciela", "zaakceptowane": {}}
    with tempfile.TemporaryDirectory() as tmp:
        for i, page in enumerate(pdf.pages):
            words = [w for w in page.extract_words() if re.fullmatch(r"[\d,. ]+", w["text"])]
            if not words:
                continue
            png = os.path.join(tmp, f"p{i}")
            subprocess.run(["pdftoppm", "-r", "300", "-png", "-singlefile", "-f", str(i + 1), "-l", str(i + 1), path, png], check=True)
            subprocess.run(["tesseract", png + ".png", png, "--psm", "6", "-l", "pol", "tsv"], check=True, capture_output=True)
            lines = {}
            for row in csv.DictReader(open(png + ".tsv", encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
                if row["level"] == "5" and row["text"].strip():
                    key = (row["block_num"], row["par_num"], row["line_num"])
                    lines.setdefault(key, []).append(row)
            ocr = [(int(ws[0]["top"]) * 72 / 300, " ".join(w["text"] for w in ws)) for ws in lines.values()]
            if not any(re.search(r"KALKULACJ\w*\s+KO[NŃ]COWA", t) for _, t in ocr):
                continue
            # linie z etykietami w kolejności na stronie; poprawki przypisujemy monotonicznie (nie cofamy się)
            labelled = [(y, k) for y, t in sorted(ocr) for k, pat in LABELS if re.search(pat, t)]
            used = -1
            # sklej liczby rozbite na słowa ("6" + "284,49") w obrębie jednej linii
            groups = {}
            for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
                groups.setdefault(round(w["top"]), []).append(w["text"])
            for top, parts in groups.items():
                if not re.search(r",\d{2}$", parts[-1]):
                    continue
                value = num(" ".join(parts))
                cand = [(abs(y - top), i, k) for i, (y, k) in enumerate(labelled) if i > used and abs(y - top) < 12]
                label = None
                if cand:
                    _, used, label = min(cand)
                if label and label not in r["zaakceptowane"]:
                    r["zaakceptowane"][label] = value
                if "nr_kalkulacji" not in r:
                    for _, t in ocr:
                        m = re.search(r"NR\s+(\S+)\s+\d\d\.\d\d\.\d{4}", t)
                        if m:
                            r["nr_kalkulacji"] = m.group(1)
    return r


# ---------- wejście ----------

def parse(path):
    with pdfplumber.open(path) as pdf:
        texts = page_texts(pdf)
        full = "\n".join(texts)
        if "Złożone" in full and "Zaakceptowane" in full:
            return parse_controlexpert(texts)
        if not any("Courier" in c["fontname"] for p in pdf.pages for c in p.chars):
            return parse_scan_with_annotations(path, pdf)
        return parse_audatex(pdf, texts)


if __name__ == "__main__":
    out = {}
    for p in sys.argv[1:]:
        try:
            out[p.rsplit("/", 1)[-1]] = parse(p)
        except Exception as e:  # prototyp: pokaż błąd zamiast przerywać
            out[p.rsplit("/", 1)[-1]] = {"blad": repr(e)}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
