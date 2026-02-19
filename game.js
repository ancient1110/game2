const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const audioFileInput = document.getElementById('audioFile');
const loadDefaultBtn = document.getElementById('loadDefault');
const difficultySelect = document.getElementById('difficulty');
const analyzeBtn = document.getElementById('analyzeBtn');
const startBtn = document.getElementById('startBtn');
const modeLabel = document.getElementById('modeLabel');
const comboText = document.getElementById('combo');
const scoreText = document.getElementById('score');
const judgeText = document.getElementById('judge');
const accuracyText = document.getElementById('accuracy');
const analysisText = document.getElementById('analysisText');

const laneX = [260, 500, 740];
const laneWidth = 160;
const hitY = 430;
const spawnY = 70;
const modeNames = ['切分点拍', '长线滑翔', '呼应互击', '双押重音'];

let audioCtx;
let audioBuffer;
let source;
let notes = [];
let laneFx = [null, null, null];
let laneBursts = [[], [], []];
let currentTravelMs = 1750;
let currentJudgeWindows = { perfect: 70, great: 120, good: 180 };

const difficultyCfg = {
  easy: {
    keep: 0.35,
    holdRate: 0.08,
    flickRate: 0.04,
    chordRate: 0.02,
    intro: 5.4,
    travelMs: 1950,
    judge: { perfect: 90, great: 150, good: 220 },
  },
  normal: {
    keep: 0.7,
    holdRate: 0.16,
    flickRate: 0.1,
    chordRate: 0.1,
    intro: 3.6,
    travelMs: 1750,
    judge: { perfect: 70, great: 120, good: 180 },
  },
  hard: {
    keep: 1.0,
    holdRate: 0.28,
    flickRate: 0.23,
    chordRate: 0.3,
    intro: 2.2,
    travelMs: 1450,
    judge: { perfect: 55, great: 95, good: 145 },
  },
};

let state = {
  playing: false,
  startTime: 0,
  combo: 0,
  score: 0,
  hits: 0,
  judged: 0,
  pressed: new Set(),
  activeHolds: new Map(),
  recentTap: [],
  mode: '等待分析',
};

function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function beep(freq = 660, duration = 0.06, type = 'triangle', gainV = 0.04) {
  ensureCtx();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainV, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function addLaneBurst(lane, color) {
  laneBursts[lane].push({
    born: performance.now(),
    color,
    sparks: Array.from({ length: 12 }, (_, i) => ({
      angle: (Math.PI * 2 * i) / 12,
      speed: 1.8 + Math.random() * 1.8,
    })),
  });
}

function updateDifficultyRuntime() {
  const cfg = difficultyCfg[difficultySelect.value] || difficultyCfg.normal;
  currentTravelMs = cfg.travelMs;
  currentJudgeWindows = cfg.judge;
}

async function fileToBuffer(file) {
  ensureCtx();
  const arr = await file.arrayBuffer();
  return audioCtx.decodeAudioData(arr.slice(0));
}

async function loadDefaultTrack() {
  ensureCtx();
  try {
    const res = await fetch('Echoes On The Overpass-Electric Guitar.mp3');
    if (!res.ok) throw new Error('fetch failed');
    const arr = await res.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arr.slice(0));
    analysisText.textContent = '已加载示例音乐，点击“分析节奏”。';
  } catch (err) {
    analysisText.textContent = [
      '默认音乐自动加载失败（常见于直接 file:// 打开页面的浏览器 CORS 限制）。',
      '请改为：1) 用“音频文件”手动选择这首 mp3；或 2) 用本地 http 服务打开页面。',
    ].join('\n');
  }
}

function analyzeBuffer(buffer, diffKey) {
  const cfg = difficultyCfg[diffKey] || difficultyCfg.normal;
  const data = buffer.getChannelData(0);
  const win = 1024;
  const hop = 512;
  const energies = [];

  for (let i = 0; i < data.length - win; i += hop) {
    let e = 0;
    for (let j = 0; j < win; j++) e += data[i + j] * data[i + j];
    energies.push(Math.sqrt(e / win));
  }

  const smooth = energies.map((_, i) => {
    const l = Math.max(0, i - 8);
    const r = Math.min(energies.length - 1, i + 8);
    let s = 0;
    for (let k = l; k <= r; k++) s += energies[k];
    return s / (r - l + 1);
  });

  const peaks = [];
  for (let i = 2; i < energies.length - 2; i++) {
    const thr = smooth[i] * 1.3;
    if (energies[i] > thr && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
      const t = (i * hop) / buffer.sampleRate;
      if (!peaks.length || t - peaks[peaks.length - 1] > 0.1) peaks.push(t);
    }
  }

  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  const sorted = intervals.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0.5;
  const bpm = Math.round(60 / Math.max(0.25, Math.min(1.1, median)));

  const playablePeaks = peaks.filter((t) => t >= cfg.intro);

  const chart = [];
  let ev = 0;
  for (const t of playablePeaks) {
    if (Math.random() > cfg.keep) continue;
    const section = Math.floor(ev / 12) % 4;
    const lane = section === 2 ? (ev % 2 === 0 ? 0 : 2) : ev % 3;
    const base = { id: `n${ev}`, time: t, lane, type: 'tap', judged: false, missed: false, section };

    if (section === 1 && Math.random() < cfg.holdRate) {
      chart.push({ ...base, type: 'hold', endTime: t + Math.max(0.42, median * (diffKey === 'hard' ? 1.45 : 1.8)) });
    } else if (section === 3 && Math.random() < cfg.flickRate) {
      chart.push({ ...base, type: 'tap' });
      chart.push({ ...base, id: `f${ev}`, type: 'flick', lane: (lane + 1) % 3, time: t + 0.1 });
    } else if (section === 2 && Math.random() < cfg.chordRate) {
      chart.push({ ...base, lane: 0, type: 'tap' });
      chart.push({ ...base, id: `c${ev}`, lane: 2, type: 'tap', time: t + 0.02 });
      if (diffKey === 'hard' && Math.random() < 0.3) {
        chart.push({ ...base, id: `cc${ev}`, lane: 1, type: 'tap', time: t + 0.04 });
      }
    } else {
      chart.push(base);
    }
    ev++;
  }

  chart.sort((a, b) => a.time - b.time);
  return { bpm, peaks: peaks.length, intro: cfg.intro, notes: chart, cfg };
}

function analyzeCurrentTrack() {
  if (!audioBuffer) {
    analysisText.textContent = '请先加载音乐（默认按钮或文件选择）。';
    return;
  }
  updateDifficultyRuntime();
  const diff = difficultySelect.value;
  const result = analyzeBuffer(audioBuffer, diff);
  notes = result.notes;
  startBtn.disabled = notes.length === 0;
  modeLabel.textContent = `${modeNames[0]}（待开始）`;

  const count = notes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {});
  analysisText.textContent = [
    `难度：${diff}`,
    `估算 BPM：${result.bpm}`,
    `检测峰值：${result.peaks}`,
    `前奏缓冲：前 ${result.intro.toFixed(1)} 秒不放点击`,
    `下落速度：${result.cfg.travelMs}ms`,
    `判定窗（完美/很好/凑合）：${result.cfg.judge.perfect}/${result.cfg.judge.great}/${result.cfg.judge.good}ms`,
    `音符总数：${notes.length}`,
    `Tap/Hold/Flick = ${count.tap || 0}/${count.hold || 0}/${count.flick || 0}`,
  ].join('\n');
}

function resetRuntime() {
  state.combo = 0;
  state.score = 0;
  state.hits = 0;
  state.judged = 0;
  state.pressed.clear();
  state.activeHolds.clear();
  state.recentTap = [];
  laneFx = [null, null, null];
  laneBursts = [[], [], []];
  judgeText.textContent = '--';
  comboText.textContent = '0';
  scoreText.textContent = '0';
  accuracyText.textContent = '0%';
}

function startGame() {
  if (!audioBuffer || !notes.length) return;
  ensureCtx();
  updateDifficultyRuntime();
  if (source) source.disconnect();
  resetRuntime();

  for (const n of notes) {
    n.judged = false;
    n.missed = false;
    n.hit = false;
  }

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  state.startTime = audioCtx.currentTime + 0.08;
  state.playing = true;
  source.start(state.startTime);
}

function judgeByOffsetMs(ms) {
  const abs = Math.abs(ms);
  if (abs <= currentJudgeWindows.perfect) return { name: '完美', score: 1000, color: '#7cf7ff' };
  if (abs <= currentJudgeWindows.great) return { name: '很好', score: 700, color: '#8cff9e' };
  if (abs <= currentJudgeWindows.good) return { name: '凑合', score: 350, color: '#ffd166' };
  return null;
}

function feedback(j, lane) {
  judgeText.textContent = j.name;
  laneFx[lane] = { until: performance.now() + 180, color: j.color };
  addLaneBurst(lane, j.color);
  beep(j.name.startsWith('完美') ? 920 : j.name.startsWith('很好') ? 760 : 620, 0.07, 'triangle', 0.04);
}

function registerHit(j, lane) {
  state.combo += 1;
  state.score += j.score;
  state.hits += 1;
  state.judged += 1;
  feedback(j, lane);
  comboText.textContent = String(state.combo);
  scoreText.textContent = String(state.score);
  accuracyText.textContent = `${Math.round((state.hits / state.judged) * 100)}%`;
}

function miss(label = '错过', lane = 1) {
  state.combo = 0;
  state.judged += 1;
  judgeText.textContent = label;
  laneFx[lane] = { until: performance.now() + 180, color: '#ff6b9f' };
  addLaneBurst(lane, '#ff6b9f');
  beep(220, 0.1, 'sawtooth', 0.03);
  comboText.textContent = '0';
  accuracyText.textContent = `${Math.round((state.hits / state.judged) * 100)}%`;
}

function currentTime() {
  return audioCtx.currentTime - state.startTime;
}

function onTap(lane) {
  if (!state.playing) return;
  const now = currentTime();
  const target = notes.find((n) => !n.judged && n.lane === lane && n.type !== 'hold' && Math.abs(now - n.time) <= 0.24);
  if (!target) return miss('错过', lane);

  if (target.type === 'flick') {
    const ok = state.recentTap.some((r) => r.lane === lane && now - r.time < 0.22);
    if (!ok) return miss('双击不足', lane);
  }

  const j = judgeByOffsetMs((now - target.time) * 1000);
  if (!j) return miss('错过', lane);
  target.judged = true;
  target.hit = true;
  registerHit(j, lane);
  state.recentTap.push({ lane, time: now });
  state.recentTap = state.recentTap.filter((r) => now - r.time < 0.26);
}

function onHoldStart(lane) {
  if (!state.playing) return;
  const now = currentTime();
  const hold = notes.find((n) => n.type === 'hold' && !n.judged && n.lane === lane && Math.abs(now - n.time) <= 0.22);
  if (!hold) return;
  const j = judgeByOffsetMs((now - hold.time) * 1000);
  if (!j) {
    hold.judged = true;
    hold.missed = true;
    return miss('错过', lane);
  }
  state.activeHolds.set(lane, hold);
  registerHit({ ...j, name: `${j.name}·按住`, score: Math.round(j.score * 0.65) }, lane);
}

function onRelease(lane) {
  const hold = state.activeHolds.get(lane);
  if (!hold) return;
  const now = currentTime();
  hold.judged = true;
  state.activeHolds.delete(lane);
  const delta = Math.abs(now - hold.endTime) * 1000;
  if (delta <= currentJudgeWindows.great) registerHit({ name: '很好·收尾', score: 520, color: '#9fffab' }, lane);
  else miss('收尾错过', lane);
}

function onKeyDown(e) {
  const key = e.key.toLowerCase();
  const map = { f: 0, j: 1, k: 2 };
  if (!(key in map) || state.pressed.has(key)) return;
  state.pressed.add(key);
  const lane = map[key];
  onHoldStart(lane);
  onTap(lane);
}

function onKeyUp(e) {
  const key = e.key.toLowerCase();
  const map = { f: 0, j: 1, k: 2 };
  if (!(key in map)) return;
  state.pressed.delete(key);
  onRelease(map[key]);
}

function updateGameLogic(now) {
  if (!state.playing) return;

  for (const n of notes) {
    if (n.judged) continue;
    const late = n.type === 'hold' ? now > n.time + 0.26 : now > n.time + 0.24;
    if (late) {
      n.judged = true;
      n.missed = true;
      miss('错过', n.lane);
    }
  }

  state.mode = modeNames[Math.floor(now / 8) % 4];
  modeLabel.textContent = state.mode;

  if (now > audioBuffer.duration + 0.5) state.playing = false;
}

function drawLaneFx(lane, x, nowMs) {
  const active = laneFx[lane];
  if (active && nowMs < active.until) {
    const remain = (active.until - nowMs) / 180;
    ctx.fillStyle = `${active.color}${Math.max(1, Math.floor(remain * 70)).toString(16).padStart(2, '0')}`;
    ctx.fillRect(x - laneWidth / 2, hitY - 20, laneWidth, 36);

    ctx.strokeStyle = active.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, hitY + 3, 26 + (1 - remain) * 16, 0, Math.PI * 2);
    ctx.stroke();
  }

  laneBursts[lane] = laneBursts[lane].filter((b) => nowMs - b.born < 340);
  for (const burst of laneBursts[lane]) {
    const t = Math.min(1, (nowMs - burst.born) / 340);
    for (const s of burst.sparks) {
      const d = 18 + t * 54 * s.speed;
      const sx = x + Math.cos(s.angle) * d;
      const sy = hitY + Math.sin(s.angle) * d;
      ctx.fillStyle = burst.color;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.5, 4 - t * 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBackground(now) {
  const nowMs = performance.now();
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#0d1324');
  grad.addColorStop(1, '#172d62');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < laneX.length; i++) {
    const keyActive = state.pressed.has(i === 0 ? 'f' : i === 1 ? 'j' : 'k');
    ctx.fillStyle = keyActive ? '#335ba8cc' : '#223a6b88';
    ctx.fillRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
    ctx.strokeStyle = keyActive ? '#95beff' : '#5d7ec9';
    ctx.strokeRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
  }

  const pulse = 10 + Math.sin(now * 8) * 3;
  ctx.fillStyle = '#dff0ff';
  ctx.fillRect(150, hitY, 700, 7);
  ctx.fillStyle = '#76f1ff66';
  ctx.fillRect(150 - pulse, hitY - 10, 700 + pulse * 2, 26);

  drawLaneFx(0, laneX[0], nowMs);
  drawLaneFx(1, laneX[1], nowMs);
  drawLaneFx(2, laneX[2], nowMs);
}

function yForNote(noteTime, now) {
  const p = 1 - (noteTime - now) * 1000 / currentTravelMs;
  return spawnY + p * (hitY - spawnY);
}

function drawNotes(now) {
  for (const n of notes) {
    if (n.judged && n.missed) continue;
    const y = yForNote(n.time, now);
    if (y < -60 || y > canvas.height + 80) continue;
    const x = laneX[n.lane];
    const color = n.type === 'hold' ? '#89ff9f' : n.type === 'flick' ? '#ffd166' : '#73f2ff';

    if (n.type === 'hold') {
      const y2 = yForNote(n.endTime, now);
      ctx.strokeStyle = '#9dffb2';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y2);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }
}

function frame() {
  const now = state.playing && audioCtx ? currentTime() : 0;
  drawBackground(now);
  drawNotes(now);
  updateGameLogic(now);
  requestAnimationFrame(frame);
}

analyzeBtn.addEventListener('click', analyzeCurrentTrack);
startBtn.addEventListener('click', startGame);
loadDefaultBtn.addEventListener('click', loadDefaultTrack);
difficultySelect.addEventListener('change', updateDifficultyRuntime);
audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  audioBuffer = await fileToBuffer(file);
  analysisText.textContent = `已载入：${file.name}\n点击“分析节奏”生成谱面。`;
});
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

updateDifficultyRuntime();
analysisText.textContent = '先尝试“加载仓库示例音乐”。若浏览器阻止 file:// 默认加载，请手动选择 mp3 文件。';
requestAnimationFrame(frame);
