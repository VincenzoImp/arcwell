#!/usr/bin/env bash
# Web search with a selectable engine.
#
#   search.sh "query" [-n COUNT] [--engine ddg|brave|searx] [--json]
#   search.sh --engines
#
# DuckDuckGo needs nothing and is the default. Brave is used automatically when
# BRAVE_API_KEY is set; a SearXNG instance when PI_SEARX_URL is. PI_SEARCH_ENGINE or
# --engine overrides that choice.
#
# node rather than python3 for the parsing: node is a documented requirement of this
# repository and python3 is not.
set -euo pipefail

count=8
engine="${PI_SEARCH_ENGINE:-}"
as_json=0
query=""

die() { printf '%s\n' "$*" >&2; exit 1; }

usable_engines() {
  printf 'ddg\n'
  [ -n "${BRAVE_API_KEY:-}" ] && printf 'brave\n'
  [ -n "${PI_SEARX_URL:-}" ] && printf 'searx\n'
  return 0
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--count) count="${2:-}"; shift 2 || die "-n needs a number" ;;
    --engine) engine="${2:-}"; shift 2 || die "--engine needs a name" ;;
    --json) as_json=1; shift ;;
    --engines)
      # Say what is usable here and what each missing one needs, so the answer is
      # actionable rather than a list of names.
      printf 'usable now: %s\n' "$(usable_engines | tr '\n' ' ')"
      [ -z "${BRAVE_API_KEY:-}" ] && printf 'brave: set BRAVE_API_KEY (free key, 2000 queries/month)\n'
      [ -z "${PI_SEARX_URL:-}" ] && printf 'searx: set PI_SEARX_URL to an instance, e.g. https://searx.example/search\n'
      exit 0 ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    --) shift; while [ "$#" -gt 0 ]; do query="${query:+$query }$1"; shift; done ;;
    -*) die "unknown option: $1 (use -- before a query that starts with a dash)" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done

[ -n "$query" ] || die "usage: search.sh \"query\" [-n COUNT] [--engine ddg|brave|searx]"
case "$count" in
  ''|*[!0-9]*) die "-n takes a number, got: $count" ;;
  ??????????*) die "-n is unreasonably large: $count" ;;
  *[!0]*) ;;
  *) die "-n takes a number greater than zero, got: $count" ;;
esac

if [ -z "$engine" ]; then
  if [ -n "${BRAVE_API_KEY:-}" ]; then engine=brave
  elif [ -n "${PI_SEARX_URL:-}" ]; then engine=searx
  else engine=ddg
  fi
fi

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v node >/dev/null 2>&1 || die "node is required"

# An engine named but not configured must say which variable is missing. Returning nothing
# would read as "no results" and send the model looking for a different query.
case "$engine" in
  brave) [ -n "${BRAVE_API_KEY:-}" ] || die "engine brave needs BRAVE_API_KEY (get one at https://brave.com/search/api/)" ;;
  searx) [ -n "${PI_SEARX_URL:-}" ] || die "engine searx needs PI_SEARX_URL, e.g. https://searx.example/search" ;;
  ddg) ;;
  *) die "unknown engine: $engine (known: ddg, brave, searx)" ;;
esac

UA='Mozilla/5.0 (compatible; pi-setup/1.0)'
body=""
case "$engine" in
  ddg)
    body="$(curl -sS --max-time 20 -A "$UA" --get \
      --data-urlencode "q=$query" https://html.duckduckgo.com/html/ 2>&1)" \
      || die "search failed (ddg): $body"
    ;;
  brave)
    # The key goes in through --config on stdin, never in argv: an argument is visible to
    # every user on the machine through `ps` for as long as the request runs.
    body="$(printf 'header = "X-Subscription-Token: %s"\n' "$BRAVE_API_KEY" \
      | curl -sS --max-time 20 --config - \
        -w '\n__PI_HTTP_STATUS__%{http_code}' \
        -H 'Accept: application/json' --get \
        --data-urlencode "q=$query" --data "count=$count" \
        https://api.search.brave.com/res/v1/web/search 2>&1)" \
      || die "search failed (brave): $body"
    ;;
  searx)
    body="$(curl -sS --max-time 20 -A "$UA" --get \
      -w '\n__PI_HTTP_STATUS__%{http_code}' \
      --data-urlencode "q=$query" --data 'format=json' "$PI_SEARX_URL" 2>&1)" \
      || die "search failed (searx): $body"
    ;;
esac

[ -n "$body" ] || die "search returned nothing (engine: $engine)"

# A keyed engine answers a bad key or an exhausted quota with an HTTP status, not with a
# page whose wording can be recognised. Reading it is the only way to tell "found nothing"
# from "refused", and telling them apart is the whole point of the two exit codes.
http_status=""
case "$engine" in
  brave|searx)
    # Only these two ask curl for the status, so only here can a trailing marker be one.
    # DuckDuckGo echoes the query into the page it returns, so searching for the marker
    # itself would otherwise truncate the results there.
    case "$body" in
      *__PI_HTTP_STATUS__*)
        http_status="${body##*__PI_HTTP_STATUS__}"
        body="${body%__PI_HTTP_STATUS__*}"
        ;;
    esac
    ;;
esac
case "$http_status" in
  400|401|403|422)
    printf '%s rejected the request (HTTP %s): the key is missing, wrong or not entitled.\n' \
      "$engine" "$http_status" >&2
    if [ "$engine" = "brave" ]; then
      printf 'Check BRAVE_API_KEY, or unset it to fall back to DuckDuckGo.\n' >&2
    else
      printf 'Check the credentials for %s.\n' "$PI_SEARX_URL" >&2
    fi
    exit 3 ;;
  429)
    printf '%s refused the request: rate limit or quota exhausted (HTTP 429).\n' "$engine" >&2
    if [ "$engine" = "brave" ]; then
      printf 'Wait, or unset BRAVE_API_KEY to fall back to DuckDuckGo.\n' >&2
    else
      printf 'Wait, or use another engine with --engine.\n' >&2
    fi
    exit 3 ;;
  5*)
    printf '%s is failing (HTTP %s).\n' "$engine" "$http_status" >&2
    exit 3 ;;
esac

printf '%s' "$body" | PI_SEARCH_ENGINE_USED="$engine" PI_SEARCH_COUNT="$count" \
PI_SEARCH_JSON="$as_json" node -e '
const body = require("node:fs").readFileSync(0, "utf8");
const engine = process.env.PI_SEARCH_ENGINE_USED;
const count = Number(process.env.PI_SEARCH_COUNT);
const asJson = process.env.PI_SEARCH_JSON === "1";

// An out-of-range code point makes fromCodePoint throw; browsers render U+FFFD.
const codePoint = (n) => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff))
  ? String.fromCodePoint(n) : "\ufffd";

// One pass, the same as fetch.sh: decoding `&amp;` first ate a round of escaping, so a
// result about HTML escaping reached the model saying the opposite of what the page says.
const NAMED = {nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\x22", apos: "\x27"};
const decode = (s) => s
  .replace(/<[^>]*>/g, "")
  .replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name) => {
    if (name[0] === "#") {
      const n = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return codePoint(n);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : whole;
  })
  .replace(/\s+/g, " ")
  .trim();

let results = [];
if (engine === "ddg") {
  // DuckDuckGo wraps each hit in result__a for the link and result__snippet for the text.
  // The href is a redirect carrying the real URL in uddg=.
  // Pair each link with the snippet that follows it in the document, rather than by
  // position in two separate lists: a result without a snippet shifted every later snippet
  // onto the wrong URL, and the model was handed a description of a different page.
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetAfter = (from) => {
    const slice = body.slice(from, from + 4000);
    const next = /class="[^"]*result__a[^"]*"/.exec(slice);
    const window = next ? slice.slice(0, next.index) : slice;
    const found = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(window);
    return found ? decode(found[1]) : "";
  };
  let m;
  while ((m = re.exec(body)) !== null && results.length < count) {
    let url = m[1];
    const redirect = /[?&]uddg=([^&]+)/.exec(url);
    if (redirect) { try { url = decodeURIComponent(redirect[1]); } catch {} }
    if (url.startsWith("//")) url = "https:" + url;
    // Sponsored hits come through /y.js with a two-kilobyte tracking URL and no uddg to
    // decode. They are advertising, not an answer, and they crowd out the real results.
    if (/[/.]duckduckgo\.com\/y\.js/.test(url) || /[?&]ad_provider=/.test(url)) continue;
    results.push({ title: decode(m[2]), url, snippet: snippetAfter(re.lastIndex) });
  }
} else {
  let parsed;
  try { parsed = JSON.parse(body); }
  catch { console.error(`could not parse the ${engine} response as JSON`); process.exit(1); }
  const rows = engine === "brave" ? (parsed.web?.results ?? []) : (parsed.results ?? []);
  results = rows.slice(0, count).map((r) => ({
    title: decode(r.title ?? ""),
    url: r.url ?? "",
    snippet: decode(r.description ?? r.content ?? ""),
  }));
}

results = results.filter((r) => r.url && r.title);
if (results.length === 0) {
  // A rate-limit page has no results in it, and reporting that as "no results" sends the
  // model rewording a query that was fine. DuckDuckGo answers a burst with an anomaly page.
  // The engine echoes the query back into the page, so a search *for* "captcha" would
  // otherwise report a bot check. Strip the echo before deciding.
  const withoutEcho = body.replace(/<input[^>]*name=[\x22\x27]q[\x22\x27][^>]*>/gi, "")
    .replace(/<textarea[^>]*name=[\x22\x27]q[\x22\x27][^>]*>[\s\S]*?<\/textarea>/gi, "")
    // The engine puts the query in the page title as well.
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "");
  if (/anomaly|captcha|unusual traffic|are you a robot/i.test(withoutEcho)) {
    console.error(`${engine} refused the request (rate limit or bot check).`);
    console.error(engine === "ddg"
      ? "Wait a minute, or set BRAVE_API_KEY for a keyed engine that does not throttle."
      : "Check the key and the quota for this engine.");
    process.exit(3);
  }
  console.error(`no results (engine: ${engine})`);
  process.exit(2);
}
if (asJson) { console.log(JSON.stringify({ engine, results }, null, 2)); }
else {
  console.log(`# ${results.length} result(s) via ${engine}\n`);
  for (const [i, r] of results.entries()) {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   ${r.url}`);
    if (r.snippet) console.log(`   ${r.snippet}`);
    console.log("");
  }
}
'
