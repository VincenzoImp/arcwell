#!/usr/bin/env bash
# Fetch a URL and print it as readable text.
#
#   fetch.sh URL [--raw] [--max-chars N]
#
# --raw prints the body untouched, which is what you want for JSON, a diff, or source.
# Otherwise HTML is reduced to text: script and style dropped, block tags turned into line
# breaks, entities decoded, links kept as "text (url)" so a follow-up fetch is possible.
set -euo pipefail

url=""
raw=0
max_chars=20000

die() { printf '%s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --raw) raw=1; shift ;;
    --max-chars) max_chars="${2:-}"; shift 2 || die "--max-chars needs a number" ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$url" ] || die "one URL at a time"; url="$1"; shift ;;
  esac
done

[ -n "$url" ] || die "usage: fetch.sh URL [--raw] [--max-chars N]"
case "$max_chars" in
  ''|*[!0-9]*) die "--max-chars takes a number, got: $max_chars" ;;
  # Longer than any real bound, and past what the shell can compare without erroring first.
  ??????????*) die "--max-chars is unreasonably large: $max_chars" ;;
  *[!0]*) ;;
  *) die "--max-chars takes a number greater than zero, got: $max_chars" ;;
esac
case "$(printf '%s' "$url" | tr '[:upper:]' '[:lower:]')" in
  http://*|https://*) ;;
  *) die "URL must start with http:// or https://, got: $url" ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v node >/dev/null 2>&1 || die "node is required"

# --fail so a 404 is an error rather than an error page rendered as content.
# Ask for the content type rather than guessing from the bytes. A .tsx file that returns
# `<html><body>` looks exactly like a page to any structural heuristic, and a server that
# says text/plain has settled the question.
body="$(curl -sS --fail --location --max-time 30 --max-redirs 5 \
  -w '\n__PI_CONTENT_TYPE__%{content_type}' \
  -A 'Mozilla/5.0 (compatible; pi-setup/1.0)' "$url" 2>&1)" \
  || die "fetch failed: ${body%%__PI_CONTENT_TYPE__*}"

content_type=""
case "$body" in
  *__PI_CONTENT_TYPE__*)
    content_type="${body##*__PI_CONTENT_TYPE__}"
    body="${body%__PI_CONTENT_TYPE__*}"
    # curl writes the marker after a newline of its own; counting it would make a body of
    # exactly --max-chars claim to have been truncated.
    body="${body%$'\n'}"
    ;;
esac

case "$(printf '%s' "$body" | tr -d '[:space:]')" in
  "") die "fetch returned an empty body: $url" ;;
esac

if [ "$raw" -eq 1 ]; then
  # Parameter expansion, not a pipe to head: head closes the pipe once it has its bytes,
  # printf takes SIGPIPE, and pipefail turns that into exit 141 on every large body. And not
  # `cut -c` either, which bounds every LINE to N characters — so a 2000-line body came back
  # whole from the flag that exists to keep it out of the context window.
  printf '%s\n' "${body:0:$max_chars}"
  [ "${#body}" -gt "$max_chars" ] \
    && printf '[truncated at %s characters — re-run with --max-chars for more]\n' "$max_chars"
  exit 0
fi

# Through stdin, not the environment: execve caps a single env string at ~1 MB on macOS and
# 128 KB on Linux, so a large page died with "Argument list too long" before node ran.
printf '%s' "$body" | PI_FETCH_URL="$url" PI_FETCH_MAX="$max_chars" \
  PI_FETCH_TYPE="$content_type" node -e '
(() => {
// `fetch.sh URL | head` closes the pipe early; without this the write throws EPIPE and a
// successful fetch ends in a stack trace and exit 1.
process.stdout.on("error", () => {});
const body = require("node:fs").readFileSync(0, "utf8");

const emit = (text) => {
  process.stdout.write(text.slice(0, max));
  if (!text.slice(0, max).endsWith("\n")) process.stdout.write("\n");
  if (text.length > max) {
    process.stdout.write(`\n[truncated at ${max} characters — re-run with --max-chars for more]\n`);
  }
};
const url = process.env.PI_FETCH_URL;
const max = Number(process.env.PI_FETCH_MAX);

// Not HTML: print it as it came. Reducing JSON or source to "text" destroys it — a JSON
// string containing "<div>", or a .tsx file returning JSX, came back with elements deleted
// and whitespace collapsed, reported as success.
//
// So the question is what the document IS, not whether a tag appears somewhere in it.
// Parseable JSON is JSON. Otherwise the body has to open with a markup declaration or an
// html/head/body tag, which a source file does not.
// XML is not HTML: a pom.xml, an RSS feed, a sitemap or an SVG came back as a soup of
// concatenated values, exit 0. And an HTML fragment — an AJAX endpoint, a cached page whose
// plugin appends a comment after </html> — failed both anchors and was dumped raw, which is
// the flood the reducer exists to prevent.
//
// So: reduce when the document is HTML, and the test is the presence of HTML structure
// rather than the shape of the first and last bytes. XML that is not XHTML is left alone.
const parseableJson = () => {
  const head = body.trimStart()[0];
  if (head !== "{" && head !== "[") return false;
  try { JSON.parse(body); return true; } catch { return false; }
};
const declared = (process.env.PI_FETCH_TYPE ?? "").toLowerCase();
// What the server declared, when it declared anything, settles it.
if (declared && !/html/.test(declared)) {
  emit(body);
  return;
}

const isXml = /^\s*(?:<\?xml|<!DOCTYPE\s+(?!html\b))/i.test(body)
  && !/<html[\s>]/i.test(body);
// Two or more distinct HTML block tags, which a source file quoting one of them does not
// have and a fragment of real markup does.
const htmlTags = new Set((body.match(/<\/?(?:html|head|body|div|p|span|ul|ol|li|table|tr|td|h[1-6]|section|article|nav|header|footer|main|a|img|br)[\s>/]/gi) ?? [])
  .map((t) => t.replace(/[<>/\s]/g, "").toLowerCase()));
const looksLikeHtml = !isXml && (htmlTags.size >= 2
  || /^\s*(?:<!DOCTYPE\s+html|<html\b|<head\b|<body\b)/i.test(body));

if (parseableJson() || !looksLikeHtml) {
  emit(body);
  return;
}

// Browsers render an out-of-range code point as U+FFFD. fromCodePoint throws, and an
// unhandled RangeError turns a hostile page into a stack trace in the model context.
const codePoint = (n) => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff))
  ? String.fromCodePoint(n) : "\ufffd";

// One pass, so `&amp;lt;` becomes `&lt;` and not `<`. Decoding `&amp;` first ate a round of
// escaping and handed the model the wrong text for any page about HTML itself.
const NAMED = {nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\x22", apos: "\x27"};
const entities = (s) => s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name) => {
  if (name[0] === "#") {
    const n = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return codePoint(n);
  }
  return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : whole;
});

let text = body
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, "")
  // Keep the destination: a link the model cannot follow is a dead end.
  // The attribute has to BE href, not merely end in it: `data-href`, `ng-href`, `:href` and
  // `xlink:href` all satisfy a bare `href=`, and a lazy match took the first one — so a page
  // could put any URL under a legitimate label and choose what the agent fetched next.
  .replace(/<a\b(?:"[^"]*"|\x27[^\x27]*\x27|[^>"\x27])*?[\s\x22\x27]href\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\s"\x27>]+))(?:"[^"]*"|\x27[^\x27]*\x27|[^>"\x27])*>([\s\S]*?)<\/a>/gi, (_, dq, sq, bare, label) => {
    const href = dq ?? sq ?? bare ?? "";
    const clean = label.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    return !href || href.startsWith("#") ? clean : `${clean} (${href})`;
  })
  .replace(/<(h[1-6])\b[^>]*>/gi, "\n\n## ")
  .replace(/<li\b[^>]*>/gi, "\n- ")
  .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
  .replace(/<\/(p|div|section|article|tr|h[1-6]|ul|ol|li|table|blockquote|pre)>/gi, "\n")
  .replace(/<[^>]+>/g, "");

text = entities(text)
  .split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim())
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

if (!text) { console.error(`nothing readable at ${url}`); process.exit(2); }
emit(text);
})();
'
