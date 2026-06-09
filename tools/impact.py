#!/usr/bin/env python3
"""
Impact analyzer for the PSA dashboard.

Tells you which VISUALIZATIONS are affected when a calculation / identity / tab
/ render function changes — from a symbol name OR from your git diff.

Usage:
  python tools/impact.py <symbol> [<symbol> ...]   # "what if I change this?"
  python tools/impact.py --staged                  # impact of staged changes (git diff --cached)
  python tools/impact.py --working                 # impact of all uncommitted changes
  python tools/impact.py --list                    # list known symbols & visualizations
  python tools/impact.py --check                   # map-drift check only (patterns still present?)

The dependency graph lives in tools/impact_map.json. Keep it in sync; this tool
warns when a symbol's code patterns can no longer be found (map drift).
"""
import json, os, sys, subprocess, re

try:
    sys.stdout.reconfigure(encoding="utf-8")  # avoid Windows cp1252 crashes
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "impact_map.json")
SOURCE_FILES = ["Code.gs", "index.html"]

C = {"hdr":"\033[1;36m","sym":"\033[1;33m","viz":"\033[1;32m","warn":"\033[1;31m",
     "dim":"\033[2m","red":"\033[1;35m","end":"\033[0m"}
def color(t,k):
    return (C.get(k,"")+t+C["end"]) if sys.stdout.isatty() else t

def load_map():
    with open(MAP_PATH, encoding="utf-8") as f:
        return json.load(f)

def read_sources():
    out = {}
    for fn in SOURCE_FILES:
        p = os.path.join(ROOT, fn)
        out[fn] = open(p, encoding="utf-8").read() if os.path.exists(p) else ""
    return out

def git_changed_lines(staged):
    """Return list of added/removed line texts from the diff of the source files."""
    cmd = ["git", "-C", ROOT, "diff", "-U0"]
    if staged:
        cmd.append("--cached")
    cmd += ["--"] + SOURCE_FILES
    try:
        diff = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout
    except Exception as e:
        print(color("git diff failed: " + str(e), "warn")); return []
    lines = []
    for ln in diff.splitlines():
        if ln[:3] in ("+++", "---"):
            continue
        if ln.startswith("+") or ln.startswith("-"):
            lines.append(ln[1:])
    return lines

def symbols_in_lines(symbols, changed_lines):
    """Which symbols have at least one pattern appearing in a changed line."""
    hits = {}
    for key, s in symbols.items():
        for pat in s.get("patterns", []):
            for cl in changed_lines:
                if pat in cl:
                    hits.setdefault(key, set()).add(pat)
                    break
            if key in hits:
                break
    return hits

def closure(roots, symbols):
    """BFS over 'feeds'. Returns viz_id -> set(root_symbol) and the set of all reached symbols."""
    viz = {}
    reached = set()
    for root in roots:
        stack = [root]; seen = set()
        while stack:
            cur = stack.pop()
            if cur in seen or cur not in symbols:
                continue
            seen.add(cur); reached.add(cur)
            for v in symbols[cur].get("affects", []):
                viz.setdefault(v, set()).add(root)
            for nxt in symbols[cur].get("feeds", []):
                stack.append(nxt)
    return viz, reached

def map_drift(symbols, sources):
    missing = []
    for key, s in symbols.items():
        found = any(pat in sources.get(fn, "") for fn in (s.get("files") or SOURCE_FILES) for pat in s.get("patterns", []))
        if not found:
            # also try across all files
            found = any(pat in blob for blob in sources.values() for pat in s.get("patterns", []))
        if not found:
            missing.append(key)
    return missing

def report(changed, symbols, vizmap, header):
    if not changed:
        print(color("No mapped symbols detected in the change.", "dim"))
        print(color("  (If you edited something not in tools/impact_map.json, add it there.)", "dim"))
        return
    print(color(header, "hdr"))
    print(color("Changed symbols:", "sym"))
    re_derive = False
    for k in sorted(changed):
        s = symbols[k]
        flag = color("  [needs runDerive()]", "red") if s.get("reDerive") else ""
        pats = changed[k] if isinstance(changed, dict) else None
        why = color("  <- matched: " + ", ".join(sorted(pats)), "dim") if pats else ""
        if s.get("reDerive"): re_derive = True
        print(f"  - {color(k,'sym')} : {s['desc']}{flag}{why}")

    viz, _ = closure(list(changed.keys()) if isinstance(changed, dict) else changed, symbols)
    if not viz:
        print(color("\nNo visualizations downstream (symbol feeds nothing / affects nothing yet).", "dim"))
    else:
        # group affected viz by page
        by_page = {}
        for vid, roots in viz.items():
            v = VIZ.get(vid, {"page": "?", "title": vid})
            by_page.setdefault(v["page"], []).append((vid, v, roots))
        print(color(f"\nAffected visualizations ({len(viz)}):", "viz"))
        for page in sorted(by_page):
            print(color("  > " + page, "viz"))
            for vid, v, roots in sorted(by_page[page]):
                rfn = v.get("render", "?"); cont = v.get("container", "?")
                print(f"      - {v['title']}  {color('('+rfn+' -> #'+cont+')','dim')}")
        if re_derive:
            print(color("\n! A changed symbol affects the derive pipeline -- deploy Code.gs and run runDerive() for the numbers to update.", "red"))

def main():
    m = load_map()
    global VIZ
    VIZ = m["visualizations"]; symbols = m["symbols"]
    sources = read_sources()

    args = sys.argv[1:]

    # always run a light drift check
    missing = map_drift(symbols, sources)
    if missing and "--check" not in args:
        print(color("! map drift -- patterns not found for: " + ", ".join(missing), "warn"))
        print(color("  (impact_map.json may be out of date; update patterns for these symbols.)\n", "dim"))

    if not args or args[0] in ("-h", "--help"):
        print(__doc__); return

    if args[0] == "--check":
        if missing:
            print(color("Map drift in: " + ", ".join(missing), "warn")); sys.exit(1)
        print(color("OK — all symbol patterns found in source.", "viz")); return

    if args[0] == "--list":
        print(color("Visualizations:", "viz"))
        for vid, v in sorted(VIZ.items()):
            print(f"  {vid:16s} {v['page']:18s} {v['title']}")
        print(color("\nSymbols (use as arguments to query impact):", "sym"))
        for k, s in sorted(symbols.items()):
            print(f"  {k:26s} {s['desc']}")
        return

    if args[0] in ("--staged", "--working"):
        staged = args[0] == "--staged"
        changed = symbols_in_lines(symbols, git_changed_lines(staged))
        report(changed, symbols, VIZ,
               f"\n=== Impact of {'staged' if staged else 'uncommitted'} changes ===")
        return

    # explicit symbol(s)
    unknown = [a for a in args if a not in symbols]
    if unknown:
        print(color("Unknown symbol(s): " + ", ".join(unknown), "warn"))
        print(color("Run  python tools/impact.py --list  to see valid symbols.", "dim")); sys.exit(1)
    report({a: set() for a in args}, symbols, VIZ, "\n=== Impact of changing: " + ", ".join(args) + " ===")

if __name__ == "__main__":
    main()
