
'use strict';

const TEXT_EXT = {
  js:'JavaScript', jsx:'JavaScript (React)', ts:'TypeScript', tsx:'TypeScript (React)',
  mjs:'JavaScript', cjs:'JavaScript', py:'Python', html:'HTML', htm:'HTML',
  css:'CSS', scss:'SCSS', less:'LESS', json:'JSON', md:'Markdown', markdown:'Markdown',
  txt:'Text', xml:'XML', svg:'SVG', yml:'YAML', yaml:'YAML', toml:'TOML', ini:'INI',
  cfg:'Config', conf:'Config', sh:'Shell', bash:'Shell', sql:'SQL',
  csv:'CSV', gitignore:'Git', gitattributes:'Git', editorconfig:'Config', npmignore:'Git',
  pyproject:'TOML', pipfile:'TOML', dockerfile:'Docker', ipynb:'Jupyter Notebook',
  lock:'Lockfile', prisma:'Prisma', graphql:'GraphQL', gql:'GraphQL', env:'Env',
  rst:'reStructuredText', rb:'Ruby', php:'PHP', c:'C', h:'C Header', cpp:'C++', java:'Java',
  go:'Go', rs:'Rust', kt:'Kotlin', swift:'Swift', lua:'Lua', r:'R'
};
const ASSET_EXT = {
  png:'PNG Image', jpg:'JPEG Image', jpeg:'JPEG Image', gif:'GIF Image', webp:'WebP Image',
  ico:'Icon', bmp:'BMP Image', mp4:'Video', webm:'Video', mov:'Video', avi:'Video',
  mp3:'Audio', wav:'Audio', ogg:'Audio', flac:'Audio',
  glb:'3D Model', obj:'3D Model', fbx:'3D Model', stl:'3D Model',
  pdf:'PDF', zip:'Archive', tar:'Archive', gz:'Archive', rar:'Archive', '7z':'Archive',
  woff:'Font', woff2:'Font', ttf:'Font', otf:'Font', eot:'Font',
  db:'Database', sqlite:'Database', exe:'Executable', dll:'Binary', so:'Binary',
  wasm:'WebAssembly', jar:'Java Archive'
};
const IGNORED_DIRS = new Set(['node_modules','.svn','.hg','dist','build','out','.next','.nuxt',
  'coverage','.cache','vendor','__pycache__','.idea','.vscode','target','bin','obj']);
const MAX_READ = 512 * 1024;
const MAX_FILES = 20000;      
const MAX_GIT_FILES = 6000;   

const state = {
  files: [], byPath: new Map(), gitFiles: new Map(),
  rootName: 'Project', warnings: [], startPoints: [], health: null, stats: null,
  graph: null, query: '',
  git: { available:false, branch:'', commits:[], fileHist:new Map(), partial:false, reason:'' }
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(1) + ' KB'
                     : n < 1073741824 ? (n/1048576).toFixed(1) + ' MB' : (n/1073741824).toFixed(2) + ' GB';
const short = p => p.split('/').pop();
const dirOf = p => p.split('/').slice(0, -1).join('/');
const fmtDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });

$('#btn-pick-dir').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', e => {
  ingest([...e.target.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f })));
});

if (window.showDirectoryPicker) {
  const b = $('#btn-pick-fs');
  b.classList.remove('hidden');
  b.addEventListener('click', async () => {
    try { const handle = await showDirectoryPicker(); const items = []; await walkHandle(handle, '', items); ingest(items); }
    catch (err) { if (err.name !== 'AbortError') alert('Could not open folder: ' + err.message); }
  });
}

const dz = $('#dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', async e => {
  e.preventDefault(); dz.classList.remove('over');
  const entry = e.dataTransfer.items && e.dataTransfer.items[0] &&
                e.dataTransfer.items[0].webkitGetAsEntry && e.dataTransfer.items[0].webkitGetAsEntry();
  if (entry && entry.isDirectory) { const items = []; await walkEntry(entry, '', items); ingest(items); }
  else if (e.dataTransfer.files.length)
    ingest([...e.dataTransfer.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f })));
});

async function walkEntry(entry, prefix, out) {
  if (out.length > MAX_FILES) return;
  if (entry.isFile) out.push({ path: prefix + entry.name, file: await new Promise(res => entry.file(res)) });
  else if (entry.isDirectory && (entry.name === '.git' || !IGNORED_DIRS.has(entry.name))) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise(res => reader.readEntries(res));
      for (const child of batch) await walkEntry(child, prefix + entry.name + '/', out);
    } while (batch.length > 0);
  }
}
async function walkHandle(handle, prefix, out) {
  for await (const [name, sub] of handle.entries()) {
    if (out.length > MAX_FILES) return;
    if (sub.kind === 'file') out.push({ path: prefix + name, file: await sub.getFile() });
    else if (sub.kind === 'directory' && (name === '.git' || !IGNORED_DIRS.has(name)))
      await walkHandle(sub, prefix + name + '/', out);
  }
}

function ingest(items) {
  if (!items.length) return;
  items = items.slice(0, MAX_FILES);
  const first = items[0].path;
  state.rootName = first.includes('/') ? first.split('/')[0] : 'Project';

  state.gitFiles = new Map();
  const normal = [];
  for (const it of items) {
    if (it.path.includes('/.git/')) {
      if (state.gitFiles.size < MAX_GIT_FILES) state.gitFiles.set(it.path, it.file);
    } else normal.push(it);
  }

  state.files = normal.map(({ path, file }) => {
    const ext = (path.split('.').pop() || '').toLowerCase();
    const base = path.split('/').pop();
    let lang = TEXT_EXT[ext] || null;
    let kind = 'asset';
    if (lang) kind = 'source';
    else if (ASSET_EXT[ext]) kind = 'asset';
    if (base === 'Dockerfile') { lang = 'Docker'; kind = 'source'; }
    if (base.toLowerCase().startsWith('license')) { lang = 'License'; kind = 'doc'; }
    if (ext === 'md' || ext === 'markdown' || ext === 'rst') kind = 'doc';
    if (base === '.gitignore' || base === '.gitattributes' || base === '.npmignore') { lang = 'Git'; kind = 'config'; }
    if (['package.json','requirements.txt','pyproject.toml','Cargo.toml','go.mod','pom.xml',
         'composer.json','Pipfile','Gemfile','build.gradle','packages.config'].includes(base)) kind = 'manifest';
    return { name: base, path, size: file.size, ext, kind, lang, file,
             content: null, lines: 0, imports: [], importedBy: [], externalDeps: [],
             depth: -1, role: null };
  }).sort((a, b) => a.path.localeCompare(b.path));

  state.byPath = new Map(state.files.map(f => [f.path, f]));
  runScan();
}
const STAGES = [
  ['Reading directory structure', stageRead],
  ['Classifying files & detecting languages', stageClassify],
  ['Detecting project manifests & README', stageManifests],
  ['Reading file contents', stageContents],
  ['Parsing imports & building dependency graph', stageGraph],
  ['Analyzing relationships & entry points', stageEntry],
  ['Reading Git history (if present)', stageGit],
  ['Checking project health', stageHealth],
];

async function runScan() {
  $('#landing').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#topbar').classList.add('hidden');
  $('#scan-screen').classList.remove('hidden');
  $('#scan-title').textContent = 'ANALYZING ' + state.rootName.toUpperCase();

  const ul = $('#scan-stages');
  ul.innerHTML = '';
  for (const [label] of STAGES)
    ul.insertAdjacentHTML('beforeend', `<li><span class="st"></span>${esc(label)}</li>`);

  for (let i = 0; i < STAGES.length; i++) {
    const li = ul.children[i];
    li.classList.add('active');
    li.querySelector('.st').innerHTML = '<span class="spin">&#9684;</span>';
    try { await STAGES[i][1](); }
    catch (err) { console.warn('Stage failed:', STAGES[i][0], err); }
    await new Promise(r => setTimeout(r, 30));
    li.classList.remove('active');
    li.classList.add('done');
    li.querySelector('.st').textContent = '\u2713';
  }

  $('#scan-screen').classList.add('hidden');
  $('#topbar').classList.remove('hidden');
  $('#app').classList.remove('hidden');
  renderAll();
}

async function stageRead() {
  const dirs = new Set();
  for (const f of state.files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  state.stats = {
    files: state.files.length, folders: dirs.size,
    size: state.files.reduce((a, f) => a + f.size, 0),
    source: state.files.filter(f => f.kind === 'source').length,
    langCounts: {}, dirs
  };
}
function stageClassify() {
  for (const f of state.files)
    if (f.lang) state.stats.langCounts[f.lang] = (state.stats.langCounts[f.lang] || 0) + 1;
}
function stageManifests() {}

async function stageContents() {
  const wanted = state.files.filter(f =>
    f.kind === 'source' && ['js','jsx','ts','tsx','mjs','cjs','py','html','htm','css','scss','less','json','md','markdown','txt'].includes(f.ext));
  for (let i = 0; i < wanted.length; i++) {
    const f = wanted[i];
    if (f.size <= MAX_READ) { f.content = await f.file.text(); f.lines = f.content.split('\n').length; }
    else { f.content = await f.file.slice(0, MAX_READ).text(); f.lines = f.content.split('\n').length; }
    if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
  }
}

const RE_JS   = /(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_PY1  = /^\s*import\s+([A-Za-z0-9_\.]+)/gm;
const RE_PY2  = /^\s*from\s+([A-Za-z0-9_\.]+)\s+import/gm;
const RE_HTML = /<script[^>]+src=["']([^"']+)["']/gi;
const RE_CSS  = /@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/g;

function resolveImport(fromPath, spec) {
  spec = spec.split('?')[0].split('#')[0];
  if (!spec) return null;
  if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/'))
    return { external: spec.split('/')[0] };
  let base = fromPath.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    else if (part === '..') base.pop();
    else base.push(part);
  }
  const stem = base.join('/');
  const candidates = [
    stem,
    stem + '.js', stem + '.jsx', stem + '.ts', stem + '.tsx', stem + '.mjs', stem + '.cjs',
    stem + '.py', stem + '.css', stem + '.scss', stem + '.less',
    stem + '.html', stem + '.htm', stem + '.json',
    stem + '/index.js', stem + '/index.jsx', stem + '/index.ts', stem + '/index.tsx',
    stem + '/index.py', stem + '/__init__.py', stem + '/main.py'
  ];
  for (const c of candidates) if (state.byPath.has(c)) return { path: c };
  return null;
}

function extractImports(f) {
  if (!f.content) return;
  const specs = [];
  const push = s => { if (s && !specs.includes(s)) specs.push(s); };
  if (['js','jsx','ts','tsx','mjs','cjs'].includes(f.ext)) {
    let m; RE_JS.lastIndex = 0;
    while ((m = RE_JS.exec(f.content))) push(m[1] || m[2] || m[3]);
  } else if (f.ext === 'py') {
    let m; RE_PY1.lastIndex = 0; RE_PY2.lastIndex = 0;
    while ((m = RE_PY1.exec(f.content))) push(m[1]);
    while ((m = RE_PY2.exec(f.content))) push(m[1]);
  } else if (['html','htm'].includes(f.ext)) {
    let m; RE_HTML.lastIndex = 0;
    while ((m = RE_HTML.exec(f.content))) push(m[1]);
  } else if (['css','scss','less'].includes(f.ext)) {
    let m; RE_CSS.lastIndex = 0;
    while ((m = RE_CSS.exec(f.content))) push(m[1]);
  }
  for (const s of specs) {
    const r = resolveImport(f.path, s);
    if (!r) continue;
    if (r.external) { if (!f.externalDeps.includes(r.external)) f.externalDeps.push(r.external); continue; }
    if (r.path !== f.path && !f.imports.includes(r.path)) f.imports.push(r.path);
  }
}

function stageGraph() {
  for (const f of state.files) extractImports(f);
  for (const f of state.files)
    for (const p of f.imports) {
      const t = state.byPath.get(p);
      if (t && !t.importedBy.includes(f.path)) t.importedBy.push(f.path);
    }

  const depth = new Map();
  const indeg = new Map(state.files.map(f => [f.path, f.imports.length]));
  let queue = state.files.filter(f => f.imports.length === 0).map(f => f.path);
  queue.forEach(p => depth.set(p, 0));
  while (queue.length) {
    const next = [];
    for (const cur of queue) {
      const cf = state.byPath.get(cur);
      for (const dep of cf.importedBy) {
        if ((depth.get(cur) || 0) + 1 > (depth.get(dep) || 0)) depth.set(dep, (depth.get(cur) || 0) + 1);
        indeg.set(dep, indeg.get(dep) - 1);
        if (indeg.get(dep) === 0) next.push(dep);
      }
    }
    queue = next;
  }
  for (const f of state.files) f.depth = depth.get(f.path) ?? 0;

  const cycles = [];
  const color = new Map();
  for (const start of state.files) {
    if ((color.get(start.path) || 0) !== 0) continue;
    const stack = [[start.path, 0]];
    color.set(start.path, 1);
    const pathStack = [start.path];
    while (stack.length) {
      const [node, idx] = stack[stack.length - 1];
      const adj = state.byPath.get(node).imports;
      if (idx < adj.length) {
        stack[stack.length - 1][1]++;
        const nxt = adj[idx];
        const c = color.get(nxt) || 0;
        if (c === 0) { color.set(nxt, 1); stack.push([nxt, 0]); pathStack.push(nxt); }
        else if (c === 1) {
          const cycle = pathStack.slice(pathStack.indexOf(nxt)).concat(nxt);
          if (!cycles.some(ex => ex.includes(nxt))) cycles.push(cycle);
        }
      } else {
        color.set(node, 2); stack.pop(); pathStack.pop();
      }
    }
  }
  state.graph = { cycles };
}

function guessRole(f) {
  const dir = f.path.toLowerCase();
  if (/test|spec|__tests__|mock/.test(dir)) return 'Test';
  if (/servic|api|client|provider|controller|endpoint/.test(dir)) return 'Service';
  if (/util|helper|lib\/|common|shared/.test(dir)) return 'Utility';
  if (/hook|composable/.test(dir)) return 'Hook';
  if (/component|widget/.test(dir)) return 'Component';
  if (/page|route|screen|view/.test(dir)) return 'Page';
  if (/config|const|setting/.test(dir)) return 'Config';
  if (/style|css|theme|scss/.test(dir)) return 'Style';
  if (/script|tool|cli|bin/.test(dir)) return 'Script';
  if (/model|store|state|redux|context|entity/.test(dir)) return 'State / Model';
  if (/middleware/.test(dir)) return 'Middleware';
  if (/asset|static|public|image/.test(dir)) return 'Asset';
  return 'Source';
}

function manifestEntryPath() {
  const pkg = state.files.find(f => f.name === 'package.json' && f.content);
  if (pkg) {
    try {
      const j = JSON.parse(pkg.content);
      const main = j.main || j.module;
      if (main) { const r = resolveImport(pkg.path, main.startsWith('./') ? main : './' + main); if (r && r.path) return r.path; }
    } catch (e) {}
  }
  return null;
}

function stageEntry() {
  for (const f of state.files) if (f.kind === 'source') f.role = guessRole(f);
  const srcFiles = state.files.filter(f => f.kind === 'source');
  const cand = new Map();
  const add = (p, why, score) => {
    if (!p || !state.byPath.has(p)) return;
    const cur = cand.get(p);
    if (!cur) cand.set(p, { why: [why], score });
    else { cur.score += score; if (!cur.why.includes(why)) cur.why.push(why); }
  };

  const mEntry = manifestEntryPath();
  if (mEntry) add(mEntry, 'referenced by package.json build metadata', 100);

  for (const f of srcFiles)
    if (/^(main|index|app|server|cli|__main__)\.(js|jsx|ts|tsx|mjs|py)$/i.test(f.name) || /^manage\.py$/i.test(f.name))
      add(f.path, `conventional entry filename "${f.name}"`, 55);

  const byFan = [...srcFiles].sort((a, b) => b.importedBy.length - a.importedBy.length);
  if (byFan[0] && byFan[0].importedBy.length > 0)
    add(byFan[0].path, `imported by ${byFan[0].importedBy.length} files — the busiest hub`, 38);
  if (byFan[1] && byFan[1].importedBy.length > 0)
    add(byFan[1].path, `imported by ${byFan[1].importedBy.length} files — a core module`, 30);

  for (const f of srcFiles.filter(f => ['html','htm'].includes(f.ext)))
    add(f.path, 'HTML page — likely a browser entry point', 45);

  state.startPoints = [...cand.entries()]
    .map(([path, v]) => ({ path, ...v, role: state.byPath.get(path).role }))
    .sort((a, b) => b.score - a.score).slice(0, 4);

  const W = [];
  for (const cyc of state.graph.cycles)
    W.push({ level: 'bad', title: 'CIRCULAR DEPENDENCY',
      body: 'These modules eventually depend on each other: <code>' +
        cyc.map(p => esc(short(p))).join('</code> &rarr; <code>') +
        '</code>. Consider extracting shared logic.' });

  const orphans = srcFiles.filter(f => f.importedBy.length === 0 && f.imports.length > 0 &&
    !/^(main|index|app|server|__main__|manage)\./i.test(f.name));
  if (orphans.length)
    W.push({ level: 'warn', title: 'POSSIBLY UNREFERENCED FILES',
      body: `${orphans.length} file(s) have no detected incoming references — they may be unused, dynamically loaded, or intentionally standalone:<br>` +
        orphans.slice(0, 8).map(o => `<code>${esc(o.path)}</code>`).join(' ') +
        (orphans.length > 8 ? ' …' : '') });

  const big = srcFiles.filter(f => f.lines > 500).sort((a, b) => b.lines - a.lines);
  for (const b of big.slice(0, 5))
    W.push({ level: 'warn', title: 'LARGE SOURCE FILE',
      body: `<code>${esc(b.path)}</code> — ${b.lines.toLocaleString()} lines. Large files can be harder to maintain and reason about.` });

  const extCount = state.files.reduce((a, f) => a + f.externalDeps.length, 0);
  const hasLock = state.files.some(f => ['package-lock.json','yarn.lock','pnpm-lock.yaml','poetry.lock','Pipfile.lock','Cargo.lock','Gemfile.lock'].includes(f.name));
  if (extCount > 0 && !hasLock)
    W.push({ level: 'warn', title: 'EXTERNAL DEPENDENCIES WITHOUT LOCKFILE',
      body: `${extCount} external package import(s) detected but no lockfile found. Versions may drift across machines.` });

  if (!state.files.some(f => /^readme(\.(md|markdown|txt|rst))?$/i.test(f.name)))
    W.push({ level: 'warn', title: 'NO README FOUND',
      body: 'A README helps newcomers understand the project. Consider adding one.' });

  if (!W.length)
    W.push({ level: 'ok', title: 'NO ISSUES DETECTED',
      body: 'No circular dependencies, no oversized files, README present. This project looks tidy.' });

  state.warnings = W;
}

function gitFile(rel) { return state.gitFiles.get(state.rootName + '/' + rel) || state.gitFiles.get(rel); }

async function inflate(file) {
  const buf = await file.arrayBuffer();
  const ds = new DecompressionStream('deflate');   // zlib-wrapped deflate
  const out = await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);                      // Uint8Array has indexOf — ArrayBuffer does not
}

async function readGitObject(sha) {
  const f = gitFile(`.git/objects/${sha.slice(0,2)}/${sha.slice(2)}`);
  if (!f) return null;
  try {
    const bytes = await inflate(f);
    const nul = bytes.indexOf(0);
    const head = new TextDecoder().decode(bytes.slice(0, nul)); // "<type> <len>"
    const type = head.split(' ')[0];
    return { type, data: bytes.slice(nul + 1) };
  } catch (e) { return null; }
}

function parseCommit(buf, sha) {
  const text = new TextDecoder().decode(buf);
  const blank = text.indexOf('\n\n');
  const headers = text.slice(0, blank).split('\n');
  let tree = null, ts = 0, author = '', msg = '';
  const parents = [];
  for (const h of headers) {
    if (h.startsWith('tree ')) tree = h.slice(5).trim();
    else if (h.startsWith('parent ')) parents.push(h.slice(7).trim());
    else if (h.startsWith('author ')) {
      const m = h.match(/^(.*?) <.*? (\d+) [+-]\d+$/);
      if (m) { author = m[1]; ts = +m[2]; }
    }
  }
  msg = text.slice(blank + 2).trim();
  return { sha, tree, parents, author, ts, msg, files: null };
}

async function readTreeEntries(sha) {
  const obj = await readGitObject(sha);
  if (!obj || obj.type !== 'tree') return [];
  const buf = obj.data;
  const dec = new TextDecoder();
  const out = [];
  let i = 0;
  while (i < buf.length && out.length < 4000) {
    const sp = buf.indexOf(0x20, i);
    const nul = buf.indexOf(0, sp);
    const mode = dec.decode(buf.slice(i, sp));
    const name = dec.decode(buf.slice(sp + 1, nul));
    const shaBytes = buf.slice(nul + 1, nul + 21);
    const hex = [...shaBytes].map(b => b.toString(16).padStart(2, '0')).join('');
    out.push({ mode, name, sha: hex, isTree: mode === '40000' });
    i = nul + 21;
  }
  return out;
}

async function flattenTree(treeSha, prefix, map) {
  if (!treeSha) return;
  const entries = await readTreeEntries(treeSha);
  for (const e of entries) {
    const p = prefix ? prefix + '/' + e.name : e.name;
    if (e.isTree) await flattenTree(e.sha, p, map);
    else map.set(p, e.sha);
  }
}

async function diffTrees(oldTree, newTree) {
  const res = { added: [], modified: [], deleted: [] };
  if (!newTree) return res;
  const oldMap = new Map(), newMap = new Map();
  await flattenTree(oldTree, '', oldMap);
  await flattenTree(newTree, '', newMap);
  const strip = p => p.startsWith(state.rootName + '/') ? p.slice(state.rootName.length + 1) : state.rootName + '/' + p;
  for (const [p, sha] of newMap) {
    const rel = strip(p);
    if (state.byPath.has(rel) || true) {
      if (!oldMap.has(p)) res.added.push(rel);
      else if (oldMap.get(p) !== sha) res.modified.push(rel);
    }
  }
  for (const p of oldMap.keys())
    if (!newMap.has(p)) res.deleted.push(strip(p));
  return res;
}

async function stageGit() {
  state.git = { available:false, branch:'', commits:[], fileHist:new Map(), partial:false, reason:'' };
  try {
    const headFile = gitFile('.git/HEAD');
    if (!headFile) { state.git.reason = 'no .git directory found in the selected folder'; return; }
    const headTxt = (await headFile.text()).trim();
    let sha = null;
    const m = headTxt.match(/ref:\s*(\S+)/);
    if (m) {
      state.git.branch = m[1].split('/').pop();
      const rf = gitFile('.git/' + m[1]);
      if (rf) sha = (await rf.text()).trim();
      else {
        const pr = gitFile('.git/packed-refs');
        if (pr) {
          const mm = (await pr.text()).match(new RegExp('^' + m[1].replace(/\//g, '\\/') + '\\s+([0-9a-f]{40})', 'm'));
          if (mm) sha = mm[1];
        }
      }
    } else sha = headTxt;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) { state.git.reason = 'could not resolve HEAD'; return; }

    const seen = new Set(); const commits = []; let cur = sha;
    while (cur && !seen.has(cur) && commits.length < 60) {
      seen.add(cur);
      const obj = await readGitObject(cur);
      if (!obj || obj.type !== 'commit') { state.git.partial = true; break; }
      commits.push(parseCommit(obj.data, cur));
      cur = commits[commits.length - 1].parents[0] || null;
    }
    if (!commits.length) { state.git.reason = 'git objects are packed (not yet supported) or unreadable'; return; }

    // per-commit file changes (diff against first parent), capped & incremental
    for (let i = 0; i < commits.length; i++) {
      const parentTree = (i + 1 < commits.length) ? commits[i + 1].tree : null;
      commits[i].files = await diffTrees(parentTree, commits[i].tree);
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const hist = new Map();
    for (let i = 0; i < commits.length; i++)
      for (const p of [...commits[i].files.added, ...commits[i].files.modified]) {
        if (!hist.has(p)) hist.set(p, []);
        hist.get(p).push(i);
      }
    state.git = { available:true, branch: state.git.branch, commits, fileHist: hist,
                  partial: state.git.partial || commits.length >= 60,
                  reason: commits.length >= 60 ? 'showing the most recent 60 commits' : '' };
  } catch (e) {
    state.git.reason = 'git parsing failed: ' + e.message;
  }
}

function stageHealth() {
  const src = state.files.filter(f => f.kind === 'source');
  const readme = state.files.find(f => /^readme(\.(md|markdown|txt|rst))?$/i.test(f.name));
  const tests = state.files.some(f => /test|spec|__tests__/i.test(f.path));
  const entry = state.startPoints.length > 0;
  const cycles = state.graph.cycles.length;
  const big = src.filter(f => f.lines > 500).length;
  const orphanRatio = src.length ? src.filter(f => f.importedBy.length === 0 && f.imports.length > 0).length / src.length : 0;

  let doc = 0; const docWhy = [];
  if (readme) { doc += 15; docWhy.push('README present (+15)'); }
  if (readme && readme.content) {
    if (/install|getting started|setup/i.test(readme.content)) { doc += 5; docWhy.push('has Install section (+5)'); }
    if (/usage|how to|quick start/i.test(readme.content)) { doc += 5; docWhy.push('has Usage section (+5)'); }
    if (/example|demo/i.test(readme.content)) { doc += 5; docWhy.push('has Examples (+5)'); }
  }
  if (!readme) docWhy.push('no README — documentation score reduced');
  doc = Math.min(30, doc);

  let struct = 10; const structWhy = ['recognizable directory layout (+10)'];
  const topDirs = new Set([...state.stats.dirs].map(d => d.split('/').pop()));
  if (topDirs.has('src') || topDirs.has('lib') || topDirs.has('app')) { struct += 5; structWhy.push('dedicated source directory (+5)'); }
  if (tests) { struct += 5; structWhy.push('tests detected (+5)'); }

  const entryS = entry ? (manifestEntryPath() ? 25 : 20) : 5;
  const entryWhy = entry ? (manifestEntryPath() ? 'entry point confirmed by package.json (+25)' : 'entry point inferred from conventions (+20)')
                         : 'no clear entry point found (+5)';

  let depS = 15; const depWhy = [];
  if (cycles) { depS -= Math.min(10, cycles * 5); depWhy.push(`${cycles} circular chain(s) (−5 each)`); }
  if (orphanRatio > .4) { depS -= 4; depWhy.push('many files with no incoming references (−4)'); }
  if (!depWhy.length) depWhy.push('clean dependency graph');

  let comp = 10; const compWhy = [];
  if (big) { comp -= Math.min(10, big * 2); compWhy.push(`${big} file(s) over 500 lines (−2 each)`); }
  if (!compWhy.length) compWhy.push('no oversized files');

  const cats = [
    { name: 'DOCUMENTATION',  score: doc,    max: 30, why: docWhy.join(' · ') },
    { name: 'STRUCTURE',      score: struct, max: 20, why: structWhy.join(' · ') },
    { name: 'ENTRY CLARITY',  score: entryS, max: 25, why: entryWhy },
    { name: 'DEPENDENCIES',   score: depS,   max: 15, why: depWhy.join(' · ') },
    { name: 'COMPLEXITY',     score: comp,   max: 10, why: compWhy.join(' · ') },
  ];
  state.health = { total: Math.round(cats.reduce((a, c) => a + c.score, 0)), cats };
}

function detectStack() {
  const has = n => state.files.some(f => f.name === n);
  const any = re => state.files.some(f => re.test(f.name));
  const bits = [];
  if (has('vite.config.js') || has('vite.config.ts')) bits.push('Vite');
  if (has('webpack.config.js')) bits.push('Webpack');
  if (has('next.config.js')) bits.push('Next.js');
  if (has('package.json')) bits.push('Node / JavaScript');
  if (has('requirements.txt') || has('pyproject.toml') || has('Pipfile')) bits.push('Python');
  if (has('Cargo.toml')) bits.push('Rust');
  if (has('go.mod')) bits.push('Go');
  if (has('pom.xml') || has('build.gradle')) bits.push('Java');
  if (has('composer.json')) bits.push('PHP');
  if (any(/\.jsx?$/) || any(/\.tsx?$/)) bits.push('Web application');
  if (!bits.length) bits.push('Generic file project');
  return 'Likely stack: ' + bits.join(' · ');
}

function renderAll() {
  $('#proj-name').textContent = state.rootName;
  const langs = Object.entries(state.stats.langCounts).sort((a, b) => b[1] - a[1]);
  $('#proj-type').textContent = detectStack();

  const cards = [
    [state.stats.files.toLocaleString(), 'FILES', 'c1'],
    [state.stats.folders.toLocaleString(), 'FOLDERS', 'c2'],
    [state.stats.source.toLocaleString(), 'SOURCE FILES', 'c3'],
    [fmtBytes(state.stats.size), 'SIZE', 'c4'],
  ];
  if (langs.length)
    cards.push([langs.slice(0, 3).map(l => esc(l[0])).join('<br>'), 'TOP LANGUAGES', 'c5']);
  if (state.git.available)
    cards.push([state.git.commits.length, 'COMMITS', 'c1']);
  $('#stat-cards').innerHTML = cards.map(([n, l, c]) =>
    `<div class="stat-card ${c}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');

  renderStartList();
  renderHealth();
  renderArch();
  renderManifests();
  renderTree();
  renderWarnings();
  renderHistory();
  buildGraph();
  $('#file-count-label').textContent =
    state.stats.files + ' files · ' + fmtBytes(state.stats.size) +
    (state.git.available ? ' · ' + state.git.commits.length + ' commits' : '');
}

function renderStartList() {
  const ol = $('#start-list');
  if (!state.startPoints.length) {
    ol.innerHTML = '<li style="pointer-events:none"><div><div class="sp-name">No strong entry candidates</div>' +
      '<div class="sp-why">Import a project with an index/main file or a package.json.</div></div></li>';
    return;
  }
  ol.innerHTML = state.startPoints.map(s => `
    <li data-path="${esc(s.path)}">
      <div>
        <div class="sp-name">${esc(short(s.path))}</div>
        <div class="sp-role">${esc(s.path)} &mdash; ${esc(s.role)}</div>
        <div class="sp-why">${esc(s.why.join('; '))}.</div>
      </div>
    </li>`).join('');
  ol.querySelectorAll('li').forEach(li =>
    li.addEventListener('click', () => inspect(li.dataset.path)));
}

function renderHealth() {
  $('#health-num').textContent = state.health.total + ' / 100';
  $('#health-bars').innerHTML = state.health.cats.map(c => {
    const pct = Math.round(c.score / c.max * 100);
    const cls = pct >= 70 ? '' : pct >= 45 ? 'mid' : 'low';
    return `<div class="hbar" title="${esc(c.why)}">
      <div class="hlabel"><span>${c.name}</span><span>${c.score}/${c.max}</span></div>
      <div class="track"><div class="fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderArch() {
  const groups = new Map(); 
  for (const f of state.files) {
    if (f.kind === 'asset') continue;
    const c = f.kind === 'manifest' ? 'Manifest' : f.kind === 'doc' ? 'Docs'
            : f.kind === 'config' ? 'Config' : (f.role || 'Source');
    if (!groups.has(c)) groups.set(c, new Map());
    const d = dirOf(f.path) || '.';
    groups.get(c).set(d, (groups.get(c).get(d) || 0) + 1);
  }
  const order = ['Page','Component','Service','State / Model','Hook','Utility','Middleware',
                 'Script','Style','Config','Test','Source','Manifest','Docs'];
  const keys = order.filter(k => groups.has(k)).concat([...groups.keys()].filter(k => !order.includes(k)));
  $('#arch-view').innerHTML = keys.map(k => {
    const dirs = [...groups.get(k).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return `<div class="arch-cat">&#9500;&#9472; ${esc(k.toUpperCase())} <span style="color:var(--pencil)">(${[...groups.get(k).values()].reduce((a,b)=>a+b,0)})</span></div>` +
      dirs.map(([d, n]) => `<div class="arch-dir">&#9472;&#9472; <b>${esc(d)}</b> — ${n} file${n>1?'s':''}</div>`).join('');
  }).join('');
}

function renderManifests() {
  const rows = [];
  const interesting = ['package.json','requirements.txt','pyproject.toml','Cargo.toml','go.mod',
    'pom.xml','composer.json','Gemfile','Dockerfile','Makefile','tsconfig.json',
    'vite.config.js','webpack.config.js','.gitignore'];
  for (const name of interesting) {
    const f = state.files.find(x => x.name === name);
    rows.push(f ? `<div class="mf"><span class="mf-tag">&#10003;</span><span>${esc(name)}</span></div>`
                : `<div class="mf"><span class="mf-missing">&#9675;</span><span style="opacity:.5">${esc(name)}</span></div>`);
  }
  const readme = state.files.find(f => /^readme/i.test(f.name));
  rows.push(readme ? `<div class="mf"><span class="mf-tag">&#10003;</span><span>${esc(readme.name)} — documentation found</span></div>`
                   : `<div class="mf"><span class="mf-missing">&#9888;</span><span>No README detected</span></div>`);
  $('#manifest-list').innerHTML = rows.join('');
}

function renderTree() {
  const wrap = $('#tree');
  wrap.innerHTML = '';
  const q = state.query.trim().toLowerCase();
  const matches = f => !q || f.path.toLowerCase().includes(q) ||
      (f.role && f.role.toLowerCase().includes(q)) || (f.lang && f.lang.toLowerCase().includes(q));

  const bigSet = new Set(state.files.filter(f => f.lines > 500).map(f => f.path));
  const cycSet = new Set(state.graph.cycles.flat());

  const root = { name: state.rootName, dirs: {}, files: [] };
  for (const f of state.files) {
    if (!matches(f)) continue;
    const parts = f.path.split('/');
    let node = root;
    for (let i = 1; i < parts.length - 1; i++)
      node = node.dirs[parts[i]] = node.dirs[parts[i]] || { name: parts[i], dirs: {}, files: [] };
    node.files.push(f);
  }

  const dirEl = (node) => {
    const el = document.createElement('div');
    el.className = 'dir';
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="caret">&#9660;</span><span>${esc(node.name)}/</span>`;
    const kids = document.createElement('div');
    kids.className = 'children';
    row.addEventListener('click', () => {
      kids.classList.toggle('hidden');
      row.querySelector('.caret').textContent = kids.classList.contains('hidden') ? '\u25B6' : '\u25BC';
    });
    for (const sub of Object.values(node.dirs).sort((a, b) => a.name.localeCompare(b.name)))
      kids.appendChild(dirEl(sub));
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const fe = document.createElement('div');
      fe.className = 'file' + (f.kind === 'asset' ? ' asset' : '') + (q ? ' hl' : '');
      let badges = '';
      if (bigSet.has(f.path)) badges += '<span class="badge big">BIG</span>';
      if (cycSet.has(f.path)) badges += '<span class="badge cyc">CYC</span>';
      fe.innerHTML = `<div class="row"><span class="caret"></span><span class="name">${esc(f.name)}</span>${badges}</div>`;
      fe.addEventListener('click', () => inspect(f.path));
      kids.appendChild(fe);
    }
    el.appendChild(row); el.appendChild(kids);
    return el;
  };
  wrap.appendChild(dirEl(root));
}

function renderWarnings() {
  const list = $('#warnings-list');
  list.innerHTML = state.warnings.map(w =>
    `<div class="wcard ${w.level === 'bad' ? 'bad' : w.level === 'ok' ? 'ok' : ''}">
       <div class="w-title">${w.level === 'ok' ? '&#10003; ' : '&#9888; '}${esc(w.title)}</div>
       <div class="w-body">${w.body}</div>
     </div>`).join('');
  list.querySelectorAll('code').forEach(c => c.addEventListener('click', () => {
    const full = state.byPath.get(c.textContent) ||
                 state.files.find(f => short(f.path) === c.textContent);
    if (full) inspect(full.path);
  }));
}

function renderHistory() {
  const sum = $('#git-summary'), list = $('#commit-list');
  if (!state.git.available) {
    sum.innerHTML = `<b>No Git history parsed.</b><br>${esc(state.git.reason || '')}` +
      `<br><span class="git-note">Drop a folder that contains its .git directory to enable archaeology (loose objects).</span>`;
    list.innerHTML = '';
    return;
  }
  const first = state.git.commits[state.git.commits.length - 1];
  const last = state.git.commits[0];
  sum.innerHTML =
    `<b>Branch:</b> ${esc(state.git.branch || 'detached')} &nbsp; <b>Commits parsed:</b> ${state.git.commits.length}` +
    `<br><b>Oldest:</b> ${fmtDate(first.ts)} — ${esc(first.msg.split('\n')[0])}` +
    `<br><b>Latest:</b> ${fmtDate(last.ts)} — ${esc(last.msg.split('\n')[0])}` +
    (state.git.reason ? `<br><span class="git-note">${esc(state.git.reason)}</span>` : '') +
    `<br><span style="color:var(--pencil)">Click a commit to see which files it changed; click a file chip to inspect it.</span>`;

  list.innerHTML = state.git.commits.map((c, i) => {
    const na = c.files.added.length, nm = c.files.modified.length, nd = c.files.deleted.length;
    const chips =
      c.files.added.slice(0, 12).map(p => `<span class="fchip add" data-p="${esc(p)}" title="added">+ ${esc(short(p))}</span>`).join('') +
      c.files.modified.slice(0, 12).map(p => `<span class="fchip mod" data-p="${esc(p)}" title="modified">&bull; ${esc(short(p))}</span>`).join('') +
      c.files.deleted.slice(0, 8).map(p => `<span class="fchip del" data-p="${esc(p)}" title="deleted">&minus; ${esc(short(p))}</span>`).join('');
    const more = na + nm + nd > 32 ? `<span style="color:var(--pencil)">… ${na+nm+nd-32} more</span>` : '';
    return `<div class="commit" data-i="${i}">
      <div class="c-msg">${esc(c.msg.split('\n')[0])}</div>
      <div class="c-meta">${fmtDate(c.ts)} &middot; ${esc(c.author)} &middot; ${c.sha.slice(0, 7)}
        &nbsp; <span style="color:var(--mint-deep)">+${na}</span>
        <span style="color:var(--butter-deep)">&bull;${nm}</span>
        <span style="color:var(--rose-deep)">&minus;${nd}</span></div>
      <div class="c-files">${chips}${more}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.commit').forEach(el =>
    el.addEventListener('click', e => {
      if (e.target.dataset.p) { const f = state.byPath.get(e.target.dataset.p); if (f) inspect(f.path); return; }
      el.classList.toggle('open');
    }));
}

let view = { x: 40, y: 30, k: 1 };
let traceMode = false;

function buildGraph() {
  const svg = $('#graph');
  const src = state.files.filter(f => f.imports.length || f.importedBy.length);
  $('#graph-empty').classList.toggle('hidden', src.length > 0);
  svg.innerHTML = '';

  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);

  const layers = new Map();
  for (const f of src) {
    if (!layers.has(f.depth)) layers.set(f.depth, []);
    layers.get(f.depth).push(f);
  }
  const sortedLayers = [...layers.keys()].sort((a, b) => b - a);
  const pos = new Map();
  const XGAP = 215, YGAP = 46, NW = 165, NH = 27;
  sortedLayers.forEach((d, li) => {
    layers.get(d).sort((a, b) => a.path.localeCompare(b.path))
      .forEach((f, i) => pos.set(f.path, { x: 40 + li * XGAP, y: 40 + i * YGAP }));
  });

  const edges = [];
  for (const f of src) for (const t of f.imports) {
    const a = pos.get(f.path), b = pos.get(t);
    if (!a || !b) continue;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M ${a.x} ${a.y + NH/2} C ${a.x - 48} ${a.y + NH/2}, ${b.x + NW + 48} ${b.y + NH/2}, ${b.x + NW} ${b.y + NH/2}`);
    p.setAttribute('class', 'edge');
    p.dataset.from = f.path; p.dataset.to = t;
    g.appendChild(p); edges.push(p);
  }

  if ($('#chk-external').checked) {
    const extCount = new Map();
    for (const f of src) for (const e of f.externalDeps) extCount.set(e, (extCount.get(e) || 0) + 1);
    const exts = [...extCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    exts.forEach(([name], i) => {
      const x = 40 + sortedLayers.length * XGAP, y = 40 + i * YGAP;
      pos.set('ext:' + name, { x, y });
      const n = document.createElementNS(NS, 'g');
      n.setAttribute('class', 'node extnode');
      n.innerHTML = `<rect x="${x}" y="${y}" width="${NW}" height="${NH}"></rect>
                     <text x="${x + 8}" y="${y + 17}">${esc(name.slice(0, 22))}</text>`;
      g.appendChild(n);
    });
    for (const f of src) for (const e of f.externalDeps) {
      const a = pos.get(f.path), b = pos.get('ext:' + e);
      if (!a || !b) continue;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M ${a.x} ${a.y + NH/2} C ${a.x - 48} ${a.y + NH/2}, ${b.x + NW + 48} ${b.y + NH/2}, ${b.x + NW} ${b.y + NH/2}`);
      p.setAttribute('class', 'edge ext');
      g.appendChild(p);
    }
  }

  const nodes = [];
  for (const f of src) {
    const p = pos.get(f.path);
    const n = document.createElementNS(NS, 'g');
    n.setAttribute('class', 'node');
    n.dataset.path = f.path;
    n.innerHTML = `<rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}"></rect>
                   <text x="${p.x + 8}" y="${p.y + 17}">${esc(short(f.path).slice(0, 23))}</text>`;
    g.appendChild(n); nodes.push(n);
  }

  const highlight = path => {
    const chain = new Set([path]); const queue = [path];
    while (queue.length) {
      const cur = state.byPath.get(queue.shift());
      if (!cur) continue;
      for (const dep of cur.importedBy) if (!chain.has(dep)) { chain.add(dep); queue.push(dep); }
    }
    nodes.forEach(n => n.classList.toggle('hl', chain.has(n.dataset.path)));
    edges.forEach(e => e.classList.toggle('hl', chain.has(e.dataset.from) && chain.has(e.dataset.to)));
  };
  const clearHl = () => { nodes.forEach(n => n.classList.remove('hl')); edges.forEach(e => e.classList.remove('hl')); };

  nodes.forEach(n => n.addEventListener('click', e => {
    const p = n.dataset.path;
    if (e.shiftKey || traceMode) { highlight(p); return; }
    clearHl(); n.classList.add('hl');
    inspect(p);
  }));
  svg.addEventListener('click', e => { if (e.target === svg) clearHl(); });

  applyView(g);
  svg.onmousedown = e => {
    const sx = e.clientX, sy = e.clientY, ox = view.x, oy = view.y;
    const move = ev => { view.x = ox + ev.clientX - sx; view.y = oy + ev.clientY - sy; applyView(g); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  svg.onwheel = e => {
    e.preventDefault();
    view.k = Math.min(3, Math.max(.2, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    applyView(g);
  };
}
function applyView(g) { g.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }

$('#btn-reset-graph').addEventListener('click', () => { view = { x: 40, y: 30, k: 1 }; buildGraph(); });
$('#graph-search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  $('#graph').querySelectorAll('.node').forEach(n =>
    n.classList.toggle('hl', q && n.dataset.path && n.dataset.path.toLowerCase().includes(q)));
});
$('#chk-external').addEventListener('change', buildGraph);
$('#btn-trace-mode').addEventListener('click', function () {
  traceMode = !traceMode;
  this.textContent = 'Trace: ' + (traceMode ? 'on' : 'off');
  this.classList.toggle('on', traceMode);
});

function impact(path) {
  const direct = state.byPath.get(path).importedBy.length;
  const seen = new Set([path]); const queue = [...state.byPath.get(path).importedBy];
  while (queue.length) {
    const c = queue.shift();
    if (seen.has(c)) continue;
    seen.add(c);
    const f = state.byPath.get(c);
    if (f) queue.push(...f.importedBy);
  }
  const transitive = seen.size - 1 - direct;
  const lvl = transitive + direct >= 8 ? 'HIGH' : transitive + direct >= 3 ? 'MEDIUM' : 'LOW';
  return { direct, transitive, lvl };
}

function whyExists(f) {
  const evidence = [];
  if (f.importedBy.length) evidence.push(`imported by ${f.importedBy.length} file(s)`);
  if (f.imports.length) evidence.push(`imports ${f.imports.length} file(s)`);
  const h = state.git.fileHist.get(f.path);
  let firstCommit = null;
  if (h && h.length) {
    firstCommit = state.git.commits[h[h.length - 1]];
    evidence.push(`introduced in commit "${firstCommit.msg.split('\n')[0]}" (${fmtDate(firstCommit.ts)})`);
  }
  const startIdx = state.startPoints.findIndex(s => s.path === f.path);
  if (startIdx >= 0) evidence.push('ranked as a project entry point');

  let interp;
  if (f.importedBy.length > 3) interp = `a core ${(f.role || 'source').toLowerCase()} module that several parts of the project rely on`;
  else if (f.importedBy.length > 0) interp = `a supporting ${(f.role || 'source').toLowerCase()} module used by specific parts of the project`;
  else if (f.imports.length > 0) interp = `a standalone ${(f.role || 'source').toLowerCase()} module — possibly a script, entry point, or legacy code`;
  else interp = `a standalone ${(f.role || 'source').toLowerCase()} file with no detected relationships`;
  if (/legacy|old|deprecated|temp|todo|hack/i.test(f.path)) interp += ', and its name suggests it may be part of a legacy or migration layer';

  return { evidence, interp, firstCommit, histCount: h ? h.length : 0 };
}

function inspect(path) {
  const f = state.byPath.get(path);
  if (!f) return;
  const imp = impact(path);
  const why = whyExists(f);
  const rel = (list, cls, arrow) => list.length
    ? list.map(p => `<div class="r ${cls}" data-path="${esc(p)}"><span class="arrow">${arrow}</span>${esc(short(p))}<span style="color:var(--pencil)"> — ${esc(dirOf(p))}</span></div>`).join('')
    : '<div class="rel-empty">None detected.</div>';

  let preview = '';
  if (f.content) {
    const importLines = new Set();
    f.content.split('\n').forEach((ln, i) => {
      if (/\b(import|require|from)\b|@import|<script/.test(ln) && /['"]/.test(ln)) importLines.add(i + 1);
    });
    preview = `<div class="insp-h">PREVIEW</div><div class="code-prev">` +
      f.content.split('\n').slice(0, 120).map((ln, i) =>
        `<div class="ln${importLines.has(i + 1) ? ' impline' : ''}"><span class="no">${i + 1}</span><span class="lc">${esc(ln) || ' '}</span></div>`).join('') +
      (f.lines > 120 ? `<div class="ln"><span class="no">&hellip;</span><span class="lc">truncated</span></div>` : '') +
      `</div>`;
  } else if (f.kind === 'asset') {
    preview = `<div class="why-box"><b>ASSET.</b> Binary or non-source file — content analysis skipped. Type: ${esc(f.lang || (f.ext ? f.ext.toUpperCase() : 'unknown'))}.</div>`;
  }

  const orphanNote = (f.importedBy.length === 0 && f.imports.length > 0 && !/^(main|index|app)/i.test(f.name))
    ? `<div class="why-box"><b>POTENTIALLY UNREFERENCED.</b> No incoming imports detected. It may be unused, dynamically loaded, or intentionally standalone.</div>` : '';

  const gitHtml = (why.histCount > 0) ? `
    <div class="insp-h">GIT HISTORY</div>
    <div class="git-box">
      <b>Created:</b> ${fmtDate(why.firstCommit.ts)} &nbsp; <b>Modified:</b> ${why.histCount} time(s) in parsed history
      ${state.git.fileHist.get(f.path).slice(-3).reverse().map(ci => {
        const c = state.git.commits[ci];
        return `<div class="g-msg">&bull; ${esc(c.msg.split('\n')[0])} <span style="color:var(--pencil)">(${fmtDate(c.ts)})</span></div>`;
      }).join('')}
    </div>` : '';

  $('#insp-body').innerHTML = `
    <div class="insp-name">${esc(f.name)}</div>
    <div class="insp-path">${esc(f.path)}</div>
    <div class="insp-meta">
      <div class="m"><div class="k">TYPE</div><div class="v">${esc(f.lang || (f.ext ? f.ext.toUpperCase() : 'Unknown'))}</div></div>
      <div class="m"><div class="k">SIZE</div><div class="v">${fmtBytes(f.size)}</div></div>
      <div class="m"><div class="k">ROLE</div><div class="v">${esc(f.role || f.kind)}</div></div>
      <div class="m"><div class="k">LINES</div><div class="v">${f.lines ? f.lines.toLocaleString() : '—'}</div></div>
    </div>
    ${orphanNote}
    <div class="why-box"><b>WHY DOES THIS FILE EXIST?</b> ${esc(why.interp)}.
      ${why.evidence.length ? '<br>Evidence: ' + esc(why.evidence.join('; ')) + '.' : ''}</div>
    <div class="insp-actions">
      <button class="btn small primary" id="insp-trace">Trace impact in graph</button>
    </div>
    <div class="insp-h">IMPORTS (${f.imports.length})</div>
    <div class="rel-list">${rel(f.imports, 'dep', '&#8594;')}</div>
    <div class="insp-h">USED BY (${f.importedBy.length})</div>
    <div class="rel-list">${rel(f.importedBy, '', '&#8592;')}</div>
    ${f.externalDeps.length ? `<div class="insp-h">EXTERNAL PACKAGES</div><div class="rel-list">${[...new Set(f.externalDeps)].map(e => `<div class="r" style="cursor:default"><span class="arrow">&#8594;</span>${esc(e)}</div>`).join('')}</div>` : ''}
    <div class="insp-h">IMPACT ANALYSIS</div>
    <div class="impact-box">
      <div class="irow"><span>Direct dependents</span><b>${imp.direct}</b></div>
      <div class="irow"><span>Transitive dependents</span><b>${imp.transitive}</b></div>
      <div class="irow"><span>Potential impact</span><b class="impact-lvl ${imp.lvl}">${imp.lvl}</b></div>
    </div>
    ${gitHtml}
    ${preview}
  `;
  $('#inspector').classList.remove('hidden');
  $('#insp-body').querySelectorAll('.r[data-path]').forEach(r =>
    r.addEventListener('click', () => inspect(r.dataset.path)));
  $('#insp-trace').addEventListener('click', () => {
    switchView('graph');
    setTimeout(() => {
      const q = $('#graph-search');
      q.value = f.name;
      q.dispatchEvent(new Event('input'));
      traceMode = true;
      const btn = $('#btn-trace-mode');
      btn.textContent = 'Trace: on'; btn.classList.add('on');
      $('#graph').querySelectorAll('.node').forEach(n =>
        n.classList.toggle('hl', n.dataset.path === f.path || state.byPath.get(f.path).importedBy.includes(n.dataset.path)));
    }, 60);
  });
}
$('#insp-close').addEventListener('click', () => $('#inspector').classList.add('hidden'));

function switchView(name) {
  $$('.nav-btn[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === name));
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + name).classList.add('active');
  if (name === 'graph') buildGraph();
}
$$('.nav-btn[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

$('#search').addEventListener('input', e => { state.query = e.target.value; renderTree(); });

/* quick-open palette */
const palette = $('#palette'), palInput = $('#palette-input'), palResults = $('#palette-results');
let palSel = 0, palMatches = [];
function openPalette() {
  if ($('#app').classList.contains('hidden')) return;
  palette.classList.remove('hidden');
  palInput.value = ''; palMatches = state.files.slice(0, 50); palSel = 0; renderPalette();
  palInput.focus();
}
function closePalette() { palette.classList.add('hidden'); }
function renderPalette() {
  palResults.innerHTML = palMatches.slice(0, 50).map((f, i) =>
    `<div class="pal-item ${i === palSel ? 'sel' : ''}" data-p="${esc(f.path)}">
       <span>${esc(f.name)}</span><span class="p-path">${esc(f.path)}</span>
     </div>`).join('');
  palResults.querySelectorAll('.pal-item').forEach(el => el.addEventListener('click', () => {
    closePalette(); inspect(el.dataset.p);
  }));
}
palInput.addEventListener('input', () => {
  const q = palInput.value.trim().toLowerCase();
  palMatches = q
    ? state.files.filter(f => f.path.toLowerCase().includes(q)).slice(0, 50)
    : state.files.slice(0, 50);
  palSel = 0; renderPalette();
});
palInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palMatches.length - 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette(); }
  else if (e.key === 'Enter' && palMatches[palSel]) { closePalette(); inspect(palMatches[palSel].path); }
  else if (e.key === 'Escape') closePalette();
});
palette.addEventListener('click', e => { if (e.target === palette) closePalette(); });

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if ($('#app').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') { $('#inspector').classList.add('hidden'); closePalette(); }
  else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === '1') switchView('overview');
  else if (e.key === '2') switchView('graph');
  else if (e.key === '3') switchView('warnings');
  else if (e.key === '4') switchView('history');
});

$('#btn-export').addEventListener('click', () => {
  const L = [];
  L.push('# DEVLENS PROJECT REPORT');
  L.push('## ' + state.rootName);
  L.push('Stack: ' + detectStack());
  L.push(`Files: ${state.stats.files} · Folders: ${state.stats.folders} · Source: ${state.stats.source} · Size: ${fmtBytes(state.stats.size)}`);
  L.push('\n## Where to start');
  state.startPoints.forEach((s, i) => L.push(`${i + 1}. \`${s.path}\` — ${s.why.join('; ')}.`));
  L.push('\n## Health: ' + state.health.total + '/100');
  state.health.cats.forEach(c => L.push(`- ${c.name}: ${c.score}/${c.max} — ${c.why}`));
  L.push('\n## Warnings');
  state.warnings.forEach(w => L.push(`- **${w.title}** — ${w.body.replace(/<[^>]+>/g, '')}`));
  if (state.git.available) {
    L.push('\n## Git history (' + state.git.commits.length + ' commits, branch: ' + (state.git.branch || 'detached') + ')');
    state.git.commits.slice(0, 15).forEach(c =>
      L.push(`- ${fmtDate(c.ts)} — ${c.msg.split('\n')[0]} (+${c.files.added.length} ·${c.files.modified.length} −${c.files.deleted.length})`));
  }
  L.push('\n---\nGenerated locally by DevLens. No source code left your machine.');
  const blob = new Blob([L.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = state.rootName.replace(/\W+/g, '-') + '-devlens-report.md';
  a.click();
  URL.revokeObjectURL(a.href);
});

function resetProject() {
  if (!confirm('Analyze a different folder? Current analysis will be discarded.')) return;
  state.files = []; state.byPath = new Map(); state.gitFiles = new Map();
  state.warnings = []; state.startPoints = []; state.health = null; state.stats = null;
  state.graph = null; state.query = '';
  state.git = { available:false, branch:'', commits:[], fileHist:new Map(), partial:false, reason:'' };
  $('#file-input').value = '';
  $('#search').value = ''; $('#graph-search').value = '';
  $('#inspector').classList.add('hidden');
  closePalette();
  switchView('overview');
  $('#app').classList.add('hidden');
  $('#topbar').classList.add('hidden');
  $('#landing').classList.remove('hidden');
}
$('#btn-new-project').addEventListener('click', resetProject);