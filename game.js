/* ============================================================
   SPACE INVADERS - retro clone
   Vanilla JS, no external libraries.
   ============================================================ */

// ---------- 基本セットアップ ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;   // 960 (論理解像度)
const H = canvas.height;  // 540

const COLORS = {
  green: '#33ff66',
  greenDim: '#0f5c28',
  amber: '#ffb000',
  red: '#ff3355',
  white: '#e8fff0',
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function rand(min, max) { return Math.random() * (max - min) + min; }
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- ピクセルアート (0/1のビットマップ) ----------
const SPRITES = {
  player: [
    '.....X.....',
    '....XXX....',
    '....XXX....',
    '.XXXXXXXXX.',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXX.XXX.XXX',
  ],
  alienA: [ // 上段: 高得点
    ['..X.....X..','...X...X...','..XXXXXXX..','.XX.XXX.XX.','XXXXXXXXXXX','X.XXXXXXX.X','X.X.....X.X','...XX.XX...'],
    ['..X.....X..','X..X...X..X','X.XXXXXXX.X','XXX.XXX.XXX','XXXXXXXXXXX','.XXXXXXXXX.','..X.....X..','.X.......X.'],
  ],
  alienB: [ // 中段
    ['...XXXXX...','.XXXXXXXXX.','XXXXXXXXXXX','XXX.XXX.XXX','XXXXXXXXXXX','..X.XXX.X..','.X.X...X.X.','X.X.....X.X'],
    ['...XXXXX...','.XXXXXXXXX.','XXXXXXXXXXX','XXX.XXX.XXX','XXXXXXXXXXX','...X.X.X...','..X.X.X.X..','.X.X...X.X.'],
  ],
  alienC: [ // 下段: 低得点
    ['....XXX....','.XXXXXXXXX.','XXXXXXXXXXX','XX.XXXXX.XX','XXXXXXXXXXX','...X...X...','..XX...XX..','.XX.....XX.'],
    ['....XXX....','.XXXXXXXXX.','XXXXXXXXXXX','XX.XXXXX.XX','XXXXXXXXXXX','..XX...XX..','.XX.....XX.','XX.......XX'],
  ],
  ufo: [
    '.....XXXXXXX.....',
    '...XXXXXXXXXXX...',
    '..XXXXXXXXXXXXX..',
    '.XX.XX.XX.XX.XX.X.',
    'XXXXXXXXXXXXXXXXXX',
    '..XX.XX.XX.XX.XX..',
    '...XX.......XX....',
  ],
};

function drawSprite(bitmap, x, y, px, color) {
  ctx.fillStyle = color;
  for (let row = 0; row < bitmap.length; row++) {
    const line = bitmap[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] === 'X') {
        ctx.fillRect(Math.round(x + col * px), Math.round(y + row * px), px, px);
      }
    }
  }
}
function spriteSize(bitmap, px) {
  return { w: bitmap[0].length * px, h: bitmap.length * px };
}

// ---------- 効果音 (WebAudio、外部ファイル不要) ----------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// ---- ミュート管理 ----
let muted = (localStorage.getItem('si_muted') === '1');

function applyMuteButtonLabel() {
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = muted ? '♪✕' : '♪';
}
function toggleMute() {
  ensureAudio();
  muted = !muted;
  localStorage.setItem('si_muted', muted ? '1' : '0');
  applyMuteButtonLabel();
  if (muted) stopUfoHum();
}

// ---- 基本のビープ音 (簡単なエンベロープ付き) ----
function beep(freq, duration, type, vol, delay) {
  if (!audioCtx || muted) return;
  const t0 = audioCtx.currentTime + (delay || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t0);
  const peak = vol != null ? vol : 0.06;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// ---- 音の高さが変化するスイープ音 (被弾・撃破用) ----
function sweep(freqFrom, freqTo, duration, type, vol, delay) {
  if (!audioCtx || muted) return;
  const t0 = audioCtx.currentTime + (delay || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'sawtooth';
  osc.frequency.setValueAtTime(freqFrom, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + duration);
  const peak = vol != null ? vol : 0.08;
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// ---- 複数の音を並べて鳴らす(ファンファーレ・ジングル用) ----
function playSequence(notes, type, vol) {
  if (!audioCtx || muted) return;
  let t = 0;
  for (const [freq, dur] of notes) {
    beep(freq, dur * 0.9, type, vol, t);
    t += dur;
  }
}

// ---- UFO飛行中のうなり音 (連続音、LFOで音程を揺らす) ----
let ufoHumNodes = null;
function startUfoHum() {
  if (!audioCtx || muted || ufoHumNodes) return;
  const osc = audioCtx.createOscillator();
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 620;
  lfo.type = 'sine';
  lfo.frequency.value = 6;
  lfoGain.gain.value = 60;
  lfo.connect(lfoGain).connect(osc.frequency);
  gain.gain.value = 0.035;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  lfo.start();
  ufoHumNodes = { osc, lfo, gain };
}
function stopUfoHum() {
  if (!ufoHumNodes) return;
  const { osc, lfo, gain } = ufoHumNodes;
  try {
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
    osc.stop(audioCtx.currentTime + 0.12);
    lfo.stop(audioCtx.currentTime + 0.12);
  } catch (e) {}
  ufoHumNodes = null;
}

const SFX = {
  shoot: () => beep(880, 0.08, 'square', 0.05),
  invaderKill: () => sweep(500, 90, 0.18, 'sawtooth', 0.09),
  playerHit: () => sweep(300, 40, 0.45, 'sawtooth', 0.12),
  ufoHit: () => sweep(1400, 200, 0.3, 'triangle', 0.09),
  step: (lo) => beep(lo ? 90 : 130, 0.07, 'square', 0.035),
  start: () => playSequence([[440,0.09],[554,0.09],[659,0.09],[880,0.16]], 'square', 0.06),
  waveClear: () => playSequence([[659,0.12],[784,0.12],[988,0.12],[1318,0.28]], 'triangle', 0.07),
  gameOver: () => playSequence([[392,0.2],[349,0.2],[311,0.2],[220,0.5]], 'sawtooth', 0.08),
};


// ---------- 入力 ----------
const Input = {
  left: false, right: false, fireHeld: false, fireEdge: false,
  pauseEdge: false, startEdge: false,
};

window.addEventListener('keydown', (e) => {
  ensureAudio();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') Input.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') Input.right = true;
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    if (!Input.fireHeld) Input.fireEdge = true;
    Input.fireHeld = true;
    Input.startEdge = true;
  }
  if (e.code === 'KeyP') Input.pauseEdge = true;
}, { passive: false });

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') Input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') Input.right = false;
  if (e.code === 'Space' || e.code === 'ArrowUp') Input.fireHeld = false;
});

// ---------- タッチ操作 (仮想スティック + 攻撃ボタン) ----------
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add('touch-mode');

const joystick = { active: false, dx: 0, touchId: null };
const joyBase = document.getElementById('joystick-base');
const joyStick = document.getElementById('joystick-stick');
const joyZone = document.getElementById('joystick-zone');
const fireZone = document.getElementById('fire-zone');
const fireButton = document.getElementById('fire-button');

// タッチした場所にスティックの土台が移動する「フローティング方式」。
// 固定位置のスティックだと指の置き場所によって反応が悪く感じるため、
// 触れた瞬間にそこが中心になるようにする。
const STICK_RADIUS = 34; // これだけ横に動かせば入力が100%になる(px)
let joyCenterPos = { x: 0, y: 0 };

function positionBaseAt(clientX, clientY) {
  const zoneRect = joyZone.getBoundingClientRect();
  const half = joyBase.offsetWidth / 2;
  const localX = clamp(clientX - zoneRect.left, half, zoneRect.width - half);
  const localY = clamp(clientY - zoneRect.top, half, zoneRect.height - half);
  joyBase.style.left = `${localX - half}px`;
  joyBase.style.top = `${localY - half}px`;
  joyBase.style.bottom = 'auto';
  return { x: zoneRect.left + localX, y: zoneRect.top + localY };
}

function handleJoyStart(touch) {
  joystick.active = true;
  joystick.touchId = touch.identifier;
  joyCenterPos = positionBaseAt(touch.clientX, touch.clientY);
  joystick.dx = 0;
  joyStick.style.transform = 'translate(-50%, -50%)';
}
function updateJoy(touch) {
  // 横方向の移動だけを見る(縦のブレは無視して反応を安定させる)
  const dx = touch.clientX - joyCenterPos.x;
  const norm = clamp(Math.abs(dx) / STICK_RADIUS, 0, 1);
  const curved = Math.pow(norm, 0.45);
  joystick.dx = Math.sign(dx) * curved;

  // ノブの見た目は土台の横幅の内側に収まるようクランプ(縦は常に中央)
  const visualRadius = Math.min(STICK_RADIUS, joyBase.offsetWidth / 2 - joyStick.offsetWidth / 2);
  const visDist = clamp(Math.abs(dx), 0, visualRadius) * Math.sign(dx);
  joyStick.style.transform = `translate(calc(-50% + ${visDist}px), -50%)`;
}
function resetJoy() {
  joystick.active = false;
  joystick.dx = 0; joystick.touchId = null;
  joyStick.style.transform = 'translate(-50%, -50%)';
  joyBase.style.left = '';
  joyBase.style.top = '';
  joyBase.style.bottom = '';
}

joyZone.addEventListener('touchstart', (e) => {
  ensureAudio();
  e.preventDefault();
  if (joystick.touchId === null) handleJoyStart(e.changedTouches[0]);
}, { passive: false });
joyZone.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.touchId) updateJoy(t);
  }
}, { passive: false });
function joyEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.touchId) resetJoy();
  }
}
joyZone.addEventListener('touchend', joyEnd);
joyZone.addEventListener('touchcancel', joyEnd);

fireZone.addEventListener('touchstart', (e) => {
  ensureAudio();
  e.preventDefault();
  if (!Input.fireHeld) Input.fireEdge = true;
  Input.fireHeld = true;
  Input.startEdge = true;
  fireButton.classList.add('active');
}, { passive: false });
fireZone.addEventListener('touchend', (e) => {
  e.preventDefault();
  Input.fireHeld = false;
  fireButton.classList.remove('active');
}, { passive: false });
fireZone.addEventListener('touchcancel', () => {
  Input.fireHeld = false;
  fireButton.classList.remove('active');
});

// タイトル/ポーズ/ゲームオーバー画面のタップでも進行できるように
document.getElementById('stage').addEventListener('touchstart', (e) => {
  ensureAudio();
  Input.startEdge = true;
}, { passive: true });

// ---------- 画面回転 ----------
// 縦・横どちらでも遊べるようにする。CRT画面(#crt)はCSS側で
// 常に16:9を保ったままビューポートいっぱいにフィットするので、
// 縦持ちの場合は自動的にレターボックス表示になり、操作系は画面下に残る。

// 初回タップ時にフルスクリーン化のみ試みる(向きの固定はしない)
let triedFullscreen = false;
function tryFullscreen() {
  if (triedFullscreen) return;
  triedFullscreen = true;
  const el = document.documentElement;
  if (isTouchDevice && el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  }
}
window.addEventListener('touchstart', tryFullscreen, { once: true, passive: true });

// ---------- ゲームオブジェクト ----------
const PLAYER_SPEED = 420;
const PLAYER_W = 44, PLAYER_H = 24;
const BULLET_W = 4, BULLET_H = 14;
const PLAYER_FIRE_COOLDOWN = 0.32;

const player = {
  x: W / 2 - PLAYER_W / 2, y: H - 56, w: PLAYER_W, h: PLAYER_H,
  lives: 3, cooldown: 0, alive: true, blinkTimer: 0,
};

let bullets = []; // {x,y,w,h,vy,from:'player'|'alien'}

// --- 敵編隊 ---
const ROWS = 5, COLS = 9;
const ALIEN_W = 33, ALIEN_H = 24;
const ALIEN_GAP_X = 16, ALIEN_GAP_Y = 18;
const FORMATION_LEFT0 = (W - (COLS * (ALIEN_W + ALIEN_GAP_X) - ALIEN_GAP_X)) / 2;

// 難易度は5段階まで。ウェーブ6以降はレベル5のまま(それ以上は難しくならない)
const MAX_DIFFICULTY_LEVEL = 5;
const DIFFICULTY = [
  { baseStep: 0.90, speedGain: 0.00, shootRate: 0.85, bulletSpeed: 240 }, // Lv1
  { baseStep: 0.74, speedGain: 0.05, shootRate: 0.68, bulletSpeed: 260 }, // Lv2
  { baseStep: 0.58, speedGain: 0.10, shootRate: 0.52, bulletSpeed: 280 }, // Lv3
  { baseStep: 0.42, speedGain: 0.15, shootRate: 0.38, bulletSpeed: 300 }, // Lv4
  { baseStep: 0.28, speedGain: 0.20, shootRate: 0.26, bulletSpeed: 320 }, // Lv5 (最高難度)
];
function difficultyLevel(wave) { return clamp(wave, 1, MAX_DIFFICULTY_LEVEL); }
function difficultyFor(wave) { return DIFFICULTY[difficultyLevel(wave) - 1]; }

let aliens = [];
let formation = { dir: 1, x: 0, y: 60, stepTimer: 0, stepInterval: 0.9, frame: 0, dropFlagged: false };

function rowType(row) {
  if (row === 0) return { bmp: SPRITES.alienA, score: 30, color: COLORS.amber };
  if (row <= 2) return { bmp: SPRITES.alienB, score: 20, color: COLORS.green };
  return { bmp: SPRITES.alienC, score: 10, color: COLORS.white };
}

function buildFormation(wave) {
  aliens = [];
  formation.dir = 1;
  formation.x = 0;
  formation.y = 60;
  formation.frame = 0;
  formation.stepTimer = 0;
  formation.stepInterval = difficultyFor(wave).baseStep;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const t = rowType(row);
      aliens.push({
        row, col, alive: true,
        baseX: FORMATION_LEFT0 + col * (ALIEN_W + ALIEN_GAP_X),
        baseY: 60 + row * (ALIEN_H + ALIEN_GAP_Y),
        w: ALIEN_W, h: ALIEN_H,
        score: t.score, color: t.color, bmp: t.bmp,
      });
    }
  }
}

function aliveAliens() { return aliens.filter(a => a.alive); }

function formationBounds() {
  const alive = aliveAliens();
  if (alive.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of alive) {
    const x = a.baseX + formation.x;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + a.w);
    maxY = Math.max(maxY, a.baseY + formation.y - 60 + a.h);
  }
  return { minX, maxX, maxY };
}

// --- バリケード(トーチカ) ---
const BARRIER_COUNT = 4;
const BLOCK = 4; // 1ブロックのpx
const BARRIER_TEMPLATE = [
  '..XXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXX',
  'XXXXXX....XXXXXXXX',
  'XXXXX......XXXXXXX',
  'XXXX........XXXXXX',
];
let barriers = [];

function buildBarriers() {
  barriers = [];
  const totalW = BARRIER_TEMPLATE[0].length * BLOCK;
  const spacing = (W - totalW * BARRIER_COUNT) / (BARRIER_COUNT + 1);
  for (let i = 0; i < BARRIER_COUNT; i++) {
    const bx = spacing + i * (totalW + spacing);
    const by = H - 150;
    const blocks = [];
    for (let r = 0; r < BARRIER_TEMPLATE.length; r++) {
      for (let c = 0; c < BARRIER_TEMPLATE[r].length; c++) {
        if (BARRIER_TEMPLATE[r][c] === 'X') {
          blocks.push({ x: bx + c * BLOCK, y: by + r * BLOCK, alive: true });
        }
      }
    }
    barriers.push({ x: bx, y: by, blocks });
  }
}

function damageBarriersAt(px, py, radius) {
  for (const b of barriers) {
    for (const blk of b.blocks) {
      if (!blk.alive) continue;
      const dx = (blk.x + BLOCK / 2) - px;
      const dy = (blk.y + BLOCK / 2) - py;
      if (dx * dx + dy * dy <= radius * radius) blk.alive = false;
    }
  }
}
function barrierBlockAt(px, py) {
  for (const b of barriers) {
    if (px < b.x || px > b.x + BARRIER_TEMPLATE[0].length * BLOCK) continue;
    for (const blk of b.blocks) {
      if (!blk.alive) continue;
      if (px >= blk.x && px < blk.x + BLOCK && py >= blk.y && py < blk.y + BLOCK) return blk;
    }
  }
  return null;
}

// --- パーティクル(爆発) ---
let particles = [];
function spawnExplosion(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y, vx: rand(-140, 140), vy: rand(-140, 140),
      life: rand(0.25, 0.5), age: 0, color,
    });
  }
}

// --- UFO (おまけの高得点敵) ---
let ufo = null;
let ufoTimer = rand(10, 18);

// ---------- ゲーム状態管理 ----------
const game = {
  state: 'title', // title | playing | paused | wave-clear | gameover
  score: 0, hiScore: Number(localStorage.getItem('si_hiscore') || 0),
  wave: 1, waveTimer: 0,
};

const el = {
  score: document.getElementById('score-val'),
  hi: document.getElementById('hi-val'),
  level: document.getElementById('level-val'),
  lives: document.getElementById('lives-val'),
  title: document.getElementById('screen-title'),
  pause: document.getElementById('screen-pause'),
  wave: document.getElementById('screen-wave'),
  waveNextText: document.getElementById('wave-next-text'),
  gameover: document.getElementById('screen-gameover'),
  finalScoreText: document.getElementById('final-score-text'),
};
el.hi.textContent = game.hiScore;
applyMuteButtonLabel();

const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
muteBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); toggleMute(); }, { passive: false });

function show(elm) { elm.classList.remove('hidden'); }
function hide(elm) { elm.classList.add('hidden'); }
function hideAllOverlays() {
  [el.title, el.pause, el.wave, el.gameover].forEach(hide);
}

function resetGame() {
  game.score = 0;
  game.wave = 1;
  player.lives = 3;
  player.x = W / 2 - PLAYER_W / 2;
  player.alive = true;
  bullets = [];
  particles = [];
  ufo = null;
  ufoTimer = rand(10, 18);
  buildFormation(game.wave);
  buildBarriers();
}

function startGame() {
  resetGame();
  hideAllOverlays();
  game.state = 'playing';
  SFX.start();
}

function nextWave() {
  game.wave += 1;
  bullets = [];
  buildFormation(game.wave);
  buildBarriers();
  hideAllOverlays();
  game.state = 'playing';
}

function goGameOver() {
  game.state = 'gameover';
  stopUfoHum();
  SFX.gameOver();
  if (game.score > game.hiScore) {
    game.hiScore = game.score;
    localStorage.setItem('si_hiscore', String(game.hiScore));
  }
  el.finalScoreText.textContent = `SCORE ${game.score}   HI-SCORE ${game.hiScore}`;
  hideAllOverlays();
  show(el.gameover);
}

// ---------- 更新ロジック ----------
function updatePlayer(dt) {
  let dir = 0;
  if (Input.left) dir -= 1;
  if (Input.right) dir += 1;
  if (joystick.active) dir += clamp(joystick.dx, -1, 1);
  dir = clamp(dir, -1, 1);
  player.x += dir * PLAYER_SPEED * dt;
  player.x = clamp(player.x, 8, W - PLAYER_W - 8);

  player.cooldown -= dt;
  const wantsFire = Input.fireEdge || Input.fireHeld;
  if (wantsFire && player.cooldown <= 0) {
    bullets.push({ x: player.x + PLAYER_W / 2 - BULLET_W / 2, y: player.y - 4, w: BULLET_W, h: BULLET_H, vy: -560, from: 'player' });
    player.cooldown = PLAYER_FIRE_COOLDOWN;
    SFX.shoot();
  }
}

function updateFormation(dt) {
  const alive = aliveAliens();
  if (alive.length === 0) return;

  formation.stepTimer += dt;
  if (formation.stepTimer >= formation.stepInterval) {
    formation.stepTimer = 0;
    formation.frame = 1 - formation.frame;
    SFX.step(formation.frame === 0);

    const bounds = formationBounds();
    let stepX = 14 * formation.dir;
    let dropNow = false;
    if (bounds.minX + stepX < 10 || bounds.maxX + stepX > W - 10) {
      dropNow = true;
    }
    if (dropNow) {
      formation.dir *= -1;
      formation.y += 16;
    } else {
      formation.x += stepX;
    }
    // 加速: 残り数が減るほど速く(基準値は難易度テーブルから)
    const d = difficultyFor(game.wave);
    const ratio = alive.length / (ROWS * COLS);
    formation.stepInterval = clamp(0.14 + ratio * (d.baseStep - d.speedGain), 0.08, 1.0);
  }

  // 敵の攻撃
  formation.shootTimer = (formation.shootTimer || 0) - dt;
  const shootRate = difficultyFor(game.wave).shootRate;
  if (formation.shootTimer <= 0) {
    formation.shootTimer = shootRate;
    // 各列の最前列(最下段)の生存エイリアンからランダムに1体選んで発射
    const cols = {};
    for (const a of alive) {
      if (!cols[a.col] || a.row > cols[a.col].row) cols[a.col] = a;
    }
    const shooters = Object.values(cols);
    if (shooters.length > 0) {
      const s = shooters[Math.floor(rand(0, shooters.length))];
      const sx = s.baseX + formation.x + s.w / 2 - BULLET_W / 2;
      const sy = s.baseY + formation.y + s.h;
      bullets.push({ x: sx, y: sy, w: BULLET_W, h: 16, vy: difficultyFor(game.wave).bulletSpeed, from: 'alien' });
    }
  }

  // 侵略ライン到達チェック
  const bounds = formationBounds();
  if (bounds.maxY >= player.y - 6) {
    goGameOver();
  }
}

function updateUFO(dt) {
  if (ufo) {
    ufo.x += ufo.dir * ufo.speed * dt;
    if (ufo.x < -60 || ufo.x > W + 60) { ufo = null; stopUfoHum(); }
  } else {
    ufoTimer -= dt;
    if (ufoTimer <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      ufo = { x: dir === 1 ? -60 : W + 60, y: 34, dir, speed: 140, w: 54, h: 21, score: [50,100,150,300][Math.floor(rand(0,4))] };
      ufoTimer = rand(14, 24);
      startUfoHum();
    }
  }
}

function updateBullets(dt) {
  for (const b of bullets) b.y += b.vy * dt;
  bullets = bullets.filter(b => b.y > -30 && b.y < H + 30);

  for (const b of bullets) {
    if (b.dead) continue;

    // バリケードとの衝突
    const blk = barrierBlockAt(b.x + b.w / 2, b.y + (b.vy < 0 ? 0 : b.h));
    if (blk) {
      blk.alive = false;
      damageBarriersAt(b.x + b.w / 2, b.y + b.h / 2, 7);
      b.dead = true;
      continue;
    }

    if (b.from === 'player') {
      // エイリアンとの衝突
      for (const a of aliens) {
        if (!a.alive) continue;
        const ax = a.baseX + formation.x, ay = a.baseY + formation.y;
        if (overlap(b, { x: ax, y: ay, w: a.w, h: a.h })) {
          a.alive = false;
          b.dead = true;
          game.score += a.score;
          spawnExplosion(ax + a.w / 2, ay + a.h / 2, a.color, 14);
          SFX.invaderKill();
          break;
        }
      }
      // UFOとの衝突
      if (!b.dead && ufo && overlap(b, ufo)) {
        game.score += ufo.score;
        spawnExplosion(ufo.x + ufo.w / 2, ufo.y + ufo.h / 2, COLORS.red, 18);
        SFX.ufoHit();
        stopUfoHum();
        ufo = null;
        b.dead = true;
      }
    } else if (b.from === 'alien') {
      if (player.alive && overlap(b, player)) {
        b.dead = true;
        onPlayerHit();
      }
    }
  }
  bullets = bullets.filter(b => !b.dead);
}

function onPlayerHit() {
  spawnExplosion(player.x + player.w / 2, player.y + player.h / 2, COLORS.green, 24);
  SFX.playerHit();
  player.lives -= 1;
  if (player.lives <= 0) {
    player.alive = false;
    goGameOver();
  } else {
    player.x = W / 2 - PLAYER_W / 2;
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  particles = particles.filter(p => p.age < p.life);
}

function checkWaveClear() {
  if (aliveAliens().length === 0) {
    game.state = 'wave-clear';
    el.waveNextText.textContent = `WAVE ${game.wave + 1} へ...`;
    show(el.wave);
    game.waveTimer = 1.8;
    SFX.waveClear();
  }
}

// ---------- 描画 ----------
function drawBackgroundStars() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
}

function drawGroundLine() {
  ctx.strokeStyle = COLORS.green;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, H - 20);
  ctx.lineTo(W, H - 20);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  if (!player.alive) return;
  const size = spriteSize(SPRITES.player, 4);
  drawSprite(SPRITES.player, player.x + (player.w - size.w) / 2, player.y + (player.h - size.h) / 2, 4, COLORS.green);
}

function drawAliens() {
  const px = 3;
  for (const a of aliens) {
    if (!a.alive) continue;
    const ax = a.baseX + formation.x, ay = a.baseY + formation.y;
    const size = spriteSize(a.bmp[formation.frame], px);
    drawSprite(a.bmp[formation.frame], ax + (a.w - size.w) / 2, ay + (a.h - size.h) / 2, px, a.color);
  }
}

function drawUFO() {
  if (!ufo) return;
  const px = 3;
  ctx.save();
  ctx.shadowColor = COLORS.red;
  ctx.shadowBlur = 14;
  drawSprite(SPRITES.ufo, ufo.x, ufo.y, px, COLORS.red);
  ctx.restore();
}

function drawBullets() {
  for (const b of bullets) {
    ctx.fillStyle = b.from === 'player' ? COLORS.white : COLORS.amber;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
}

function drawBarriers() {
  ctx.fillStyle = COLORS.green;
  for (const b of barriers) {
    for (const blk of b.blocks) {
      if (blk.alive) ctx.fillRect(blk.x, blk.y, BLOCK, BLOCK);
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = 1 - p.age / p.life;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1;
}

function render() {
  drawBackgroundStars();
  drawGroundLine();
  drawBarriers();
  drawAliens();
  drawUFO();
  drawPlayer();
  drawBullets();
  drawParticles();
}

function updateHUD() {
  el.score.textContent = game.score;
  el.hi.textContent = Math.max(game.hiScore, game.score);
  el.level.textContent = game.wave;
  el.lives.textContent = '▲'.repeat(Math.max(0, player.lives));
}

// ---------- メインループ ----------
let lastTime = performance.now();

function togglePause() {
  if (game.state === 'playing') { game.state = 'paused'; show(el.pause); }
  else if (game.state === 'paused') { game.state = 'playing'; hide(el.pause); }
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (Input.pauseEdge) {
    Input.pauseEdge = false;
    if (game.state === 'playing' || game.state === 'paused') togglePause();
  }

  switch (game.state) {
    case 'title':
      if (Input.startEdge) startGame();
      break;
    case 'playing':
      updatePlayer(dt);
      updateFormation(dt);
      updateUFO(dt);
      updateBullets(dt);
      updateParticles(dt);
      checkWaveClear();
      break;
    case 'wave-clear':
      game.waveTimer -= dt;
      if (game.waveTimer <= 0) nextWave();
      break;
    case 'gameover':
      if (Input.startEdge) startGame();
      break;
    case 'paused':
    default:
      break;
  }

  Input.fireEdge = false;
  Input.startEdge = false;

  render();
  updateHUD();

  requestAnimationFrame(loop);
}

buildFormation(1);
buildBarriers();
requestAnimationFrame(loop);