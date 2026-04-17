/**
 * greenlight web UI — v0.5
 *
 * Returns a self-contained HTML string. No external deps, no CDN calls.
 * Inline CSS (dark theme) + vanilla JS SSE client.
 */

export function htmlDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>greenlight</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5}
a{color:#58a6ff;text-decoration:none}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #21262d;background:#161b22}
header h1{font-size:15px;font-weight:600;color:#58a6ff;letter-spacing:.02em}
#dot{width:8px;height:8px;border-radius:50%;background:#3fb950;flex-shrink:0;transition:background .3s}
#dot.err{background:#f85149}
#status{font-size:11px;color:#8b949e}
#file-label{margin-left:auto;font-size:11px;color:#484f58}
main{display:grid;grid-template-columns:1fr;gap:0;max-width:1100px;margin:0 auto;padding:20px 16px;gap:24px}
@media(min-width:800px){main{grid-template-columns:320px 1fr}}
section h2{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8b949e;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #21262d}
/* contracts */
#contracts-list{display:flex;flex-direction:column;gap:6px}
.contract{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:6px;border:1px solid #21262d;background:#161b22;transition:border-color .2s}
.contract:hover{border-color:#30363d}
.mark{font-size:14px;flex-shrink:0;margin-top:1px}
.contract-body{flex:1;min-width:0}
.contract-title{color:#e6edf3;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.contract-meta{font-size:10px;color:#484f58;margin-top:2px}
.badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600}
.badge.passed{background:#1c4731;color:#3fb950}
.badge.failed{background:#4d1a1a;color:#f85149}
.badge.pending{background:#222;color:#8b949e}
/* run history */
#runs-wrap{grid-column:1/-1}
@media(min-width:800px){#runs-wrap{grid-column:2}}
table{width:100%;border-collapse:collapse}
th,td{padding:6px 10px;text-align:left;border-bottom:1px solid #21262d;font-size:12px}
th{color:#8b949e;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
td{color:#e6edf3}
tr:hover td{background:#161b22}
.ok{color:#3fb950}
.fail{color:#f85149}
.dim{color:#484f58}
/* messages */
#messages-wrap{grid-column:1/-1}
.msg{padding:7px 10px;border-radius:6px;border:1px solid #21262d;background:#161b22;margin-bottom:6px}
.msg-header{display:flex;gap:8px;align-items:center;margin-bottom:3px}
.msg-kind{font-size:10px;font-weight:600;color:#d2a8ff;background:#2d1f4a;padding:1px 7px;border-radius:10px}
.msg-route{font-size:11px;color:#8b949e}
.msg-ts{margin-left:auto;font-size:10px;color:#484f58}
.msg-payload{font-size:11px;color:#8b949e;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.empty{color:#484f58;font-size:12px;padding:10px 0;text-align:center}
</style>
</head>
<body>
<header>
  <span id="dot" class="err"></span>
  <h1>greenlight</h1>
  <span id="status">connecting…</span>
  <span id="file-label"></span>
</header>
<main>
  <section id="contracts-wrap">
    <h2>Contracts</h2>
    <div id="contracts-list"><p class="empty">loading…</p></div>
  </section>
  <section id="runs-wrap">
    <h2>Run History</h2>
    <div id="runs-list"><p class="empty">loading…</p></div>
  </section>
  <section id="messages-wrap" style="grid-column:1/-1">
    <h2>Agent Messages</h2>
    <div id="messages-list"><p class="empty">loading…</p></div>
  </section>
</main>
<script>
var es = null;
function connect() {
  if (es) { try { es.close(); } catch(e){} }
  es = new EventSource('/api/stream');
  es.onopen = function() {
    document.getElementById('dot').className = '';
    document.getElementById('status').textContent = 'live';
  };
  es.onerror = function() {
    document.getElementById('dot').className = 'err';
    document.getElementById('status').textContent = 'reconnecting…';
    setTimeout(connect, 3000);
  };
  es.onmessage = function() { fetchState(); };
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(iso) {
  var d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return Math.round(d/1000) + 's ago';
  if (d < 3600000) return Math.round(d/60000) + 'm ago';
  return new Date(iso).toLocaleTimeString();
}

function renderContracts(contracts) {
  var el = document.getElementById('contracts-list');
  if (!contracts || contracts.length === 0) {
    el.innerHTML = '<p class="empty">No contracts found</p>'; return;
  }
  var html = '';
  for (var i = 0; i < contracts.length; i++) {
    var c = contracts[i];
    var mark = c.checked ? '<span class="mark ok">&#10003;</span>' : (c.verifier ? '<span class="mark dim">&#9675;</span>' : '<span class="mark dim">&#183;</span>');
    var badge = c.checked ? '<span class="badge passed">passed</span>' : (c.verifier ? '<span class="badge pending">pending</span>' : '');
    var meta = c.verifier ? escHtml(c.verifier.command || '') : '<em>no verifier</em>';
    html += '<div class="contract">' + mark + '<div class="contract-body"><div class="contract-title">' + escHtml(c.title) + ' ' + badge + '</div><div class="contract-meta">' + meta + '</div></div></div>';
  }
  el.innerHTML = html;
}

function renderRuns(runs) {
  var el = document.getElementById('runs-list');
  if (!runs || runs.length === 0) {
    el.innerHTML = '<p class="empty">No runs yet</p>'; return;
  }
  var html = '<table><thead><tr><th></th><th>Contract</th><th>Trigger</th><th>Exit</th><th>Duration</th><th>When</th></tr></thead><tbody>';
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var icon = r.passed ? '<span class="ok">&#10003;</span>' : '<span class="fail">&#10007;</span>';
    html += '<tr><td>' + icon + '</td><td>' + escHtml(r.contractTitle) + '</td><td class="dim">' + escHtml(r.trigger) + '</td><td class="dim">' + r.exitCode + '</td><td class="dim">' + r.durationMs + 'ms</td><td class="dim">' + timeAgo(r.ts) + '</td></tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderMessages(messages) {
  var el = document.getElementById('messages-list');
  if (!messages || messages.length === 0) {
    el.innerHTML = '<p class="empty">No messages yet</p>'; return;
  }
  var html = '';
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var payload = typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload);
    html += '<div class="msg"><div class="msg-header"><span class="msg-kind">' + escHtml(m.kind) + '</span><span class="msg-route">' + escHtml(m.from) + ' &rarr; ' + escHtml(m.to) + '</span><span class="msg-ts">' + timeAgo(m.ts) + '</span></div><div class="msg-payload">' + escHtml(payload) + '</div></div>';
  }
  el.innerHTML = html;
}

async function fetchState() {
  try {
    var r = await fetch('/api/state');
    var s = await r.json();
    if (s.todoPath) document.getElementById('file-label').textContent = s.todoPath;
    renderContracts(s.contracts);
    renderRuns(s.runs);
    renderMessages(s.messages);
  } catch(e) {
    console.error('fetchState error', e);
  }
}

connect();
fetchState();
// Also poll every 10s as fallback
setInterval(fetchState, 10000);
</script>
</body>
</html>`;
}
