const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const audioFileInput = document.getElementById('audioFile');
const difficultySelect = document.getElementById('difficulty');
const analyzeBtn = document.getElementById('analyzeBtn');
const startBtn = document.getElementById('startBtn');
const comboText = document.getElementById('combo');
const scoreText = document.getElementById('score');
const judgeText = document.getElementById('judge');
const scoreRateText = document.getElementById('scoreRate');
const stateText = document.getElementById('stateText');
const analysisText = document.getElementById('analysisText');

const laneX = [260, 500, 740];
const laneWidth = 160;
const hitY = 430;
const spawnY = 70;

let audioCtx;
let audioBuffer;
let source;
let notes = [];
let laneFx = [null, null, null];
let laneBursts = [[], [], []];
let currentTravelMs = 1750;
let currentJudgeWindows = { perfect: 72, great: 122, good: 185 };
let pausedAt = null;

const SCORE_VALUES = { perfect: 1000, great: 700, good: 350, miss: -400 };

const difficultyCfg = {
  easy: {
    keep: 0.28, holdRate: 0.25, flickRate: 0.04, chordRate: 0.02,
    intro: 5.6, travelMs: 2050, judge: { perfect: 95, great: 165, good: 240 }, maxGap: 1.8,
    holdLen: [0.55, 1.2],
  },
  normal: {
    keep: 0.5, holdRate: 0.34, flickRate: 0.08, chordRate: 0.06,
    intro: 4.0, travelMs: 1800, judge: { perfect: 72, great: 122, good: 185 }, maxGap: 1.35,
    holdLen: [0.45, 1.0],
  },
  hard: {
    keep: 0.68, holdRate: 0.42, flickRate: 0.15, chordRate: 0.1,
    intro: 2.4, travelMs: 1550, judge: { perfect: 55, great: 95, good: 145 }, maxGap: 0.95,
    holdLen: [0.35, 0.85],
  },
};

let state = {
  playing: false,
  paused: false,
  startTime: 0,
  combo: 0,
  score: 0,
  maxScore: 0,
  pressed: new Set(),
  activeHolds: new Map(),
  judgedCount: 0,
};

function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function nowSec() {
  return audioCtx.currentTime - state.startTime;
}

function updateDifficultyRuntime() {
  const cfg = difficultyCfg[difficultySelect.value] || difficultyCfg.normal;
  currentTravelMs = cfg.travelMs;
  currentJudgeWindows = cfg.judge;
}

function randRange(a, b) {
  return a + Math.random() * (b - a);
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

function addLaneBurst(lane, color, size = 1) {
  laneBursts[lane].push({
    born: performance.now(),
    color,
    size,
    sparks: Array.from({ length: Math.round(8 + size * 6) }, (_, i) => ({
      angle: (Math.PI * 2 * i) / Math.round(8 + size * 6),
      speed: 1.2 + Math.random() * (1.4 + size),
    })),
  });
}

async function fileToBuffer(file) {
  ensureCtx();
  const arr = await file.arrayBuffer();
  return audioCtx.decodeAudioData(arr.slice(0));
}

function evenlyFillGaps(times, maxGap, startTime, endTime) {
  const out = times.slice().sort((a, b) => a - b);
  if (!out.length) return out;
  const filled = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const prev = filled[filled.length - 1];
    const cur = out[i];
    const gap = cur - prev;
    if (gap > maxGap) {
      const steps = Math.floor(gap / maxGap);
      for (let s = 1; s <= steps; s++) {
        const t = prev + (gap / (steps + 1)) * s;
        if (t >= startTime && t <= endTime) filled.push(t);
      }
    }
    filled.push(cur);
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
    const thr = smooth[i] * 1.28;
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
    const lane = ev % 3;
    const base = { id: `n${ev}`, time: t, lane, type: 'tap', judged: false, missed: false, started: false };

    if (Math.random() < cfg.holdRate) {
      chart.push({ ...base, type: 'hold', endTime: t + randRange(cfg.holdLen[0], cfg.holdLen[1]) });
    } else if (Math.random() < cfg.flickRate) {
      chart.push({ ...base, type: 'flick', flickWindow: 0.22, tapsNeeded: 2, tapsDone: 0, firstTapAt: null });
    } else if (Math.random() < cfg.chordRate) {
      chart.push({ ...base, lane: 0, type: 'tap' });
      chart.push({ ...base, id: `c${ev}`, lane: 2, type: 'tap', time: t + 0.02 });
    } else {
      chart.push(base);
    }
  });

  chart.sort((a, b) => a.time - b.time);
  return { notes: chart, intro, cfg, peaks: peaks.length };
}

function judgeByOffsetMs(ms) {
  const abs = Math.abs(ms);
  if (abs <= currentJudgeWindows.perfect) return { key: 'perfect', name: '完美', color: '#4dff88', fx: 1.25 };
  if (abs <= currentJudgeWindows.great) return { key: 'great', name: '很好', color: '#5cb3ff', fx: 1.0 };
  if (abs <= currentJudgeWindows.good) return { key: 'good', name: '凑合', color: '#ffaf45', fx: 0.78 };
  return null;
}

function updateScoreRate() {
  const rate = state.maxScore > 0 ? (state.score / state.maxScore) * 100 : 0;
  scoreRateText.textContent = `${Math.max(0, rate).toFixed(1)}%`;
}

function registerJudge(judge, lane) {
  const pts = SCORE_VALUES[judge.key];
  state.score += pts;
  state.judgedCount += 1;
  state.combo += 1;
  judgeText.textContent = judge.name;
  laneFx[lane] = { until: performance.now() + 200, color: judge.color, scale: judge.fx };
  addLaneBurst(lane, judge.color, judge.fx);
  beep(judge.key === 'perfect' ? 950 : judge.key === 'great' ? 780 : 620, 0.07, 'triangle', 0.04);
  comboText.textContent = String(state.combo);
  scoreText.textContent = String(state.score);
  updateScoreRate();
}

function registerMiss(lane, label = '错过') {
  state.score += SCORE_VALUES.miss;
  state.judgedCount += 1;
  state.combo = 0;
  judgeText.textContent = label;
  laneFx[lane] = { until: performance.now() + 210, color: '#ff5a6e', scale: 0.9 };
  addLaneBurst(lane, '#ff5a6e', 0.85);
  beep(210, 0.09, 'sawtooth', 0.03);
  comboText.textContent = '0';
  scoreText.textContent = String(state.score);
  updateScoreRate();
}

function firstPending(lane, rangeSec = 0.26) {
  const now = nowSec();
  return notes.find((n) => !n.judged && n.lane === lane && Math.abs(now - n.time) <= rangeSec);
}

function onTap(lane) {
  if (!state.playing || state.paused) return;
  const now = nowSec();
  const target = firstPending(lane);
  if (!target) return registerMiss(lane);

  const j = judgeByOffsetMs((now - target.time) * 1000);
  if (!j) return registerMiss(lane);

  if (target.type === 'hold') {
    target.started = true;
    state.activeHolds.set(lane, target);
    registerJudge({ ...j, name: `${j.name}·按住`, key: j.key, color: j.color, fx: j.fx + 0.08 }, lane);
    return;
  }

  if (target.type === 'flick') {
    if (!target.firstTapAt || now - target.firstTapAt > target.flickWindow) {
      target.firstTapAt = now;
      target.tapsDone = 0;
    }
    target.tapsDone += 1;
    if (target.tapsDone < target.tapsNeeded) {
      laneFx[lane] = { until: performance.now() + 120, color: '#5cb3ff', scale: 0.55 };
      beep(520, 0.025, 'sine', 0.015);
      return;
    }
  }

  target.judged = true;
  registerJudge(j, lane);
}

function onRelease(lane) {
  const hold = state.activeHolds.get(lane);
  if (!hold || hold.judged) return;
  const now = nowSec();
  hold.judged = true;
  state.activeHolds.delete(lane);
  const delta = Math.abs(now - hold.endTime) * 1000;
  const j = judgeByOffsetMs(delta);
  if (j) registerJudge({ ...j, name: `${j.name}·收尾` }, lane);
  else registerMiss(lane, '收尾错过');
}

function togglePause() {
  if (!state.playing) return;
  if (!state.paused) {
    pausedAt = nowSec();
    state.paused = true;
    stateText.textContent = '暂停';
    audioCtx.suspend();
  } else {
    state.paused = false;
    stateText.textContent = '演奏中';
    audioCtx.resume();
  }
}

function onKeyDown(e) {
  const map = { f: 0, j: 1, k: 2 };
  const key = e.key.toLowerCase();
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
    return;
  }
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
  if (!state.playing || state.paused) return;

  for (const n of notes) {
    if (n.judged) continue;
    const late = now > n.time + 0.28;

    if (n.type === 'hold') {
      if (!n.started && late) {
        n.judged = true;
        n.missed = true;
        registerMiss(n.lane);
      } else if (n.started && now > n.endTime + 0.22) {
        n.judged = true;
        state.activeHolds.delete(n.lane);
        registerMiss(n.lane, '收尾错过');
      }
      continue;
    }

    if (n.type === 'flick') {
      if (late) {
        n.judged = true;
        registerMiss(n.lane, '双击错过');
      }
      continue;
    }

    if (late) {
      n.judged = true;
      registerMiss(n.lane);
    }
  }

  if (audioBuffer && now > audioBuffer.duration + 0.5) {
    state.playing = false;
    stateText.textContent = '结束';
  }
}

function drawLaneFx(lane, x, nowMs) {
  const active = laneFx[lane];
  if (active && nowMs < active.until) {
    const remain = (active.until - nowMs) / 200;
    const alpha = Math.max(16, Math.floor(remain * 150)).toString(16).padStart(2, '0');
    const glowH = 34 + active.scale * 12;
    ctx.fillStyle = `${active.color}${alpha}`;
    ctx.fillRect(x - laneWidth / 2, hitY - glowH / 2, laneWidth, glowH);

    ctx.strokeStyle = active.color;
    ctx.lineWidth = 3 + active.scale * 2;
    ctx.beginPath();
    ctx.arc(x, hitY + 3, 20 + (1 - remain) * (26 + active.scale * 12), 0, Math.PI * 2);
    ctx.stroke();
  }

  laneBursts[lane] = laneBursts[lane].filter((b) => nowMs - b.born < 360);
  laneBursts[lane].forEach((burst) => {
    const t = Math.min(1, (nowMs - burst.born) / 360);
    burst.sparks.forEach((s) => {
      const d = 16 + t * 52 * s.speed * burst.size;
      const sx = x + Math.cos(s.angle) * d;
      const sy = hitY + Math.sin(s.angle) * d;
      ctx.fillStyle = burst.color;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.1, 4.2 * burst.size - t * 3.2), 0, Math.PI * 2);
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

  if (state.paused) {
    ctx.fillStyle = '#0008';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#dff0ff';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
  }
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
    const color = n.type === 'hold' ? '#4dff88' : n.type === 'flick' ? '#ffaf45' : '#5cb3ff';

    if (n.type === 'hold') {
      const y2 = yFor(n.endTime, now);
      ctx.strokeStyle = '#58ff9c';
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

function resetRuntime() {
  state.combo = 0;
  state.score = 0;
  state.maxScore = 0;
  state.pressed.clear();
  state.activeHolds.clear();
  state.judgedCount = 0;
  state.paused = false;
  laneFx = [null, null, null];
  laneBursts = [[], [], []];
  comboText.textContent = '0';
  scoreText.textContent = '0';
  scoreRateText.textContent = '0%';
  judgeText.textContent = '--';
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

  state.maxScore = notes.reduce((sum, n) => {
    if (n.type === 'hold') return sum + SCORE_VALUES.perfect * 2;
    return sum + SCORE_VALUES.perfect;
  }, 0);

  const count = notes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {});
  analysisText.textContent = [
    `难度: ${diff}`,
    `峰值: ${result.peaks}`,
    `音符: ${notes.length}`,
    `Tap/Hold/Flick = ${count.tap || 0}/${count.hold || 0}/${count.flick || 0}`,
    `前奏留白: ${result.intro.toFixed(1)}s`,
    `最大空窗目标: ${result.cfg.maxGap}s`,
    `下落速度: ${result.cfg.travelMs}ms`,
    `判定窗(完美/很好/凑合): ${result.cfg.judge.perfect}/${result.cfg.judge.great}/${result.cfg.judge.good}ms`,
  ].join('\n');
}

function startGame() {
  if (!audioBuffer || !notes.length) return;
  ensureCtx();
  if (source) source.disconnect();
  resetRuntime();

  notes.forEach((n) => {
    n.judged = false;
    n.missed = false;
    n.started = false;
    if (n.type === 'flick') {
      n.tapsDone = 0;
      n.firstTapAt = null;
    }
  });

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  state.startTime = audioCtx.currentTime + 0.08;
  state.playing = true;
  stateText.textContent = '演奏中';
  source.start(state.startTime);
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
difficultySelect.addEventListener('change', updateDifficultyRuntime);
audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  audioBuffer = await fileToBuffer(file);
  startBtn.disabled = true;
  analysisText.textContent = `已载入：${file.name}\n点击“分析节奏”生成谱面。`;
  stateText.textContent = '待分析';
});
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

updateDifficultyRuntime();
requestAnimationFrame(frame);
