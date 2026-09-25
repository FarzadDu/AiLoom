"""Build Ailoom's offline English MedlinePlus health-topic index.

Usage: python scripts/build-medlineplus-corpus.py path/to/mplus_topics_compressed_YYYY-MM-DD.zip

Download the ZIP linked at https://medlineplus.gov/xml.html first. This script
does not send user queries or application data to NLM. The source ZIP is not
committed; the compact JSON includes attribution and its snapshot date.
"""

from __future__ import annotations

import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
import zipfile


OUTPUT = Path(__file__).resolve().parents[1] / "src/server/chat/medlineplus-topics.json"
MAX_SUMMARY_CHARS = 1050


class PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_summary(raw: str) -> str:
    parser = PlainText()
    parser.feed(raw)
    text = re.sub(r"\s+", " ", html.unescape(" ".join(parser.parts))).strip()
    if len(text) <= MAX_SUMMARY_CHARS:
        return text
    # End on a sentence boundary, so a clinical statement is not cut in half.
    end = max((match.end() for match in re.finditer(r"[.!?](?=\s|$)", text[:MAX_SUMMARY_CHARS])), default=0)
    return text[:end].strip() if end >= MAX_SUMMARY_CHARS // 2 else ""


def topic_text(topic: ET.Element, name: str) -> list[str]:
    return [re.sub(r"\s+", " ", element.text or "").strip()
            for element in topic.findall(name) if (element.text or "").strip()]


def build(source_zip: Path) -> dict:
    if source_zip.stat().st_size > 10_000_000:
        raise ValueError("Unexpectedly large MedlinePlus ZIP")
    with zipfile.ZipFile(source_zip) as archive:
        members = [item for item in archive.infolist()
                   if re.fullmatch(r"mplus_topics_\d{4}-\d{2}-\d{2}\.xml", item.filename)]
        if len(members) != 1 or members[0].file_size > 50_000_000:
            raise ValueError("Expected exactly one bounded MedlinePlus topic XML file")
        match = re.fullmatch(r"mplus_topics_(\d{4}-\d{2}-\d{2})\.xml", members[0].filename)
        assert match is not None
        root = ET.fromstring(archive.read(members[0]))

    if root.tag != "health-topics":
        raise ValueError("Unexpected XML root")
    topics = []
    for element in root.findall("health-topic"):
        if element.get("language") != "English":
            continue
        title = (element.get("title") or "").strip()
        url = (element.get("url") or "").strip()
        parsed = urlparse(url)
        if not title or parsed.scheme != "https" or parsed.hostname != "medlineplus.gov":
            continue
        aliases = list(dict.fromkeys(topic_text(element, "also-called") + topic_text(element, "see-reference")))
        groups = list(dict.fromkeys(topic_text(element, "group")))
        summary_element = element.find("full-summary")
        summary = clean_summary(summary_element.text or "") if summary_element is not None else ""
        if not summary:
            summary = clean_summary(element.get("meta-desc") or "")
        if not summary or not groups:
            continue
        topics.append({"title": title, "url": url, "aliases": aliases, "groups": groups,
                       "summary": summary})

    topics.sort(key=lambda item: item["title"].casefold())
    if len(topics) < 900:
        raise ValueError(f"Only {len(topics)} English topics parsed; check the XML source")
    return {
        "attribution": "MedlinePlus.gov, U.S. National Library of Medicine",
        "sourcePage": "https://medlineplus.gov/xml.html",
        "sourceZip": f"https://medlineplus.gov/xml/{source_zip.name}",
        "snapshotDate": match.group(1),
        "sourceGeneratedAt": root.get("date-generated", ""),
        "language": "English",
        "topics": topics,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    result = build(Path(sys.argv[1]))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(result['topics'])} English topics to {OUTPUT} ({OUTPUT.stat().st_size} bytes)")
