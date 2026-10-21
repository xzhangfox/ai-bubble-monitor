"""What the hyperscalers have already committed to spend: an LLM reads their
10-Q and 10-K filings for the commitments not yet on their balance sheets —
leases signed but not yet begun (mostly data centres) and purchase
commitments (servers, network gear, capacity) — the "extended forward
purchases" of Dalio's fifth hallmark, which XBRL doesn't carry as numbers.

Trust nothing the model says on its own: each figure must come with the
sentence that states it, that sentence must be in the filing word for word,
and the amount must be in that sentence. Anything else is dropped (and
counted). Results are kept per filing, so each filing is read once.

Writes data/ai-bubble/commitments.json. Needs GEMINI_API_KEY; without it the
saved results are kept as they are.

    python -m ml.filings_llm
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Any, Callable

from ml.common import GEMINI_MODEL, gemini_json, http_get, read_json, write_json
from ml.sec_capex import COMPANIES

PER_COMPANY = 6  # the latest filings read: enough for a year-ago comparison
NAMES = {"MSFT": "Microsoft", "GOOGL": "Alphabet", "AMZN": "Amazon", "META": "Meta Platforms", "ORCL": "Oracle"}
KINDS = {"leases_not_commenced", "purchase_commitments"}

# ---------------------------------------------------------------- filing text


class _Text(HTMLParser):
    """The visible text of a filing (inline XBRL is XHTML, so tags close in
    order): hidden blocks — the XBRL header, display:none — left out."""

    BLOCK = {"p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section"}
    VOID = {"br", "img", "hr", "meta", "link", "input", "col", "area", "base", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.stack: list[bool] = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            return self.handle_startendtag(tag, attrs)
        style = (dict(attrs).get("style") or "").replace(" ", "").lower()
        hide = tag in ("script", "style", "ix:header") or "display:none" in style
        self.stack.append(hide)
        self.hidden += hide
        if not self.hidden:
            if tag in self.BLOCK:
                self.parts.append("\n")
            elif tag in ("td", "th"):
                self.parts.append(" ")

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and not self.hidden:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.VOID or not self.stack:
            return
        self.hidden -= self.stack.pop()
        if not self.hidden and tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _Text()
    p.feed(html)
    text = "".join(p.parts).replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def normalize(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("—", "-").replace("–", "-").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


CUES = re.compile(
    r"not yet commenced|have not commenced|purchase commitments?|purchase obligations?|contractual obligations|non-cancell?able (?:contractual )?commitments|commitments? (?:to|for) (?:purchase|acquire)",
    re.I,
)


def passages(text: str, *, width: int = 700, limit: int = 10) -> list[str]:
    """The stretches of the filing around each mention of a commitment,
    overlapping ones merged; those naming a dollar amount first."""
    spans: list[list[int]] = []
    for m in CUES.finditer(text):
        a, b = max(0, m.start() - width), min(len(text), m.end() + width)
        if spans and a <= spans[-1][1]:
            spans[-1][1] = max(spans[-1][1], b)
        else:
            spans.append([a, b])
    out = [normalize(text[a:b]) for a, b in spans]
    out.sort(key=lambda p: (not re.search(r"\$\s?[\d.,]+\s*(?:billion|million|trillion)", p, re.I),))
    return out[:limit]


# ---------------------------------------------------------------- checking

AMOUNT = re.compile(r"\$\s?([\d,]+(?:\.\d+)?)\s*(trillion|billion|million)", re.I)
SCALE = {"trillion": 1e12, "billion": 1e9, "million": 1e6}


def parse_amount(text: str) -> float | None:
    m = AMOUNT.search(text or "")
    if not m:
        return None
    return float(m.group(1).replace(",", "")) * SCALE[m.group(2).lower()]


def verify(item: dict, source: str, report_date: str) -> tuple[dict | None, str]:
    """The item as kept, or None and why not."""
    kind = item.get("kind")
    if kind not in KINDS:
        return None, f"unknown kind {kind!r}"
    quote = normalize(str(item.get("quote", "")))
    if len(quote) < 30:
        return None, "no quote"
    if quote not in normalize(source):
        return None, "quote not in the filing"
    amount_text = normalize(str(item.get("amountText", "")))
    if not amount_text or amount_text not in quote:
        return None, "amount not in the quote"
    amount = parse_amount(amount_text)
    if amount is None or amount <= 0:
        return None, "amount unreadable"
    as_of = str(item.get("asOf") or "")[:10]
    try:
        date.fromisoformat(as_of)
    except ValueError:
        as_of = report_date
    return {
        "kind": kind,
        "amountBn": round(amount / 1e9, 2),
        "amountText": amount_text,
        "asOf": as_of,
        "whatFor": normalize(str(item.get("whatFor", "")))[:120],
        "quote": quote[:600],
    }, ""


# ---------------------------------------------------------------- reading a filing

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "kind": {"type": "STRING", "enum": sorted(KINDS)},
                    "amountText": {"type": "STRING"},
                    "asOf": {"type": "STRING"},
                    "whatFor": {"type": "STRING"},
                    "quote": {"type": "STRING"},
                },
                "required": ["kind", "amountText", "quote"],
            },
        }
    },
    "required": ["items"],
}


def prompt_for(company: str, form: str, report_date: str, chunks: list[str]) -> str:
    joined = "\n\n".join(f"[Passage {i + 1}]\n{c}" for i, c in enumerate(chunks))
    return f"""You are reading passages from {company}'s {form} filing with the SEC, for the period ended {report_date}.

Find the commitments it discloses that are not yet on its balance sheet: money it has already agreed to spend but not yet spent.
- "leases_not_commenced": leases signed that have not yet commenced (data centers, offices, equipment).
- "purchase_commitments": purchase commitments or obligations (for example servers, network equipment, data-center capacity, energy, cloud services).

For each total the passages state:
- kind: one of the two above.
- amountText: the amount exactly as written, e.g. "$62.4 billion" or "$7,250 million".
- asOf: the date the amount is stated as of, as YYYY-MM-DD (often the period end).
- whatFor: what it is for, in at most 12 words, from the passage.
- quote: the complete sentence from the passages that states the amount, copied character for character.

Rules:
- Only amounts stated in the passages. Never add amounts up, convert them, or estimate.
- If a total and its parts are both given, give only the total. Amounts that don't overlap (operating and finance leases, say) are separate items.
- Skip debt, interest, tax and amounts already on the balance sheet (recorded lease liabilities, accrued payables).
- If there are none, return an empty list.

{joined}"""


def read_filing(meta: dict, *, get: Callable[[str], bytes] = http_get, ask: Callable[..., Any] = gemini_json) -> dict:
    text = html_to_text(get(meta["url"]).decode("utf-8", errors="replace"))
    chunks = passages(text)
    record = {**meta, "model": GEMINI_MODEL, "extractedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "items": [], "rejected": []}
    if not chunks:
        return record
    reply = ask(prompt_for(NAMES.get(meta["ticker"], meta["ticker"]), meta["form"], meta["reportDate"], chunks), SCHEMA)
    source = "\n".join(chunks)
    seen = set()
    for raw in (reply or {}).get("items", []):
        kept, why = verify(raw, source, meta["reportDate"])
        if not kept:
            record["rejected"].append({"why": why, "amountText": str(raw.get("amountText", ""))[:40]})
            continue
        key = (kept["kind"], kept["amountBn"])
        if key not in seen:
            seen.add(key)
            record["items"].append(kept)
    return record


def recent_filings(ticker: str, cik: int, *, get: Callable[[str], bytes] = http_get, limit: int = PER_COMPANY) -> list[dict]:
    sub = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json"))
    r = sub["filings"]["recent"]
    out = []
    for form, acc, filed, report, doc in zip(r["form"], r["accessionNumber"], r["filingDate"], r["reportDate"], r["primaryDocument"]):
        if form not in ("10-Q", "10-K"):
            continue
        out.append(
            {
                "ticker": ticker,
                "cik": cik,
                "form": form,
                "accession": acc,
                "filed": filed,
                "reportDate": report,
                "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}",
            }
        )
        if len(out) == limit:
            break
    return out


# ---------------------------------------------------------------- summary

def totals(record: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for it in record["items"]:
        out[it["kind"]] = round(out.get(it["kind"], 0.0) + it["amountBn"], 2)
    return out


def summarize(filings: dict[str, dict]) -> dict:
    """Per company: the latest filing's commitments and the filing a year
    before; for the five together, the sum of those that compare."""
    companies = []
    for ticker in COMPANIES:
        mine = sorted((f for f in filings.values() if f["ticker"] == ticker), key=lambda f: f["reportDate"])
        if not mine:
            continue
        latest = mine[-1]
        target = (date.fromisoformat(latest["reportDate"]) - timedelta(days=365)).isoformat()
        prior = min(mine[:-1], key=lambda f: abs((date.fromisoformat(f["reportDate"]) - date.fromisoformat(target)).days), default=None)
        if prior and abs((date.fromisoformat(prior["reportDate"]) - date.fromisoformat(target)).days) > 45:
            prior = None
        companies.append(
            {
                "ticker": ticker,
                "name": NAMES[ticker],
                "form": latest["form"],
                "filed": latest["filed"],
                "reportDate": latest["reportDate"],
                "url": latest["url"],
                "totals": totals(latest),
                "items": latest["items"],
                "yearAgo": {"reportDate": prior["reportDate"], "totals": totals(prior), "url": prior["url"]} if prior else None,
            }
        )
    both = [c for c in companies if c["yearAgo"]]
    now = sum(sum(c["totals"].values()) for c in both)
    then = sum(sum(c["yearAgo"]["totals"].values()) for c in both)
    read = list(filings.values())
    return {
        "companies": companies,
        "totalBn": round(sum(sum(c["totals"].values()) for c in companies), 1),
        # (a year-on-year change only over the companies with both filings read)
        "compared": [c["ticker"] for c in both],
        "comparedNowBn": round(now, 1),
        "comparedYearAgoBn": round(then, 1),
        "change": round(now / then - 1, 3) if then > 0 else None,
        "checked": {"filings": len(read), "kept": sum(len(f["items"]) for f in read), "dropped": sum(len(f["rejected"]) for f in read)},
    }


def run(*, get: Callable[[str], bytes] = http_get, ask: Callable[..., Any] = gemini_json, pause: float = 0.2) -> dict:
    saved = read_json("commitments.json", {}) or {}
    filings: dict[str, dict] = dict(saved.get("filings", {}))
    wanted: list[dict] = []
    for ticker, cik in COMPANIES.items():
        wanted += recent_filings(ticker, cik, get=get)
        time.sleep(pause)
    fresh = 0
    for meta in wanted:
        if meta["accession"] in filings:
            continue
        try:
            filings[meta["accession"]] = read_filing(meta, get=get, ask=ask)
            fresh += 1
        except Exception as err:  # one bad filing shouldn't stop the rest
            print(f"  {meta['ticker']} {meta['form']} {meta['reportDate']}: {err}", file=sys.stderr)
        time.sleep(pause)
    keep = {m["accession"] for m in wanted}
    filings = {a: f for a, f in filings.items() if a in keep}
    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": GEMINI_MODEL,
        "source": "SEC EDGAR 10-Q and 10-K filings, read by an LLM; every figure checked against the filing's own sentence",
        "summary": summarize(filings),
        "filings": filings,
    }
    print(f"Read {fresh} new filing(s); kept {out['summary']['checked']['kept']} figures, dropped {out['summary']['checked']['dropped']}")
    return out


def main() -> int:
    if not os.environ.get("GEMINI_API_KEY"):
        print("GEMINI_API_KEY isn't set — keeping the saved commitments")
        return 0
    write_json("commitments.json", run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
