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
  python tools/impact.py --graph                   # generate interactive tools/impact_graph.html
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

GRAPH_HTML = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>PSA Dashboard — Impact Graph</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--ink:#1a1a2e;--muted:#6b7280;--line:#d6dae0;--hot:#ef6c00;--hotline:#ef6c00}
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--ink)}
  header{padding:12px 18px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:5}
  header h1{font-size:15px;margin:0 0 4px} header .sub{font-size:12px;color:var(--muted)}
  .controls{margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn{font-size:12px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer}
  .btn.active{background:var(--ink);color:#fff;border-color:var(--ink)}
  #banner{font-size:12px;color:var(--muted);margin-left:auto;max-width:55%;text-align:right}
  #wrap{overflow:auto;height:calc(100vh - 92px)}
  svg{display:block}
  .node rect{rx:5;stroke:#b8c0cc;stroke-width:1}
  .node text{font-size:10.5px;dominant-baseline:middle;pointer-events:none}
  .node{cursor:pointer}
  .edge{fill:none;stroke:var(--line);stroke-width:1.2}
  .edge.hot{stroke:var(--hotline);stroke-width:2.2;opacity:.95}
  .dim{opacity:.12} .hot rect{stroke:var(--hot);stroke-width:2.5}
  .layerlbl{font-size:10px;fill:#9aa3af;font-weight:700;letter-spacing:.5px}
  .pagelbl{font-size:11px;font-weight:700}
  #tip{position:fixed;pointer-events:none;background:#111827;color:#fff;font-size:11px;line-height:1.5;
       padding:8px 10px;border-radius:6px;max-width:340px;display:none;z-index:9;box-shadow:0 4px 14px rgba(0,0,0,.25)}
  #tip b{color:#fde68a} #tip .k{color:#93c5fd}
  .redr{color:#ef6c00;font-weight:700}
</style></head><body>
<header>
  <h1>PSA Dashboard — Impact Graph</h1>
  <div class="sub">Click any node to highlight everything it affects. Hover for details. Calcs/tabs flow left → visualizations right.</div>
  <div class="controls">
    <button class="btn active" id="m-full" onclick="setMode('full')">Full graph (calcs → visualizations)</button>
    <button class="btn" id="m-viz" onclick="setMode('viz')">Visualizations only</button>
    <button class="btn" onclick="reset()">Reset</button>
    <span id="banner">Nothing selected.</span>
  </div>
</header>
<div id="wrap"><svg id="svg"></svg></div>
<div id="tip"></div>
<script>
/*__DATA__*/
const PAGES = ["ONA Mockdrill","EU Mockdrill","Complaints Status","QR Code Coverage","Data Report"];
const PCOL = {"ONA Mockdrill":"#1D9E75","EU Mockdrill":"#378ADD","Complaints Status":"#BA7517",
              "QR Code Coverage":"#7F77DD","Data Report":"#64748b"};
const NS="http://www.w3.org/2000/svg";
const svg=document.getElementById("svg"), tip=document.getElementById("tip"), banner=document.getElementById("banner");
let mode="full", pos={}, sel=null;

function layerOf(id){
  if(id in DATA.visualizations) return 3;
  if(id.indexOf("tab.")===0) return 1;
  if(id.indexOf("render.")===0||id.indexOf("widget.")===0) return 2;
  return 0; // calc.* def.*
}
function labelOf(id){ return (id in DATA.visualizations) ? DATA.visualizations[id].title : id; }
function isViz(id){ return id in DATA.visualizations; }
function mk(tag,at){ const e=document.createElementNS(NS,tag); for(const k in at) e.setAttribute(k,at[k]); return e; }

const W=258, H=22, VG=7;
function layout(){
  pos={};
  if(mode==="full"){
    const XCOL=[24,310,640,980], lab=["DERIVE CALCS / DEFS","DATA TABS / GLOBALS","RENDER / WIDGET FNS","VISUALISATIONS"];
    const layers=[[],[],[],[]];
    Object.keys(DATA.symbols).forEach(id=>layers[layerOf(id)].push(id));
    // layer 3 (viz) grouped by page
    const vizByPage={}; Object.keys(DATA.visualizations).forEach(id=>{
      const p=DATA.visualizations[id].page; (vizByPage[p]=vizByPage[p]||[]).push(id); });
    layers.forEach(a=>a.sort());
    let maxY=0;
    for(let L=0;L<3;L++){ let y=46; layers[L].forEach(id=>{ pos[id]={x:XCOL[L],y:y}; y+=H+VG; }); maxY=Math.max(maxY,y); }
    let y=46;
    PAGES.forEach(p=>{ const list=(vizByPage[p]||[]).sort(); if(!list.length) return;
      pos["__pg__"+p]={x:XCOL[3],y:y,page:p,header:true}; y+=20;
      list.forEach(id=>{ pos[id]={x:XCOL[3],y:y}; y+=H+VG; }); y+=8; });
    maxY=Math.max(maxY,y);
    svg.setAttribute("viewBox",`0 0 ${XCOL[3]+W+30} ${maxY+20}`);
    svg.setAttribute("width",XCOL[3]+W+30); svg.setAttribute("height",maxY+20);
    window.__layerlbls=lab.map((t,i)=>({x:XCOL[i],t}));
  } else {
    // viz-only: one column per page
    const cols=PAGES.length, GAPX=(258+40);
    let maxY=0;
    PAGES.forEach((p,ci)=>{ let y=60; Object.keys(DATA.visualizations).filter(id=>DATA.visualizations[id].page===p).sort()
        .forEach(id=>{ pos[id]={x:24+ci*GAPX,y:y}; y+=H+VG+10; }); maxY=Math.max(maxY,y);
        pos["__pg__"+p]={x:24+ci*GAPX,y:34,page:p,header:true}; });
    svg.setAttribute("viewBox",`0 0 ${24+cols*GAPX+30} ${maxY+20}`);
    svg.setAttribute("width",24+cols*GAPX+30); svg.setAttribute("height",maxY+20);
    window.__layerlbls=[];
  }
}
function edgesFor(){
  const E=[];
  if(mode==="full"){
    for(const s in DATA.symbols){ const o=DATA.symbols[s];
      (o.feeds||[]).forEach(f=>{ if(pos[f]) E.push([s,f]); });
      (o.affects||[]).forEach(v=>{ if(pos[v]) E.push([s,v]); }); }
  } else {
    DATA.viz_links.forEach(l=>{ if(pos[l.a]&&pos[l.b]) E.push([l.a,l.b,l.via]); });
  }
  return E;
}
function path(a,b){ const A=pos[a],B=pos[b]; const x1=A.x+W,y1=A.y+H/2,x2=B.x,y2=B.y+H/2;
  const mx=(x1+x2)/2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; }
function vpath(a,b){ const A=pos[a],B=pos[b]; const x1=A.x+W/2,y1=A.y+H,x2=B.x+W/2,y2=B.y;
  const my=(y1+y2)/2; return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`; }

let EDGES=[];
function draw(){
  layout(); EDGES=edgesFor(); svg.innerHTML="";
  (window.__layerlbls||[]).forEach(L=> svg.appendChild(txt(L.x,30,L.t,"layerlbl")));
  const eg=mk("g",{}); svg.appendChild(eg);
  EDGES.forEach((e,i)=>{ const p=mk("path",{class:"edge",d: mode==="full"?path(e[0],e[1]):vpath(e[0],e[1])});
    p.dataset.a=e[0]; p.dataset.b=e[1]; eg.appendChild(p); });
  for(const id in pos){ const P=pos[id];
    if(P.header){ const t=txt(P.x, P.y+12, P.page, "pagelbl"); t.setAttribute("fill",PCOL[P.page]||"#333"); svg.appendChild(t); continue; }
    const g=mk("g",{class:"node"}); g.dataset.id=id;
    const viz=isViz(id);
    const fill = viz ? (PCOL[DATA.visualizations[id].page]||"#94a3b8") : "#e5e9f0";
    const r=mk("rect",{x:P.x,y:P.y,width:W,height:H,fill:fill, "fill-opacity": viz?0.92:1});
    const t=txt(P.x+8, P.y+H/2, clip(labelOf(id)), null); t.setAttribute("fill", viz?"#fff":"#1a1a2e");
    g.appendChild(r); g.appendChild(t);
    g.addEventListener("mouseenter",ev=>showTip(ev,id));
    g.addEventListener("mousemove",ev=>moveTip(ev));
    g.addEventListener("mouseleave",()=>{tip.style.display="none";});
    g.addEventListener("click",ev=>{ev.stopPropagation(); select(id);});
    svg.appendChild(g);
  }
  applyHighlight();
}
function txt(x,y,s,cls){ const t=mk("text",{x:x,y:y}); if(cls)t.setAttribute("class",cls); t.textContent=s; return t; }
function clip(s){ return s.length>34? s.slice(0,33)+"…": s; }

function neighborsOf(id){
  // set of node ids to highlight when 'id' is selected
  if(isViz(id)){
    const set=new Set([id]);
    (DATA.viz_upstream[id]||[]).forEach(s=>set.add(s));
    (DATA.viz_connected[id]||[]).forEach(v=>set.add(v));
    return set;
  }
  return new Set(DATA.symbol_downstream[id]||[id]);
}
function select(id){ sel=id; applyHighlight(); setBanner(id); }
function reset(){ sel=null; applyHighlight(); banner.textContent="Nothing selected."; }
function applyHighlight(){
  const set= sel? neighborsOf(sel): null;
  svg.querySelectorAll(".node").forEach(g=>{
    const id=g.dataset.id;
    g.classList.remove("dim","hot");
    if(set){ if(set.has(id)) g.classList.add("hot"); else g.classList.add("dim"); }
  });
  svg.querySelectorAll(".edge").forEach(p=>{
    p.classList.remove("dim","hot");
    if(set){ if(set.has(p.dataset.a)&&set.has(p.dataset.b)) p.classList.add("hot"); else p.classList.add("dim"); }
  });
}
function setBanner(id){
  if(isViz(id)){
    const up=(DATA.viz_upstream[id]||[]), conn=(DATA.viz_connected[id]||[]);
    banner.innerHTML = `<b>${DATA.visualizations[id].title}</b> — depends on ${up.length} calc/tab/render; `+
      `shares logic with <b>${conn.length}</b> other visualisation(s).`;
  } else {
    const o=DATA.symbols[id]; const vz=(DATA.symbol_viz[id]||[]);
    const rd=o.reDerive? ` <span class="redr">[needs runDerive()]</span>`:"";
    banner.innerHTML = `Changing <b>${id}</b> affects <b>${vz.length}</b> visualisation(s).${rd}`;
  }
}
function showTip(ev,id){
  let h="";
  if(isViz(id)){ const v=DATA.visualizations[id];
    h=`<b>${v.title}</b><br><span class="k">page</span> ${v.page}<br><span class="k">render</span> ${v.render} → #${v.container}`+
      `<br><span class="k">depends on</span> ${(DATA.viz_upstream[id]||[]).join(", ")||"—"}`;
  } else { const o=DATA.symbols[id];
    h=`<b>${id}</b>${o.reDerive?' <span class="redr">[runDerive]</span>':''}<br>${o.desc}`+
      `<br><span class="k">affects</span> ${(DATA.symbol_viz[id]||[]).map(v=>DATA.visualizations[v].title).join(", ")||"—"}`;
  }
  tip.innerHTML=h; tip.style.display="block"; moveTip(ev);
}
function moveTip(ev){ const pad=14; let x=ev.clientX+pad,y=ev.clientY+pad;
  if(x+350>innerWidth)x=ev.clientX-360; if(y+120>innerHeight)y=ev.clientY-120; tip.style.left=x+"px"; tip.style.top=y+"px"; }
function setMode(m){ mode=m; sel=null; banner.textContent="Nothing selected.";
  document.getElementById("m-full").classList.toggle("active",m==="full");
  document.getElementById("m-viz").classList.toggle("active",m==="viz"); draw(); }
svg.addEventListener("click",()=>reset());
draw();
</script></body></html>"""

def compute_graph(m):
    symbols = m["symbols"]; viz = m["visualizations"]
    def reach(sym):
        seen=set(); stack=[sym]; vset=set()
        while stack:
            c=stack.pop()
            if c in seen or c not in symbols: continue
            seen.add(c)
            for v in symbols[c].get("affects",[]): vset.add(v)
            for n in symbols[c].get("feeds",[]): stack.append(n)
        return seen, vset
    symbol_downstream={}; symbol_viz={}
    for s in symbols:
        seen,vset = reach(s)
        symbol_downstream[s]=sorted(seen|set(vset)); symbol_viz[s]=sorted(vset)
    viz_upstream={v:[] for v in viz}
    for s in symbols:
        for v in symbol_viz[s]: viz_upstream[v].append(s)
    viz_upstream={v:sorted(set(x)) for v,x in viz_upstream.items()}
    viz_connected={}
    for v in viz:
        conn=set()
        for s in viz_upstream[v]: conn|=set(symbol_viz[s])
        conn.discard(v); viz_connected[v]=sorted(conn)
    ids=list(viz); links=[]
    for i in range(len(ids)):
        for j in range(i+1,len(ids)):
            shared=sorted(set(viz_upstream[ids[i]])&set(viz_upstream[ids[j]]))
            if shared: links.append({"a":ids[i],"b":ids[j],"via":shared})
    return {"visualizations":viz,
            "symbols":{k:{"desc":s["desc"],"reDerive":s.get("reDerive",False),
                          "feeds":s.get("feeds",[]),"affects":s.get("affects",[])} for k,s in symbols.items()},
            "symbol_downstream":symbol_downstream,"symbol_viz":symbol_viz,
            "viz_upstream":viz_upstream,"viz_connected":viz_connected,"viz_links":links}

def build_graph(m):
    data = compute_graph(m)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "impact_graph.html")
    html = GRAPH_HTML.replace("/*__DATA__*/", "const DATA = " + json.dumps(data) + ";")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(color("Wrote " + out, "viz"))
    print(color("Open it in a browser (double-click). Regenerate after editing impact_map.json.", "dim"))

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

    if args[0] == "--graph":
        build_graph(m); return

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
