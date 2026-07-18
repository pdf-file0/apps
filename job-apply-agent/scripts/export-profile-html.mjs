// Generates profiles/profile-copier.local.html — a local, file:// only page
// for copy-pasting candidate_profile fields into job application forms.
// Never hosted, never committed (gitignored). Rerun after editing/adding
// any profiles/candidate_profile*.local.yaml file.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profilesDir = join(root, 'profiles')
const outFile = join(profilesDir, 'profile-copier.local.html')

function flatten(value, prefix, out) {
  if (value === null || value === undefined || value === '') return
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i + 1}]`, out))
    return
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      flatten(val, prefix ? `${prefix}.${key}` : key, out)
    }
    return
  }
  out.push({ path: prefix, value: String(value) })
}

function humanize(path) {
  return path
    .replace(/\[(\d+)\]/g, ' #$1')
    .split('.')
    .join(' → ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const files = readdirSync(profilesDir).filter(
  (f) => f.startsWith('candidate_profile') && f.endsWith('.local.yaml'),
)

if (files.length === 0) {
  console.error('No profiles/candidate_profile*.local.yaml files found.')
  process.exit(1)
}

const profiles = {}
for (const file of files) {
  const data = parse(readFileSync(join(profilesDir, file), 'utf8'))
  const rows = []
  flatten(data, '', rows)
  const label = data?.candidate?.preferred_name || data?.candidate?.legal_name || file
  profiles[file] = { label, rows: rows.map((r) => ({ label: humanize(r.path), value: r.value })) }
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Profile Copier (local only)</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.3rem; }
  .bar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
  select, input { font-size: 1rem; padding: 0.4rem; }
  input#filter { flex: 1; min-width: 200px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #eee; vertical-align: top; }
  td.label { color: #555; width: 40%; }
  td.value { font-family: ui-monospace, monospace; word-break: break-word; }
  button { cursor: pointer; padding: 0.25rem 0.6rem; border: 1px solid #ccc; border-radius: 4px; background: #fafafa; }
  button:hover { background: #eee; }
  button.copied { background: #d4f5d4; border-color: #7c7; }
  .warn { background: #fff3cd; border: 1px solid #ffe08a; padding: 0.6rem 0.9rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Profile Copier (local only — do not upload or share this file)</h1>
<div class="warn">Contains PII. Opened directly from disk (file://). Regenerate with <code>npm run profile:web</code> after editing a profile.</div>
<div class="bar">
  <select id="profileSelect"></select>
  <input id="filter" placeholder="Filter fields…">
  <button id="copyAll">Copy all as text</button>
</div>
<table id="table"><tbody></tbody></table>
<script>
const PROFILES = ${JSON.stringify(profiles)};
const select = document.getElementById('profileSelect');
const tbody = document.querySelector('#table tbody');
const filter = document.getElementById('filter');

for (const [file, p] of Object.entries(PROFILES)) {
  const opt = document.createElement('option');
  opt.value = file;
  opt.textContent = p.label + ' (' + file + ')';
  select.appendChild(opt);
}

function render() {
  const rows = PROFILES[select.value].rows;
  const q = filter.value.toLowerCase();
  tbody.innerHTML = '';
  for (const row of rows) {
    if (q && !row.label.toLowerCase().includes(q) && !row.value.toLowerCase().includes(q)) continue;
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.className = 'label';
    tdLabel.textContent = row.label;
    const tdValue = document.createElement('td');
    tdValue.className = 'value';
    tdValue.textContent = row.value;
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    btn.onclick = () => {
      navigator.clipboard.writeText(row.value);
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1000);
    };
    tdBtn.appendChild(btn);
    tr.append(tdLabel, tdValue, tdBtn);
    tbody.appendChild(tr);
  }
}

document.getElementById('copyAll').onclick = () => {
  const text = PROFILES[select.value].rows.map((r) => r.label + ': ' + r.value).join('\\n');
  navigator.clipboard.writeText(text);
};

select.onchange = render;
filter.oninput = render;
render();
</script>
</body>
</html>
`

writeFileSync(outFile, html)
console.log(`Wrote ${outFile}`)
console.log(`Open with: open "${outFile}"`)
