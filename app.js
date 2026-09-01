/* ─────────────────────────────────────────────────────────────
   Objects search — loading animation demo

   Timeline
     0 – 10s   no results yet      → placeholder tiles ("Objects" icon)
    10 – 20s   images  9 – 13
    20 – 30s   images 15 – 20
    30 – 40s   images  1 – 8
    40s        search finishes by itself

   "Stop" (at any moment, or the automatic finish at 40s) starts
   re-ranking: drift flips upwards, speed doubles, the loader tile
   reads "Finalizing results..." and after 5s the final results show.
   ───────────────────────────────────────────────────────────── */

/* ── data ─────────────────────────────────────────────────── */

// natural width of every best shot (all of them are 270px tall)
const IMG_W = {
  1: 102, 2: 159, 3: 129, 4: 153, 5: 168, 6: 159, 7: 156, 8: 243,
  9: 114, 10: 255, 11: 177, 12: 162, 13: 147,
  15: 120, 16: 138, 17: 114, 18: 123, 19: 120, 20: 156
};
const NAT_H = 270;
const TIMES = ['8:43', '8:45', '8:47', '8:49', '8:50', '8:54', '8:58', '8:59'];

const src = n => `bestshots/image%20${n}.jpg`;
const timeOf = n => TIMES[(n * 3) % TIMES.length];
const widthOf = (n, h) => Math.round(IMG_W[n] / NAT_H * h);

const SEARCH_MS = 40000;   // full search
const FINAL_MS = 5000;    // re-ranking after stop

const PHASES = [
  { at: 0, pool: null },                        // nothing found yet
  { at: 10000, pool: [9, 10, 11, 12, 13] },
  { at: 20000, pool: [15, 16, 17, 18, 19, 20] },
  { at: 30000, pool: [1, 2, 3, 4, 5, 6, 7, 8] }
];

const GROUPS = [
  { label: 'Very High', items: [1, 2, 3, 4] },
  { label: 'High', items: [5, 6, 7, 8] },
  { label: 'Medium', items: [9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20] }
];

/* ── drift field geometry ─────────────────────────────────── */

const AREA_W = 786;          // center panel width
const AREA_H = 904 - 56;     // below the panel header
const PAD = 16;
const COLS = 4;
const COL_W = (AREA_W - PAD * 2) / COLS;
const TILE_H = 180;
const ROW_H = 280;           // vertical rhythm of the field
const SPAN_PAD = 186;        // off-screen buffer above / below the field
const ROWS = 5;
const SPAN = ROWS * ROW_H;
const OFF = TILE_H + SPAN_PAD;
const SPEED = 68;            // px/s — constant drift, unaffected by demo speed
const FINAL_SPEED_X = 2;     // ×2 and upwards while finalizing
const EASE_MAX = 36;         // px, cap on the ease-in-out excursion
const EDGE_FADE = 120;       // px of fade at the top / bottom of the field
const FILL = 0.72;           // chance a cell holds a tile at all
const PEAKS = [0.3, 0.6, 0.9];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = p => p * p * (3 - 2 * p);   // ease-in-out

/* ── elements ─────────────────────────────────────────────── */

const el = {
  scaler: document.getElementById('scaler'),
  window: document.getElementById('window'),
  drift: document.getElementById('drift'),
  results: document.getElementById('results'),
  idle: document.getElementById('state-idle'),
  loading: document.getElementById('state-loading'),
  resultsState: document.getElementById('state-results'),
  loadingTitle: document.getElementById('loading-title'),
  card: document.getElementById('loader-card'),
  cardText: document.getElementById('loader-card-text'),
  cardBtnText: document.getElementById('loader-card-btn-text'),
  dbgState: document.getElementById('dbg-state'),
  dbgTime: document.getElementById('dbg-time')
};

/* ── window scaling ───────────────────────────────────────── */

function fit() {
  const s = Math.min(1, (innerWidth - 48) / 1638, (innerHeight - 140) / 960);
  el.window.style.transform = `scale(${s})`;
  el.scaler.style.width = 1638 * s + 'px';
  el.scaler.style.height = 960 * s + 'px';
}
addEventListener('resize', fit);
fit();

/* ── state machine ────────────────────────────────────────── */

let mode = 'idle';        // idle | search | final | results
let clock = 0;            // ms into the search
let finalClock = 0;       // ms into re-ranking
let speedMult = 1;        // demo fast-forward

function currentPool() {
  let pool = null;
  for (const p of PHASES) if (clock >= p.at) pool = p.pool;
  return pool;
}

function show(state) {
  for (const s of [el.idle, el.loading, el.resultsState]) s.classList.remove('is-visible');
  state.classList.add('is-visible');
}

function startSearch() {
  clock = 0;
  finalClock = 0;
  mode = 'search';
  el.loadingTitle.textContent = 'Searching...';
  el.cardText.textContent = 'Searching...';
  el.cardBtnText.textContent = 'Finish';
  el.card.classList.remove('is-final');
  resetField();
  show(el.loading);
}

function startFinalizing() {
  if (mode !== 'search') return;
  mode = 'final';
  finalClock = 0;
  el.loadingTitle.textContent = 'Finalizing results...';
  el.cardText.textContent = 'Finalizing results...';
  el.card.classList.add('is-final');
}

function showResults() {
  mode = 'results';
  show(el.resultsState);
}

function reset() {
  mode = 'idle';
  clock = 0;
  finalClock = 0;
  show(el.idle);
}

/* ── drift field ──────────────────────────────────────────── */

const cells = [];

function makeCell(row, col) {
  const node = document.createElement('div');
  node.className = 'dtile';

  const img = document.createElement('img');
  img.className = 'dtile__img';
  img.alt = '';

  const icon = document.createElement('img');
  icon.className = 'dtile__icon';
  icon.src = 'assets/object-40.svg';
  icon.alt = '';

  const time = document.createElement('p');
  time.className = 'dtile__time';

  const badge = document.createElement('span');
  badge.className = 'dtile__badge';
  badge.textContent = '100%';

  node.append(img, icon, time, badge);
  el.drift.appendChild(node);

  const cell = {
    row, col, node, img, icon, time, badge,
    x: 0, y: 0, yJit: 0, w: 90,
    peak: 0.4, phase: 'off', t: 0, tIn: 0.9, tHold: 3, tOut: 1.2, tOff: 1
  };
  cells.push(cell);
  return cell;
}

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) makeCell(r, c);
}

// give a cell a fresh look: image (or placeholder), size, position, opacity peak
function dress(cell) {
  const pool = currentPool();
  cell.present = Math.random() < FILL;

  if (!pool) {
    cell.node.className = 'dtile dtile--empty';
    cell.img.style.display = 'none';
    cell.icon.style.display = 'block';
    cell.time.style.display = 'none';
    cell.badge.style.display = 'none';
    cell.w = Math.round(rnd(68, 112));
    cell.peak = rnd(0.2, 0.34);
  } else {
    const n = pick(pool);
    cell.node.className = 'dtile';
    cell.img.src = src(n);
    cell.img.style.display = 'block';
    cell.icon.style.display = 'none';
    cell.time.textContent = timeOf(n);
    cell.time.style.display = 'block';
    cell.badge.style.display = Math.random() < 0.12 ? 'block' : 'none';
    cell.w = widthOf(n, TILE_H);
    cell.peak = pick(PEAKS);
  }

  cell.node.style.width = cell.w + 'px';
  cell.x = PAD + cell.col * COL_W + rnd(0, Math.max(0, COL_W - cell.w));
  cell.yJit = rnd(-26, 26);

  cell.tIn = rnd(0.7, 1.2);
  cell.tHold = rnd(1.4, 4.6);
  cell.tOut = rnd(1.0, 1.8);
  cell.tOff = rnd(0.3, 2.6);
  cell.phase = 'on';
  cell.t = 0;
}

function resetField() {
  for (const cell of cells) {
    cell.y = cell.row * ROW_H - TILE_H + 12;
    dress(cell);
    // stagger the blink cycles so nothing pops in unison
    cell.t = rnd(0, cell.tIn + cell.tHold + cell.tOut);
  }
}
resetField();

const span = ROWS * ROW_H;

function stepField(dt) {
  const dir = mode === 'final' ? -1 : 1;
  const dy = SPEED * (mode === 'final' ? FINAL_SPEED_X : 1) * dir * dt;

  for (const cell of cells) {
    cell.y += dy;

    // wrap around — always happens while the tile is fully outside the field
    if (cell.y > AREA_H) { cell.y -= span; dress(cell); cell.t = 0; cell.phase = 'off'; }
    else if (cell.y + TILE_H < 0) { cell.y += span; dress(cell); cell.t = 0; cell.phase = 'off'; }

    // opacity envelope: fade in → hold → fade out → gone for a while → new tile
    cell.t += dt;
    let env = 0;
    if (cell.phase === 'on') {
      if (cell.t < cell.tIn) env = cell.t / cell.tIn;
      else if (cell.t < cell.tIn + cell.tHold) env = 1;
      else if (cell.t < cell.tIn + cell.tHold + cell.tOut) env = 1 - (cell.t - cell.tIn - cell.tHold) / cell.tOut;
      else { cell.phase = 'off'; cell.t = 0; env = 0; }
    } else if (cell.t >= cell.tOff) {
      dress(cell);                       // reappears somewhere else, with fresh content
      env = 0;
    }
    if (!cell.present) env = 0;

    // never let a tile blink in or out right at the edge of the field
    const y = cell.y + cell.yJit;
    const edge = Math.min((y + TILE_H) / EDGE_FADE, (AREA_H - y) / EDGE_FADE, 1);

    cell.node.style.transform = `translate3d(${cell.x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    cell.node.style.opacity = (cell.peak * env * clamp01(edge)).toFixed(3);
  }
}

/* ── main loop ────────────────────────────────────────────── */

let last = performance.now();

function frame(now) {
  // the timeline follows wall clock, the field never jumps more than one 20fps step
  const dt = Math.min(0.5, (now - last) / 1000) * speedMult;
  last = now;

  if (mode === 'search') {
    clock += dt * 1000;
    if (clock >= SEARCH_MS) { clock = SEARCH_MS; startFinalizing(); }
  } else if (mode === 'final') {
    finalClock += dt * 1000;
    if (finalClock >= FINAL_MS) showResults();
  }

  if (mode === 'search' || mode === 'final') stepField(Math.min(dt, 0.05));

  el.dbgState.textContent =
    mode === 'search' ? (currentPool() ? 'searching' : 'searching (no hits)')
      : mode === 'final' ? 'finalizing'
        : mode;
  el.dbgTime.textContent =
    mode === 'search' ? (clock / 1000).toFixed(1) + 's'
      : mode === 'final' ? (finalClock / 1000).toFixed(1) + 's'
        : '—';

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ── final results ────────────────────────────────────────── */

function buildResults() {
  const frag = document.createDocumentFragment();
  for (const g of GROUPS) {
    const title = document.createElement('p');
    title.className = 'group-title';
    title.innerHTML = `<b>${g.label}</b> confidence`;
    frag.appendChild(title);

    const row = document.createElement('div');
    row.className = 'row';
    for (const n of g.items) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.style.width = widthOf(n, 178) + 'px';
      tile.innerHTML =
        `<img src="${src(n)}" alt=""><p class="tile__time">${timeOf(n)}</p>`;
      row.appendChild(tile);
    }
    frag.appendChild(row);
  }
  el.results.appendChild(frag);
}
buildResults();

/* ── controls ─────────────────────────────────────────────── */

document.getElementById('btn-stop-header').onclick = startFinalizing;
document.getElementById('btn-stop-card').onclick = startFinalizing;
document.getElementById('btn-restart').onclick = startSearch;

addEventListener('keydown', e => {
  if (e.key === 'Enter') { if (mode === 'idle' || mode === 'results') startSearch(); }
  else if (e.key === 'Escape') reset();
  else if (e.key === ' ' && mode === 'search') { e.preventDefault(); startFinalizing(); }
});

document.querySelector('.demobar').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.speed) {
    speedMult = Number(btn.dataset.speed);
    for (const b of document.querySelectorAll('.demobar [data-speed]')) b.classList.remove('is-on');
    btn.classList.add('is-on');
    return;
  }
  if (btn.dataset.act === 'start') startSearch();
  if (btn.dataset.act === 'stop') startFinalizing();
  if (btn.dataset.act === 'reset') reset();
});
