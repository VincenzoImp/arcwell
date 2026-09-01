---
name: web
description: Search the web and read a page as text. Use when you need current information, documentation for a library or version, an error message you do not recognise, or the content of a URL. Pi has no built-in web tool, so without this the only option is improvising a curl command, which produces worse results and a different command every time.
---

# Web

Two scripts in this directory. Both print to stdout and exit non-zero with a reason.

## Search

```bash
./search.sh "query"                 # 8 results
./search.sh "query" -n 3            # fewer
./search.sh "query" --json          # for parsing
./search.sh --engines               # what works on this machine, and what the rest need
./search.sh -- "-Wall gcc flag"     # -- first, for a query that starts with a dash
./search.sh --help                  # both scripts have one
```

DuckDuckGo by default and needs nothing. Brave is used automatically when `BRAVE_API_KEY`
is set, a SearXNG instance when `PI_SEARX_URL` is; `--engine` overrides the choice.

Never pass a key on the command line — the scripts read it from the environment and hand it
to `curl` through stdin, so it never appears in `ps` or in the session transcript.

Exit codes. Every message below goes to stderr, not stdout:

- `1` — the request failed, the arguments were wrong, or the page was empty.
- `2` — it worked and there was nothing to return: reword the query, or the page had no
  readable text.
- `3` — **`search.sh` only** — the engine refused: a rate limit, a bot check, a bad key, an
  exhausted quota. Waiting or a different engine is the answer, not a different query. A
  throttled `fetch.sh` comes back as `1`, with the HTTP status in the message.

## Read a page

```bash
./fetch.sh https://example.com/doc          # HTML reduced to text, links kept as text (url)
./fetch.sh https://api.example.com/thing    # JSON and source printed untouched
./fetch.sh URL --raw                        # never reduce
./fetch.sh URL --max-chars 60000            # default is 20000
```

## How to use the results

Search returns titles, URLs and snippets. **A snippet is not an answer** — it is a search
engine's summary, often stale and sometimes wrong. When the answer matters, `fetch.sh` the
URL and read the page.

Say which source you used. "According to `<url>`" is checkable; "I found online that" is not.

If a search returns nothing useful, change the query rather than the engine: the engine is
rarely the problem.
