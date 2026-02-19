const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const audioFileInput = $('audioFile');
const difficultySelect = $('difficulty');
const analyzeBtn = $('analyzeBtn');
const startBtn = $('startBtn');
const comboText = $('combo');
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
const progressFill = $('progressFill');
const progressText = $('progressText');

const laneX = [250, 500, 750]; // F J K 三轨位置
const laneWidth = 170;
const hitY = 430;
const spawnY = 65;

let audioCtx, audioBuffer, source;
let notes = [];
let laneFx = [null, null, null];
let laneBursts = [[], [], []];
let travelMs = 1800;
let judgeWindows = { perfect: 72, great: 122, good: 185 };
let chartEndTime = 0;

const SCORE = { perfect: 1000, great: 700, good: 350, miss: -400 };

const diffCfg = {
  easy: { intro: 4.8, travelMs: 2100, judge: { perfect: 95, great: 165, good: 240 }, beatSnap: 0.55, holdChance: 0.2 },
  normal: { intro: 3.6, travelMs: 1820, judge: { perfect: 72, great: 122, good: 185 }, beatSnap: 0.75, holdChance: 0.26 },
  hard: { intro: 2.2, travelMs: 1550, judge: { perfect: 55, great: 95, good: 145 }, beatSnap: 0.92, holdChance: 0.34 },
};

const state = {
  playing: false,
  paused: false,
  startTime: 0,
  combo: 0,
  maxCombo: 0,
  score: 0,
  possibleScore: 0,
  pressed: new Set(),
  activeHolds: new Map(),
};

const startHint = '按 空格 开始演奏 / 演奏中按 空格 暂停';

function ensureCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function nowSec() { return audioCtx.currentTime - state.startTime; }
function rand(a, b) { return a + Math.random() * (b - a); }

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
  return audioCtx.decodeAudioData((await file.arrayBuffer()).slice(0));
}

function detectPeaks(data, sampleRate) {
  const win = 2048;
  const hop = 512;
  const env = [];
  const flux = [];

  let prev = 0;
  for (let i = 0; i < data.length - win; i += hop) {
    let e = 0;
    let d = 0;
    for (let j = 0; j < win; j++) {
      const v = data[i + j];
      e += v * v;
      if (j) d += Math.abs(v - data[i + j - 1]);
    }
    const rms = Math.sqrt(e / win);
    env.push(rms);
    flux.push(Math.max(0, d / win - prev));
    prev = d / win;
  }

  const peaks = [];
  for (let i = 4; i < env.length - 4; i++) {
    const l = Math.max(0, i - 12);
    const r = Math.min(env.length - 1, i + 12);
    let mean = 0;
    for (let k = l; k <= r; k++) mean += env[k] + flux[k] * 0.6;
    mean /= (r - l + 1);
    const score = env[i] + flux[i] * 0.8;
    if (score > mean * 1.25 && score > env[i - 1] && score > env[i + 1]) {
      const t = (i * hop) / sampleRate;
      if (!peaks.length || t - peaks[peaks.length - 1] > 0.09) peaks.push(t);
    }
  }
  return peaks;
}

function estimateBeat(peaks) {
  if (peaks.length < 4) return 0.5;
  const diffs = [];
  for (let i = 1; i < peaks.length; i++) {
    const d = peaks[i] - peaks[i - 1];
    if (d > 0.18 && d < 1.1) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  return diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0.5;
}

function pickMode(sectionIdx) {
  const modes = ['groove', 'call', 'sync', 'hold'];
  return modes[sectionIdx % modes.length];
}

function visualClearanceSec(cfgTravelMs) {
  const diameterPx = 44;
  const travelPx = hitY - spawnY;
  const speed = travelPx / (cfgTravelMs / 1000);
  return diameterPx / Math.max(1, speed);
}

function laneFreeAt(lane, t, laneNextFree, laneHolds, headGap) {
  if (t < laneNextFree[lane]) return false;
  return !laneHolds[lane].some((h) => t >= h.time - headGap && t <= h.endTime + headGap);
}

function pushLaneNote(list, note, laneNextFree, laneHolds, cfgTravelMs) {
  const lane = note.lane;
  const baseGap = visualClearanceSec(cfgTravelMs);
  const gap = note.type === 'flick' ? baseGap * 1.15 : baseGap;
  if (!laneFreeAt(lane, note.time, laneNextFree, laneHolds, gap)) return false;

  list.push(note);
  if (note.type === 'hold') {
    laneNextFree[lane] = note.endTime + baseGap * 0.6;
    laneHolds[lane].push({ time: note.time, endTime: note.endTime });
  } else {
    laneNextFree[lane] = Math.max(laneNextFree[lane], note.time + gap);
  }
  return true;
}

function localPeakDensity(peaks, t, window = 0.45) {
  let c = 0;
  for (const p of peaks) if (Math.abs(p - t) <= window) c += 1;
  return c;
}

function chooseHoldLen(beat, diffKey) {
  const r = Math.random();
  if (r < 0.2) return beat * (diffKey === 'hard' ? 1.5 : 1.75);
  if (r < 0.52) return beat * (diffKey === 'hard' ? 2.2 : 2.6);
  if (r < 0.8) return beat * (diffKey === 'hard' ? 3.1 : 3.6);
  return beat * (diffKey === 'hard' ? 4.2 : 4.8);
}

function placeHoldAccompaniment(chart, hold, laneNextFree, laneHolds, peaks, beat, diffKey, idx, cfgTravelMs) {
  const others = [0, 1, 2].filter((x) => x !== hold.lane);
  const step = Math.max(beat * (diffKey === 'hard' ? 0.62 : 0.82), 0.24);
  let t = hold.time + step;
  let c = 0;

  while (t < hold.endTime - 0.18 && c < (diffKey === 'hard' ? 5 : 3)) {
    const density = localPeakDensity(peaks, t, 0.36);
    if (density >= 2 || Math.random() < (diffKey === 'hard' ? 0.72 : 0.42)) {
      const lane = others[c % others.length];
      pushLaneNote(chart, { id: `ha${idx}_${c}`, time: t, lane, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfgTravelMs);

      if (diffKey === 'hard' && density >= 3 && Math.random() < 0.45) {
        pushLaneNote(chart, { id: `hf${idx}_${c}`, time: t + beat * 0.22, lane, type: 'flick', tapsNeeded: 2, tapsDone: 0, firstTapAt: null, flickWindow: 0.22, judged: false, missed: false }, laneNextFree, laneHolds, cfgTravelMs);
      }
    }
    t += step;
    c += 1;
  }
}

function buildChart(peaks, duration, diffKey) {
  const cfg = diffCfg[diffKey] || diffCfg.normal;
  const beat = estimateBeat(peaks);
  const intro = cfg.intro;
  const lastPeak = peaks.length ? peaks[peaks.length - 1] : duration - 5;
  const endTime = Math.min(duration - 3.8, lastPeak + 6.5);
  const safeEnd = Math.max(intro + 12, endTime);

  const timeline = [];
  for (let t = intro; t <= safeEnd; t += beat / cfg.beatSnap) timeline.push(t);

  const chart = [];
  const laneNextFree = [-1, -1, -1];
  const laneHolds = [[], [], []];

  timeline.forEach((t, i) => {
    const section = Math.floor(i / 24);
    const mode = pickMode(section);
    const strong = i % 4 === 0;

    if (mode === 'groove') {
      if (strong) pushLaneNote(chart, { id: `n${i}`, time: t, lane: 0, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
      else if (i % 2 === 0) pushLaneNote(chart, { id: `n${i}`, time: t, lane: 1, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
      else if (Math.random() < 0.26) pushLaneNote(chart, { id: `n${i}`, time: t, lane: 2, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
      return;
    }

    if (mode === 'call') {
      const lane = (Math.floor(i / 2) % 2 === 0) ? 0 : 1;
      pushLaneNote(chart, { id: `n${i}`, time: t, lane, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
      if (i % 8 === 7 && Math.random() < 0.62) {
        pushLaneNote(chart, { id: `f${i}`, time: t + beat * 0.35, lane: 2, type: 'flick', tapsNeeded: 2, tapsDone: 0, firstTapAt: null, flickWindow: 0.22, judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
      }
      return;
    }

    if (mode === 'sync') {
      if (Math.random() < (diffKey === 'hard' ? 0.88 : 0.64)) {
        pushLaneNote(chart, { id: `n${i}`, time: t, lane: i % 3, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
      }
      if (diffKey !== 'easy' && i % 6 === 0 && Math.random() < 0.54) {
        pushLaneNote(chart, { id: `c${i}`, time: t + beat * 0.25, lane: 2, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
      }
      return;
    }

    if (Math.random() < cfg.holdChance) {
      const lane = [0, 1, 2][i % 3];
      const holdLen = chooseHoldLen(beat, diffKey);
      const hold = { id: `h${i}`, time: t, lane, type: 'hold', endTime: Math.min(t + holdLen, safeEnd - 0.2), judged: false, missed: false, started: false };
      const placed = pushLaneNote(chart, hold, laneNextFree, laneHolds, cfg.travelMs);
      if (placed && diffKey !== 'easy') placeHoldAccompaniment(chart, hold, laneNextFree, laneHolds, peaks, beat, diffKey, i, cfg.travelMs);
      return;
    }

    pushLaneNote(chart, { id: `n${i}`, time: t, lane: i % 3, type: 'tap', judged: false, missed: false }, laneNextFree, laneHolds, cfg.travelMs);
  });

  chart.sort((a, b) => a.time - b.time);
  return { notes: chart, intro, beat, end: safeEnd };
}

function judgeByOffsetMs(ms) {
  const a = Math.abs(ms);
  if (a <= judgeWindows.perfect) return { key: 'perfect', name: '完美', color: '#4dff88', fx: 1.35 };
  if (a <= judgeWindows.great) return { key: 'great', name: '很好', color: '#5cb3ff', fx: 1.05 };
  if (a <= judgeWindows.good) return { key: 'good', name: '凑合', color: '#ffaf45', fx: 0.78 };
  return null;
}

function updateScoreRate() {
  const r = state.possibleScore > 0 ? (state.score / state.possibleScore) * 100 : 0;
  scoreRateText.textContent = `${Math.max(0, r).toFixed(1)}%`;
}

function addFx(lane, color, scale) {
  laneFx[lane] = { until: performance.now() + 220, color, scale };
  laneBursts[lane].push({
    born: performance.now(),
    color,
    size: scale,
    sparks: Array.from({ length: Math.round(8 + scale * 8) }, (_, i) => ({
      angle: Math.PI * 2 * i / Math.round(8 + scale * 8),
      speed: 1.3 + Math.random() * (1.5 + scale),
    })),
  });
}

function registerJudge(j, lane, possible = 1000) {
  state.possibleScore += possible;
  state.score += SCORE[j.key];
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  judgeText.textContent = j.name;
  addFx(lane, j.color, j.fx);
  beep(j.key === 'perfect' ? 960 : j.key === 'great' ? 790 : 630, 0.07, 'triangle', 0.04);
  comboText.textContent = String(state.combo);
  scoreText.textContent = String(state.score);
  updateScoreRate();
}

function registerMiss(lane, label = '错过', possible = 1000) {
  state.possibleScore += possible;
  state.score += SCORE.miss;
  state.combo = 0;
  judgeText.textContent = label;
  addFx(lane, '#ff5a6e', 0.85);
  beep(210, 0.09, 'sawtooth', 0.03);
  comboText.textContent = '0';
  scoreText.textContent = String(state.score);
  updateScoreRate();
}

function pendingNote(lane, r = 0.26) {
  const n = nowSec();
  return notes.find((x) => !x.judged && x.lane === lane && Math.abs(n - x.time) <= r);
}

function onTap(lane) {
  if (!state.playing || state.paused) return;
  const n = nowSec();
  const target = pendingNote(lane);
  if (!target) return registerMiss(lane, '空击', 0);
  const j = judgeByOffsetMs((n - target.time) * 1000);
  if (!j) return registerMiss(lane, '错过', 1000);

  if (target.type === 'hold') {
    target.started = true;
    state.activeHolds.set(lane, target);
    registerJudge({ ...j, name: `${j.name}·按住`, fx: j.fx + 0.08 }, lane);
    return;
  }

  if (target.type === 'flick') {
    if (!target.firstTapAt || n - target.firstTapAt > target.flickWindow) {
      target.firstTapAt = n;
      target.tapsDone = 0;
    }
    target.tapsDone += 1;
    if (target.tapsDone < target.tapsNeeded) {
      addFx(lane, '#5cb3ff', 0.5);
      beep(520, 0.025, 'sine', 0.015);
      return;
    }
  }

  target.judged = true;
  registerJudge(j, lane);
}

function onRelease(lane) {
  const h = state.activeHolds.get(lane);
  if (!h || h.judged) return;
  h.judged = true;
  state.activeHolds.delete(lane);
  const d = Math.abs(nowSec() - h.endTime) * 1000;
  const j = judgeByOffsetMs(d);
  if (j) registerJudge({ ...j, name: `${j.name}·收尾` }, lane);
  else registerMiss(lane, '收尾错过', 1000);
}

function startGame() {
  if (!audioBuffer || !notes.length) return;
  ensureCtx();
  if (source) source.disconnect();
  resetRun();
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
  resultOverlay.classList.add('hidden');
  source.start(state.startTime);
}

function togglePause() {
  if (!state.playing) {
    if (audioBuffer && notes.length) startGame();
    return;
  }
  state.paused = !state.paused;
  stateText.textContent = state.paused ? '暂停' : '演奏中';
  if (state.paused) audioCtx.suspend(); else audioCtx.resume();
}

function handleDown(lane) {
  const key = ['f', 'j', 'k'][lane];
  state.pressed.add(key);
  onTap(lane);
}

function handleUp(lane) {
  const key = ['f', 'j', 'k'][lane];
  state.pressed.delete(key);
  onRelease(lane);
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
  handleDown(map[key]);
}

function onKeyUp(e) {
  const map = { f: 0, j: 1, k: 2 };
  const key = e.key.toLowerCase();
  if (!(key in map)) return;
  handleUp(map[key]);
}

function updateLogic(now) {
  if (!state.playing || state.paused) return;
  for (const n of notes) {
    if (n.judged) continue;
    const late = now > n.time + 0.28;
    if (n.type === 'hold') {
      if (!n.started && late) { n.judged = true; registerMiss(n.lane, '错过', 1000); }
      else if (n.started && now > n.endTime + 0.22) { n.judged = true; state.activeHolds.delete(n.lane); registerMiss(n.lane, '收尾错过', 1000); }
      continue;
    }
    if (n.type === 'flick') { if (late) { n.judged = true; registerMiss(n.lane, '双击错过', 1000); } continue; }
    if (late) { n.judged = true; registerMiss(n.lane, '错过', 1000); }
  }
  if (now > chartEndTime + 1.0) finishRun();
}

function finishRun() {
  state.playing = false;
  if (source) {
    try { source.stop(); } catch {}
    source.disconnect();
    source = null;
  }
  stateText.textContent = '结束';
  const rate = state.possibleScore > 0 ? Math.max(0, (state.score / state.possibleScore) * 100) : 0;
  let rank = 'D', desc = 'Keep Grooving';
  if (rate >= 95) [rank, desc] = ['S', 'Rhythm Master'];
  else if (rate >= 88) [rank, desc] = ['A', 'Fantastic Flow'];
  else if (rate >= 75) [rank, desc] = ['B', 'Great Vibe'];
  else if (rate >= 60) [rank, desc] = ['C', 'Nice Try'];
  resultRank.textContent = rank;
  resultDesc.textContent = desc;
  resultScore.textContent = String(state.score);
  resultRate.textContent = `${rate.toFixed(1)}%`;
  resultCombo.textContent = String(state.maxCombo);
  resultOverlay.classList.remove('hidden');
}

function drawLaneFx(lane, x, nowMs) {
  const a = laneFx[lane];
  if (a && nowMs < a.until) {
    const r = (a.until - nowMs) / 220;
    const alpha = Math.max(10, Math.floor(r * 140)).toString(16).padStart(2, '0');
    ctx.fillStyle = `${a.color}${alpha}`;
    ctx.fillRect(x - laneWidth / 2, hitY - 22, laneWidth, 44);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 3 + a.scale * 2;
    ctx.beginPath();
    ctx.arc(x, hitY + 2, 18 + (1 - r) * (30 + a.scale * 14), 0, Math.PI * 2);
    ctx.stroke();
  }

  laneBursts[lane] = laneBursts[lane].filter((b) => nowMs - b.born < 380);
  laneBursts[lane].forEach((b) => {
    const t = Math.min(1, (nowMs - b.born) / 380);
    b.sparks.forEach((s) => {
      const d = 14 + t * 56 * s.speed * b.size;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(x + Math.cos(s.angle) * d, hitY + Math.sin(s.angle) * d, Math.max(1, 4 * b.size - t * 3.1), 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function drawBg() {
  const nowMs = performance.now();
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#0d1324');
  g.addColorStop(1, '#172d62');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 3; i++) {
    const key = i === 0 ? 'f' : i === 1 ? 'j' : 'k';
    const down = state.pressed.has(key);
    ctx.fillStyle = down ? '#335ba8cc' : '#223a6b88';
    ctx.fillRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
    ctx.strokeStyle = down ? '#95beff' : '#5d7ec9';
    ctx.strokeRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
  }

  ctx.fillStyle = '#dff0ff';
  ctx.fillRect(140, hitY, 720, 7);
  drawLaneFx(0, laneX[0], nowMs);
  drawLaneFx(1, laneX[1], nowMs);
  drawLaneFx(2, laneX[2], nowMs);

  if (!state.playing && notes.length) {
    ctx.fillStyle = '#0009';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#dff0ff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(startHint, canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '16px sans-serif';
    ctx.fillText('轨道语义：F=主拍低频 / J=主旋中频 / K=切分高频', canvas.width / 2, canvas.height / 2 + 18);
  } else if (state.paused) {
    ctx.fillStyle = '#0008';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
  }
}

function yFor(t, now) { return spawnY + (1 - ((t - now) * 1000) / travelMs) * (hitY - spawnY); }

function drawNotes(now) {
  for (const n of notes) {
    if (n.judged && n.missed) continue;
    const y = yFor(n.time, now);
    const x = laneX[n.lane];
    const color = n.type === 'hold' ? '#4dff88' : n.type === 'flick' ? '#ffaf45' : '#5cb3ff';

    if (n.type === 'hold') {
      const y2 = yFor(n.endTime, now);
      const top = Math.min(y, y2);
      const bottom = Math.max(y, y2);
      if (bottom < -80 || top > canvas.height + 90) continue;
      ctx.strokeStyle = '#58ff9c';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y2);
      ctx.stroke();
      if (y >= -70 && y <= canvas.height + 90) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }

    if (y < -70 || y > canvas.height + 90) continue;
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

function stopPlaybackForReanalyze() {
  if (source) {
    try { source.stop(); } catch {}
    source.disconnect();
    source = null;
  }
  state.playing = false;
  state.paused = false;
  state.activeHolds.clear();
  state.pressed.clear();
  laneFx = [null, null, null];
  laneBursts = [[], [], []];
  comboText.textContent = '0';
  scoreText.textContent = '0';
  judgeText.textContent = '--';
  scoreRateText.textContent = '0%';
  stateText.textContent = '待开始';
}

function analyzeCurrentTrack() {
  stopPlaybackForReanalyze();
  if (!audioBuffer) {
    analysisText.textContent = '请先加载音乐。';
    return;
  }

  const diff = difficultySelect.value;
  const cfg = diffCfg[diff] || diffCfg.normal;
  travelMs = cfg.travelMs;
  judgeWindows = cfg.judge;

  const peaks = detectPeaks(audioBuffer.getChannelData(0), audioBuffer.sampleRate);
  const built = buildChart(peaks, audioBuffer.duration, diff);
  notes = built.notes;
  chartEndTime = built.end;
  startBtn.disabled = !notes.length;

  const count = notes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {});
  const modePlan = '模式序列: Groove(主拍) → Call(呼应) → Sync(切分) → Hold(长线) 循环';
  analysisText.textContent = [
    `难度: ${diff}`,
    `检测峰值: ${peaks.length}`,
    `拍点估计: ${(built.beat || 0.5).toFixed(3)}s`,
    `谱面结束点: ${built.end.toFixed(1)}s（避免长尾空窗）`,
    `音符: ${notes.length}`,
    `Tap/Hold/Flick = ${count.tap || 0}/${count.hold || 0}/${count.flick || 0}`,
    '三轨语义: F=低频主拍 / J=中频旋律 / K=高频点缀',
    modePlan,
  ].join('\n');

  stateText.textContent = '待开始';
}

function resetRun() {
  state.combo = 0;
  state.maxCombo = 0;
  state.score = 0;
  state.possibleScore = 0;
  state.activeHolds.clear();
  state.pressed.clear();
  state.paused = false;
  comboText.textContent = '0';
  scoreText.textContent = '0';
  judgeText.textContent = '--';
  scoreRateText.textContent = '0%';
  laneFx = [null, null, null];
  laneBursts = [[], [], []];
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

analyzeBtn.addEventListener('click', analyzeCurrentTrack);
startBtn.addEventListener('click', startGame);
closeResult.addEventListener('click', () => resultOverlay.classList.add('hidden'));

difficultySelect.addEventListener('change', () => {
  const cfg = diffCfg[difficultySelect.value] || diffCfg.normal;
  travelMs = cfg.travelMs;
  judgeWindows = cfg.judge;
});

audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  audioBuffer = await fileToBuffer(file);
  startBtn.disabled = true;
  notes = [];
  analysisText.textContent = `已载入：${file.name}\n点击“分析节奏”生成谱面。`;
  stateText.textContent = '待分析';
  progressFill.style.height = '0%';
  progressText.textContent = '0%';
});

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

document.querySelectorAll('.touch-key[data-lane]').forEach((btn) => {
  const lane = Number(btn.dataset.lane);
  const down = (e) => { e.preventDefault(); if (!state.pressed.has(['f', 'j', 'k'][lane])) handleDown(lane); };
  const up = (e) => { e.preventDefault(); handleUp(lane); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
});

requestAnimationFrame(frame);
