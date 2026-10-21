"""Shared plumbing for the Python side of the monitor: where the data lives,
HTTP with retries, and the one Gemini call the LLM steps make.

Everything here runs in the daily GitHub Actions job (see
.github/workflows/ai-bubble-data.yml), after or around the Node script that
builds the market indicators.
"""

from __future__ import annotations

import gzip
import json
import os
import time
import zlib
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("AI_BUBBLE_DATA_DIR", ROOT / "data" / "ai-bubble"))

# SEC asks automated clients to say who they are (https://www.sec.gov/os/accessing-edgar-data).
# (an empty repository secret arrives as an empty string: fall back then too)
SEC_USER_AGENT = os.environ.get("SEC_USER_AGENT") or "AI Bubble Monitor xzhangfox@users.noreply.github.com"

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
GEMINI_URL = os.environ.get("GEMINI_URL", "https://generativelanguage.googleapis.com/v1beta/models")


def annotate(level: str, title: str, message: str) -> None:
    """A line in the log, and in GitHub Actions also an annotation on the run
    (readable through the API, so a failed step says why without the logs)."""
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::{level} title={title}::{message.replace(chr(10), ' ')}")
    else:
        print(f"[{level}] {title}: {message}")


def read_json(name: str, default: Any = None) -> Any:
    path = DATA_DIR / name
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json(name: str, data: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def http_get(url: str, *, headers: dict[str, str] | None = None, retries: int = 3, timeout: int = 30) -> bytes:
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            # (SEC's fair-access rules ask for a declared User-Agent and compressed responses)
            req = urllib.request.Request(url, headers={"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate", "Accept": "*/*", **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read()
                encoding = (res.headers.get("Content-Encoding") or "").lower()
            if encoding == "gzip":
                body = gzip.decompress(body)
            elif encoding == "deflate":
                body = zlib.decompress(body)
            if not body.strip():
                raise ValueError(f"empty response from {url}")
            return body
        except (urllib.error.URLError, TimeoutError, ValueError) as err:
            last = err
            # (a 403/404 won't get better by asking again; say what the server said)
            if isinstance(err, urllib.error.HTTPError) and err.code in (403, 404):
                try:
                    raw = err.read()
                    if (err.headers.get("Content-Encoding") or "").lower() == "gzip":
                        raw = gzip.decompress(raw)
                    text = " ".join(raw.decode("utf-8", "replace").split())
                    last = RuntimeError(f"{err} — {text[:300]}")
                except Exception:
                    pass
                break
            if attempt < retries:
                time.sleep(2 * attempt)
    raise RuntimeError(f"GET {url} failed: {last}")


def gemini_json(prompt: str, schema: dict[str, Any], *, temperature: float = 0.0, timeout: int = 120) -> Any:
    """One structured Gemini call: the reply is parsed JSON matching `schema`.
    Needs GEMINI_API_KEY (a repository secret in the Actions job)."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    body = json.dumps(
        {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature, "responseMimeType": "application/json", "responseSchema": schema},
        }
    ).encode()
    last: Exception | None = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(
                f"{GEMINI_URL}/{GEMINI_MODEL}:generateContent",
                data=body,
                headers={"Content-Type": "application/json", "x-goog-api-key": key},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as res:
                out = json.loads(res.read())
            text = "".join(p.get("text", "") for p in out["candidates"][0]["content"]["parts"])
            return json.loads(text)
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as err:
            last = err
            if isinstance(err, urllib.error.HTTPError) and err.code in (400, 401, 403):
                break
            if attempt < 3:
                time.sleep(3 * attempt)
    raise RuntimeError(f"Gemini call failed: {last}")
