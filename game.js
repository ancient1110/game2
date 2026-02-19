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
const hitY = 430; // 不贴底
const spawnY = 70;
const travelMs = 1800;
const modeNames = ['切分点拍', '长线滑翔', '呼应互击', '双押重音'];

let audioCtx;
let audioBuffer;
let source;
let notes = [];
let fxFlash = null;

const difficultyCfg = {
  easy: { keep: 0.55, holdRate: 0.12, flickRate: 0.08, chordRate: 0.1, intro: 4.2 },
  normal: { keep: 0.75, holdRate: 0.18, flickRate: 0.12, chordRate: 0.15, intro: 3.4 },
  hard: { keep: 1.0, holdRate: 0.26, flickRate: 0.2, chordRate: 0.24, intro: 2.6 },
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

const judgeWindows = {
  perfect: 70,
  great: 120,
  good: 180,
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
      if (!peaks.length || t - peaks[peaks.length - 1] > 0.11) peaks.push(t);
    }
  }

  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  const median = intervals.length ? intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : 0.5;
  const bpm = Math.round(60 / Math.max(0.25, Math.min(1.1, median)));

  const intro = cfg.intro;
  const playablePeaks = peaks.filter((t) => t >= intro);

  const chart = [];
  let ev = 0;
  for (const t of playablePeaks) {
    if (Math.random() > cfg.keep) continue;
    const section = Math.floor(ev / 12) % 4;
    const lane = section === 2 ? (ev % 2 === 0 ? 0 : 2) : ev % 3;
    const base = { id: `n${ev}`, time: t, lane, type: 'tap', judged: false, missed: false, section };

    if (section === 1 && Math.random() < cfg.holdRate) {
      chart.push({ ...base, type: 'hold', endTime: t + Math.max(0.4, median * 1.8) });
    } else if (section === 3 && Math.random() < cfg.flickRate) {
      chart.push({ ...base, type: 'tap' });
      chart.push({ ...base, id: `f${ev}`, type: 'flick', lane: (lane + 1) % 3, time: t + 0.12 });
    } else if (section === 2 && Math.random() < cfg.chordRate) {
      chart.push({ ...base, lane: 0, type: 'tap' });
      chart.push({ ...base, id: `c${ev}`, lane: 2, type: 'tap', time: t + 0.02 });
    } else {
      chart.push(base);
    }
    ev++;
  }

  chart.sort((a, b) => a.time - b.time);
  return { bpm, peaks: peaks.length, intro, notes: chart };
}

function analyzeCurrentTrack() {
  if (!audioBuffer) {
    analysisText.textContent = '请先加载音乐（默认按钮或文件选择）。';
    return;
  }
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
  judgeText.textContent = '--';
  comboText.textContent = '0';
  scoreText.textContent = '0';
  accuracyText.textContent = '0%';
}

function startGame() {
  if (!audioBuffer || !notes.length) return;
  ensureCtx();
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
  if (abs <= judgeWindows.perfect) return { name: '完美', score: 1000, color: '#7cf7ff' };
  if (abs <= judgeWindows.great) return { name: '很好', score: 700, color: '#8cff9e' };
  if (abs <= judgeWindows.good) return { name: '凑合', score: 350, color: '#ffd166' };
  return null;
}

function feedback(j) {
  judgeText.textContent = j.name;
  fxFlash = { until: performance.now() + 160, color: j.color };
  beep(j.name === '完美' ? 920 : j.name === '很好' ? 760 : 620, 0.07, 'triangle', 0.04);
}

function registerHit(j) {
  state.combo += 1;
  state.score += j.score;
  state.hits += 1;
  state.judged += 1;
  feedback(j);
  comboText.textContent = String(state.combo);
  scoreText.textContent = String(state.score);
  accuracyText.textContent = `${Math.round((state.hits / state.judged) * 100)}%`;
}

function miss(label = '错过') {
  state.combo = 0;
  state.judged += 1;
  judgeText.textContent = label;
  fxFlash = { until: performance.now() + 200, color: '#ff6b9f' };
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
  const target = notes.find((n) => !n.judged && n.lane === lane && n.type !== 'hold' && Math.abs(now - n.time) <= 0.22);
  if (!target) return miss('错过');

  if (target.type === 'flick') {
    const ok = state.recentTap.some((r) => r.lane === lane && now - r.time < 0.2);
    if (!ok) return miss('双击不足');
  }

  const j = judgeByOffsetMs((now - target.time) * 1000);
  if (!j) return miss('错过');
  target.judged = true;
  target.hit = true;
  registerHit(j);
  state.recentTap.push({ lane, time: now });
  state.recentTap = state.recentTap.filter((r) => now - r.time < 0.25);
}

function onHoldStart(lane) {
  if (!state.playing) return;
  const now = currentTime();
  const hold = notes.find((n) => n.type === 'hold' && !n.judged && n.lane === lane && Math.abs(now - n.time) <= 0.2);
  if (!hold) return;
  const j = judgeByOffsetMs((now - hold.time) * 1000);
  if (!j) {
    hold.judged = true;
    hold.missed = true;
    return miss('错过');
  }
  state.activeHolds.set(lane, hold);
  registerHit({ ...j, name: `${j.name}·按住`, score: Math.round(j.score * 0.65) });
}

function onRelease(lane) {
  const hold = state.activeHolds.get(lane);
  if (!hold) return;
  const now = currentTime();
  hold.judged = true;
  state.activeHolds.delete(lane);
  const delta = Math.abs(now - hold.endTime) * 1000;
  if (delta <= 120) registerHit({ name: '很好·收尾', score: 520, color: '#9fffab' });
  else miss('收尾错过');
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
    const late = n.type === 'hold' ? now > n.time + 0.22 : now > n.time + 0.2;
    if (late) {
      n.judged = true;
      n.missed = true;
      miss('错过');
    }
  }

  state.mode = modeNames[Math.floor(now / 8) % 4];
  modeLabel.textContent = state.mode;

  if (now > audioBuffer.duration + 0.5) state.playing = false;
}

function drawBackground(now) {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#0d1324');
  grad.addColorStop(1, '#172d62');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < laneX.length; i++) {
    ctx.fillStyle = '#223a6b88';
    ctx.fillRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
    ctx.strokeStyle = '#5d7ec9';
    ctx.strokeRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
  }

  const pulse = 10 + Math.sin(now * 8) * 3;
  ctx.fillStyle = '#dff0ff';
  ctx.fillRect(150, hitY, 700, 7);
  ctx.fillStyle = '#76f1ff66';
  ctx.fillRect(150 - pulse, hitY - 10, 700 + pulse * 2, 26);
}

function yForNote(noteTime, now) {
  const p = 1 - (noteTime - now) * 1000 / travelMs;
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

function drawJudgeFlash() {
  if (!fxFlash || performance.now() > fxFlash.until) return;
  ctx.fillStyle = fxFlash.color + '22';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function frame() {
  const now = state.playing && audioCtx ? currentTime() : 0;
  drawBackground(now);
  drawNotes(now);
  drawJudgeFlash();
  updateGameLogic(now);
  requestAnimationFrame(frame);
}

analyzeBtn.addEventListener('click', analyzeCurrentTrack);
startBtn.addEventListener('click', startGame);
loadDefaultBtn.addEventListener('click', loadDefaultTrack);
audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  audioBuffer = await fileToBuffer(file);
  analysisText.textContent = `已载入：${file.name}\n点击“分析节奏”生成谱面。`;
});
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

analysisText.textContent = '先尝试“加载仓库示例音乐”。若浏览器阻止 file:// 默认加载，请手动选择 mp3 文件。';
requestAnimationFrame(frame);
