# /// script
# requires-python = ">=3.10"
# dependencies = ["ddgs==9.16.1"]
# ///

import json
import sys

from ddgs import DDGS
from ddgs.exceptions import DDGSException


def main():
    query = sys.stdin.read(1200).strip()[:300]
    if not query:
        print("[]")
        return
    try:
        results = DDGS(timeout=5).text(query, max_results=5)
    except DDGSException as error:
        if str(error).strip().lower().rstrip(".") != "no results found":
            raise
        results = []
    print(json.dumps([
        {
            "url": item.get("href", ""),
            "title": str(item.get("title") or "")[:180],
            "snippet": str(item.get("body") or "")[:500],
        }
        for item in results
    ]))


if __name__ == "__main__":
    main()
