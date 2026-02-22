import express, { type Request, type Response } from 'express';
import { getSuccessEvents, getPoisonEvents } from './store';

export function createApp(): express.Application {
  const app = express();

  // ── REST snapshot ──────────────────────────────────────────────────────────
  app.get('/api/events', (_req: Request, res: Response) => {
    res.json({ success: getSuccessEvents(), poison: getPoisonEvents() });
  });

  // ── Server-Sent Events ─────────────────────────────────────────────────────
  // Browsers connect here; we push a fresh snapshot every second.
  app.get('/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    const push = (): void => {
      const payload = JSON.stringify({
        success: getSuccessEvents(),
        poison:  getPoisonEvents(),
      });
      res.write(`data: ${payload}\n\n`);
    };

    push(); // immediate snapshot on connect
    const timer = setInterval(push, 1_000);
    req.on('close', () => clearInterval(timer));
  });

  // ── Dashboard HTML ─────────────────────────────────────────────────────────
  app.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(dashboardHtml());
  });

  return app;
}

// ─── HTML template ─────────────────────────────────────────────────────────────

function dashboardHtml(): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CI Build Events — RabbitMQ Demo</title>
  <style>
    /* ── Reset & base ─────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', monospace;
      font-size: 13px;
      background: #f8f9fa;
      color: #212529;
      padding: 20px 24px;
    }

    /* ── Header ───────────────────────────────────────────────────────────── */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid #dee2e6;
    }
    h1 { font-size: 16px; letter-spacing: 1px; color: #343a40; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px;
         color: #6c757d; margin: 24px 0 8px; }

    /* ── SSE status pill ──────────────────────────────────────────────────── */
    #sse-status {
      font-size: 11px; padding: 3px 10px; border-radius: 12px;
      font-weight: bold; border: 1px solid;
    }
    .connected    { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
    .disconnected { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }

    /* ── Counters ─────────────────────────────────────────────────────────── */
    #counters { font-size: 12px; color: #6c757d; margin-bottom: 6px; }
    #counters span { margin-right: 18px; }
    #counters strong { color: #343a40; }

    /* ── Legend ───────────────────────────────────────────────────────────── */
    .legend { display: flex; gap: 14px; margin-bottom: 12px; font-size: 11px; color: #6c757d; }
    .legend-dot {
      display: inline-block; width: 12px; height: 12px;
      border-radius: 2px; margin-right: 4px; vertical-align: middle;
    }

    /* ── Tables ───────────────────────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px;
            background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    thead th {
      background: #343a40; color: #f8f9fa; padding: 7px 10px;
      text-align: left; font-weight: normal; font-size: 11px; letter-spacing: .4px;
    }
    td { padding: 5px 10px; border-bottom: 1px solid #f1f3f5; vertical-align: middle; }

    /* ── Row colour coding ────────────────────────────────────────────────── */
    tr.c1 td { background: #dbeafe; }   /* consumer-1: soft blue  */
    tr.c2 td { background: #dcfce7; }   /* consumer-2: soft green */
    tr.poison td { background: #fee2e2; } /* poison: soft red     */

    /* ── Badges ───────────────────────────────────────────────────────────── */
    .badge {
      display: inline-block; padding: 1px 7px; border-radius: 10px;
      font-size: 10px; font-weight: bold; border: 1px solid;
    }
    .t-queued   { background:#e0f2fe; color:#075985; border-color:#bae6fd; }
    .t-started  { background:#fef9c3; color:#854d0e; border-color:#fde68a; }
    .t-finished { background:#dcfce7; color:#166534; border-color:#86efac; }
    .s-success  { color: #166534; font-weight: bold; }
    .s-failed   { color: #991b1b; font-weight: bold; }

    /* ── Misc ─────────────────────────────────────────────────────────────── */
    .mono   { font-family: monospace; font-size: 11px; }
    .muted  { color: #adb5bd; }
    .empty  { text-align: center; padding: 20px; color: #adb5bd; font-style: italic; }
  </style>
</head>
<body>

<header>
  <h1>&#9711; RabbitMQ — CI Build Events</h1>
  <span id="sse-status" class="disconnected">&#9679; Disconnected</span>
</header>

<div id="counters">
  <span>&#10003; Success: <strong id="cnt-success">0</strong></span>
  <span>&#10007; Poison: <strong id="cnt-poison">0</strong></span>
</div>

<div class="legend">
  <span><span class="legend-dot" style="background:#dbeafe;border:1px solid #93c5fd"></span>consumer-1</span>
  <span><span class="legend-dot" style="background:#dcfce7;border:1px solid #86efac"></span>consumer-2</span>
  <span><span class="legend-dot" style="background:#fee2e2;border:1px solid #fca5a5"></span>poison</span>
</div>

<h2>Successful Events</h2>
<table id="success-table">
  <thead>
    <tr>
      <th>Time</th>
      <th>Consumer</th>
      <th>Type</th>
      <th>Repo</th>
      <th>Branch</th>
      <th>Commit</th>
      <th>Status</th>
      <th>Duration</th>
      <th>Attempt</th>
      <th>Producer</th>
      <th>TraceId</th>
    </tr>
  </thead>
  <tbody id="success-body">
    <tr><td class="empty" colspan="11">Waiting for events&hellip;</td></tr>
  </tbody>
</table>

<h2>Poison / Failed Events</h2>
<table id="poison-table">
  <thead>
    <tr>
      <th>Time</th>
      <th>Routing Key</th>
      <th>Reason</th>
      <th>Raw (truncated)</th>
    </tr>
  </thead>
  <tbody id="poison-body">
    <tr><td class="empty" colspan="4">No poison messages yet</td></tr>
  </tbody>
</table>

<script>
  const statusEl    = document.getElementById('sse-status');
  const successBody = document.getElementById('success-body');
  const poisonBody  = document.getElementById('poison-body');
  const cntSuccess  = document.getElementById('cnt-success');
  const cntPoison   = document.getElementById('cnt-poison');

  function typeBadge(type) {
    const map = {
      'build.queued':   ['t-queued',   'queued'],
      'build.started':  ['t-started',  'started'],
      'build.finished': ['t-finished', 'finished'],
    };
    const [cls, label] = map[type] || ['', type];
    return '<span class="badge ' + cls + '">' + label + '</span>';
  }

  function statusCell(status) {
    if (!status) return '<span class="muted">—</span>';
    return '<span class="' + (status === 'success' ? 's-success' : 's-failed') + '">' + status + '</span>';
  }

  function ftime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderSuccess(events) {
    cntSuccess.textContent = events.length;
    if (!events.length) {
      successBody.innerHTML = '<tr><td class="empty" colspan="11">Waiting for events&hellip;</td></tr>';
      return;
    }
    successBody.innerHTML = events.map(function(e) {
      const cls = e.consumerId === 'consumer-1' ? 'c1' : 'c2';
      const dur = e.durationMs ? (e.durationMs / 1000).toFixed(2) + 's' : '<span class="muted">—</span>';
      return '<tr class="' + cls + '">'
        + '<td class="mono">' + ftime(e.createdAt) + '</td>'
        + '<td>' + esc(e.consumerId) + '</td>'
        + '<td>' + typeBadge(e.type) + '</td>'
        + '<td>' + esc(e.repo) + '</td>'
        + '<td>' + esc(e.branch) + '</td>'
        + '<td class="mono">' + esc(e.commitSha) + '</td>'
        + '<td>' + statusCell(e.status) + '</td>'
        + '<td class="mono">' + dur + '</td>'
        + '<td style="text-align:center">' + e.attempt + '</td>'
        + '<td>' + esc(e.producerId) + '</td>'
        + '<td class="mono muted">' + esc(e.traceId.slice(0, 8)) + '&hellip;</td>'
        + '</tr>';
    }).join('');
  }

  function renderPoison(events) {
    cntPoison.textContent = events.length;
    if (!events.length) {
      poisonBody.innerHTML = '<tr><td class="empty" colspan="4">No poison messages yet</td></tr>';
      return;
    }
    poisonBody.innerHTML = events.map(function(e) {
      const raw = e.raw.length > 90 ? e.raw.slice(0, 90) + '…' : e.raw;
      return '<tr class="poison">'
        + '<td class="mono">' + ftime(e.timestamp) + '</td>'
        + '<td>' + esc(e.routingKey) + '</td>'
        + '<td>' + esc(e.reason) + '</td>'
        + '<td class="mono">' + esc(raw) + '</td>'
        + '</tr>';
    }).join('');
  }

  function connect() {
    var es = new EventSource('/events');

    es.onopen = function() {
      statusEl.textContent = '● Connected';
      statusEl.className   = 'connected';
    };

    es.onmessage = function(e) {
      var data = JSON.parse(e.data);
      renderSuccess(data.success);
      renderPoison(data.poison);
    };

    es.onerror = function() {
      statusEl.textContent = '● Disconnected';
      statusEl.className   = 'disconnected';
      es.close();
      setTimeout(connect, 3000); // reconnect after 3 s
    };
  }

  connect();
</script>
</body>
</html>`;
}
