/* ─────────────────────────────────────────────────────────────
   Objects search — loading animation demo

   Timeline
     0 – 10s   no results yet      → placeholder tiles ("Objects" icon)
    10 – 20s   images  9 – 13
    20 – 30s   images 15 – 20
    30 – 40s   images  1 – 8
    40s        search finishes by itself

   Every object fades in over the first half of its life and out over
   the second half, and is placed by where it sits at mid-life so the
   field stays evenly spread however far the objects travel. The
   `Easing` control ties drift speed to opacity: +1 fastest when
   brightest, 0 constant, -1 standing still when brightest.

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
const FINAL_MS = 5000;     // re-ranking after stop

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

/* ── tunable field parameters (wired to the sliders) ──────── */

const DEFAULTS = {
  travel: 400,   // px  — how far an object drifts during its life
  travelVar: 35,    // %   — spread around that distance
  count: 14,    //     — how many objects live in the field
  size: 135,   // px  — side of an equal-area square (all objects get the same area)
  sizeVar: 20,    // %
  life: 4,     // s   — appear + disappear
  lifeVar: 30,    // %
  ease: -1      // -1 … +1 — how speed relates to opacity (see `travelled`)
};
const params = { ...DEFAULTS };

/* ── field geometry ───────────────────────────────────────── */

const AREA_W = 786;          // center panel width
const AREA_H = 904;          // the field owns the whole panel now
const PAD = 16;
const FINAL_SPEED_X = 2;     // ×2 and upwards while finalizing
const GAP = [0.1, 1.2];      // s — pause before an object reappears
const PLACE_TRIES = 14;      // candidate spots tried on every respawn
const PEAKS = [0.3, 0.6, 0.9];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = p => p * p * (3 - 2 * p);   // ease-in-out

// Opacity over a life: 0 → 1 across the first half, 1 → 0 across the second.
const envelope = p => p < 0.5 ? smooth(p * 2) : smooth((1 - p) * 2);

// Fraction of the travel covered by time p of the life, blended by `ease`:
//
//   +1   speed follows opacity — accelerates in from a standstill, fastest at
//        mid-life where it is brightest, stops again as it fades out
//    0   constant speed
//   -1   speed runs inverse to opacity — rushes in unseen, stands still at
//        mid-life when fully visible, accelerates away as it fades
//
// Speed stays within 1 ± |ease| of the average, so the curve never goes
// backwards; whatever the setting, the object covers exactly its travel over
// exactly one life and is half way at mid-life.
const halfTravel = q => 8 * q * q * q * (1 - q);          // ∫envelope, q ≤ 0.5
const integral = p => p < 0.5 ? halfTravel(p) : 1 - halfTravel(1 - p);
const travelled = p => p + params.ease * (integral(p) - p);
const vary = (avg, pct) => Math.max(avg * 0.12, avg * (1 + (pct / 100) * rnd(-1, 1)));

/* ── elements ─────────────────────────────────────────────── */

const el = {
  scaler: document.getElementById('scaler'),
  window: document.getElementById('window'),
  drift: document.getElementById('drift'),
  results: document.getElementById('results'),
  idle: document.getElementById('state-idle'),
  loading: document.getElementById('state-loading'),
  resultsState: document.getElementById('state-results'),
  card: document.getElementById('loader-card'),
  cardText: document.getElementById('loader-card-text'),
  cardBtnText: document.getElementById('loader-card-btn-text'),
  dbgState: document.getElementById('dbg-state'),
  dbgTime: document.getElementById('dbg-time')
};

/* ── window scaling ───────────────────────────────────────── */

function fit() {
  const chrome = document.querySelector('.panelbar').offsetHeight + 56;
  const s = Math.min(1, (innerWidth - 48) / 1638, (innerHeight - chrome) / 960);
  el.window.style.transform = `scale(${s})`;
  el.scaler.style.width = 1638 * s + 'px';
  el.scaler.style.height = 960 * s + 'px';
}
addEventListener('resize', fit);

/* ── state machine ────────────────────────────────────────── */

let mode = 'idle';        // idle | search | final | results
let clock = 0;            // ms into the search
let finalClock = 0;       // ms into re-ranking
let speedMult = 1;        // demo fast-forward (timeline only)

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

const objs = [];

function makeObject() {
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

  const o = {
    node, img, icon, time, badge,
    x: 0, y: 0, yMid: 0, w: 90, h: 180,
    dist: 136, life: 2, peak: 0.6,
    phase: 'off', p: 0, t: 0, tOff: 0
  };
  objs.push(o);
  spawn(o);
  return o;
}

function ensureCount() {
  const want = Math.round(params.count);
  while (objs.length < want) makeObject();
  while (objs.length > want) objs.pop().node.remove();
}

// area shared by two rectangles — used to keep respawns from stacking up
function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  const w = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  const h = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  return w > 0 && h > 0 ? w * h : 0;
}

// Objects are placed by where they sit at MID-LIFE — the instant they are
// fully visible and standing still — spread evenly over the whole panel. The
// travel is then hung symmetrically around that point, so a long travel simply
// means the first / last stretch happens off-panel for objects near an edge,
// instead of squeezing every object towards the middle.
function place(o) {
  const dir = mode === 'final' ? -1 : 1;
  const maxX = Math.max(0, AREA_W - PAD * 2 - o.w);
  const maxY = Math.max(0, AREA_H - o.h - 16);
  let best = [PAD, 8], bestScore = Infinity;

  for (let i = 0; i < PLACE_TRIES; i++) {
    const x = PAD + rnd(0, maxX);
    const yMid = 8 + rnd(0, maxY);

    let score = 0;
    for (const other of objs) {
      if (other === o || other.phase !== 'on') continue;
      score += overlap(x - 6, yMid - 6, o.w + 12, o.h + 12,
        other.x, other.yMid, other.w, other.h);
    }
    if (score < bestScore) { bestScore = score; best = [x, yMid]; if (!score) break; }
  }
  o.x = best[0];
  o.yMid = best[1];
  o.y = o.yMid - dir * o.dist / 2;   // travelled(0.5) === 0.5, so mid-life lands on yMid
}

// give an object a fresh look: image (or placeholder), size, distance, life, spot
function spawn(o) {
  const pool = currentPool();

  o.life = vary(params.life, params.lifeVar);
  o.dist = vary(params.travel, params.travelVar);

  // every object covers the same surface, whatever its aspect ratio:
  // side² = w × h, so h = side / √aspect and w = side × √aspect
  const side = vary(params.size, params.sizeVar);
  let aspect;

  if (!pool) {
    o.node.className = 'dtile dtile--empty';
    o.img.style.display = 'none';
    o.icon.style.display = 'block';
    o.time.style.display = 'none';
    o.badge.style.display = 'none';
    aspect = rnd(0.38, 0.72);
    o.peak = rnd(0.3, 0.5);
  } else {
    const n = pick(pool);
    o.node.className = 'dtile';
    o.img.src = src(n);
    o.img.style.display = 'block';
    o.icon.style.display = 'none';
    o.time.textContent = timeOf(n);
    aspect = IMG_W[n] / NAT_H;
    o.peak = pick(PEAKS);
  }

  const k = Math.sqrt(aspect);
  o.h = Math.round(Math.min(side / k, AREA_H - 40));
  o.w = Math.round(o.h * aspect);

  if (pool) {
    o.time.style.display = o.h >= 100 ? 'block' : 'none';
    o.badge.style.display = o.h >= 120 && Math.random() < 0.12 ? 'block' : 'none';
  }

  const iconSize = Math.round(Math.min(40, o.h * 0.24));
  o.icon.style.width = o.icon.style.height = iconSize + 'px';
  o.node.style.width = o.w + 'px';
  o.node.style.height = o.h + 'px';

  place(o);
  o.phase = 'on';
  o.p = 0;
  o.t = 0;
  o.tOff = rnd(GAP[0], GAP[1]);
}

function resetField() {
  ensureCount();
  for (const o of objs) {
    spawn(o);
    o.p = Math.random();          // stagger, so they don't all pulse together
  }
}

function draw(o, env) {
  // a tile hanging over the edge of the panel fades by how much of it is outside,
  // so anything fully inside — every object at mid-life — keeps its full opacity
  const inside = (Math.min(o.y + o.h, AREA_H) - Math.max(o.y, 0)) / o.h;
  const edge = smooth(clamp01(inside));
  o.node.style.transform = `translate3d(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px, 0)`;
  o.node.style.opacity = (o.peak * env * clamp01(edge)).toFixed(3);
}

function stepField(dt) {
  const dir = mode === 'final' ? -1 : 1;
  const rate = mode === 'final' ? FINAL_SPEED_X : 1;

  for (const o of objs) {
    if (o.phase === 'on') {
      const p0 = o.p;
      o.p = Math.min(1, o.p + dt * rate / o.life);

      // one curve drives both: the ease spans the whole life and its speed
      // runs inverse to the fade — full opacity means a standstill
      o.y += dir * o.dist * (travelled(o.p) - travelled(p0));
      draw(o, envelope(o.p));

      if (o.p >= 1) { o.phase = 'off'; o.t = 0; o.node.style.opacity = '0'; }
    } else {
      o.t += dt * rate;
      if (o.t >= o.tOff) spawn(o);   // reappears somewhere else, with fresh content
    }
  }
}

/* ── main loop ────────────────────────────────────────────── */

let last = performance.now();

function frame(now) {
  // the drift runs on wall clock; only the search timeline honours the demo speed
  const dt = Math.min(0.5, (now - last) / 1000);
  last = now;

  if (mode === 'search') {
    clock += dt * speedMult * 1000;
    if (clock >= SEARCH_MS) { clock = SEARCH_MS; startFinalizing(); }
  } else if (mode === 'final') {
    finalClock += dt * speedMult * 1000;
    if (finalClock >= FINAL_MS) showResults();
  }

  if (mode === 'search' || mode === 'final') stepField(Math.min(dt, 0.1));

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

/* ── parameter sliders ────────────────────────────────────── */

const CONTROLS = [
  { key: 'travel', label: 'Travel distance', min: 20, max: 700, step: 10, unit: 'px' },
  { key: 'travelVar', label: 'Travel variability', min: 0, max: 100, step: 5, unit: '%' },
  { key: 'count', label: 'Number of objects', min: 1, max: 48, step: 1, unit: '' },
  { key: 'size', label: 'Object size (area)', min: 40, max: 280, step: 5, unit: 'px' },
  { key: 'sizeVar', label: 'Size variability', min: 0, max: 80, step: 5, unit: '%' },
  { key: 'life', label: 'Life time', min: 0.4, max: 10, step: 0.1, unit: 's' },
  { key: 'lifeVar', label: 'Life variability', min: 0, max: 80, step: 5, unit: '%' },
  { key: 'ease', label: 'Easing', min: -1, max: 1, step: 0.1, unit: '' }
];

function paintControl(c) {
  const v = params[c.key];
  document.getElementById('val-' + c.key).textContent =
    (c.step < 1 ? v.toFixed(1) : v) + (c.unit ? ' ' + c.unit : '');
}

function buildControls() {
  const host = document.getElementById('sliders');
  for (const c of CONTROLS) {
    const wrap = document.createElement('label');
    wrap.className = 'ctl';
    wrap.innerHTML =
      `<span class="ctl__top"><span class="ctl__name">${c.label}</span>` +
      `<span class="ctl__val" id="val-${c.key}"></span></span>` +
      `<input type="range" id="in-${c.key}" min="${c.min}" max="${c.max}" step="${c.step}">`;
    host.appendChild(wrap);

    const input = wrap.querySelector('input');
    input.value = params[c.key];
    input.addEventListener('input', () => {
      params[c.key] = Number(input.value);
      if (c.key === 'count') ensureCount();
      paintControl(c);
    });
    paintControl(c);
  }
}

function resetParams() {
  Object.assign(params, DEFAULTS);
  for (const c of CONTROLS) {
    document.getElementById('in-' + c.key).value = params[c.key];
    paintControl(c);
  }
  ensureCount();
}

/* ── controls ─────────────────────────────────────────────── */

document.getElementById('btn-stop-card').onclick = startFinalizing;
document.getElementById('btn-restart').onclick = startSearch;

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter') { if (mode === 'idle' || mode === 'results') startSearch(); }
  else if (e.key === 'Escape') reset();
  else if (e.key === ' ' && mode === 'search') { e.preventDefault(); startFinalizing(); }
});

document.querySelector('.panelbar').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.speed) {
    speedMult = Number(btn.dataset.speed);
    for (const b of document.querySelectorAll('[data-speed]')) b.classList.remove('is-on');
    btn.classList.add('is-on');
    return;
  }
  if (btn.dataset.act === 'start') startSearch();
  if (btn.dataset.act === 'stop') startFinalizing();
  if (btn.dataset.act === 'reset') reset();
  if (btn.dataset.act === 'defaults') resetParams();
});

/* ── go ───────────────────────────────────────────────────── */

buildResults();
buildControls();
resetField();
fit();
requestAnimationFrame(frame);
