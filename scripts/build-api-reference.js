// Builds the API reference from docs/openapi.json and the request DTOs in src/.
// Refresh it after changing endpoints:
//   npm run openapi:export
//   node scripts/build-api-reference.js docs/openapi.json <out.html> docs/API-REFERENCE.md
const fs = require('fs');
const [, , specPath, outPath] = process.argv;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const schemas = spec.components?.schemas ?? {};

// The DTOs use class-validator only, so the spec's request schemas are empty.
// Read each DTO class from source instead: its fields and validation rules.
const srcRoot = require('path').resolve(require('path').dirname(specPath), '../src');
const dtoFields = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = require('path').join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'generated') walk(full); continue; }
    if (!/\.dto\.ts$/.test(e.name)) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const cls of src.matchAll(/export class (\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
      const fields = [];
      let decos = [];
      let open = 0; // unclosed parens of a decorator spanning several lines
      const depth = (s) => (s.match(/\(/g) ?? []).length - (s.match(/\)/g) ?? []).length;
      for (const raw of cls[2].split('\n')) {
        const line = raw.trim();
        if (open > 0) { decos[decos.length - 1] += ' ' + line; open += depth(line); continue; }
        if (line.startsWith('@')) { decos.push(line); open = depth(line); continue; }
        const m = line.match(/^(\w+)(\?|!)?\s*:\s*([^;=]+)/);
        if (!m) continue;
        const d = decos.join(' ');
        const rules = [];
        const pick = (re, f) => { const x = d.match(re); if (x) rules.push(f(x)); };
        pick(/description:\s*(['"`])(.+?)\1/, (x) => esc(x[2]));
        pick(/example:\s*(['"`]?)([^,'"`}]+)\1/, (x) => `e.g. <code>${esc(x[2].trim())}</code>`);
        pick(/IsEmail/, () => 'email address');
        pick(/MinLength\((\d+)\)/, (x) => `min ${x[1]} chars`);
        pick(/MaxLength\((\d+)\)/, (x) => `max ${x[1]} chars`);
        pick(/Length\((\d+),\s*(\d+)\)/, (x) => `${x[1]}–${x[2]} chars`);
        pick(/Matches\(\/(.+?)\//, (x) => `pattern <code>${esc(x[1])}</code>`);
        pick(/\bMin\((\d+)\)/, (x) => `≥ ${x[1]}`);
        pick(/\bMax\((\d+)\)/, (x) => `≤ ${x[1]}`);
        pick(/IsNumberString|IsNumericString/, () => 'digits as a string');
        pick(/IsIn\(\[([^\]]+)\]/, (x) => `one of ${esc(x[1])}`);
        pick(/IsEnum/, () => 'enum value');
        pick(/IsUUID/, () => 'UUID');
        pick(/IsUrl/, () => 'URL');
        pick(/IsBoolean/, () => 'true or false');
        pick(/ValidateNested/, () => 'nested object');
        fields.push({
          name: m[1],
          type: m[3].trim(),
          required: !(m[2] === '?' || /IsOptional/.test(d)),
          notes: rules.join(' · '),
        });
        decos = [];
      }
      dtoFields[cls[1]] = fields;
    }
  }
})(srcRoot);

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const resolve = (s) => (s && s.$ref ? schemas[s.$ref.split('/').pop()] ?? {} : s ?? {});

const GROUPS = [
  ['Auth', 'Accounts and sessions', 'Register, sign in, refresh tokens, verify email, reset passwords, one-time login codes.'],
  ['Tenancy', 'Business and branches', 'Who the signed-in user is, which business they act for, and the branches they can use.'],
  ['catalog', 'Products', 'The product catalogue: create, list, edit, retire, and bulk-import from CSV.'],
  ['inventory', 'Stock', 'Stock levels per branch, restocks and adjustments, and low-stock thresholds.'],
  ['payments', 'Payments', 'Confirmed payments waiting to be itemized, and cash payments recorded by hand.'],
  ['sales', 'Sales and refunds', 'Turn a payment into a sale by saying what was sold; refund all or part of a sale.'],
  ['managed payments', 'Paystack account setup', 'Create the business’s Paystack subaccount and dedicated virtual account (test mode).'],
  ['payout', 'Payout bank account', 'The bank account the business is paid out to. Only the last 4 digits are ever returned.'],
  ['reports', 'Dashboard and reports', 'Today’s figures, low-stock items, and the filtered sales history.'],
  ['notifications', 'Notifications', 'Send a templated message over email or WhatsApp to verify delivery.'],
  ['push', 'Browser push', 'Subscribe a browser to push notifications for payment and stock alerts.'],
  ['PaystackWebhook', 'Paystack webhooks', 'Called by Paystack, not by the app. Signed and verified before anything is processed.'],
  ['App', 'Health', 'A simple check that the API is up.'],
];

const ops = {};
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const tag = (op.tags ?? ['App'])[0];
    (ops[tag] ??= []).push({ path, method: method.toUpperCase(), op });
  }
}

function typeOf(p) {
  p = resolve(p);
  if (p.enum) return p.enum.map((v) => `"${v}"`).join(' | ');
  if (p.type === 'array') return `${typeOf(p.items)}[]`;
  return p.format ? `${p.type} (${p.format})` : p.type ?? 'object';
}

function fieldRows(schema) {
  const name = schema?.$ref?.split('/').pop();
  if (name && dtoFields[name]?.length) {
    return dtoFields[name].map((f) => `<tr><td><code>${esc(f.name)}</code></td><td class="t">${esc(f.type)}</td><td>${f.required ? '<span class="req">required</span>' : '<span class="opt">optional</span>'}</td><td>${f.notes}</td></tr>`);
  }
  const s = resolve(schema);
  const req = new Set(s.required ?? []);
  return Object.entries(s.properties ?? {}).map(([name, p]) => {
    const r = resolve(p);
    const bits = [];
    if (r.description) bits.push(esc(r.description));
    if (r.example !== undefined) bits.push(`e.g. <code>${esc(JSON.stringify(r.example))}</code>`);
    if (r.minLength) bits.push(`min ${r.minLength} chars`);
    if (r.maxLength) bits.push(`max ${r.maxLength} chars`);
    if (r.minimum !== undefined) bits.push(`≥ ${r.minimum}`);
    if (r.maximum !== undefined) bits.push(`≤ ${r.maximum}`);
    return `<tr><td><code>${esc(name)}</code></td><td class="t">${esc(typeOf(r))}</td><td>${req.has(name) ? '<span class="req">required</span>' : '<span class="opt">optional</span>'}</td><td>${bits.join(' · ')}</td></tr>`;
  });
}

function table(head, rows) {
  if (!rows.length) return '';
  return `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function endpoint({ path, method, op }) {
  const id = slug(`${method}-${path}`);
  const isPublic = !(op.security && op.security.length) && !/me|branches|products|stock|payments|sales|dashboard|reports|payout|subscriptions|notifications|resend|change-/.test(path);
  const params = (op.parameters ?? []).map((p) => {
    const s = resolve(p.schema);
    return `<tr><td><code>${esc(p.name)}</code></td><td class="t">${esc(p.in)}</td><td>${p.required ? '<span class="req">required</span>' : '<span class="opt">optional</span>'}</td><td>${esc(typeOf(s))}${p.description ? ' · ' + esc(p.description) : ''}</td></tr>`;
  });
  const content = op.requestBody?.content ?? {};
  const ctype = Object.keys(content)[0];
  const body = ctype ? fieldRows(content[ctype].schema) : [];
  const responses = Object.entries(op.responses ?? {}).map(([code, r]) => `<span class="code c${code[0]}">${esc(code)}</span>${r.description ? ` <span class="rd">${esc(r.description)}</span>` : ''}`);
  return `<article class="ep" id="${id}">
  <header class="ep-h"><span class="m m-${method.toLowerCase()}">${method}</span><code class="p">${esc(path).replace(/\{(\w+)\}/g, '<i>{$1}</i>')}</code>
  <span class="auth ${isPublic ? 'pub' : 'tok'}">${isPublic ? 'No token' : 'Bearer token'}</span></header>
  ${op.summary ? `<p class="sum">${esc(op.summary)}</p>` : ''}
  ${params.length ? `<h4>Parameters</h4>${table(['Name', 'In', '', 'Type'], params)}` : ''}
  ${body.length ? `<h4>Request body <span class="ct">${esc(ctype)}</span></h4>${table(['Field', 'Type', '', 'Notes'], body)}` : ''}
  ${responses.length ? `<div class="resp"><span class="rl">Responses</span>${responses.join('')}</div>` : ''}
</article>`;
}

const total = Object.values(ops).reduce((n, l) => n + l.length, 0);
const nav = GROUPS.filter(([t]) => ops[t]).map(([t, name]) => `<a href="#${slug(name)}">${esc(name)}<span>${ops[t].length}</span></a>`).join('');
const sections = GROUPS.filter(([t]) => ops[t]).map(([t, name, blurb]) => `<section class="grp" id="${slug(name)}">
<h2>${esc(name)}</h2><p class="blurb">${esc(blurb)}</p>
${ops[t].map(endpoint).join('\n')}
</section>`).join('\n');

const built = new Date().toISOString().slice(0, 10);
const html = `<title>Invent-IO API Reference</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
/* Layout: sticky group index on the left, endpoint ledger on the right; index becomes a wrapping strip on phones. */
:root{
  --bg:#f7f7f5;--surface:#ffffff;--ink:#1c1917;--muted:#5f5a55;--line:#e4e2df;--soft:#f0efec;
  --accent:#0b6358;--accent-soft:#e4f3f1;
  --get:#0b6358;--post:#1d4ed8;--patch:#a16207;--put:#7c3aed;--delete:#b91c1c;
  --ok:#0b6358;--warn:#a16207;--bad:#b91c1c;
  --sans:"IBM Plex Sans",-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#141312;--surface:#1c1b19;--ink:#ece9e5;--muted:#a49e97;--line:#2e2c29;--soft:#23221f;
  --accent:#4fc1ad;--accent-soft:#163631;
  --get:#4fc1ad;--post:#7aa7ff;--patch:#e0b048;--put:#b79cff;--delete:#f07a7a;
  --ok:#4fc1ad;--warn:#e0b048;--bad:#f07a7a;color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#141312;--surface:#1c1b19;--ink:#ece9e5;--muted:#a49e97;--line:#2e2c29;--soft:#23221f;
  --accent:#4fc1ad;--accent-soft:#163631;
  --get:#4fc1ad;--post:#7aa7ff;--patch:#e0b048;--put:#b79cff;--delete:#f07a7a;
  --ok:#4fc1ad;--warn:#e0b048;--bad:#f07a7a;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);padding-inline:16px}
.wrap{max-width:1180px;margin:0 auto;padding-block:40px 80px;display:grid;grid-template-columns:230px minmax(0,1fr);gap:48px}
code{font-family:var(--mono);font-size:.88em}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* index */
nav{position:sticky;top:calc(env(safe-area-inset-top,0px) + 24px);align-self:start;display:flex;flex-direction:column;gap:2px}
nav .k{font:600 11px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 10px 10px}
nav a{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:6px;color:var(--ink);text-decoration:none;font-size:14px}
nav a span{color:var(--muted);font:500 12px var(--mono);font-variant-numeric:tabular-nums}
nav a:hover{background:var(--soft)}
/* header */
.top{display:flex;flex-direction:column;gap:14px;padding-bottom:28px;border-bottom:1px solid var(--line);margin-bottom:8px}
.brand{font:700 13px var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.brand b{color:var(--accent)}
h1{margin:0;font:700 clamp(28px,4vw,38px)/1.15 var(--sans);letter-spacing:-.02em;text-wrap:balance}
.lede{margin:0;max-width:64ch;color:var(--muted)}
.base{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px}
.base code{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-size:13px;overflow-wrap:anywhere}
.base .lbl{font:600 11px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:6px}
.fact{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;min-width:0}
.fact h3{margin:0 0 4px;font:600 13px var(--sans)}
.fact p{margin:0;font-size:13.5px;color:var(--muted)}
/* groups */
.grp{padding-top:40px}
.grp h2{margin:0;font:700 22px/1.2 var(--sans);letter-spacing:-.01em;text-wrap:balance}
.blurb{margin:6px 0 18px;color:var(--muted);max-width:64ch}
.ep{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin-bottom:12px;min-width:0;scroll-margin-top:24px}
.ep-h{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.m{font:600 11.5px/1 var(--mono);letter-spacing:.04em;padding:5px 7px;border-radius:4px;border:1px solid currentColor;min-width:58px;text-align:center}
.m-get{color:var(--get)}.m-post{color:var(--post)}.m-patch{color:var(--patch)}.m-put{color:var(--put)}.m-delete{color:var(--delete)}
.p{font:500 14.5px var(--mono);overflow-wrap:anywhere;flex:1 1 220px;min-width:0}
.p i{font-style:normal;color:var(--accent)}
.auth{font:500 11.5px var(--sans);padding:3px 8px;border-radius:999px;white-space:nowrap}
.auth.tok{background:var(--soft);color:var(--muted)}
.auth.pub{background:var(--accent-soft);color:var(--accent)}
.sum{margin:10px 0 0;font-size:14.5px}
h4{margin:16px 0 6px;font:600 11px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
h4 .ct{font:400 11px var(--mono);letter-spacing:0;text-transform:none;margin-left:6px}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th{text-align:left;font:600 11px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 10px 6px 0;border-bottom:1px solid var(--line)}
td{padding:7px 10px 7px 0;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
td:first-child{white-space:nowrap}
td.t{font:400 12.5px var(--mono);color:var(--muted)}
.req{color:var(--bad);font-size:12px}.opt{color:var(--muted);font-size:12px}
.resp{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;margin-top:14px;font-size:13px}
.rl{font:600 11px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.code{font:600 12px var(--mono)}.c2{color:var(--ok)}.c3{color:var(--muted)}.c4{color:var(--warn)}.c5{color:var(--bad)}
.rd{color:var(--muted)}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
@media (max-width:860px){
  .wrap{grid-template-columns:minmax(0,1fr);gap:24px;padding-block:24px 64px}
  nav{position:static;flex-direction:row;flex-wrap:wrap;gap:6px}
  nav .k{width:100%;margin:0 0 2px}
  nav a{background:var(--surface);border:1px solid var(--line);padding:5px 10px;font-size:13px}
}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
</style>
<div class="wrap">
<nav aria-label="Endpoint groups"><p class="k">Endpoints · ${total}</p>${nav}</nav>
<main>
  <div class="top">
    <span class="brand">Invent<b>-IO</b> · Backend</span>
    <h1>API Reference</h1>
    <p class="lede">Every endpoint the Invent-IO backend exposes. Invent-IO turns a confirmed payment into a recorded sale and updates stock in under 60 seconds. This page is generated from the backend’s OpenAPI specification, so it lists exactly what the code serves.</p>
    <div class="base"><span class="lbl">Base URL</span><code>https://invent-io-backend-production.up.railway.app</code><span class="lbl">Version</span><code>/v1</code></div>
    <div class="facts">
      <div class="fact"><h3>Authentication</h3><p>Send <code>Authorization: Bearer &lt;accessToken&gt;</code>. Tokens come from register, login or a login code. Refresh them with <code>/v1/auth/refresh</code>.</p></div>
      <div class="fact"><h3>Money</h3><p>Amounts are whole minor units (kobo for NGN), sent and returned as strings, e.g. <code>"150000"</code> = ₦1,500.00.</p></div>
      <div class="fact"><h3>Businesses are isolated</h3><p>Every request is scoped to the signed-in user’s business. Roles decide what each member may do; owners can do everything.</p></div>
      <div class="fact"><h3>Lists and errors</h3><p>Lists use <code>limit</code> and <code>cursor</code>, returning <code>nextCursor</code>. Errors return <code>{ statusCode, message }</code>.</p></div>
    </div>
  </div>
  ${sections}
  <footer>Generated ${built} from <code>docs/openapi.json</code> in the invent-io-backend repository · ${total} endpoints.</footer>
</main>
</div>`;
fs.writeFileSync(outPath, html);

// Markdown edition, for reading on GitHub (which does not render HTML pages).
if (process.argv[4]) {
  const md = [];
  const cell = (s) => String(s ?? '').replace(/<code>(.*?)<\/code>/g, '`$1`').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\|/g, '\\|');
  const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
  md.push('# Invent-IO API Reference', '');
  md.push('Every endpoint the Invent-IO backend exposes. Invent-IO turns a confirmed payment into a recorded sale and updates stock in under 60 seconds. This file is generated from the backend’s OpenAPI specification ([`openapi.json`](openapi.json)) and its request DTOs, so it lists exactly what the code serves.', '');
  md.push('| | |', '|---|---|', '| **Base URL** | `https://invent-io-backend-production.up.railway.app` |', '| **Version prefix** | `/v1` |', `| **Endpoints** | ${total} |`, '');
  md.push('## Conventions', '');
  md.push('- **Authentication:** send `Authorization: Bearer <accessToken>`. Tokens come from register, login or a login code; refresh them with `POST /v1/auth/refresh`.');
  md.push('- **Money:** amounts are whole minor units (kobo for NGN), sent and returned as strings, e.g. `"150000"` = ₦1,500.00.');
  md.push('- **Businesses are isolated:** every request is scoped to the signed-in user’s business. Roles decide what each member may do; owners can do everything.');
  md.push('- **Lists and errors:** lists take `limit` and `cursor` and return `nextCursor`. Errors return `{ statusCode, message }`.', '');
  md.push('## Contents', '');
  for (const [t, name] of GROUPS) if (ops[t]) md.push(`- [${name}](#${anchor(name)}) (${ops[t].length})`);
  md.push('');
  for (const [t, name, blurb] of GROUPS) {
    if (!ops[t]) continue;
    md.push(`## ${name}`, '', blurb, '');
    for (const { path, method, op } of ops[t]) {
      const isPublic = !(op.security && op.security.length) && !/me|branches|products|stock|payments|sales|dashboard|reports|payout|subscriptions|notifications|resend|change-/.test(path);
      md.push(`### \`${method} ${path}\``, '');
      if (op.summary) md.push(op.summary, '');
      md.push(`**Auth:** ${isPublic ? 'none' : 'Bearer token'}`, '');
      const params = op.parameters ?? [];
      if (params.length) {
        md.push('**Parameters**', '', '| Name | In | Required | Type |', '|---|---|---|---|');
        for (const p of params) md.push(`| \`${p.name}\` | ${p.in} | ${p.required ? 'yes' : 'no'} | ${cell(typeOf(resolve(p.schema)))}${p.description ? ' · ' + cell(p.description) : ''} |`);
        md.push('');
      }
      const content = op.requestBody?.content ?? {};
      const ctype = Object.keys(content)[0];
      const ref = ctype && content[ctype].schema?.$ref?.split('/').pop();
      const fields = ref ? dtoFields[ref] ?? [] : [];
      if (fields.length) {
        md.push(`**Request body** (\`${ctype}\`)`, '', '| Field | Type | Required | Notes |', '|---|---|---|---|');
        for (const f of fields) md.push(`| \`${f.name}\` | \`${cell(f.type)}\` | ${f.required ? 'yes' : 'no'} | ${cell(f.notes)} |`);
        md.push('');
      } else if (ctype) {
        md.push(`**Request body:** \`${ctype}\``, '');
      }
      const codes = Object.entries(op.responses ?? {}).map(([c, r]) => `\`${c}\`${r.description ? ' ' + cell(r.description) : ''}`);
      if (codes.length) md.push(`**Responses:** ${codes.join(', ')}`, '');
    }
  }
  md.push('---', '', `Generated ${built} from \`docs/openapi.json\` and the request DTOs in \`src/\`.`, '');
  fs.writeFileSync(process.argv[4], md.join('\n'));
  console.log(`wrote ${process.argv[4]}`);
}
console.log(`wrote ${outPath} (${total} endpoints, ${(html.length / 1024).toFixed(0)} KB)`);
