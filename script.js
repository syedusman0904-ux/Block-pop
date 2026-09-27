/* ══════════════════════════════════════════════════════════════
   BlockPop — shared game engine
   Handles: home page, classic mode, adventure mode
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const body = document.body;
  const mode = body.dataset.mode || null;   // null | 'classic' | 'adventure'

  /* ══════════════════════════════════════════════════════════
     ALGORITHM CONFIG
     ──────────────────────────────────────────────────────────
     difficulty:          'easy' | 'normal' | 'hard'
                          Shifts the balance between small and
                          large shapes across the whole game.
     guaranteePlayable:   if true, never hand the player a full
                          tray with zero legal moves.
     varietyPenalty:      if true, no duplicate shape in one tray.
     boardFillSensitivity: 0 = ignore board fullness entirely,
                          1 = default, 2 = extreme reaction.
     ══════════════════════════════════════════════════════════ */

  const ALGO = {
    difficulty: 'normal',
    guaranteePlayable: true,
    varietyPenalty: true,
    boardFillSensitivity: 1.0
  };

  /* ══════════════════════════════════════════════════════════
     SCORE CONFIG
     ──────────────────────────────────────────────────────────
     pointsPerBlock:  score awarded for each block placed
     lineBase:        base bonus for one completed line
     lineCombo:       extra bonus per additional line in the
                      same move (quadratic combo bonus)
     ══════════════════════════════════════════════════════════ */

  const SCORE = {
    pointsPerBlock: 10,
    lineBase: 100,
    lineCombo: 50
  };

  /* ══════════════════════════════════════════════════════════
     AUDIO ENGINE
     ══════════════════════════════════════════════════════════ */

  const Sfx = (function () {
    let ctx = null;

    function get() {
      if (!ctx) {
        try {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
          return null;
        }
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(freq, dur, type, vol, delay) {
      const c = get();
      if (!c) return;
      const t = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.06);
    }

    function noise(dur, vol, cutoff) {
      const c = get();
      if (!c) return;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const decay = 1 - i / len;
        data[i] = (Math.random() * 2 - 1) * decay * decay;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff || 2500;
      const gain = c.createGain();
      gain.gain.value = vol || 0.07;
      src.connect(filter).connect(gain).connect(c.destination);
      src.start();
    }

    return {
      unlock() { get(); },
      pickup() { tone(520, 0.06, 'sine', 0.07); },
      place()  { tone(320, 0.09, 'triangle', 0.1); },
      invalid(){ tone(140, 0.11, 'sawtooth', 0.05); },
      clear(n) {
        const steps = Math.min(n, 4);
        for (let i = 0; i < steps; i++) {
          tone(440 * Math.pow(1.26, i), 0.28, 'sine', 0.12, i * 0.07);
        }
        noise(0.3, 0.05, 4200);
      },
      gameOver() {
        tone(420, 0.28, 'sine', 0.13);
        tone(310, 0.28, 'sine', 0.13, 0.16);
        tone(200, 0.5, 'sine', 0.13, 0.32);
      },
      levelUp() {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
          tone(f, 0.3, 'triangle', 0.13, i * 0.1);
        });
      }
    };
  })();
  /* ══════════════════════════════════════════════════════════
     ANIMATED BACKGROUND
     ══════════════════════════════════════════════════════════ */

  function initBackground() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const COLORS = ['#4ea8ff', '#3ddc97', '#ffd166', '#ff6b6b',
                    '#c084fc', '#f472b6', '#22d3ee', '#fb923c'];
    const blocks = [];
    let w = 0, h = 0, dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const count = Math.min(28, Math.max(12, Math.floor((w * h) / 42000)));
    for (let i = 0; i < count; i++) {
      blocks.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 12 + Math.random() * 36,
        vy: 0.15 + Math.random() * 0.5,
        vx: (Math.random() - 0.5) * 0.25,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.012,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        alpha: 0.05 + Math.random() * 0.09
      });
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        b.y += b.vy;
        b.x += b.vx;
        b.rot += b.vr;

        if (b.y - b.size > h) { b.y = -b.size; b.x = Math.random() * w; }
        if (b.x < -b.size) b.x = w + b.size;
        else if (b.x > w + b.size) b.x = -b.size;

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle = b.color;
        const s = b.size;
        const r = s * 0.22;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-s / 2, -s / 2, s, s, r);
        else ctx.rect(-s / 2, -s / 2, s, s);
        ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ══════════════════════════════════════════════════════════
     PARTICLE SYSTEM
     ══════════════════════════════════════════════════════════ */

  function ParticleSystem(canvas) {
    const ctx = canvas.getContext('2d');
    const particles = [];
    let dpr = 1, w = 0, h = 0, raf = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function burst(x, y, color, count) {
      const n = count || 10;
      for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4.5;
        particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          radius: 1.5 + Math.random() * 3.5,
          life: 1,
          decay: 0.012 + Math.random() * 0.018,
          color: color,
          gravity: 0.18
        });
      }
      if (particles.length > 420) {
        particles.splice(0, particles.length - 420);
      }
      if (!raf) loop();
    }

    function loop() {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
      }

      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * (0.35 + p.life * 0.65), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (particles.length > 0) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = null;
        ctx.clearRect(0, 0, w, h);
      }
    }

    return {
      burst: burst,
      resize: resize,
      reset: function () {
        particles.length = 0;
        ctx.clearRect(0, 0, w, h);
      }
    };
  }
  /* ══════════════════════════════════════════════════════════
     HOME PAGE
     ══════════════════════════════════════════════════════════ */

  if (!mode) {
    initBackground();

    const bestEl = document.getElementById('homeBest');
    const levelEl = document.getElementById('homeLevel');
    const best = parseInt(localStorage.getItem('blockpop-best') || '0', 10) || 0;
    const level = parseInt(localStorage.getItem('blockpop-level') || '1', 10) || 1;

    if (bestEl) bestEl.textContent = 'Best Score: ' + best;
    if (levelEl) levelEl.textContent = 'Adventure Level ' + level;

    document.addEventListener('pointerdown', function () { Sfx.unlock(); }, { once: true });
    return;
  }

  /* ══════════════════════════════════════════════════════════
     GAME SETUP
     ══════════════════════════════════════════════════════════ */

  initBackground();
  document.addEventListener('pointerdown', function () { Sfx.unlock(); }, { once: true });

  const SIZE = 8;
  const GAP = 5;   // must match CSS `.board { gap }`

  /* Shape library — "X" = block, "." = hole */
  const SHAPES = [
    // singles & lines
    { g: ["X"],                       c: "#4ea8ff" },
    { g: ["XX"],                      c: "#4ea8ff" },
    { g: ["X", "X"],                  c: "#4ea8ff" },
    { g: ["XXX"],                     c: "#3ddc97" },
    { g: ["X", "X", "X"],             c: "#3ddc97" },
    { g: ["XXXX"],                    c: "#ffd166" },
    { g: ["X", "X", "X", "X"],        c: "#ffd166" },
    { g: ["XXXXX"],                   c: "#ff6b6b" },
    { g: ["X", "X", "X", "X", "X"],   c: "#ff6b6b" },

    // squares & rectangles
    { g: ["XX", "XX"],                c: "#c084fc" },
    { g: ["XXX", "XXX"],              c: "#f472b6" },
    { g: ["XX", "XX", "XX"],          c: "#f472b6" },

    // corners
    { g: ["X.", "XX"],                c: "#22d3ee" },
    { g: ["XX", "X."],                c: "#22d3ee" },
    { g: ["XX", ".X"],                c: "#22d3ee" },
    { g: [".X", "XX"],                c: "#22d3ee" },

    // L / J
    { g: ["X.", "X.", "XX"],          c: "#ffd166" },
    { g: [".X", ".X", "XX"],          c: "#ffd166" },
    { g: ["XX", "X.", "X."],          c: "#ffd166" },
    { g: ["XX", ".X", ".X"],          c: "#ffd166" },
    { g: ["XXX", "X.."],              c: "#3ddc97" },
    { g: ["XXX", "..X"],              c: "#3ddc97" },
    { g: ["X..", "XXX"],              c: "#3ddc97" },
    { g: ["..X", "XXX"],              c: "#3ddc97" },

    // T
    { g: ["XXX", ".X."],              c: "#c084fc" },
    { g: [".X.", "XXX"],              c: "#c084fc" },
    { g: ["X.", "XX", "X."],          c: "#c084fc" },
    { g: [".X", "XX", ".X"],          c: "#c084fc" },

    // S / Z
    { g: [".XX", "XX."],              c: "#ff6b6b" },
    { g: ["XX.", ".XX"],              c: "#ff6b6b" },
    { g: ["X.", "XX", ".X"],          c: "#fb923c" },
    { g: [".X", "XX", "X."],          c: "#fb923c" },

    // plus
    { g: [".X.", "XXX", ".X."],       c: "#22d3ee" },

    // big L / J
    { g: ["X..", "X..", "XXX"],       c: "#4ea8ff" },
    { g: ["..X", "..X", "XXX"],       c: "#4ea8ff" },
    { g: ["XXX", "X..", "X.."],       c: "#4ea8ff" },
    { g: ["XXX", "..X", "..X"],       c: "#4ea8ff" }
  ];

  /* ══════════════════════════════════════════════════════════
     PIECE SELECTION ALGORITHM
     ══════════════════════════════════════════════════════════ */

  let SHAPE_UID = 0;
  const SHAPE_DEFS = SHAPES.map(function (def) {
    const cells = [];
    let cols = 0;
    for (let r = 0; r < def.g.length; r++) {
      const row = def.g[r];
      if (row.length > cols) cols = row.length;
      for (let c = 0; c < row.length; c++) {
        if (row[c] === 'X') cells.push([r, c]);
      }
    }
    return {
      id: SHAPE_UID++,
      cells: cells,
      rows: def.g.length,
      cols: cols,
      color: def.c,
      size: cells.length
    };
  });

  function difficultyFactor() {
    if (ALGO.difficulty === 'easy') return 0.75;
    if (ALGO.difficulty === 'hard') return 1.35;
    return 1.0;
  }

  function countPlacements(shape) {
    let count = 0;
    const maxR = SIZE - shape.rows;
    const maxC = SIZE - shape.cols;
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        if (canPlaceShape(shape, r, c)) count++;
      }
    }
    return count;
  }

  function canPlaceShape(shape, row, col) {
    const cl = shape.cells;
    for (let i = 0; i < cl.length; i++) {
      const rr = row + cl[i][0];
      const cc = col + cl[i][1];
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return false;
      if (grid[rr][cc]) return false;
    }
    return true;
  }

  function analyzeContext() {
    let filled = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c]) filled++;
      }
    }

    const placements = new Array(SHAPE_DEFS.length);
    for (let i = 0; i < SHAPE_DEFS.length; i++) {
      placements[i] = countPlacements(SHAPE_DEFS[i]);
    }

    return {
      fillRatio: filled / (SIZE * SIZE),
      filled: filled,
      placements: placements,
      mode: mode,
      level: level,
      score: score,
      difficulty: difficultyFactor()
    };
  }

  function scoreShape(shape, ctx) {
    const placements = ctx.placements[shape.id];

    if (placements === 0) return 0.00001;

    const fill = ctx.fillRatio;
    const size = shape.size;
    const diff = ctx.difficulty;
    const sens = ALGO.boardFillSensitivity;

    let w = 1;

    const pressure = (fill - 0.35) * sens;

    if (pressure < -0.15) {
      w *= 0.55 + size * 0.5;
    } else if (pressure < 0.25) {
      w *= 0.95 + Math.min(size, 4) * 0.12;
    } else {
      w *= 2.8 / Math.pow(size, 0.65);
    }

    w *= Math.pow(placements, 0.65);

    if (diff > 1.05) {
      w *= Math.max(0.4, 1 + (size - 2.5) * 0.2 * (diff - 1));
    } else if (diff < 0.95) {
      w *= Math.max(0.4, 1 + (2.5 - size) * 0.15 * (1 - diff));
    }

    if (ctx.mode === 'adventure') {
      const lvlBoost = 1 + Math.min(ctx.level, 20) * 0.015;
      w *= Math.max(0.4, 1 + (size - 3) * 0.09 * lvlBoost);
    }

    return Math.max(0.00001, w);
  }

  function pickWeightedShape(ctx, excluded) {
    const weights = new Array(SHAPE_DEFS.length);
    let total = 0;

    for (let i = 0; i < SHAPE_DEFS.length; i++) {
      const shape = SHAPE_DEFS[i];

      if (excluded && excluded.has(shape.id)) {
        weights[i] = 0;
        continue;
      }

      const w = scoreShape(shape, ctx);
      weights[i] = w;
      total += w;
    }

    if (total <= 0) {
      return SHAPE_DEFS[(Math.random() * SHAPE_DEFS.length) | 0];
    }

    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return SHAPE_DEFS[i];
    }
    return SHAPE_DEFS[SHAPE_DEFS.length - 1];
  }

  function findSafeShape(ctx) {
    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < SHAPE_DEFS.length; i++) {
      const shape = SHAPE_DEFS[i];
      if (ctx.placements[shape.id] === 0) continue;

      const s = shape.size - ctx.placements[shape.id] * 0.01;
      if (s < bestScore) {
        bestScore = s;
        best = shape;
      }
    }
    return best;
  }

  function generatePieceSet() {
    const ctx = analyzeContext();
    const picked = [];
    const usedIds = new Set();

    for (let i = 0; i < 3; i++) {
      const shape = pickWeightedShape(
        ctx,
        ALGO.varietyPenalty ? usedIds : null
      );
      picked.push(shape);
      usedIds.add(shape.id);
    }

    if (ALGO.guaranteePlayable) {
      const anyPlayable = picked.some(function (s) {
        return ctx.placements[s.id] > 0;
      });

      if (!anyPlayable) {
        const safe = findSafeShape(ctx);
        if (safe) picked[picked.length - 1] = safe;
      }
    }

    return picked;
  }
/* ══════════════════════════════════════════════════════════
     DOM refs
     ══════════════════════════════════════════════════════════ */

  const boardEl    = document.getElementById('board');
  const boardWrap  = document.querySelector('.board-wrap');
  const fxCanvas   = document.getElementById('fxCanvas');
  const trayEl     = document.getElementById('tray');
  const scoreEl    = document.getElementById('score');
  const bestEl     = document.getElementById('best');
  const targetEl   = document.getElementById('target');
  const progressEl = document.getElementById('progressFill');
  const levelNumEl = document.getElementById('levelNum');
  const overlay    = document.getElementById('overlay');
  const overTitle  = document.getElementById('overTitle');
  const finalEl    = document.getElementById('finalScore');
  const restartBtn = document.getElementById('restart');

  const particles = ParticleSystem(fxCanvas);

  /* ══════════════════════════════════════════════════════════
     State
     ══════════════════════════════════════════════════════════ */

  let grid = [];
  let cells = [];
  let pieces = [];
  let score = 0;
  let best = parseInt(localStorage.getItem('blockpop-best') || '0', 10) || 0;
  let level = parseInt(localStorage.getItem('blockpop-level') || '1', 10) || 1;
  let target = 0;
  let pendingLevel = null;
  let over = false;
  let busy = false;
  let drag = null;
  let trayCell = 20;

  /* ══════════════════════════════════════════════════════════
     LEVEL DEFINITION
     ──────────────────────────────────────────────────────────
     target: 600 + n * 600 grows the goal by 600 points per level,
     matching the 10x score inflation.
     ══════════════════════════════════════════════════════════ */

  function getLevelDef(n) {
    return {
      target: 600 + n * 600,
      prefill: n < 3 ? 0 : Math.min((n - 2) * 4, 24)
    };
  }

  function seededRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ══════════════════════════════════════════════════════════
     BOARD
     ══════════════════════════════════════════════════════════ */

  function buildBoard() {
    boardEl.innerHTML = '';
    cells = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      boardEl.appendChild(d);
      cells.push(d);
    }
  }

  function renderBoard() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = cells[r * SIZE + c];
        const v = grid[r][c];
        el.className = v ? 'cell filled' : 'cell';
        if (v) el.style.setProperty('--c', v);
      }
    }
  }

  function canPlace(piece, row, col) {
    for (let i = 0; i < piece.cells.length; i++) {
      const rr = row + piece.cells[i][0];
      const cc = col + piece.cells[i][1];
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return false;
      if (grid[rr][cc]) return false;
    }
    return true;
  }

  function showPreview(row, col, piece) {
    clearPreview();
    if (row === null) return;
    for (let i = 0; i < piece.cells.length; i++) {
      const rr = row + piece.cells[i][0];
      const cc = col + piece.cells[i][1];
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
      const el = cells[rr * SIZE + cc];
      el.classList.add('preview');
      el.style.setProperty('--pc', piece.color);
    }
  }

  function clearPreview() {
    for (let i = 0; i < cells.length; i++) cells[i].classList.remove('preview');
  }

  /* ══════════════════════════════════════════════════════════
     TRAY
     ══════════════════════════════════════════════════════════ */

  function computeSizes() {
    const bw = boardEl.getBoundingClientRect().width;
    if (bw === 0) return;
    const boardCell = (bw - (SIZE - 1) * GAP) / SIZE;

    const tw = trayEl.getBoundingClientRect().width;
    const slotW = (tw - 20) / 3;

    trayCell = Math.max(7, Math.min(boardCell * 0.56, slotW / 5.9, 24));
    particles.resize();
  }

  function buildPieceEl(piece, cell, gap) {
    const el = document.createElement('div');
    el.className = 'piece';
    el.style.gridTemplateColumns = 'repeat(' + piece.cols + ', ' + cell + 'px)';
    el.style.gridAutoRows = cell + 'px';
    el.style.gap = gap + 'px';
    el.style.setProperty('--c', piece.color);

    const occupied = new Set(piece.cells.map(function (p) { return p[0] + ',' + p[1]; }));

    for (let r = 0; r < piece.rows; r++) {
      for (let c = 0; c < piece.cols; c++) {
        const b = document.createElement('div');
        if (occupied.has(r + ',' + c)) b.className = 'b';
        el.appendChild(b);
      }
    }
    return el;
  }

  function renderTray() {
    trayEl.innerHTML = '';
    const gap = Math.max(2, Math.round(trayCell * 0.14));

    pieces.forEach(function (piece, i) {
      const slot = document.createElement('div');
      slot.className = 'slot';

      if (piece) {
        const el = buildPieceEl(piece, trayCell, gap);
        el.addEventListener('pointerdown', function (e) { onPointerDown(e, i); });
        slot.appendChild(el);
      }
      trayEl.appendChild(slot);
    });
  }

  /* ══════════════════════════════════════════════════════════
     DRAG & DROP
     ══════════════════════════════════════════════════════════ */

  function onPointerDown(e, index) {
    if (over || busy || drag) return;
    const piece = pieces[index];
    if (!piece) return;

    e.preventDefault();
    Sfx.unlock();
    Sfx.pickup();

    const srcRect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - srcRect.left) / srcRect.width;
    const relY = (e.clientY - srcRect.top) / srcRect.height;

    const br = boardEl.getBoundingClientRect();
    const stride = (br.width + GAP) / SIZE;
    const cell = stride - GAP;

    const w = piece.cols * stride - GAP;
    const h = piece.rows * stride - GAP;

    const ghost = document.createElement('div');
    ghost.className = 'drag-piece';
    ghost.style.gridTemplateColumns = 'repeat(' + piece.cols + ', ' + cell + 'px)';
    ghost.style.gridAutoRows = cell + 'px';
    ghost.style.gap = GAP + 'px';
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    ghost.style.setProperty('--c', piece.color);

    const occupied = new Set(piece.cells.map(function (p) { return p[0] + ',' + p[1]; }));
    for (let r = 0; r < piece.rows; r++) {
      for (let c = 0; c < piece.cols; c++) {
        const b = document.createElement('div');
        if (occupied.has(r + ',' + c)) b.className = 'b';
        ghost.appendChild(b);
      }
    }
    document.body.appendChild(ghost);

    drag = {
      index: index,
      piece: piece,
      el: ghost,
      relX: relX,
      relY: relY,
      w: w,
      h: h,
      lift: e.pointerType === 'touch' ? Math.min(46, cell * 1.05) : 0,
      row: 0,
      col: 0,
      valid: false
    };

    e.currentTarget.style.visibility = 'hidden';

    moveDrag(e.clientX, e.clientY);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function moveDrag(x, y) {
    const d = drag;
    if (!d) return;

    const br = boardEl.getBoundingClientRect();
    const stride = (br.width + GAP) / SIZE;

    let left = x - d.relX * d.w;
    let top = y - d.relY * d.h - d.lift;

    const col = Math.round((left - br.left) / stride);
    const row = Math.round((top - br.top) / stride);
    const valid = canPlace(d.piece, row, col);

    if (valid) {
      left = br.left + col * stride;
      top = br.top + row * stride;
    }

    d.el.style.left = left + 'px';
    d.el.style.top = top + 'px';
    d.el.classList.toggle('locked', valid);

    d.row = row;
    d.col = col;
    d.valid = valid;

    showPreview(valid ? row : null, valid ? col : null, d.piece);
  }

  function onPointerMove(e) {
    if (!drag) return;
    moveDrag(e.clientX, e.clientY);
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    if (!drag) return;

    const d = drag;
    drag = null;

    d.el.remove();
    clearPreview();

    if (d.valid) {
      placePiece(d.piece, d.row, d.col, d.index);
    } else {
      Sfx.invalid();
      renderTray();
    }
  }
/* ══════════════════════════════════════════════════════════
     PLACING & CLEARING
     ══════════════════════════════════════════════════════════ */

  function cellCenter(r, c) {
    const br = boardEl.getBoundingClientRect();
    const stride = (br.width + GAP) / SIZE;
    const cellSize = stride - GAP;
    return {
      x: c * stride + cellSize / 2,
      y: r * stride + cellSize / 2
    };
  }

  function showScorePopup(amount) {
    const br = boardWrap.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = '+' + amount;
    el.style.left = (br.left + br.width / 2) + 'px';
    el.style.top = (br.top + br.height / 2) + 'px';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1000);
  }

  function placePiece(piece, row, col, index) {
    busy = true;

    for (let i = 0; i < piece.cells.length; i++) {
      grid[row + piece.cells[i][0]][col + piece.cells[i][1]] = piece.color;
    }

    /* ── block placement score ── */
    score += piece.cells.length * SCORE.pointsPerBlock;
    pieces[index] = null;

    Sfx.place();

    renderBoard();
    renderTray();
    updateScore();

    const fullRows = [];
    const fullCols = [];

    for (let r = 0; r < SIZE; r++) {
      let full = true;
      for (let c = 0; c < SIZE; c++) if (!grid[r][c]) { full = false; break; }
      if (full) fullRows.push(r);
    }
    for (let c = 0; c < SIZE; c++) {
      let full = true;
      for (let r = 0; r < SIZE; r++) if (!grid[r][c]) { full = false; break; }
      if (full) fullCols.push(c);
    }

    const lineCount = fullRows.length + fullCols.length;

    if (lineCount === 0) {
      busy = false;
      finishTurn();
      return;
    }

    const marked = new Set();
    fullRows.forEach(function (r) {
      for (let c = 0; c < SIZE; c++) marked.add(r * SIZE + c);
    });
    fullCols.forEach(function (c) {
      for (let r = 0; r < SIZE; r++) marked.add(r * SIZE + c);
    });

    marked.forEach(function (i) { cells[i].classList.add('clearing'); });

    marked.forEach(function (i) {
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      const pos = cellCenter(r, c);
      const color = grid[r][c] || '#ffffff';
      particles.burst(pos.x, pos.y, color, 5 + Math.floor(Math.random() * 4));
    });

    Sfx.clear(lineCount);

    setTimeout(function () {
      fullRows.forEach(function (r) {
        for (let c = 0; c < SIZE; c++) grid[r][c] = null;
      });
      fullCols.forEach(function (c) {
        for (let r = 0; r < SIZE; r++) grid[r][c] = null;
      });

      /* ── line-clear bonus ──
         1 line  →   100
         2 lines →   300
         3 lines →   600
         4 lines →  1000
         5 lines →  1500  */
      const gained =
        lineCount * SCORE.lineBase +
        lineCount * (lineCount - 1) * SCORE.lineCombo;
      score += gained;

      showScorePopup(gained);

      renderBoard();
      updateScore();
      busy = false;
      finishTurn();
    }, 240);
  }

  function finishTurn() {
    if (pieces.every(function (p) { return p === null; })) {
      pieces = generatePieceSet();
    }
    renderTray();

    if (mode === 'adventure' && score >= target) {
      endGame(true);
      return;
    }

    if (!hasMove()) endGame(false);
  }

  function hasMove() {
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p) continue;
      for (let r = 0; r <= SIZE - p.rows; r++) {
        for (let c = 0; c <= SIZE - p.cols; c++) {
          if (canPlace(p, r, c)) return true;
        }
      }
    }
    return false;
  }

  /* ══════════════════════════════════════════════════════════
     SCORE / PROGRESS
     ══════════════════════════════════════════════════════════ */

  function updateScore() {
    scoreEl.textContent = score;

    if (mode === 'classic') {
      bestEl.textContent = Math.max(best, score);
    } else if (progressEl) {
      const pct = target > 0 ? Math.min(100, (score / target) * 100) : 0;
      progressEl.style.width = pct + '%';
    }
  }

  /* ══════════════════════════════════════════════════════════
     GAME OVER / LEVEL END
     ══════════════════════════════════════════════════════════ */

  function endGame(win) {
    over = true;
    finalEl.textContent = score;

    if (mode === 'adventure') {
      if (win) {
        overTitle.textContent = 'Level Complete!';
        restartBtn.textContent = 'Next Level';
        pendingLevel = level + 1;
        try { localStorage.setItem('blockpop-level', String(pendingLevel)); } catch (e) {}
        Sfx.levelUp();
      } else {
        overTitle.textContent = 'Level Failed';
        restartBtn.textContent = 'Retry';
        pendingLevel = level;
        Sfx.gameOver();
      }
    } else {
      overTitle.textContent = 'Game Over';
      restartBtn.textContent = 'Play Again';
      if (score > best) {
        best = score;
        try { localStorage.setItem('blockpop-best', String(best)); } catch (e) {}
      }
      bestEl.textContent = best;
      Sfx.gameOver();
    }

    overlay.classList.remove('hidden');
  }

  /* ══════════════════════════════════════════════════════════
     LEVEL PREFILL (adventure)
     ══════════════════════════════════════════════════════════ */

  function placePrefill(count) {
    if (count <= 0) return;

    const rng = seededRng(level * 9871 + 12345);
    const palette = SHAPES.map(function (s) { return s.c; });
    let placed = 0;
    let attempts = 0;

    while (placed < count && attempts < 400) {
      attempts++;

      const r = Math.floor(rng() * SIZE);
      const c = Math.floor(rng() * SIZE);
      if (grid[r][c]) continue;

      const color = palette[Math.floor(rng() * palette.length)];
      grid[r][c] = color;

      let rowFull = true;
      for (let i = 0; i < SIZE; i++) if (!grid[r][i]) { rowFull = false; break; }

      let colFull = true;
      for (let i = 0; i < SIZE; i++) if (!grid[i][c]) { colFull = false; break; }

      if (rowFull || colFull) {
        grid[r][c] = null;
        continue;
      }

      placed++;
    }
  }
  /* ══════════════════════════════════════════════════════════
     RESET / START
     ══════════════════════════════════════════════════════════ */

  function reset() {
    grid = [];
    for (let r = 0; r < SIZE; r++) {
      grid.push(new Array(SIZE).fill(null));
    }

    score = 0;
    over = false;
    busy = false;
    drag = null;

    if (mode === 'adventure') {
      const def = getLevelDef(level);
      target = def.target;
      placePrefill(def.prefill);

      if (targetEl) targetEl.textContent = target;
      if (levelNumEl) levelNumEl.textContent = level;
      if (progressEl) progressEl.style.width = '0%';
    } else {
      bestEl.textContent = Math.max(best, 0);
    }

    pieces = generatePieceSet();

    overlay.classList.add('hidden');
    particles.reset();

    updateScore();
    renderBoard();
    computeSizes();
    renderTray();
  }

  /* ══════════════════════════════════════════════════════════
     EVENTS
     ══════════════════════════════════════════════════════════ */

  restartBtn.addEventListener('click', function () {
    if (mode === 'adventure' && pendingLevel !== null) {
      level = pendingLevel;
      pendingLevel = null;
    }
    reset();
  });

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      computeSizes();
      renderTray();
    }, 120);
  });

  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest('.app')) e.preventDefault();
  });

  document.addEventListener('touchmove', function (e) {
    if (drag) e.preventDefault();
  }, { passive: false });

  /* ══════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════ */

  buildBoard();
  reset();

  setTimeout(function () {
    computeSizes();
    renderTray();
    particles.resize();
  }, 120);

})();

