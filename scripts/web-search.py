# /// script
# requires-python = ">=3.10"
# dependencies = ["ddgs==9.16.1"]
# ///

import json
import sys

from ddgs import DDGS
from ddgs.exceptions import DDGSException


def clip(value, limit):
    return str(value or "")[:limit]


def search(ddgs, query, mode):
    # The DuckDuckGo image backend currently fails ("malformed headers"), so
    # images let ddgs pick a working backend.
    if mode == "images":
        return ddgs.images(query, backend="auto", safesearch="on", max_results=10)
    if mode == "news":
        return ddgs.news(query, max_results=6)
    return ddgs.text(query, max_results=10)


def main():
    query = sys.stdin.read(1200).strip()[:300]
    if not query:
        print("[]")
        return
    mode = sys.argv[1] if sys.argv[1:] in (["images"], ["news"]) else "text"
    ddgs = DDGS(timeout=6)
    results = []
    # The auto backend picks engines at random and sometimes comes back empty
    # for an ordinary query, so try once more before giving up.
    for _ in range(2):
        try:
            results = search(ddgs, query, mode)
        except DDGSException as error:
            if str(error).strip().lower().rstrip(".") != "no results found":
                raise
            results = []
        if results:
            break
    if mode == "images":
        print(json.dumps([
            {"thumbnail": clip(item.get("thumbnail"), 1500),
             "original": clip(item.get("image"), 1500),
             "url": clip(item.get("url"), 400),
             "title": clip(item.get("title"), 180),
             "width": int(item.get("width") or 0) if str(item.get("width") or "0").isdigit() else 0,
             "height": int(item.get("height") or 0) if str(item.get("height") or "0").isdigit() else 0}
            for item in results
        ]))
        return
    print(json.dumps([
        {
            "url": item.get("url" if mode == "news" else "href", ""),
            "title": clip(item.get("title"), 180),
            "snippet": clip(item.get("body"), 500),
            "date": clip(item.get("date"), 40),
        }
        for item in results
    ]))


if __name__ == "__main__":
    main()
