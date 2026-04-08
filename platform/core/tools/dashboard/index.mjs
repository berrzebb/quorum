/**
 * dashboard/index.mjs — Tool: dashboard
 *
 * Generate a live HTML dashboard from EventStore data.
 * Reads trigger evaluations, audit verdicts, fitness scores,
 * stagnation patterns, and learning suggestions from SQLite.
 * Outputs a self-contained HTML file with auto-refresh.
 */
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

export async function toolDashboard(params) {
  const { path: outPath, format = "html" } = params;

  // 1. Load EventStore
  let store;
  try {
    const bridgePath = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "../../bridge.mjs");
    // Dynamic import — fail gracefully
    const bridge = await import(bridgePath);
    const repoRoot = process.cwd();
    await bridge.init(repoRoot);
    store = bridge;
  } catch (err) {
    return { error: `EventStore unavailable: ${err.message}` };
  }

  // 2. Query events
  const triggers = store.event.queryEvents?.({ eventType: "trigger.evaluation", limit: 200, descending: true }) ?? [];
  const verdicts = store.event.queryEvents?.({ eventType: "audit.verdict", limit: 200, descending: true }) ?? [];
  const fitnessChecks = store.event.queryEvents?.({ eventType: "fitness.check", limit: 200, descending: true }) ?? [];
  const fitnessSnapshots = store.event.queryEvents?.({ eventType: "fitness.snapshot", limit: 50, descending: true }) ?? [];
  const stagnations = store.event.queryEvents?.({ eventType: "stagnation.detected", limit: 20, descending: true }) ?? [];
  const learnings = store.event.queryEvents?.({ eventType: "learning.suggestions", limit: 20, descending: true }) ?? [];
  const outcomes = store.event.queryEvents?.({ eventType: "trigger.outcome", limit: 100, descending: true }) ?? [];

  store.close?.();

  // 3. Compute stats
  const totalAudits = verdicts.length;
  const approved = verdicts.filter(e => e.payload?.verdict === "approved" || e.payload?.verdict === "agree").length;
  const rejected = verdicts.filter(e => e.payload?.verdict === "changes_requested" || e.payload?.verdict === "reject").length;
  const infraFail = verdicts.filter(e => e.payload?.verdict === "infra_failure").length;
  const approvalRate = totalAudits > 0 ? Math.round((approved / totalAudits) * 100) : 0;

  const fitnessScores = [...fitnessChecks, ...fitnessSnapshots]
    .filter(e => e.payload?.score != null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(e => ({ time: new Date(e.timestamp).toISOString(), score: e.payload.score, phase: e.payload.phase ?? "check" }));
  const bestFitness = fitnessScores.length > 0 ? Math.max(...fitnessScores.map(f => f.score)) : null;

  const triggerData = triggers
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(e => ({
      time: new Date(e.timestamp).toISOString(),
      score: e.payload?.score ?? 0,
      tier: e.payload?.tier ?? "T1",
      mode: e.payload?.mode ?? "skip",
    }));

  const stagnationList = stagnations.map(e => ({
    time: new Date(e.timestamp).toISOString(),
    patterns: e.payload?.patterns ?? [],
    count: e.payload?.count ?? 0,
  }));

  const learningSuggestions = learnings.flatMap(e => e.payload?.suggestions ?? []);

  // Trigger accuracy
  const accurateOutcomes = outcomes.filter(e => e.payload?.isAccurate).length;
  const triggerAccuracy = outcomes.length > 0 ? Math.round((accurateOutcomes / outcomes.length) * 100) : null;

  // 4. Format output
  if (format === "json") {
    return {
      stats: { totalAudits, approved, rejected, infraFail, approvalRate, bestFitness, triggerAccuracy },
      triggers: triggerData.slice(-50),
      fitness: fitnessScores.slice(-50),
      stagnations: stagnationList,
      learnings: learningSuggestions.slice(0, 10),
    };
  }

  // 5. Generate HTML
  const data = JSON.stringify({
    stats: { totalAudits, approved, rejected, infraFail, approvalRate, bestFitness, triggerAccuracy },
    triggers: triggerData,
    fitness: fitnessScores,
    verdicts: verdicts.sort((a, b) => a.timestamp - b.timestamp).map(e => ({
      time: new Date(e.timestamp).toISOString(),
      verdict: e.payload?.verdict ?? "unknown",
      source: e.source,
      tier: e.payload?.tier,
    })),
    stagnations: stagnationList,
    learnings: learningSuggestions.slice(0, 20),
  });

  const html = buildDashboardHTML(data);

  const outputPath = outPath
    ? resolve(outPath)
    : resolve(tmpdir(), "quorum-dashboard.html");

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");

  return { path: outputPath, stats: { totalAudits, approved, rejected, infraFail, approvalRate, bestFitness } };
}

function buildDashboardHTML(dataJson) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="30">
<title>Quorum Dashboard</title>
<style>
:root{--bg:#08090c;--surface:#0f1114;--border:#1a1d23;--bh:#2a2f38;--text:#a0a8b4;--dim:#545b67;--bright:#e8ecf1;--accent:#c8956c;--green:#8fb47a;--blue:#7c9cba;--purple:#b48fc7;--red:#c75c5c;--mono:'Courier New',monospace;--sans:system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--sans);background:var(--bg);color:var(--text);padding:32px}
.header{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:24px;margin-bottom:32px}
.header h1{font-size:2.4em;color:var(--bright);letter-spacing:-2px}
.header h1 em{font-weight:300;color:var(--green)}
.live{font-family:var(--mono);font-size:.7em;color:var(--green);display:flex;align-items:center;gap:6px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.stats{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;margin-bottom:40px}
.stat{padding:20px 12px;background:var(--surface);border:1px solid var(--border);text-align:center}
.stat:hover{border-color:var(--bh)}
.stat .n{font-size:2.2em;font-weight:700;color:var(--bright);line-height:1;letter-spacing:-1px}
.stat .l{font-family:var(--mono);font-size:.55em;color:var(--dim);letter-spacing:4px;margin-top:6px}
.stat.k .n{color:var(--green)}.stat.r .n{color:var(--red)}.stat.f .n{color:var(--accent)}
.bar{height:3px;background:var(--border);margin-top:10px;overflow:hidden}
.bar-fill{height:100%;transition:width 1s}
.sect{margin-bottom:40px}
.sect-label{font-family:var(--mono);font-size:.6em;color:var(--accent);letter-spacing:5px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.sect-label::before{content:'';width:12px;height:1px;background:var(--accent)}
.chart{position:relative;background:var(--surface);border:1px solid var(--border);padding:20px;height:280px}
.chart canvas{width:100%!important;height:100%!important}
table{width:100%;border-collapse:collapse;font-size:.82em}
th{font-family:var(--mono);font-size:.6em;color:var(--accent);letter-spacing:3px;text-align:left;padding:8px 10px;border-bottom:2px solid var(--border);position:sticky;top:0;background:var(--bg)}
td{padding:8px 10px;border-bottom:1px solid var(--border)}
tr:hover td{background:rgba(143,180,122,.03)}
.sk{color:var(--green);font-weight:600}.sr{color:var(--red)}.sf{color:var(--accent)}
.mono{font-family:var(--mono);font-size:.9em}
.warn{background:rgba(199,92,92,.08);border:1px solid var(--red);padding:12px 16px;margin-bottom:16px;font-family:var(--mono);font-size:.8em;color:var(--red)}
.learn{background:var(--surface);border:1px solid var(--border);padding:12px 16px;font-size:.85em}
.learn li{margin:4px 0;color:var(--dim)}
@media(max-width:768px){.stats{grid-template-columns:repeat(3,1fr)}body{padding:16px}}
</style>
</head>
<body>
<div class="header">
  <h1>Quorum <em>Dashboard</em></h1>
  <div><div class="live"><span class="dot"></span>LIVE (30s refresh)</div></div>
</div>
<div id="app"></div>
<script>
const D=${dataJson};
const $=id=>document.getElementById(id);
const app=document.getElementById('app');

// Stats
const s=D.stats;
app.innerHTML=\`
<div class="stats">
  <div class="stat"><div class="n">\${s.totalAudits}</div><div class="l">AUDITS</div></div>
  <div class="stat k"><div class="n">\${s.approved}</div><div class="l">APPROVED</div><div class="bar"><div class="bar-fill" style="width:\${s.approvalRate}%;background:var(--green)"></div></div></div>
  <div class="stat r"><div class="n">\${s.rejected}</div><div class="l">REJECTED</div><div class="bar"><div class="bar-fill" style="width:\${s.totalAudits?Math.round(s.rejected/s.totalAudits*100):0}%;background:var(--red)"></div></div></div>
  <div class="stat f"><div class="n">\${s.infraFail}</div><div class="l">INFRA FAIL</div></div>
  <div class="stat"><div class="n">\${s.bestFitness!=null?s.bestFitness.toFixed(2):'\\u2014'}</div><div class="l">BEST FITNESS</div></div>
  <div class="stat k"><div class="n">\${s.approvalRate}%</div><div class="l">APPROVAL RATE</div><div class="bar"><div class="bar-fill" style="width:\${s.approvalRate}%;background:var(--green)"></div></div></div>
  <div class="stat"><div class="n">\${s.triggerAccuracy!=null?s.triggerAccuracy+'%':'\\u2014'}</div><div class="l">TRIGGER ACC</div></div>
</div>

\${D.stagnations.length?\`<div class="warn">\\u26a0 Stagnation detected: \${D.stagnations[0].patterns.join(', ')} (last: \${D.stagnations[0].time.substring(0,19)})</div>\`:''}

<div class="sect">
  <div class="sect-label">TRIGGER SCORE TREND</div>
  <div class="chart"><canvas id="triggerChart"></canvas></div>
</div>

<div class="sect">
  <div class="sect-label">FITNESS TREND</div>
  <div class="chart"><canvas id="fitnessChart"></canvas></div>
</div>

<div class="sect">
  <div class="sect-label">VERDICT LOG</div>
  <div style="max-height:400px;overflow-y:auto">
    <table><thead><tr><th>#</th><th>TIME</th><th>VERDICT</th><th>SOURCE</th><th>TIER</th></tr></thead>
    <tbody>\${D.verdicts.map((v,i)=>\`<tr><td class="mono" style="color:var(--dim)">\${i+1}</td><td class="mono" style="font-size:.85em">\${v.time.substring(11,19)}</td><td class="\${v.verdict==='approved'||v.verdict==='agree'?'sk':v.verdict==='infra_failure'?'sf':'sr'}">\${v.verdict}</td><td class="mono">\${v.source}</td><td class="mono">\${v.tier??'\\u2014'}</td></tr>\`).join('')}
    </tbody></table>
  </div>
</div>

\${D.learnings.length?\`<div class="sect"><div class="sect-label">AUTO-LEARN SUGGESTIONS</div><div class="learn"><ul>\${D.learnings.map(l=>\`<li>\${l}</li>\`).join('')}</ul></div></div>\`:''}
\`;

// Charts
function drawLineChart(canvasId, data, valueKey, colorFn) {
  const canvas=document.getElementById(canvasId);if(!canvas||!data.length)return;
  const ctx=canvas.getContext('2d');
  const rect=canvas.parentElement.getBoundingClientRect();
  canvas.width=rect.width*2;canvas.height=(rect.height-40)*2;
  ctx.scale(2,2);const w=rect.width,h=rect.height-40;
  const values=data.map(d=>d[valueKey]);
  const mn=Math.min(...values)*0.95,mx=Math.max(...values)*1.05,rg=mx-mn||1;
  const px=i=>40+(w-60)*(i/Math.max(data.length-1,1));
  const py=v=>10+(h-20)*(1-(v-mn)/rg);

  // Grid
  ctx.strokeStyle='#1a1d23';ctx.lineWidth=.5;
  for(let i=0;i<=4;i++){const y=10+(h-20)*(i/4);ctx.beginPath();ctx.moveTo(40,y);ctx.lineTo(w-20,y);ctx.stroke();
  ctx.fillStyle='#545b67';ctx.font='9px monospace';ctx.textAlign='right';ctx.fillText((mx-rg*i/4).toFixed(2),36,y+3)}

  // Line
  ctx.beginPath();ctx.strokeStyle='#7c9cba';ctx.lineWidth=1.5;
  data.forEach((d,i)=>{i===0?ctx.moveTo(px(i),py(d[valueKey])):ctx.lineTo(px(i),py(d[valueKey]))});ctx.stroke();

  // Points
  data.forEach((d,i)=>{
    ctx.beginPath();ctx.arc(px(i),py(d[valueKey]),3,0,Math.PI*2);
    ctx.fillStyle=colorFn(d);ctx.fill();
  });
}

drawLineChart('triggerChart',D.triggers,'score',d=>d.mode==='skip'?'#545b67':d.mode==='simple'?'#c8956c':'#c75c5c');
drawLineChart('fitnessChart',D.fitness,'score',d=>d.score>=0.7?'#8fb47a':d.score>=0.4?'#c8956c':'#c75c5c');
</script>
</body>
</html>`;
}

// Make it async-compatible for bridge.init
export async function toolDashboardAsync(params) {
  return toolDashboard(params);
}
