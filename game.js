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
  easy: { keep: 0.3, holdRate: 0.06, flickRate: 0.03, chordRate: 0.02, intro: 5.6, travelMs: 2000, judge: { perfect: 95, great: 160, good: 230 }, maxGap: 2.0 },
  normal: { keep: 0.65, holdRate: 0.14, flickRate: 0.08, chordRate: 0.09, intro: 3.8, travelMs: 1750, judge: { perfect: 72, great: 122, good: 185 }, maxGap: 1.4 },
  hard: { keep: 1.0, holdRate: 0.3, flickRate: 0.22, chordRate: 0.3, intro: 2.2, travelMs: 1450, judge: { perfect: 55, great: 95, good: 145 }, maxGap: 0.9 },
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
    sparks: Array.from({ length: 10 }, (_, i) => ({ angle: (Math.PI * 2 * i) / 10, speed: 1.5 + Math.random() * 1.9 })),
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
  } catch {
    analysisText.textContent = [
      '默认音乐自动加载失败（常见于直接 file:// 打开页面的 CORS 限制）。',
      '请改为：1) 用“音频文件”手动选择 mp3；或 2) 用本地 http 服务打开页面。',
    ].join('\n');
  }
}

function evenlyFillGaps(times, maxGap, startTime, endTime) {
  const out = times.slice().sort((a, b) => a - b);
  if (!out.length) return out;
  const filled = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const prev = filled[filled.length - 1];
    const cur = out[i];
    let gap = cur - prev;
    if (gap > maxGap) {
      const steps = Math.floor(gap / maxGap);
      for (let s = 1; s <= steps; s++) {
        const t = prev + (gap / (steps + 1)) * s;
        if (t >= startTime && t <= endTime) filled.push(t);
      }
    }
    filled.push(cur);
  }
  if (endTime - filled[filled.length - 1] > maxGap) {
    filled.push(filled[filled.length - 1] + maxGap * 0.8);
  }
  return filled.filter((t) => t >= startTime && t <= endTime);
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

  const intro = cfg.intro;
  const endTime = Math.max(intro, buffer.duration - 0.8);
  const baseTimes = peaks.filter((t) => t >= intro && t <= endTime).filter(() => Math.random() <= cfg.keep);
  const times = evenlyFillGaps(baseTimes, cfg.maxGap, intro, endTime);

  const chart = [];
  times.forEach((t, ev) => {
    const section = Math.floor(ev / 12) % 4;
    const lane = section === 2 ? (ev % 2 === 0 ? 0 : 2) : ev % 3;
    const base = { id: `n${ev}`, time: t, lane, type: 'tap', judged: false, missed: false, started: false };

    if (section === 1 && Math.random() < cfg.holdRate) {
      chart.push({ ...base, type: 'hold', endTime: t + (diffKey === 'hard' ? 0.48 : 0.62) });
    } else if (section === 3 && Math.random() < cfg.flickRate) {
      // flick 需要同轨双击，避免生成跨轨导致必 miss
      chart.push({ ...base, type: 'flick', flickWindow: 0.2, tapsNeeded: 2, tapsDone: 0 });
    } else if (section === 2 && Math.random() < cfg.chordRate) {
      chart.push({ ...base, lane: 0, type: 'tap' });
      chart.push({ ...base, id: `c${ev}`, lane: 2, type: 'tap', time: t + 0.02 });
      if (diffKey === 'hard' && Math.random() < 0.28) {
        chart.push({ ...base, id: `cc${ev}`, lane: 1, type: 'tap', time: t + 0.03 });
      }
    } else {
      chart.push(base);
    }
  });

  chart.sort((a, b) => a.time - b.time);
  return { notes: chart, intro, cfg, peaks: peaks.length };
}

function analyzeCurrentTrack() {
  if (!audioBuffer) {
    analysisText.textContent = '请先加载音乐。';
    return;
  }
  updateDifficultyRuntime();
  const diff = difficultySelect.value;
  const result = analyzeBuffer(audioBuffer, diff);
  notes = result.notes;
  startBtn.disabled = !notes.length;
  modeLabel.textContent = `${modeNames[0]}（待开始）`;

  const count = notes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {});
  analysisText.textContent = [
    `难度: ${diff}`,
    `峰值: ${result.peaks}`,
    `音符: ${notes.length}`,
    `Tap/Hold/Flick = ${count.tap || 0}/${count.hold || 0}/${count.flick || 0}`,
    `前奏留白: ${result.intro.toFixed(1)}s`,
    `最大空窗(目标): ${result.cfg.maxGap}s`,
    `速度: ${result.cfg.travelMs}ms，判定窗: ${result.cfg.judge.perfect}/${result.cfg.judge.great}/${result.cfg.judge.good}ms`,
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

  notes.forEach((n) => {
    n.judged = false;
    n.missed = false;
    n.started = false;
    if (n.type === 'flick') n.tapsDone = 0;
  });

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  state.startTime = audioCtx.currentTime + 0.08;
  state.playing = true;
  source.start(state.startTime);
}

function judgeByOffsetMs(ms) {
  // 标准判定点：音符圆心与判定线中心重合 => offset=0；前后对称看绝对值
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

function miss(label, lane) {
  state.combo = 0;
  state.judged += 1;
  judgeText.textContent = label;
  laneFx[lane] = { until: performance.now() + 180, color: '#ff6b9f' };
  addLaneBurst(lane, '#ff6b9f');
  beep(220, 0.1, 'sawtooth', 0.03);
  comboText.textContent = '0';
  accuracyText.textContent = `${Math.round((state.hits / state.judged) * 100)}%`;
}

function nowSec() {
  return audioCtx.currentTime - state.startTime;
}

function firstPending(lane, rangeSec = 0.25) {
  const now = nowSec();
  return notes.find((n) => !n.judged && n.lane === lane && Math.abs(now - n.time) <= rangeSec);
}

function onTap(lane) {
  if (!state.playing) return;
  const now = nowSec();
  const target = firstPending(lane);
  if (!target) return miss('错过', lane);

  const j = judgeByOffsetMs((now - target.time) * 1000);
  if (!j) return miss('错过', lane);

  if (target.type === 'hold') {
    target.started = true;
    state.activeHolds.set(lane, target);
    registerHit({ ...j, name: `${j.name}·按住`, score: Math.round(j.score * 0.65) }, lane);
    return;
  }

  if (target.type === 'flick') {
    if (!target.firstTapAt) target.firstTapAt = now;
    if (now - target.firstTapAt > target.flickWindow) {
      target.firstTapAt = now;
      target.tapsDone = 0;
    }
    target.tapsDone += 1;
    if (target.tapsDone < target.tapsNeeded) {
      // 第一击只记预输入，不判定失败
      beep(520, 0.03, 'sine', 0.015);
      return;
    }
  }

  target.judged = true;
  registerHit(j, lane);
  state.recentTap.push({ lane, time: now });
  state.recentTap = state.recentTap.filter((r) => now - r.time < 0.3);
}

function onRelease(lane) {
  const hold = state.activeHolds.get(lane);
  if (!hold) return;
  const now = nowSec();
  hold.judged = true;
  state.activeHolds.delete(lane);
  const delta = Math.abs(now - hold.endTime) * 1000;
  if (delta <= currentJudgeWindows.great) registerHit({ name: '很好·收尾', score: 520, color: '#9fffab' }, lane);
  else miss('收尾错过', lane);
}

function onKeyDown(e) {
  const map = { f: 0, j: 1, k: 2 };
  const key = e.key.toLowerCase();
  if (!(key in map) || state.pressed.has(key)) return;
  state.pressed.add(key);
  onTap(map[key]);
}

function onKeyUp(e) {
  const map = { f: 0, j: 1, k: 2 };
  const key = e.key.toLowerCase();
  if (!(key in map)) return;
  state.pressed.delete(key);
  onRelease(map[key]);
}

function updateGameLogic(now) {
  if (!state.playing) return;
  for (const n of notes) {
    if (n.judged) continue;
    const lateStart = now > n.time + 0.26;
    if (n.type === 'hold') {
      if (!n.started && lateStart) {
        n.judged = true;
        n.missed = true;
        miss('错过', n.lane);
      } else if (n.started && now > n.endTime + 0.2) {
        n.judged = true;
        state.activeHolds.delete(n.lane);
        miss('收尾错过', n.lane);
      }
      continue;
    }
    if (n.type === 'flick') {
      if (lateStart) {
        n.judged = true;
        n.missed = true;
        miss('双击错过', n.lane);
      }
      continue;
    }
    if (lateStart) {
      n.judged = true;
      n.missed = true;
      miss('错过', n.lane);
    }
  }
  modeLabel.textContent = modeNames[Math.floor(now / 8) % 4];
  if (audioBuffer && now > audioBuffer.duration + 0.5) state.playing = false;
}

function drawLaneFx(lane, x, nowMs) {
  const active = laneFx[lane];
  if (active && nowMs < active.until) {
    const remain = (active.until - nowMs) / 180;
    const a = Math.max(1, Math.floor(remain * 90)).toString(16).padStart(2, '0');
    ctx.fillStyle = `${active.color}${a}`;
    ctx.fillRect(x - laneWidth / 2, hitY - 20, laneWidth, 38);
    ctx.strokeStyle = active.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, hitY + 3, 24 + (1 - remain) * 16, 0, Math.PI * 2);
    ctx.stroke();
  }

  laneBursts[lane] = laneBursts[lane].filter((b) => nowMs - b.born < 340);
  laneBursts[lane].forEach((burst) => {
    const t = Math.min(1, (nowMs - burst.born) / 340);
    burst.sparks.forEach((s) => {
      const d = 16 + t * 48 * s.speed;
      const sx = x + Math.cos(s.angle) * d;
      const sy = hitY + Math.sin(s.angle) * d;
      ctx.fillStyle = burst.color;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.2, 3.8 - t * 3), 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function drawBackground(now) {
  const nowMs = performance.now();
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#0d1324');
  grad.addColorStop(1, '#172d62');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < laneX.length; i++) {
    const key = i === 0 ? 'f' : i === 1 ? 'j' : 'k';
    const down = state.pressed.has(key);
    ctx.fillStyle = down ? '#335ba8cc' : '#223a6b88';
    ctx.fillRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
    ctx.strokeStyle = down ? '#95beff' : '#5d7ec9';
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

function yFor(time, now) {
  const p = 1 - ((time - now) * 1000) / currentTravelMs;
  return spawnY + p * (hitY - spawnY);
}

function drawNotes(now) {
  for (const n of notes) {
    if (n.judged && n.missed) continue;
    const y = yFor(n.time, now);
    if (y < -60 || y > canvas.height + 80) continue;
    const x = laneX[n.lane];
    const color = n.type === 'hold' ? '#89ff9f' : n.type === 'flick' ? '#ffd166' : '#73f2ff';

    if (n.type === 'hold') {
      const y2 = yFor(n.endTime, now);
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

    if (n.type === 'flick') {
      ctx.fillStyle = '#1a1d27';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('2x', x, y + 4);
    }
  }
}

function frame() {
  const now = state.playing && audioCtx ? nowSec() : 0;
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
