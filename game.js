const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const audioFileInput = $('audioFile');
const difficultySelect = $('difficulty');
const analyzeBtn = $('analyzeBtn');
const startBtn = $('startBtn');
const comboText = $('combo');
const gameComboWrap = $('gameComboWrap');
const scoreText = $('score');
const judgeText = $('judge');
const scoreRateText = $('scoreRate');
const stateText = $('stateText');
const analysisText = $('analysisText');
const resultOverlay = $('resultOverlay');
const resultRank = $('resultRank');
const resultDesc = $('resultDesc');
const resultScore = $('resultScore');
const resultRate = $('resultRate');
const resultCombo = $('resultCombo');
const closeResult = $('closeResult');
const saveChartBtn = $('saveChartBtn');
const loadChartBtn = $('loadChartBtn');
const chartFileInput = $('chartFileInput');
const sRankOverlay = $('sRankOverlay');
const sRankCanvas = $('sRankCanvas');
const sResultScore = $('sResultScore');
const sResultRate = $('sResultRate');
const sResultCombo = $('sResultCombo');
const sSaveChartBtn = $('sSaveChartBtn');
const sSealClose = $('sSealClose');
const progressFill = $('progressFill');
const progressText = $('progressText');
const negOverlay = $('negOverlay');
const negCanvas = $('negCanvas');
const negScore = $('negScore');
const negCombo = $('negCombo');
const negClose = $('negClose');
const negSaveChartBtn = $('negSaveChartBtn');

const laneX = [250, 500, 750];
const laneWidth = 170;
const hitY = 430;
const spawnY = 65;

let audioCtx, audioBuffer, source;
let notes = [];
let perfectScoreMap = new Map();
let laneFx = [[], [], []];
let laneBursts = [[], [], []];
let travelMs = 1800;
let judgeWindows = { perfect: 72, great: 122, good: 185 };
let chartEndTime = 0;
let currentBeatSec = 0.5;

const SCORE = { miss: -400 };
const JUDGE_FACTOR = { perfect: 1.0, great: 0.7, good: 0.35 };

const diffCfg = {
  easy:   { intro: 4.8, travelMs: 2100, judge: { perfect: 95,  great: 165, good: 240 } },
  normal: { intro: 3.6, travelMs: 1820, judge: { perfect: 72,  great: 122, good: 185 } },
  hard:   { intro: 2.2, travelMs: 1550, judge: { perfect: 55,  great: 95,  good: 145 } },
};

const state = {
  playing: false, paused: false, analyzing: false, startTime: 0,
  combo: 0, maxCombo: 0, score: 0, totalComboScore: 0,
  judgedPerfectScore: 0,
  pressed: new Set(), activeHolds: new Map(),
};

const startHint = '按 空格 开始演奏 / 演奏中按 空格 暂停';

// ============================================================
// 3D DEEP-SEA VISUAL SYSTEM
// ============================================================

const VANISH_X = 500;
const VANISH_Y = -600; 

function perspScale(y) {
  return Math.max(0.01, (y - VANISH_Y) / (hitY - VANISH_Y));
}
function perspX(lx, y) {
  return VANISH_X + (lx - VANISH_X) * perspScale(y);
}

const LANE_PALETTE = [
  { fill: 'rgba(0,80,200,',   edge: '#3aafff', shadow: '#0080ff' },
  { fill: 'rgba(0,180,180,',  edge: '#00f0e0', shadow: '#00cccc' },
  { fill: 'rgba(0,180,100,',  edge: '#00ffa3', shadow: '#00cc80' },
];
const NOTE_COLORS = {
  tap:   { main: '#00e5ff', glow: '#0090bb', shadow: '#00e5ff' },
  hold:  { main: '#00ffa3', glow: '#008055', shadow: '#00ffa3' },
  flick: { main: '#ff9f45', glow: '#883a00', shadow: '#ffb060' },
};

function rand(a, b) { return a + Math.random() * (b - a); }

const NUM_BUBBLES = 22;
const bubbles = Array.from({ length: NUM_BUBBLES }, (_, i) => ({
  x: rand(80, 940),
  y: rand(0, 580),
  r: rand(1.2, 5),
  speed: rand(0.2, 0.9),
  wobble: rand(0, Math.PI * 2),
  wobbleSpeed: rand(0.4, 1.4),
  alpha: rand(0.04, 0.18),
  depth: rand(0.3, 1.0),
}));

const MOTES_COUNT = 12;
const motes = Array.from({ length: MOTES_COUNT }, () => ({
  x: rand(80, 940),
  y: rand(0, 580),
  vx: rand(-0.12, 0.12),
  vy: rand(-0.04, 0.09),
  alpha: rand(0.03, 0.10),
  r: rand(0.7, 1.8),
}));

function updateParticles() {
  for (const b of bubbles) {
    b.y -= b.speed;
    b.wobble += b.wobbleSpeed * 0.018;
    if (b.y < -15) { b.y = canvas.height + 10; b.x = rand(80, 940); }
  }
  for (const m of motes) {
    m.x += m.vx; m.y += m.vy;
    if (m.x < 60 || m.x > 960) m.vx *= -1;
    if (m.y < 0) m.y = canvas.height;
    if (m.y > canvas.height) m.y = 0;
  }
}

function drawBubbles() {
  ctx.save();
  for (const b of bubbles) {
    const bx = b.x + Math.sin(b.wobble) * 6;
    ctx.globalAlpha = b.alpha;
    ctx.strokeStyle = '#7fffff';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(bx, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = b.alpha * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(bx - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const m of motes) {
    ctx.globalAlpha = m.alpha;
    ctx.fillStyle = '#80e0ff';
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOceanBackground(nowMs) {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0,   '#000614');
  g.addColorStop(0.3, '#000f28');
  g.addColorStop(0.7, '#001840');
  g.addColorStop(1,   '#002555');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const lgL = ctx.createRadialGradient(0, canvas.height, 0, 0, canvas.height, 350);
  lgL.addColorStop(0, 'rgba(0,100,180,0.04)');
  lgL.addColorStop(1, 'transparent');
  ctx.fillStyle = lgL;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const lgR = ctx.createRadialGradient(canvas.width, canvas.height, 0, canvas.width, canvas.height, 300);
  lgR.addColorStop(0, 'rgba(0,180,150,0.03)');
  lgR.addColorStop(1, 'transparent');
  ctx.fillStyle = lgR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const t = nowMs * 0.00028;
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const ox = 100 + i * 135;
    const cx = ox + Math.sin(t * 0.9 + i * 1.37) * 55 + Math.sin(t * 0.4 + i * 2.1) * 25;
    const w  = 14 + Math.sin(t * 1.2 + i * 0.8) * 7;
    const cg = ctx.createLinearGradient(cx, 0, cx + 70, canvas.height * 0.72);
    cg.addColorStop(0, `rgba(0,210,240,${0.025 + Math.sin(t + i) * 0.008})`);
    cg.addColorStop(1, 'rgba(0,180,220,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(cx - w, 0);
    ctx.lineTo(cx + w, 0);
    ctx.lineTo(cx + 90 + w, canvas.height * 0.72);
    ctx.lineTo(cx + 90 - w, canvas.height * 0.72);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const ts = nowMs * 0.0009;
  ctx.save();
  ctx.globalAlpha = 0.022;
  for (let i = 0; i < 8; i++) {
    const hx = 150 + i * 105 + Math.sin(ts + i * 1.1) * 18;
    const hy = hitY + 30 + Math.sin(ts * 1.4 + i * 0.9) * 14;
    const rh = ctx.createRadialGradient(hx, hy, 0, hx, hy, 40 + Math.sin(ts + i) * 12);
    rh.addColorStop(0, '#00ffee');
    rh.addColorStop(1, 'transparent');
    ctx.fillStyle = rh;
    ctx.beginPath();
    ctx.arc(hx, hy, 45 + Math.sin(ts + i) * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const fog = ctx.createLinearGradient(0, 0, 0, 100);
  fog.addColorStop(0, 'rgba(0,4,14,0.78)');
  fog.addColorStop(1, 'rgba(0,4,14,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, canvas.width, 100);
}

function drawLanes3D(nowMs) {
  const topY = VANISH_Y; 
  const bottomY = canvas.height + 10;
  const ts = nowMs * 0.0007;

  for (let i = 0; i < 3; i++) {
    const lx = laneX[i];
    const hw = laneWidth / 2;
    const p = LANE_PALETTE[i];
    const pressed = state.pressed.has(['f', 'j', 'k'][i]);

    const tsY = perspScale(topY),  bsY = perspScale(bottomY);
    const tx = perspX(lx, topY),   bx = perspX(lx, bottomY);
    const thw = hw * tsY,          bhw = hw * bsY;

    const alphaFill = pressed ? 0.32 : 0.14 + Math.sin(ts + i * 1.1) * 0.015;
    ctx.beginPath();
    ctx.moveTo(tx - thw, topY);
    ctx.lineTo(tx + thw, topY);
    ctx.lineTo(bx + bhw, bottomY);
    ctx.lineTo(bx - bhw, bottomY);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, topY, 0, bottomY);
    fillGrad.addColorStop(0, p.fill + '0.0)');
    fillGrad.addColorStop(0.5, p.fill + alphaFill + ')');
    fillGrad.addColorStop(1, p.fill + (alphaFill * 1.5) + ')');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    const edgeAlpha = pressed ? 1.0 : 0.80;
    ctx.save();
    ctx.shadowBlur  = pressed ? 8 : 2;
    ctx.shadowColor = p.shadow;
    ctx.strokeStyle = p.edge;
    ctx.lineWidth   = pressed ? 2.2 : 1.4;
    ctx.globalAlpha = edgeAlpha;
    ctx.beginPath();
    ctx.moveTo(tx - thw, topY);
    ctx.lineTo(bx - bhw, bottomY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx + thw, topY);
    ctx.lineTo(bx + bhw, bottomY);
    ctx.stroke();
    ctx.restore();

    if (pressed) {
      ctx.save();
      const pg = ctx.createLinearGradient(bx, hitY - 60, bx, hitY + 60);
      pg.addColorStop(0, 'transparent');
      pg.addColorStop(0.5, p.fill + '0.45)');
      pg.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.moveTo(bx - bhw, bottomY);
      ctx.lineTo(bx + bhw, bottomY);
      ctx.lineTo(tx + thw, topY);
      ctx.lineTo(tx - thw, topY);
      ctx.fillStyle = p.fill + '0.15)';
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawHitLine(nowMs) {
  const leftEdge  = perspX(laneX[0] - laneWidth / 2, hitY);
  const rightEdge = perspX(laneX[2] + laneWidth / 2, hitY);
  const pulse = (Math.sin(nowMs * 0.0025) + 1) * 0.5;

  ctx.save();
  ctx.shadowBlur  = 14 + pulse * 6;
  ctx.shadowColor = '#00e5ff';
  ctx.strokeStyle = `rgba(0,229,255,${0.15 + pulse * 0.12})`;
  ctx.lineWidth   = 5 + pulse * 2;
  ctx.beginPath();
  ctx.moveTo(leftEdge, hitY);
  ctx.lineTo(rightEdge, hitY);
  ctx.stroke();

  ctx.shadowBlur  = 6;
  ctx.strokeStyle = '#a0f8ff';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(leftEdge, hitY);
  ctx.lineTo(rightEdge, hitY);
  ctx.stroke();

  for (let i = 0; i < 3; i++) {
    const cx = perspX(laneX[i], hitY);
    ctx.shadowBlur  = 8;
    ctx.shadowColor = '#00e5ff';
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, hitY - 10);
    ctx.lineTo(cx, hitY + 10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLaneFx(lane, x, nowMs) {
  const visX = perspX(x, hitY); 

  laneFx[lane] = laneFx[lane].filter(a => nowMs < a.until);
  laneFx[lane].forEach(a => {
    const r = (a.until - nowMs) / 220;
    ctx.save();
    ctx.globalAlpha = r * 0.4;
    ctx.shadowBlur  = 14;
    ctx.shadowColor = a.color;
    ctx.fillStyle   = a.color;
    ctx.beginPath();
    ctx.arc(visX, hitY, 16 + (1 - r) * (36 + a.scale * 18), 0, Math.PI * 2);
    ctx.lineWidth   = 2.5 + a.scale;
    ctx.strokeStyle = a.color;
    ctx.globalAlpha = r * 0.7;
    ctx.stroke();

    ctx.globalAlpha = r * r * 0.25;
    const hw = (laneWidth * 0.85) / 2;
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.ellipse(visX, hitY, hw, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  laneBursts[lane] = laneBursts[lane].filter(b => nowMs - b.born < 420);
  laneBursts[lane].forEach(b => {
    const t = Math.min(1, (nowMs - b.born) / 420);
    const ease = 1 - Math.pow(1 - t, 2.5);
    b.sparks.forEach(s => {
      const d = 12 + ease * 68 * s.speed * b.size;
      const sx = visX + Math.cos(s.angle) * d;
      const sy = hitY + Math.sin(s.angle) * d * 0.45;
      const sr = Math.max(0.5, 3.5 * b.size * (1 - t * 0.9));
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.65;
      ctx.shadowBlur = 6;
      ctx.shadowColor = b.color;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  });
}

function drawBg() {
  const nowMs = performance.now();
  updateParticles();
  drawOceanBackground(nowMs);
  drawBubbles();
  drawLanes3D(nowMs);
  drawHitLine(nowMs);
  drawLaneFx(0, laneX[0], nowMs);
  drawLaneFx(1, laneX[1], nowMs);
  drawLaneFx(2, laneX[2], nowMs);

  if (state.analyzing) {
    const t = nowMs * 0.001;
    ctx.fillStyle = 'rgba(0,4,16,0.62)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.textAlign = 'center';
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.shadowBlur = 24; ctx.shadowColor = '#00ffa3';
    ctx.strokeStyle = '#00ffa3'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy - 58, 22, t * 2, t * 2 + Math.PI * 1.4);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let i = 0; i < 4; i++) {
      const a = t * 2 + Math.PI * 1.4 + i * 0.22;
      const px = cx + Math.cos(a) * 22, py = (cy - 58) + Math.sin(a) * 22;
      ctx.globalAlpha = 0.15 + i * 0.2;
      ctx.fillStyle = '#00ffa3';
      ctx.beginPath(); ctx.arc(px, py, 3.5 - i * 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 20; ctx.shadowColor = '#00ffa3';
    ctx.fillStyle = '#80ffcc';
    ctx.font = 'bold 22px "Exo 2", sans-serif';
    ctx.fillText('正在分析节奏…', cx, cy - 6);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#4a8faa';
    ctx.font = '13px "Share Tech Mono", monospace';
    ctx.fillText('检测音频峰值 · 推算 BPM · 生成音符序列', cx, cy + 24);
    ctx.restore();
  } else if (!audioBuffer && !state.playing) {
    ctx.fillStyle = 'rgba(0,4,16,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.textAlign = 'center';
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.shadowBlur = 32; ctx.shadowColor = '#00e5ff';
    ctx.fillStyle = '#a0f8ff';
    ctx.font = 'bold 26px "Exo 2", sans-serif';
    ctx.fillText('欢迎来到 Abyssal Groove Lab', cx, cy - 52);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#4a8faa';
    ctx.font = '14px "Share Tech Mono", monospace';
    ctx.fillText('① 点击「音频文件」载入本地音乐', cx, cy - 12);
    ctx.fillText('② 选择难度，点击「分析节奏」自动生成谱面', cx, cy + 14);
    ctx.fillText('③ 按 空格 或点击「开始演奏」进入游戏', cx, cy + 40);
    ctx.fillStyle = '#2a5f78';
    ctx.font = '12px "Share Tech Mono", monospace';
    ctx.fillText('也可直接「加载谱面」读取已保存的 JSON 谱面文件', cx, cy + 72);
    ctx.restore();
  } else if (audioBuffer && !notes.length && !state.playing) {
    ctx.fillStyle = 'rgba(0,4,16,0.52)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.textAlign = 'center';
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.shadowBlur = 28; ctx.shadowColor = '#00ffa3';
    ctx.fillStyle = '#80ffcc';
    ctx.font = 'bold 24px "Exo 2", sans-serif';
    ctx.fillText('音频已载入 — 准备生成谱面', cx, cy - 44);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#4a8faa';
    ctx.font = '14px "Share Tech Mono", monospace';
    ctx.fillText('选择右上方难度（轻松 / 标准 / 高压）', cx, cy - 4);
    ctx.fillText('然后点击「分析节奏」生成专属谱面', cx, cy + 22);
    ctx.fillStyle = '#2a5f78';
    ctx.font = '12px "Share Tech Mono", monospace';
    ctx.fillText('也可点击「加载谱面」直接读取已有 JSON 谱面', cx, cy + 54);
    ctx.restore();
  } else if (!state.playing && notes.length) {
    ctx.fillStyle = 'rgba(0,4,16,0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowBlur  = 24;
    ctx.shadowColor = '#00e5ff';
    ctx.fillStyle   = '#a0f8ff';
    ctx.font = 'bold 28px "Exo 2", sans-serif';
    ctx.fillText('按 空格 开始演奏 / 演奏中按 空格 暂停', canvas.width / 2, canvas.height / 2);
    ctx.restore();
  } else if (state.paused) {
    ctx.fillStyle = 'rgba(0,4,16,0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.textAlign  = 'center';
    ctx.shadowBlur  = 30;
    ctx.shadowColor = '#00ffa3';
    ctx.fillStyle   = '#00ffa3';
    ctx.font = 'bold 48px "Exo 2", sans-serif';
    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }
}

const YFOR_VY = -600;  
function yFor(t, now) {
  const frac = 1 - ((t - now) * 1000) / travelMs; 
  const psSpawn = (spawnY - YFOR_VY) / (hitY - YFOR_VY);
  const Z_far   = 1 / psSpawn;
  const Z       = Z_far + frac * (1 - Z_far);
  const ps      = 1 / Z;
  return YFOR_VY + ps * (hitY - YFOR_VY);
}

function hexRGB(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function hexDark(hex, f, a) {
  const [r,g,b] = hexRGB(hex);
  return `rgba(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)},${a})`;
}

function drawHemisphere(x, y, r, color, shadowColor, rw) {
  if (rw === undefined) rw = r;
  ctx.save();
  const ps = perspScale(y);
  const ry = r * 0.35 * (ps / perspScale(hitY));

  ctx.shadowBlur  = 6;
  ctx.shadowColor = shadowColor;
  ctx.fillStyle   = hexDark(color, 0.38, 0.95);
  ctx.beginPath();
  ctx.ellipse(x, y, rw, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 0, false);
  ctx.ellipse(x, y, rw, ry, 0, 0, Math.PI, false);
  ctx.closePath();

  ctx.shadowBlur  = 7;
  ctx.shadowColor = shadowColor;
  const dg = ctx.createRadialGradient(x - r * 0.18, y - r * 0.42, 0, x, y, r);
  dg.addColorStop(0,    'rgba(255,255,255,0.55)');
  dg.addColorStop(0.15, color);
  dg.addColorStop(0.70, color);
  dg.addColorStop(1,    hexDark(color, 0.35, 1.0));
  ctx.fillStyle = dg;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(0,0,0,0.50)';
  ctx.lineWidth   = Math.max(0.7, r * 0.07);
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 0, false);
  ctx.stroke();

  ctx.strokeStyle = hexDark(color, 1.4, 0.80);
  ctx.lineWidth   = Math.max(0.8, r * 0.07);
  ctx.beginPath();
  ctx.ellipse(x, y, rw, ry, 0, 0, Math.PI, false);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 0, false);
  ctx.ellipse(x, y, rw, ry, 0, 0, Math.PI, false);
  ctx.clip();
  const sx = x - r * 0.22, sy = y - r * 0.44;
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.38);
  sg.addColorStop(0,    'rgba(255,255,255,0.72)');
  sg.addColorStop(0.50, 'rgba(255,255,255,0.10)');
  sg.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawSphere(x, y, r, color, shadowColor) {
  ctx.save();
  ctx.shadowBlur  = 7;
  ctx.shadowColor = shadowColor;
  ctx.fillStyle   = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur  = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth   = Math.max(0.7, r * 0.07);
  ctx.stroke();

  const hx = x - r * 0.28, hy = y - r * 0.30;
  const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.46);
  hg.addColorStop(0,    'rgba(255,255,255,0.70)');
  hg.addColorStop(0.50, 'rgba(255,255,255,0.14)');
  hg.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFlickPill(xF, yF, rF, xB, yB, rB, color, shadowColor) {
  ctx.save();

  const dx = xF - xB;
  const dy = yF - yB;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist < 1) {
    drawSphere(xF, yF, rF, color, shadowColor);
    ctx.restore();
    return;
  }

  const angle = Math.atan2(dy, dx); 
  const sinAlpha = (rB - rF) / dist;
  const alpha = Math.asin(Math.max(-1, Math.min(1, sinAlpha)));

  const aLeftBack = angle - Math.PI / 2 + alpha;
  const aLeftFront = angle - Math.PI / 2 + alpha;
  const aRightBack = angle + Math.PI / 2 - alpha;
  const aRightFront = angle + Math.PI / 2 - alpha;

  ctx.shadowBlur = 7;
  ctx.shadowColor = shadowColor;
  ctx.fillStyle = color;

  ctx.beginPath();
  ctx.arc(xB, yB, rB, aRightBack, aLeftBack, false);
  ctx.lineTo(xF + rF * Math.cos(aLeftFront), yF + rF * Math.sin(aLeftFront));
  ctx.arc(xF, yF, rF, aLeftFront, aRightFront, false);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(0.7, rF * 0.07);
  ctx.stroke();

  ctx.save();
  ctx.clip(); 

  const hxF = xF - rF * 0.28, hyF = yF - rF * 0.30;
  const hgF = ctx.createRadialGradient(hxF, hyF, 0, hxF, hyF, rF * 0.46);
  hgF.addColorStop(0,    'rgba(255,255,255,0.70)');
  hgF.addColorStop(0.50, 'rgba(255,255,255,0.14)');
  hgF.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = hgF;
  ctx.beginPath();
  ctx.arc(xF, yF, rF, 0, Math.PI * 2);
  ctx.fill();

  const hxB = xB - rB * 0.28, hyB = yB - rB * 0.30;
  const hgB = ctx.createRadialGradient(hxB, hyB, 0, hxB, hyB, rB * 0.46);
  hgB.addColorStop(0,    'rgba(255,255,255,0.40)');
  hgB.addColorStop(0.50, 'rgba(255,255,255,0.08)');
  hgB.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = hgB;
  ctx.beginPath();
  ctx.arc(xB, yB, rB, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(hxB, hyB);
  ctx.lineTo(hxF, hyF);
  
  ctx.lineWidth = rF * 0.4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.stroke();

  ctx.lineWidth = rF * 0.15;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

function drawNotes(now) {
  for (const n of notes) {
    if (n.judged && !n.missed) continue; 
    if (n.type !== 'hold') continue;
    if (n.missed && n.started) continue; 
    if (n.started && !n.judged && !state.playing) continue;

    const y  = yFor(n.time,    now); 
    const y2 = yFor(n.endTime, now); 

    const tailY  = Math.max(VANISH_Y + 1, y2);
    const holdFloat = 26.4 * perspScale(hitY) * 0.55;
    const headY = n.started ? hitY + holdFloat : Math.min(y, canvas.height + 10);

    if (headY <= tailY) continue;                         
    if (tailY > canvas.height + 90 || headY < -80) continue; 

    const nc = NOTE_COLORS.hold;
    const lx = laneX[n.lane];
    const steps = 28;

    for (let s = 0; s < steps; s++) {
      const f0 = s       / steps;
      const f1 = (s + 1) / steps;
      const yA_lane = tailY + f0 * (headY - tailY);
      const yB_lane = tailY + f1 * (headY - tailY);
      const floatA = 26.4 * Math.max(0.02, perspScale(yA_lane)) * 0.55;
      const floatB = 26.4 * Math.max(0.02, perspScale(yB_lane)) * 0.55;
      const yA = yA_lane - floatA;
      const yB = yB_lane - floatB;
      const sA = Math.max(0.02, perspScale(yA_lane));
      const sB = Math.max(0.02, perspScale(yB_lane));
      const xA = perspX(lx, yA_lane), xB = perspX(lx, yB_lane);

      ctx.save();
      ctx.globalAlpha = n.started ? 0.65 : 0.95; 

      const wA = Math.max(1, sA * 19.2), wB = Math.max(1, sB * 19.2);

      const midX = (xA + xB) * 0.5, midW = (wA + wB) * 0.5;
      
      const [rC, gC, bC] = hexRGB(nc.main);
      const rgbMain = `${rC},${gC},${bC}`;

      const tg = ctx.createLinearGradient(midX - midW, 0, midX + midW, 0);
      tg.addColorStop(0,    `rgba(${rgbMain}, 0.85)`);         
      tg.addColorStop(0.15, `rgba(${rgbMain}, 0.25)`);         
      tg.addColorStop(0.35, `rgba(${rgbMain}, 0.15)`);         
      tg.addColorStop(0.46, `rgba(255,255,255,0.80)`);         
      tg.addColorStop(0.54, `rgba(255,255,255,0.80)`);         
      tg.addColorStop(0.65, `rgba(${rgbMain}, 0.15)`);         
      tg.addColorStop(0.85, `rgba(${rgbMain}, 0.25)`);         
      tg.addColorStop(1,    `rgba(${rgbMain}, 0.85)`);         

      ctx.beginPath();
      ctx.moveTo(xA - wA, yA);
      ctx.lineTo(xA + wA, yA);
      ctx.lineTo(xB + wB, yB + 0.5);
      ctx.lineTo(xB - wB, yB + 0.5);
      ctx.closePath();
      
      ctx.fillStyle = tg;
      ctx.shadowBlur  = n.started ? 15 : 6;
      ctx.shadowColor = nc.shadow;
      ctx.fill();

      ctx.shadowBlur = 0;

      ctx.strokeStyle = `rgba(255,255,255,0.45)`;
      ctx.lineWidth   = Math.max(0.5, (sA + sB) * 1.2);
      ctx.beginPath();
      ctx.moveTo(xA - wA, yA); ctx.lineTo(xB - wB, yB + 0.5);
      ctx.moveTo(xA + wA, yA); ctx.lineTo(xB + wB, yB + 0.5);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,255,255,0.8)`;
      ctx.lineWidth   = Math.max(0.6, (sA + sB) * 1.5);
      ctx.beginPath();
      ctx.moveTo(xA, yA);
      ctx.lineTo(xB, yB + 0.5);
      ctx.stroke();

      ctx.restore();
    }
  }

  for (const n of notes) {
    if (n.judged && !n.missed) continue;
    if (n.type === 'hold' && n.judged && n.missed && n.started) continue; 
    if (n.type === 'hold' && n.started) continue;
    const y = yFor(n.time, now);
    if (y < -70 || y > canvas.height + 90) continue;
    const x = perspX(laneX[n.lane], y);
    const s = perspScale(y);
    const r = 26.4 * Math.max(0.02, s);
    const nc = NOTE_COLORS[n.type] || NOTE_COLORS.tap;
    const floatY = y - r * 0.55;

    const ery = r * 0.28 * (s / perspScale(hitY));
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = hexDark(nc.main, 0.3, 1.0);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.15, n.type === 'flick' ? r * 1.5 : r, ery * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (n.type === 'flick') {
      const stretchR = r * 1.0;
      const yBack = Math.max(VANISH_Y + 1, y - stretchR);
      const sBack = perspScale(yBack);
      const rBack = 26.4 * Math.max(0.02, sBack);
      const xBack = perspX(laneX[n.lane], yBack);
      drawFlickPill(x, floatY, r, xBack, yBack - rBack * 0.55, rBack, nc.main, nc.shadow);
    } else {
      drawSphere(x, floatY, r, nc.main, nc.shadow);
    }
  }
}

// ============================================================
// MUSIC ANALYSIS ENGINE
// ============================================================

function ensureCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function nowSec() { return audioCtx.currentTime - state.startTime; }

function beep(freq = 660, duration = 0.06, type = 'triangle', gainV = 0.04) {
  ensureCtx();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainV, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now); osc.stop(now + duration);
}

async function fileToBuffer(file) {
  ensureCtx(); return audioCtx.decodeAudioData((await file.arrayBuffer()).slice(0));
}

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 0, j = 0; i < n; i++) {
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    let m = n >> 1; for (; j & m; m >>= 1) j ^= m; j ^= m;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1; const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = i + j + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr;        im[a] += vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

let lastBandOnsets = null;

function detectBandOnsets(data, sampleRate) {
  const N = 2048, HOP = 512, hopSec = HOP / sampleRate, binHz = sampleRate / N;
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));

  const bL0 = Math.max(1, Math.round(40 / binHz)), bL1 = Math.round(200 / binHz);
  const bM1 = Math.round(2500 / binHz), bH1 = Math.min((N >> 1) - 1, Math.round(10000 / binHz));
  const frames = Math.floor((data.length - N) / HOP);
  const fL = new Float32Array(frames), fM = new Float32Array(frames), fH = new Float32Array(frames);
  const pL = new Float32Array(bL1 - bL0 + 1), pM = new Float32Array(bM1 - bL1), pH = new Float32Array(bH1 - bM1);
  const re = new Float32Array(N), im = new Float32Array(N);

  for (let fr = 0; fr < frames; fr++) {
    const base = fr * HOP;
    for (let i = 0; i < N; i++) { re[i] = data[base + i] * hann[i]; im[i] = 0; }
    fftInPlace(re, im);
    let fl = 0, fm = 0, fh = 0;
    for (let k = bL0; k <= bL1; k++) { const m = Math.log1p(Math.sqrt(re[k] ** 2 + im[k] ** 2)); fl += Math.max(0, m - pL[k - bL0]); pL[k - bL0] = m; }
    for (let k = bL1 + 1; k <= bM1; k++) { const m = Math.log1p(Math.sqrt(re[k] ** 2 + im[k] ** 2)); fm += Math.max(0, m - pM[k - bL1 - 1]); pM[k - bL1 - 1] = m; }
    for (let k = bM1 + 1; k <= bH1; k++) { const m = Math.log1p(Math.sqrt(re[k] ** 2 + im[k] ** 2)); fh += Math.max(0, m - pH[k - bM1 - 1]); pH[k - bM1 - 1] = m; }
    fL[fr] = fl; fM[fr] = fm; fH[fr] = fh;
  }

  function pickPeaks(flux, sigmaK, minGapSec) {
    const winFrames = Math.round(0.35 / hopSec), minGapFrames = Math.round(minGapSec / hopSec);
    const raw = []; let lastFrame = -99999;
    for (let i = 1; i < flux.length - 1; i++) {
      if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1] || i - lastFrame < minGapFrames) continue;
      const l = Math.max(0, i - winFrames), r = Math.min(flux.length - 1, i + winFrames);
      let mean = 0, cnt = r - l + 1;
      for (let k = l; k <= r; k++) mean += flux[k]; mean /= cnt;
      let variance = 0; for (let k = l; k <= r; k++) variance += (flux[k] - mean) ** 2;
      const std = Math.sqrt(variance / cnt), threshold = mean + std * sigmaK;
      if (flux[i] > threshold) { raw.push({ t: i * hopSec, str: flux[i] - threshold }); lastFrame = i; }
    }
    if (!raw.length) return [];
    const sorted = [...raw].sort((a, b) => a.str - b.str);
    const p95Str = sorted[Math.floor(sorted.length * 0.95)].str || 0.001;
    return raw.sort((a,b) => a.t - b.t).map(o => ({ t: o.t, str: Math.min(1.0, o.str / p95Str) }));
  }

  const low = pickPeaks(fL, 1.1, 0.10), mid = pickPeaks(fM, 1.3, 0.07), high = pickPeaks(fH, 1.5, 0.05);
  const merged = [...low, ...mid, ...high].sort((a, b) => a.t - b.t);
  const all = [];
  for (const o of merged) if (!all.length || o.t - all[all.length - 1] > 0.025) all.push(o.t);
  return { low, mid, high, all };
}

function detectPeaks(data, sampleRate) { lastBandOnsets = detectBandOnsets(data, sampleRate); return lastBandOnsets.all; }

function estimateBeat(onsets) {
  if (onsets.length < 6) return 0.5;
  const res = 0.004, usedLen = Math.min(onsets.length, 400);
  const endT = onsets[usedLen - 1] + 1, bins = Math.ceil(endT / res), imp = new Float32Array(bins);
  for (let i = 0; i < usedLen; i++) { const idx = Math.round(onsets[i] / res); if (idx >= 0 && idx < bins) imp[idx] = 1; }
  const minLag = Math.round((60 / 185) / res), maxLag = Math.round((60 / 60) / res);
  let bestLag = Math.round(0.5 / res), bestAC = -1, searchLen = Math.min(bins, Math.round(30 / res));
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0; for (let i = 0; i + lag < searchLen; i++) ac += imp[i] * imp[i + lag];
    if (ac > bestAC) { bestAC = ac; bestLag = lag; }
  }
  let period = bestLag * res, bpm = 60 / period;
  while (bpm < 115) { bpm *= 2; period /= 2; }
  while (bpm > 230) { bpm /= 2; period *= 2; }
  return period;
}

function estimateDownbeatPhase(peaks, beat, intro) {
  if (!peaks.length) return intro;
  let bestPhase = intro, bestScore = -1;
  for (let c = 0; c < 32; c++) {
    const phase = intro + (c / 32) * beat; let score = 0;
    for (const t of peaks) {
      if (t < intro) continue; if (t > intro + 60) break;
      const nearest = Math.round((t - phase) / beat), delta = Math.abs((t - phase) - nearest * beat);
      if (delta < beat * 0.18) score += (1 - delta / (beat * 0.18)) * (nearest % 4 === 0 ? 1.8 : nearest % 2 === 0 ? 1.2 : 1);
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase; }
  }
  return bestPhase;
}

// ============================================================
// DYNAMIC PATTERNS & CHART BUILDER
// ============================================================

const CHART_PATTERNS = {
  rest:          [{ b: 0, l: 0, tp: 'tap' }],
  lone_hold:     [{ b: 0, l: 1, tp: 'hold', dur: 3.5 }],
  downbeat:      [{ b: 0, l: 0, tp: 'tap' }, { b: 2, l: 1, tp: 'tap' }],
  hold_intro:    [{ b: 0, l: 0, tp: 'hold', dur: 1.5 }, { b: 2, l: 2, tp: 'hold', dur: 1.5 }],
  offbeat_one:   [{ b: 0, l: 0, tp: 'tap' }, { b: 1.5, l: 1, tp: 'tap' }, { b: 3, l: 2, tp: 'tap' }],
  dotted:        [{ b: 0, l: 0, tp: 'tap' }, { b: 1.5, l: 1, tp: 'tap' }, { b: 2.5, l: 0, tp: 'tap' }],
  four_floor:    [{ b: 0, l: 0, tp: 'tap' }, { b: 1, l: 1, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 3, l: 1, tp: 'tap' }],
  hold_walk:     [{ b: 0, l: 0, tp: 'hold', dur: 1.5 }, { b: 1.5, l: 2, tp: 'tap' }, { b: 2, l: 1, tp: 'hold', dur: 1.5 }, { b: 3.5, l: 2, tp: 'tap' }],
  ping_pong:     [{ b: 0, l: 0, tp: 'tap' }, { b: 0.5, l: 1, tp: 'tap' }, { b: 1.5, l: 2, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 3, l: 2, tp: 'tap' }],
  sync_groove:   [{ b: 0, l: 0, tp: 'tap' }, { b: 0.75, l: 1, tp: 'tap' }, { b: 1.5, l: 2, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 2.5, l: 1, tp: 'tap' }, { b: 3, l: 2, tp: 'hold', dur: 1 }],
  double_stair:  [{ b: 0, l: 0, tp: 'tap' }, { b: 0, l: 2, tp: 'tap' }, { b: 1, l: 1, tp: 'tap' }, { b: 1.5, l: 1, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 2, l: 2, tp: 'tap' }, { b: 3, l: 1, tp: 'tap' }, { b: 3.5, l: 2, tp: 'tap' }],
  hold_stream:   [{ b: 0, l: 1, tp: 'hold', dur: 3.5 }, { b: 0, l: 0, tp: 'tap' }, { b: 0.5, l: 2, tp: 'tap' }, { b: 1.5, l: 0, tp: 'tap' }, { b: 2, l: 2, tp: 'tap' }, { b: 3, l: 0, tp: 'tap' }],
  outer_trill:   [{ b: 0, l: 0, tp: 'tap' }, { b: 0.5, l: 2, tp: 'tap' }, { b: 1, l: 0, tp: 'tap' }, { b: 1.5, l: 2, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 2.5, l: 2, tp: 'tap' }, { b: 3, l: 0, tp: 'tap' }, { b: 3.5, l: 2, tp: 'tap' }],
  gallop:        [{ b: 0, l: 0, tp: 'tap' }, { b: 0.25, l: 1, tp: 'tap' }, { b: 1, l: 2, tp: 'tap' }, { b: 1.25, l: 1, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 2.25, l: 1, tp: 'tap' }, { b: 3, l: 2, tp: 'tap' }, { b: 3.25, l: 1, tp: 'tap' }],
  stream_16th:   [{ b: 0, l: 0, tp: 'tap' }, { b: 0.25, l: 1, tp: 'tap' }, { b: 0.5, l: 2, tp: 'tap' }, { b: 0.75, l: 1, tp: 'tap' }, { b: 1, l: 0, tp: 'tap' }, { b: 1.25, l: 1, tp: 'tap' }, { b: 1.5, l: 2, tp: 'tap' }, { b: 1.75, l: 1, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 2.25, l: 1, tp: 'tap' }, { b: 2.5, l: 2, tp: 'tap' }, { b: 2.75, l: 1, tp: 'tap' }, { b: 3, l: 0, tp: 'tap' }, { b: 3.25, l: 1, tp: 'tap' }, { b: 3.5, l: 2, tp: 'tap' }, { b: 3.75, l: 1, tp: 'tap' }],
  heavy_drop:    [{ b: 0, l: 0, tp: 'hold', dur: 1.5 }, { b: 0, l: 2, tp: 'hold', dur: 1.5 }, { b: 1.5, l: 1, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 2, l: 1, tp: 'tap' }, { b: 2.5, l: 2, tp: 'tap' }, { b: 3, l: 1, tp: 'tap' }, { b: 3, l: 2, tp: 'tap' }, { b: 3.5, l: 0, tp: 'tap' }],
  chord_explode: [{ b: 0, l: 0, tp: 'tap' }, { b: 0, l: 1, tp: 'tap' }, { b: 0.5, l: 2, tp: 'tap' }, { b: 1, l: 1, tp: 'tap' }, { b: 1, l: 2, tp: 'tap' }, { b: 1.5, l: 0, tp: 'tap' }, { b: 2, l: 0, tp: 'tap' }, { b: 2, l: 2, tp: 'tap' }, { b: 2.5, l: 1, tp: 'tap' }, { b: 3, l: 0, tp: 'tap' }, { b: 3, l: 1, tp: 'tap' }, { b: 3.5, l: 2, tp: 'tap' }]
};

const TIER_POOLS = {
  0: ['rest', 'lone_hold', 'downbeat'],
  1: ['downbeat', 'hold_intro', 'offbeat_one', 'dotted'],
  2: ['four_floor', 'hold_walk', 'ping_pong', 'sync_groove'],
  3: ['double_stair', 'hold_stream', 'outer_trill', 'gallop'],
  4: ['stream_16th', 'heavy_drop', 'chord_explode', 'double_stair', 'hold_stream']
};

function selectBarPattern(tier, prevName) {
  const pool = TIER_POOLS[tier] || TIER_POOLS[0];
  const filtered = pool.filter(n => n !== prevName);
  return (filtered.length ? filtered : pool)[Math.floor(Math.random() * (filtered.length || pool.length))];
}

function bandStrAt(band, t, win) {
  let best = 0;
  for (const o of band) if (Math.abs(o.t - t) <= win) best = Math.max(best, o.str);
  return best;
}

function computeEnergyEnvelope(data, sampleRate) {
  const W = Math.round(sampleRate * 2.0), H = Math.round(sampleRate * 0.1), raw = [];
  for (let i = 0; i + W <= data.length; i += H) {
    let e = 0; for (let j = 0; j < W; j++) e += data[i + j] * data[i + j];
    raw.push({ t: i / sampleRate, rms: Math.sqrt(e / W) });
  }
  return raw.map((f, i) => {
    const l = Math.max(0, i - 3), r = Math.min(raw.length - 1, i + 3);
    let s = 0; for (let k = l; k <= r; k++) s += raw[k].rms;
    return { t: f.t, rms: s / (r - l + 1) };
  });
}

function avgRmsIn(env, t0, t1) {
  let s = 0, c = 0;
  for (const f of env) if (f.t >= t0 && f.t < t1) { s += f.rms; c++; }
  return c ? s / c : 0;
}

function energyPercentiles(env, intro, safeEnd) {
  const vals = env.filter(f => f.t >= intro && f.t <= safeEnd).map(f => f.rms).sort((a, b) => a - b);
  if (!vals.length) return { p20: 0, p50: 0.5, p80: 1, p90: 1 };
  const at = p => vals[Math.max(0, Math.floor((vals.length - 1) * p))];
  const minE = at(0.05), maxE = at(0.95), range = maxE - minE;
  const p50 = at(0.5);
  const p80 = Math.max(at(0.8), p50 + range * 0.15);
  const p90 = Math.max(at(0.9), p80 + range * 0.10); // 解锁极高压判定点
  const p20 = Math.min(at(0.2), p50 - range * 0.15);
  return { p20, p50, p80, p90 };
}

function buildBarTiers(env, pct, beat, downbeatPhase, intro, safeEnd) {
  const barLen = beat * 4; let t = downbeatPhase + Math.ceil((intro - downbeatPhase) / barLen) * barLen;
  const bars = [];
  const midpoint  = intro + (safeEnd - intro) * 0.50;
  const threequar = intro + (safeEnd - intro) * 0.75;
  while (t < safeEnd) {
    const end = Math.min(t + barLen, safeEnd), avg = avgRmsIn(env, t, end);
    const posFactor = t >= threequar ? 1.20 : t >= midpoint ? 1.10 : 1.00;
    const scaledAvg = avg * posFactor;
    // 突破上限，大于 p90 时直接进入 Tier 4 评级
    const tier = scaledAvg > pct.p90 ? 4 : scaledAvg > pct.p80 ? 3 : scaledAvg > pct.p50 ? 2 : scaledAvg > pct.p20 ? 1 : 0;
    bars.push({ t, end, tier, energy: avg }); t += barLen;
  }
  return bars;
}

function makeNote(type, id, time, lane) { return { id, time, lane, type, judged: false, missed: false }; }
function makeHold(id, time, lane, endTime) { return { id, time, lane, type: 'hold', endTime, judged: false, missed: false, started: false }; }
function visualClearanceSec(cfgTravelMs) { return 44 / Math.max(1, (hitY - spawnY) / (cfgTravelMs / 1000)); }
function laneFreeAt(lane, t, laneNextFree, laneHolds, headGap) {
  if (t < laneNextFree[lane]) return false;
  return !laneHolds[lane].some(h => t >= h.time - headGap && t <= h.endTime + headGap);
}

function pushLaneNote(list, note, laneNextFree, laneHolds, cfgTravelMs, minGapSec = 0) {
  const lane = note.lane, baseGap = visualClearanceSec(cfgTravelMs);
  const gap = Math.max(note.type === 'flick' ? baseGap * 1.15 : baseGap, minGapSec);
  if (!laneFreeAt(lane, note.time, laneNextFree, laneHolds, gap)) return false;
  list.push(note);
  if (note.type === 'hold') { laneNextFree[lane] = note.endTime + baseGap * 0.6; laneHolds[lane].push({ time: note.time, endTime: note.endTime }); }
  else laneNextFree[lane] = Math.max(laneNextFree[lane], note.time + gap);
  return true;
}

function buildChart(peaks, duration, diffKey, monoData, sampleRate) {
  const cfg   = diffCfg[diffKey] || diffCfg.normal;
  const bands = lastBandOnsets || detectBandOnsets(monoData, sampleRate);
  const beat  = estimateBeat(bands.all);
  const intro = cfg.intro;
  const downbeatPhase = estimateDownbeatPhase(bands.all, beat, intro);

  const lastOnset = bands.all.length ? bands.all[bands.all.length - 1] : duration - 5;
  const endTime   = Math.min(duration - 3.5, lastOnset + beat * 6);
  const safeEnd   = Math.max(intro + 12, endTime);

  const envelope = computeEnergyEnvelope(monoData, sampleRate);
  const pct      = energyPercentiles(envelope, intro, safeEnd);
  const rawBars  = buildBarTiers(envelope, pct, beat, downbeatPhase, intro, safeEnd);

  for (let bi = 0; bi < rawBars.length; bi++) {
    const startIdx = Math.max(0, bi - 4), endIdx = Math.min(rawBars.length - 1, bi + 4);
    let localSum = 0; for (let i = startIdx; i <= endIdx; i++) localSum += rawBars[i].energy;
    const localAvg = localSum / (endIdx - startIdx + 1);

    let finalTier = rawBars[bi].tier;
    if (rawBars[bi].energy > localAvg * 1.25) finalTier = Math.max(finalTier, 2);
    if (rawBars[bi].energy > localAvg * 1.7)  finalTier = Math.max(finalTier, 3);
    // 突破平滑限制，允许提权到 4
    if (rawBars[bi].energy > localAvg * 2.0)  finalTier = Math.max(finalTier, 4);

    if (bi > rawBars.length / 2 && rawBars[bi].energy > localAvg * 0.95 && rawBars[bi].energy > pct.p50) {
      finalTier = Math.max(finalTier, 2);
    }

    if (bi > 0) {
      const prevTier = rawBars[bi - 1].finalTier;
      // 允许高等级的适度延续保留
      if (prevTier >= 4 && finalTier < prevTier) {
        if (rawBars[bi].energy > localAvg * 0.9) finalTier = prevTier;
        else if (rawBars[bi].energy > localAvg * 0.65) finalTier = prevTier - 1;
      } else if (prevTier >= 3 && finalTier < prevTier) {
        if (rawBars[bi].energy > localAvg * 0.85) finalTier = prevTier;
        else if (rawBars[bi].energy > localAvg * 0.6) finalTier = prevTier - 1;
      }
    }
    if (finalTier === 0 && Math.random() < 0.8) finalTier = 1;
    rawBars[bi].finalTier = finalTier;
  }

  const chart        = [];
  const laneNextFree = [-1, -1, -1];
  const laneHolds    = [[], [], []];
  let noteIdx        = 0;
  let prevPattern    = 'rest';
  let lastNoteTime   = 0;

  const normalLaneGap = diffKey === 'normal' ? beat * 1.05 : 0;
  
  // 核心改动：lastFlickTime 变为每轨独立数组，解决轨道间双击排斥 Bug
  let lastFlickTime   = [-999, -999, -999];
  let lastLane = -1;
  let consecutiveLaneCount = 0;

  for (let bi = 0; bi < rawBars.length; bi++) {
    const barStart = rawBars[bi].t;
    let tier = rawBars[bi].finalTier;

    // 突破难度天花板，真正允许 Hard 跑到 4 级
    if (diffKey === 'easy')   tier = Math.min(tier, 2);
    if (diffKey === 'normal') tier = Math.min(tier, 3);
    if (diffKey === 'hard')   tier = Math.min(tier, 4);

    const patternName = selectBarPattern(tier, prevPattern);
    const template    = CHART_PATTERNS[patternName] || [];
    prevPattern       = patternName;
    const isStream = ['stream_16th', 'gallop', 'outer_trill'].includes(patternName);

    for (const slot of template) {
      if (diffKey === 'easy' && (slot.b % 0.5 !== 0)) continue;
      if (diffKey === 'normal' && isStream && slot.b % 0.5 !== 0 && Math.random() < 0.15) continue;
      const isHighDense  = ['outer_trill', 'gallop', 'double_stair', 'hold_stream'].includes(patternName);
      const isExtraDense = ['stream_16th', 'heavy_drop', 'chord_explode'].includes(patternName);
      const isNonDownbeat = slot.b !== 0 && slot.tp !== 'hold';
      if (diffKey === 'normal' && isHighDense  && isNonDownbeat && Math.random() < 0.55) continue;
      if (diffKey === 'hard'   && isHighDense  && isNonDownbeat && Math.random() < 0.35) continue;
      if (diffKey === 'hard'   && isExtraDense && isNonDownbeat && Math.random() < 0.55) continue;

      const t = barStart + slot.b * beat;
      if (t < intro || t >= safeEnd - 0.05) continue;

      const win = beat * (tier <= 1 ? 0.50 : tier === 2 ? 0.42 : 0.36);
      const strL = bandStrAt(bands.low,  t, win);
      const strM = bandStrAt(bands.mid,  t, win);
      const strH = bandStrAt(bands.high, t, win);
      const maxStr = Math.max(strL, strM, strH);

      let minStr = tier === 1 ? 0.05 : tier === 2 ? 0.02 : 0.01;
      const starving = (t - lastNoteTime) > beat * 3;
      if (maxStr < minStr && !starving && slot.b !== 0) continue;

      let noteType = slot.tp;
      let lane = slot.l;
      let isDouble = false;

      if (diffKey !== 'easy' && noteType === 'tap' && tier >= 3) {
        if ((strL > 0.15 && strH > 0.15)) isDouble = true;
      }

      if (!isDouble && (tier <= 2 || !isStream) && !(noteType === 'hold' && tier >= 3)) {
        if (strL > strM && strL > strH) lane = 0;
        else if (strM > strH) lane = 1;
        else lane = 2;
      }

      if (noteType === 'tap') {
        if (lane === lastLane) {
          consecutiveLaneCount++;
          if (consecutiveLaneCount >= 4) {
            lane = (lane + 1 + Math.floor(Math.random() * 2)) % 3;
            consecutiveLaneCount = 1;
          }
        } else {
          consecutiveLaneCount = 1;
        }
        lastLane = lane;
      }

      // 这里检测本轨道上次双击冷却即可，不影响其他轨
      if (noteType === 'tap' && diffKey !== 'easy') {
        const isOffbeat = (slot.b % 1 !== 0);
        const flickChance = diffKey === 'hard' ? (isOffbeat ? 0.15 : 0.05) : (isOffbeat ? 0.06 : 0.01);
        if (Math.random() < flickChance && (t - lastFlickTime[lane] > beat * 1.5)) {
          noteType = 'flick';
        }
      }

      let placed = false;
      if (noteType === 'hold') {
        let extendedDur = (slot.dur ?? 2);
        // 突破小节限制：2级及以上就有概率延长长按持续时间（最高延长4拍，绝对跨小节）
        if (tier >= 2 && Math.random() < 0.3) {
          extendedDur += 1 + Math.random() * 3; 
        }

        const holdEnd = Math.min(t + extendedDur * beat, safeEnd - 0.1);
        if (holdEnd - t >= beat * 0.5) {
          placed = pushLaneNote(chart, makeHold(`h${noteIdx++}`, t, lane, holdEnd), laneNextFree, laneHolds, cfg.travelMs, normalLaneGap);
          
          // 根据 Tier 控制多轨同步/异步长按
          let extraHoldsAllowed = 0;
          if (tier >= 3) extraHoldsAllowed = 1; // Tier 3 有可能出现双轨长按
          if (tier >= 4) extraHoldsAllowed = 2; // Tier 4 有可能出现三轨长按

          if (extraHoldsAllowed > 0 && placed) {
            let otherLanes = [0, 1, 2].filter(l => l !== lane).sort(() => Math.random() - 0.5);
            let extraPlaced = 0;
            for (let ol of otherLanes) {
              if (extraPlaced >= extraHoldsAllowed) break;
              
              if (Math.random() < 0.3) { // 对每条空闲轨道有40%的爆发长按概率
                // offsetT: 可能完全同步，也可能错开半拍到2拍
                const offsetT = t + beat * (Math.random() < 0.5 ? 0 : (Math.random() * 2.0));
                const extraDur = beat * (1.0 + Math.random() * 3.5); // 可以跨小节
                const extraEnd = Math.min(offsetT + extraDur, safeEnd - 0.1);
                
                if (extraEnd - offsetT >= beat * 0.5) {
                  if (pushLaneNote(chart, makeHold(`h${noteIdx++}`, offsetT, ol, extraEnd), laneNextFree, laneHolds, cfg.travelMs, normalLaneGap)) {
                    extraPlaced++;
                  }
                }
              }
            }
          }
        }
      } else if (noteType === 'flick') {
        placed = pushLaneNote(chart, { id: `f${noteIdx++}`, time: t, lane, type: 'flick', tapsNeeded: 2, tapsDone: 0, firstTapAt: null, flickWindow: 0.50, judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs, normalLaneGap);
        if (placed) lastFlickTime[lane] = t;

        // 根据 Tier 控制多轨同步/异步双击
        let extraFlicksAllowed = 0;
        if (tier >= 3) extraFlicksAllowed = 1; // Tier 3 出现双轨连击
        if (tier >= 4) extraFlicksAllowed = 2; // Tier 4 出现三轨连击

        if (extraFlicksAllowed > 0 && placed) {
          let otherLanes = [0, 1, 2].filter(l => l !== lane).sort(() => Math.random() - 0.5);
          let extraPlaced = 0;
          for (let ol of otherLanes) {
            if (extraPlaced >= extraFlicksAllowed) break;
            
            if (Math.random() < 0.15) { // 35%独立概率蔓延至其他轨道
              // offsetT: 可能同步，也可能错开一拍形成交错连击
              const offsetT = t + beat * (Math.random() < 0.8 ? 0 : (Math.random() * 1.0));
              if (offsetT - lastFlickTime[ol] > beat * 1.5 && offsetT < safeEnd - 0.05) {
                if (pushLaneNote(chart, { id: `f${noteIdx++}`, time: offsetT, lane: ol, type: 'flick', tapsNeeded: 2, tapsDone: 0, firstTapAt: null, flickWindow: 0.50, judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs, normalLaneGap)) {
                  lastFlickTime[ol] = offsetT;
                  extraPlaced++;
                }
              }
            }
          }
        }
      } else {
        // Tap分支：多押系统早已完善，Tier 4 依然支持三押单点
        placed = pushLaneNote(chart, makeNote('tap', `n${noteIdx++}`, t, lane), laneNextFree, laneHolds, cfg.travelMs, normalLaneGap);
        if (isDouble) {
          let secondLane = (lane + (Math.random() > 0.5 ? 1 : 2)) % 3;
          pushLaneNote(chart, makeNote('tap', `n${noteIdx++}`, t, secondLane), laneNextFree, laneHolds, cfg.travelMs, normalLaneGap);
          lastLane = secondLane;
          if (tier >= 4 && Math.random() < 0.35) {
            let thirdLane = 3 - lane - secondLane;
            pushLaneNote(chart, makeNote('tap', `n${noteIdx++}`, t, thirdLane), laneNextFree, laneHolds, cfg.travelMs, normalLaneGap);
            lastLane = thirdLane;
          }
        }
      }

      if (placed) lastNoteTime = t;
    }
  }

  chart.sort((a, b) => a.time - b.time);
  return { notes: chart, intro, beat, end: safeEnd, sections: [], downbeatPhase };
}

// ============================================================
// GAMEPLAY LOGIC & UI RENDERER
// ============================================================

function buildMonoData(buffer) {
  if (!buffer) return null;
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels <= 1) return buffer.getChannelData(0);
  const mixed = new Float32Array(length), inv = 1 / numberOfChannels;
  for (let c = 0; c < numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mixed[i] += channel[i];
  }
  for (let i = 0; i < length; i++) mixed[i] *= inv;
  return mixed;
}

function judgeByOffsetMs(ms) {
  const a = Math.abs(ms);
  if (a <= judgeWindows.perfect) return { key: 'perfect', name: '完美', color: '#00ffa3', fx: 1.35 };
  if (a <= judgeWindows.great)   return { key: 'great',   name: '很好', color: '#00e5ff', fx: 1.05 };
  if (a <= judgeWindows.good)    return { key: 'good',    name: '凑合', color: '#ffb060', fx: 0.78 };
  return null;
}

function judgeSecondFlickTap(ms) {
  const a = Math.abs(ms), p = judgeWindows.perfect;
  if (a <= judgeWindows.perfect + p) return { key: 'perfect', name: '完美', color: '#00ffa3', fx: 1.35 };
  if (a <= judgeWindows.great  + p) return { key: 'great',   name: '很好', color: '#00e5ff', fx: 1.05 };
  if (a <= judgeWindows.good   + p) return { key: 'good',    name: '凑合', color: '#ffb060', fx: 0.78 };
  return null;
}

function comboMultiplier(combo) {
  if (combo <= 10) return 1.0;
  if (combo <= 49) return 1.01;
  if (combo <= 99) return 1.02;
  if (combo <= 199) return 1.05;
  return 1.1;
}

function scoreBaseByNotePart(note, part = 'tap') {
  if (!note) return 1000;
  if (note.type === 'flick') return 2000;
  if (note.type === 'hold') {
    if (part === 'holdHead') return 1000;
    const durBeats = Math.max(0, (note.endTime - note.time) / Math.max(0.01, currentBeatSec));
    return 1000 + 1000 * durBeats;
  }
  return 1000;
}

function comboTier(combo) {
  if (combo >= 200) return 'rift';
  if (combo >= 100) return 'abyss';
  if (combo >= 50) return 'deep';
  if (combo >= 11) return 'surge';
  return 'base';
}

function refreshComboDisplay() {
  comboText.textContent = String(state.combo);
  if (!gameComboWrap) return;
  gameComboWrap.dataset.tier = comboTier(state.combo);
  gameComboWrap.classList.toggle('is-active', state.playing);
  gameComboWrap.classList.toggle('is-paused', state.playing && state.paused);
}

function calculateTotalComboScore() {
  const events = [];
  for (const n of notes) {
    if (n.type === 'hold') {
      events.push({ time: n.time, id: `${n.id}-head`, note: n, part: 'holdHead' });
      events.push({ time: n.endTime, id: `${n.id}-tail`, note: n, part: 'holdTail' });
    } else {
      events.push({ time: n.time, id: n.id, note: n, part: 'tap' });
    }
  }
  events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  perfectScoreMap = new Map();
  let combo = 0;
  let total = 0;
  for (const e of events) {
    combo += 1;
    const ps = scoreBaseByNotePart(e.note, e.part) * comboMultiplier(combo);
    perfectScoreMap.set(e.id, ps);
    total += ps;
  }
  return Math.round(total);
}

function updateScoreRate() {
  const denom = state.judgedPerfectScore;
  scoreRateText.textContent = denom > 0 ? `${Math.max(0, (state.score / denom) * 100).toFixed(1)}%` : '0%';
}

function addFx(lane, color, scale) {
  laneFx[lane].push({ born: performance.now(), until: performance.now() + 220, color, scale });
  laneBursts[lane].push({
    born: performance.now(), color, size: scale,
    sparks: Array.from({ length: Math.round(8 + scale * 8) }, (_, i) => ({
      angle: Math.PI * 2 * i / Math.round(8 + scale * 8),
      speed: 1.3 + Math.random() * (1.5 + scale)
    }))
  });
}

function registerJudge(j, lane, note, part = 'tap') {
  state.combo += 1;
  const mul = comboMultiplier(state.combo);
  const base = scoreBaseByNotePart(note, part);
  const gain = Math.round(base * JUDGE_FACTOR[j.key] * mul);
  state.score += gain;
  const mapKey = note.type === 'hold'
    ? (part === 'holdHead' ? `${note.id}-head` : `${note.id}-tail`)
    : note.id;
  state.judgedPerfectScore += perfectScoreMap.get(mapKey) || 0;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  judgeText.textContent = `${j.name} +${gain}`;
  addFx(lane, j.color, j.fx);
  beep(j.key === 'perfect' ? 960 : j.key === 'great' ? 790 : 630, 0.07, 'triangle', 0.04);
  refreshComboDisplay();
  scoreText.textContent = String(state.score);
  updateScoreRate();
}

function registerMiss(lane, label = '错过', note = null, parts = null) {
  state.score += SCORE.miss; state.combo = 0;
  if (note && parts) {
    for (const part of parts) {
      const mapKey = part === 'holdHead' ? `${note.id}-head`
                   : part === 'holdTail' ? `${note.id}-tail`
                   : note.id;
      state.judgedPerfectScore += perfectScoreMap.get(mapKey) || 0;
    }
  }
  judgeText.textContent = label; addFx(lane, '#ff4d6d', 0.85); beep(210, 0.09, 'sawtooth', 0.03);
  refreshComboDisplay();
  scoreText.textContent = String(state.score);
  updateScoreRate();
}

function pendingNote(lane, r = 0.26) {
  const n = nowSec(); return notes.find(x => !x.judged && x.lane === lane && Math.abs(n - x.time) <= r);
}

function pendingFlickSecond(lane) {
  return notes.find(x => !x.judged && x.lane === lane && x.type === 'flick' && x.firstTapAt);
}

function onTap(lane) {
  if (!state.playing || state.paused) return;
  const n = nowSec();
  const rankOrder = ['perfect', 'great', 'good'];
  const interval = judgeWindows.perfect * 2 / 1000;

  const flickTarget = pendingFlickSecond(lane);
  if (flickTarget) {
    const j2 = judgeSecondFlickTap((n - (flickTarget.time + interval)) * 1000);
    flickTarget.judged = true;
    if (!j2) { registerMiss(lane, '双击错过'); return; }
    const worseJudge = rankOrder.indexOf(j2.key) > rankOrder.indexOf(flickTarget.firstJudge.key) ? j2 : flickTarget.firstJudge;
    registerJudge(worseJudge, lane, flickTarget, 'tap');
    return;
  }

  const target = pendingNote(lane);
  if (!target) return registerMiss(lane, '空击');
  const j = judgeByOffsetMs((n - target.time) * 1000);
  if (!j) return registerMiss(lane, '错过');

  if (target.type === 'hold') {
    target.started = true; state.activeHolds.set(lane, target);
    registerJudge({ ...j, name: `${j.name}·按住`, fx: j.fx + 0.08 }, lane, target, 'holdHead'); return;
  }
  if (target.type === 'flick') {
    target.firstTapAt = n;
    target.firstJudge = j;
    addFx(lane, j.color, j.fx);
    beep(520, 0.025, 'sine', 0.015);
    return;
  }
  target.judged = true; registerJudge(j, lane, target, 'tap');
}

function onRelease(lane) {
  const h = state.activeHolds.get(lane);
  if (!h || h.judged) return;
  h.judged = true; state.activeHolds.delete(lane);
  const j = judgeByOffsetMs(Math.abs(nowSec() - h.endTime) * 1000);
  if (j) registerJudge({ ...j, name: `${j.name}·收尾` }, lane, h, 'holdTail'); else registerMiss(lane, '收尾错过', h, ['holdTail']);
}

function startGame() {
  if (!audioBuffer || !notes.length) return;
  ensureCtx(); if (source) source.disconnect(); resetRun();
  notes.forEach(n => { n.judged = n.missed = n.started = false; if (n.type === 'flick') n.tapsDone = 0, n.firstTapAt = null; });
  source = audioCtx.createBufferSource(); source.buffer = audioBuffer; source.connect(audioCtx.destination);
  state.startTime = audioCtx.currentTime + 0.08; state.playing = true; stateText.textContent = '演奏中';
  refreshComboDisplay();
  resultOverlay.classList.add('hidden'); source.start(state.startTime);
}

function togglePause() {
  if (!state.playing) {
    if (audioBuffer && !notes.length && !state.analyzing) { analyzeCurrentTrack(); return; } 
    if (audioBuffer && notes.length) startGame();
    return;
  }
  state.paused = !state.paused; stateText.textContent = state.paused ? '暂停' : '演奏中';
  refreshComboDisplay();
  if (state.paused) audioCtx.suspend(); else audioCtx.resume();
}

function handleDown(lane) { state.pressed.add(['f', 'j', 'k'][lane]); onTap(lane); }
function handleUp(lane) { state.pressed.delete(['f', 'j', 'k'][lane]); onRelease(lane); }

function onKeyDown(e) {
  const map = { f: 0, j: 1, k: 2 }, key = e.key.toLowerCase();
  if (key in map) e.preventDefault();
  if (e.code === 'Space') {
    e.preventDefault();
    if (!sRankOverlay.classList.contains('hidden')) { sRankOverlay.classList.add('hidden'); stopSRankCanvas(); return; }
    if (!negOverlay.classList.contains('hidden'))   { negOverlay.classList.add('hidden');   stopNegCanvas();   return; }
    if (!resultOverlay.classList.contains('hidden')){ resultOverlay.classList.add('hidden');                   return; }
    togglePause();
    return;
  }
  if (!(key in map) || state.pressed.has(key)) return; handleDown(map[key]);
}
function onKeyUp(e) { const map = { f: 0, j: 1, k: 2 }, key = e.key.toLowerCase(); if (key in map) handleUp(map[key]); }

function updateLogic(now) {
  if (!state.playing || state.paused) return;
  for (const n of notes) {
    if (n.judged) continue;
    const late = now > n.time + 0.28;
    if (n.type === 'hold') {
      if (!n.started && late) { n.judged = true; n.missed = true; registerMiss(n.lane, '错过', n, ['holdHead', 'holdTail']); }
      else if (n.started && now > n.endTime + 0.22) { n.judged = true; n.missed = true; state.activeHolds.delete(n.lane); registerMiss(n.lane, '收尾错过', n, ['holdTail']); }
    } else if (n.type === 'flick') {
      const flickTimeout = (judgeWindows.perfect * 4 + judgeWindows.good) / 1000 + 0.05;
      if (now > n.time + flickTimeout) { n.judged = true; n.missed = true; registerMiss(n.lane, '双击错过', n, ['tap']); }
    } else if (late) { n.judged = true; n.missed = true; registerMiss(n.lane, '错过', n, ['tap']); }
  }
  if (now > chartEndTime + 1.0) finishRun();
}

function finishRun() {
  state.playing = false;
  refreshComboDisplay();
  if (source) { try { source.stop(); } catch {} source.disconnect(); source = null; }
  for (const n of notes) {
    if (n.type === 'hold' && n.started && !n.judged) { n.judged = true; n.missed = true; }
  }
  stateText.textContent = '结束';
  const rate = state.judgedPerfectScore > 0 ? Math.max(0, (state.score / state.judgedPerfectScore) * 100) : 0;

  if (state.score < 0) {
    negScore.textContent = String(state.score);
    negCombo.textContent = String(state.maxCombo);
    negOverlay.classList.remove('hidden');
    startNegCanvas();
  } else if (rate >= 95) {
    sResultScore.textContent = String(state.score);
    sResultRate.textContent = `${rate.toFixed(1)}%`;
    sResultCombo.textContent = String(state.maxCombo);
    sRankOverlay.classList.remove('hidden');
    startSRankCanvas();
  } else {
    let rank = 'D', desc = 'Keep Grooving';
    if (rate >= 88) [rank, desc] = ['A', 'Fantastic Flow'];
    else if (rate >= 75) [rank, desc] = ['B', 'Great Vibe'];
    else if (rate >= 60) [rank, desc] = ['C', 'Nice Try'];
    resultRank.textContent = rank; resultDesc.textContent = desc;
    resultScore.textContent = String(state.score); resultRate.textContent = `${rate.toFixed(1)}%`;
    resultCombo.textContent = String(state.maxCombo); resultOverlay.classList.remove('hidden');
  }
}

function stopPlaybackForReanalyze() {
  if (source) { try { source.stop(); } catch {} source.disconnect(); source = null; }
  for (const n of notes) {
    if (n.type === 'hold' && n.started && !n.judged) { n.judged = true; n.missed = true; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  state.playing = state.paused = false; state.activeHolds.clear(); state.pressed.clear();
  state.combo = state.maxCombo = state.score = state.judgedPerfectScore = 0;
  laneFx = [[], [], []]; laneBursts = [[], [], []];
  refreshComboDisplay(); scoreText.textContent = '0';
  judgeText.textContent = '--'; scoreRateText.textContent = '0%'; stateText.textContent = '待开始';
  if (!state.analyzing) analysisText.textContent = '';
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function analyzeCurrentTrack() {
  stopPlaybackForReanalyze(); if (!audioBuffer) return;
  state.analyzing = true; stateText.textContent = '分析中…';
  analysisText.textContent = '正在分析音频节奏，请稍候…';
  setTimeout(() => {
    const diff = difficultySelect.value, cfg = diffCfg[diff] || diffCfg.normal;
    travelMs = cfg.travelMs; judgeWindows = cfg.judge;
    const mono = buildMonoData(audioBuffer), peaks = detectPeaks(mono, audioBuffer.sampleRate);
    const built = buildChart(peaks, audioBuffer.duration, diff, mono, audioBuffer.sampleRate);
    notes = built.notes; chartEndTime = built.end; currentBeatSec = built.beat; state.totalComboScore = calculateTotalComboScore(); startBtn.disabled = !notes.length;
    const count = notes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {});
    const bpmStr = (60 / built.beat).toFixed(1);
    currentChartMeta = { difficulty: diff, bpm: bpmStr, title: audioFileInput.files?.[0]?.name?.replace(/\.[^.]+$/, '') || 'untitled' };
    analysisText.textContent = `难度: ${diff} | 曲速: ${bpmStr} BPM | 总音符: ${notes.length}\n单击: ${count.tap||0}  连击: ${count.flick||0}  长按: ${count.hold||0}\n满连理论总分: ${state.totalComboScore}`;
    stateText.textContent = '待开始'; state.analyzing = false;
  }, 50);
}

function resetRun() {
  state.combo = state.maxCombo = state.score = state.judgedPerfectScore = 0;
  state.activeHolds.clear(); state.pressed.clear(); state.paused = false;
  refreshComboDisplay(); scoreText.textContent = '0';
  judgeText.textContent = '--'; scoreRateText.textContent = '0%';
  laneFx = [[], [], []]; laneBursts = [[], [], []];
}

function updateProgress(now) {
  const ratio = audioBuffer && state.playing ? Math.max(0, Math.min(1, now / Math.max(1, chartEndTime))) : 0;
  progressFill.style.height = `${(ratio * 100).toFixed(1)}%`;
  progressText.textContent = `${Math.round(ratio * 100)}%`;
}

function frame() {
  const now = state.playing && audioCtx ? nowSec() : 0;
  drawBg();
  drawNotes(now);
  updateLogic(now);
  updateProgress(now);
  requestAnimationFrame(frame);
}

let sRafId = null;
function startSRankCanvas() {
  const sc = sRankCanvas;
  sc.width = window.innerWidth; sc.height = window.innerHeight;
  const sCtx = sc.getContext('2d');
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * sc.width, y: Math.random() * sc.height,
    vx: (Math.random() - 0.5) * 0.8, vy: -(0.4 + Math.random() * 1.2),
    r: 1 + Math.random() * 3.5, alpha: 0.2 + Math.random() * 0.6,
    hue: 30 + Math.random() * 40, twinkle: Math.random() * Math.PI * 2,
  }));
  let t = 0;
  function drawSFrame() {
    sCtx.clearRect(0, 0, sc.width, sc.height);
    const bg = sCtx.createRadialGradient(sc.width/2, sc.height/2, 0, sc.width/2, sc.height/2, Math.max(sc.width, sc.height)*0.75);
    bg.addColorStop(0, 'rgba(30,14,0,0.92)'); bg.addColorStop(0.4, 'rgba(15,7,0,0.94)'); bg.addColorStop(1, 'rgba(0,2,8,0.97)');
    sCtx.fillStyle = bg; sCtx.fillRect(0, 0, sc.width, sc.height);
    for (let i = 0; i < 6; i++) {
      const angle = (t * 0.0004 + i * Math.PI / 3) % (Math.PI * 2);
      const bx = sc.width/2 + Math.cos(angle)*20, by = sc.height/2 + Math.sin(angle)*20;
      const ex = sc.width/2 + Math.cos(angle)*sc.width, ey = sc.height/2 + Math.sin(angle)*sc.height;
      const beam = sCtx.createLinearGradient(bx, by, ex, ey);
      const alpha = 0.025 + Math.sin(t * 0.002 + i) * 0.012;
      beam.addColorStop(0, `rgba(255,180,0,${alpha*2})`); beam.addColorStop(0.3, `rgba(255,140,0,${alpha})`); beam.addColorStop(1, 'rgba(255,100,0,0)');
      sCtx.save(); sCtx.lineWidth = 50 + Math.sin(t*0.003+i)*15; sCtx.strokeStyle = beam;
      sCtx.beginPath(); sCtx.moveTo(bx, by); sCtx.lineTo(ex, ey); sCtx.stroke(); sCtx.restore();
    }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.twinkle += 0.07;
      if (p.y < -10) { p.y = sc.height + 5; p.x = Math.random() * sc.width; }
      const brightness = 0.5 + Math.sin(p.twinkle) * 0.5;
      sCtx.save(); sCtx.globalAlpha = p.alpha * brightness;
      sCtx.shadowBlur = 6; sCtx.shadowColor = `hsl(${p.hue},100%,60%)`;
      sCtx.fillStyle = `hsl(${p.hue},100%,${60 + brightness*30}%)`;
      sCtx.beginPath(); sCtx.arc(p.x, p.y, p.r*brightness, 0, Math.PI*2); sCtx.fill(); sCtx.restore();
    }
    t++; sRafId = requestAnimationFrame(drawSFrame);
  }
  if (sRafId) cancelAnimationFrame(sRafId);
  drawSFrame();
}
function stopSRankCanvas() { if (sRafId) { cancelAnimationFrame(sRafId); sRafId = null; } }

let negRafId = null;
function startNegCanvas() {
  const sc = negCanvas;
  sc.width = window.innerWidth; sc.height = window.innerHeight;
  const sCtx = sc.getContext('2d');

  const shards = Array.from({ length: 80 }, () => ({
    x: Math.random() * sc.width,
    y: Math.random() * sc.height,
    w: 4 + Math.random() * 120,
    h: 1 + Math.random() * 4,
    speed: 0.3 + Math.random() * 1.6,
    hue: 340 + Math.random() * 30,
    alpha: 0.04 + Math.random() * 0.14,
    glitchTimer: Math.random() * 60,
  }));

  const embers = Array.from({ length: 45 }, () => ({
    x: Math.random() * sc.width,
    y: sc.height + Math.random() * 200,
    vx: (Math.random() - 0.5) * 0.5,
    vy: -(0.3 + Math.random() * 0.8),
    r: 1 + Math.random() * 2.5,
    alpha: 0.15 + Math.random() * 0.4,
    twinkle: Math.random() * Math.PI * 2,
  }));

  let t = 0;
  function drawNegFrame() {
    sCtx.clearRect(0, 0, sc.width, sc.height);

    const bg = sCtx.createRadialGradient(sc.width/2, sc.height/2, 0, sc.width/2, sc.height/2, Math.max(sc.width, sc.height) * 0.8);
    bg.addColorStop(0,   'rgba(30,0,8,0.94)');
    bg.addColorStop(0.5, 'rgba(12,0,4,0.96)');
    bg.addColorStop(1,   'rgba(0,0,2,0.98)');
    sCtx.fillStyle = bg; sCtx.fillRect(0, 0, sc.width, sc.height);

    for (let i = 0; i < 8; i++) {
      const angle = (t * 0.0007 + i * Math.PI / 4) % (Math.PI * 2);
      const bx = sc.width/2 + Math.cos(angle) * 15, by = sc.height/2 + Math.sin(angle) * 15;
      const ex = sc.width/2 + Math.cos(angle) * sc.width, ey = sc.height/2 + Math.sin(angle) * sc.height;
      const beam = sCtx.createLinearGradient(bx, by, ex, ey);
      const alpha = 0.018 + Math.sin(t * 0.003 + i) * 0.009;
      beam.addColorStop(0, `rgba(255,0,60,${alpha * 2})`);
      beam.addColorStop(0.4, `rgba(180,0,40,${alpha})`);
      beam.addColorStop(1, 'rgba(100,0,20,0)');
      sCtx.save(); sCtx.lineWidth = 35 + Math.sin(t * 0.004 + i) * 10;
      sCtx.strokeStyle = beam;
      sCtx.beginPath(); sCtx.moveTo(bx, by); sCtx.lineTo(ex, ey); sCtx.stroke(); sCtx.restore();
    }

    for (const s of shards) {
      s.y += s.speed; s.glitchTimer--;
      if (s.y > sc.height + 10) { s.y = -10; s.x = Math.random() * sc.width; }
      if (s.glitchTimer <= 0) {
        s.x = Math.random() * sc.width;
        s.w = 4 + Math.random() * 140;
        s.alpha = 0.04 + Math.random() * 0.16;
        s.glitchTimer = 15 + Math.random() * 90;
      }
      sCtx.globalAlpha = s.alpha;
      sCtx.fillStyle = `hsl(${s.hue},100%,55%)`;
      sCtx.fillRect(s.x, s.y, s.w, s.h);
    }
    sCtx.globalAlpha = 1;

    for (const p of embers) {
      p.x += p.vx; p.y += p.vy; p.twinkle += 0.06;
      if (p.y < -15) { p.y = sc.height + 10; p.x = Math.random() * sc.width; }
      const br = 0.4 + Math.abs(Math.sin(p.twinkle)) * 0.6;
      sCtx.save();
      sCtx.globalAlpha = p.alpha * br;
      sCtx.shadowBlur = 8; sCtx.shadowColor = `rgba(255,40,80,0.8)`;
      sCtx.fillStyle = `hsl(${350 + Math.sin(p.twinkle) * 15},100%,${55 + br * 25}%)`;
      sCtx.beginPath(); sCtx.arc(p.x, p.y, p.r * br, 0, Math.PI * 2); sCtx.fill();
      sCtx.restore();
    }

    if (t % 120 < 3) {
      sCtx.globalAlpha = 0.04 * (3 - t % 120);
      sCtx.fillStyle = '#ff0030';
      sCtx.fillRect(0, 0, sc.width, sc.height);
      sCtx.globalAlpha = 1;
    }

    t++;
    negRafId = requestAnimationFrame(drawNegFrame);
  }
  if (negRafId) cancelAnimationFrame(negRafId);
  drawNegFrame();
}
function stopNegCanvas() { if (negRafId) { cancelAnimationFrame(negRafId); negRafId = null; } }

let currentChartMeta = {};

function saveChart() {
  if (!notes.length) { alert('没有谱面可保存，请先分析节奏。'); return; }
  const payload = {
    version: 1, meta: currentChartMeta, travelMs, judgeWindows, chartEndTime, beatSec: currentBeatSec,
    notes: notes.map(n => ({ ...n, judged: false, missed: false, started: false, firstTapAt: null, tapsDone: 0 })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
  a.download = `chart_${currentChartMeta.title || 'untitled'}_${currentChartMeta.difficulty || 'normal'}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function loadChartFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.notes || !Array.isArray(data.notes)) throw new Error('无效谱面文件');
      stopPlaybackForReanalyze();
      notes = data.notes.map(n => ({ ...n, judged: false, missed: false, started: false, firstTapAt: null, tapsDone: 0 }));
      travelMs = data.travelMs || 1820; judgeWindows = data.judgeWindows || diffCfg.normal.judge; currentBeatSec = data.beatSec || (data.meta?.bpm ? 60 / Number(data.meta.bpm) : 0.5); state.totalComboScore = calculateTotalComboScore();
      chartEndTime = data.chartEndTime || 0; currentChartMeta = data.meta || {};
      const count = notes.reduce((a, n) => ((a[n.type] = (a[n.type]||0)+1), a), {});
      analysisText.textContent = `已加载谱面: ${currentChartMeta.title||'未知'}\n难度: ${currentChartMeta.difficulty||'未知'} | BPM: ${currentChartMeta.bpm||'未知'}\n总音符: ${notes.length} | Tap/Hold/Flick = ${count.tap||0}/${count.hold||0}/${count.flick||0}\n满连理论总分: ${state.totalComboScore}`;
      stateText.textContent = '待开始'; startBtn.disabled = false;
    } catch (err) { alert('谱面文件解析失败：' + err.message); }
  };
  reader.readAsText(file);
}

analyzeBtn.addEventListener('click', analyzeCurrentTrack);
startBtn.addEventListener('click', startGame);
closeResult.addEventListener('click', () => resultOverlay.classList.add('hidden'));
saveChartBtn.addEventListener('click', saveChart);
sSaveChartBtn.addEventListener('click', saveChart);
sSealClose.addEventListener('click', () => { sRankOverlay.classList.add('hidden'); stopSRankCanvas(); });
negClose.addEventListener('click', () => { negOverlay.classList.add('hidden'); stopNegCanvas(); });
negSaveChartBtn.addEventListener('click', saveChart);
loadChartBtn.addEventListener('click', () => chartFileInput.click());
chartFileInput.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) loadChartFile(f); chartFileInput.value = ''; });
difficultySelect.addEventListener('change', () => {
  const cfg = diffCfg[difficultySelect.value] || diffCfg.normal;
  travelMs = cfg.travelMs; judgeWindows = cfg.judge;
});
audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  stopPlaybackForReanalyze();
  if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
  const pickerSpan = audioFileInput.closest('label')?.querySelector('span');
  if (pickerSpan) pickerSpan.textContent = file.name.length > 28 ? file.name.slice(0, 26) + '…' : file.name;
  audioBuffer = await fileToBuffer(file); startBtn.disabled = true; notes = [];
  analysisText.textContent = '';
  stateText.textContent = '待分析'; progressFill.style.height = '0%'; progressText.textContent = '0%';
});

window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
document.querySelectorAll('.touch-key[data-lane]').forEach(btn => {
  const lane = Number(btn.dataset.lane);
  btn.addEventListener('pointerdown', e => { e.preventDefault(); if (!state.pressed.has(['f', 'j', 'k'][lane])) handleDown(lane); });
  btn.addEventListener('pointerup',     e => { e.preventDefault(); handleUp(lane); });
  btn.addEventListener('pointercancel', e => { e.preventDefault(); handleUp(lane); });
  btn.addEventListener('pointerleave',  e => { e.preventDefault(); handleUp(lane); });
});
requestAnimationFrame(frame);
