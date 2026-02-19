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
const leftStreak = $('leftStreak');
const rightStreak = $('rightStreak');
const resultOverlay = $('resultOverlay');
const resultRank = $('resultRank');
const resultDesc = $('resultDesc');
const resultScore = $('resultScore');
const resultRate = $('resultRate');
const resultCombo = $('resultCombo');
const closeResult = $('closeResult');
const pauseBtn = $('pauseBtn');

const laneX = [250, 500, 750];
const laneWidth = 170;
const hitY = 430;
const spawnY = 60;

let audioCtx, audioBuffer, source;
let notes = [];
let laneFx = [null, null, null];
let laneBursts = [[], [], []];
let travelMs = 1750;
let judgeWindows = { perfect: 72, great: 122, good: 185 };
let streakState = 0;
let streakUntil = 0;

const SCORE = { perfect: 1000, great: 700, good: 350, miss: -400 };

const diffCfg = {
  easy: { keep: 0.3, holdRate: 0.34, flickRate: 0.03, chordRate: 0.01, intro: 5.6, travelMs: 2100, judge: { perfect: 95, great: 165, good: 240 }, maxGap: 1.7, holdLen: [1.6, 3.6] },
  normal: { keep: 0.52, holdRate: 0.4, flickRate: 0.07, chordRate: 0.05, intro: 4.0, travelMs: 1850, judge: { perfect: 72, great: 122, good: 185 }, maxGap: 1.3, holdLen: [1.4, 3.2] },
  hard: { keep: 0.68, holdRate: 0.46, flickRate: 0.13, chordRate: 0.09, intro: 2.6, travelMs: 1600, judge: { perfect: 55, great: 95, good: 145 }, maxGap: 0.95, holdLen: [1.2, 2.8] },
};

const state = {
  playing: false,
  paused: false,
  startTime: 0,
  combo: 0,
  maxCombo: 0,
  score: 0,
  maxScore: 0,
  pressed: new Set(),
  activeHolds: new Map(),
};

function ensureCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function nowSec() { return audioCtx.currentTime - state.startTime; }
function rand(a, b) { return a + Math.random() * (b - a); }

function setStreak(kind) {
  streakState = kind;
  streakUntil = performance.now() + 900;
  const color = kind === 2 ? '#4dff88' : kind === 1 ? '#5cb3ff' : kind === -1 ? '#ff5a6e' : '#ffaf45';
  [leftStreak, rightStreak].forEach((el) => {
    el.classList.add('hot');
    el.style.setProperty('--streak-color', color);
    el.style.background = `linear-gradient(180deg, ${color}55, #131a30)`;
  });
}

function clearStreakIfNeeded() {
  if (performance.now() < streakUntil) return;
  [leftStreak, rightStreak].forEach((el) => {
    el.classList.remove('hot');
    el.style.background = 'linear-gradient(180deg, #141f3a, #131a30)';
  });
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
  osc.start(now); osc.stop(now + duration);
}

async function fileToBuffer(file) { ensureCtx(); return audioCtx.decodeAudioData((await file.arrayBuffer()).slice(0)); }

function fillGaps(times, maxGap, start, end) {
  const s = times.slice().sort((a, b) => a - b);
  if (!s.length) return s;
  const out = [s[0]];
  for (let i = 1; i < s.length; i++) {
    const p = out[out.length - 1]; const c = s[i]; const g = c - p;
    if (g > maxGap) {
      const steps = Math.floor(g / maxGap);
      for (let n = 1; n <= steps; n++) out.push(p + (g / (steps + 1)) * n);
    }
    out.push(c);
  }
  return out.filter((t) => t >= start && t <= end);
}

function analyzeBuffer(buffer, diffKey) {
  const cfg = diffCfg[diffKey] || diffCfg.normal;
  const d = buffer.getChannelData(0);
  const win = 1024, hop = 512, energies = [];
  for (let i = 0; i < d.length - win; i += hop) {
    let e = 0; for (let j = 0; j < win; j++) e += d[i + j] * d[i + j]; energies.push(Math.sqrt(e / win));
  }
  const smooth = energies.map((_, i) => {
    const l = Math.max(0, i - 8), r = Math.min(energies.length - 1, i + 8);
    let s = 0; for (let k = l; k <= r; k++) s += energies[k]; return s / (r - l + 1);
  });
  const peaks = [];
  for (let i = 2; i < energies.length - 2; i++) {
    if (energies[i] > smooth[i] * 1.28 && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
      const t = (i * hop) / buffer.sampleRate;
      if (!peaks.length || t - peaks[peaks.length - 1] > 0.1) peaks.push(t);
    }
  }
  const intro = cfg.intro, end = Math.max(intro, buffer.duration - 0.8);
  const kept = peaks.filter((t) => t >= intro && t <= end).filter(() => Math.random() < cfg.keep);
  const times = fillGaps(kept, cfg.maxGap, intro, end);

  const chart = [];
  times.forEach((t, i) => {
    const lane = i % 3;
    const base = { id: `n${i}`, time: t, lane, type: 'tap', judged: false, missed: false, started: false };
    if (Math.random() < cfg.holdRate) chart.push({ ...base, type: 'hold', endTime: t + rand(cfg.holdLen[0], cfg.holdLen[1]) });
    else if (Math.random() < cfg.flickRate) chart.push({ ...base, type: 'flick', tapsNeeded: 2, tapsDone: 0, firstTapAt: null, flickWindow: 0.22 });
    else if (Math.random() < cfg.chordRate) { chart.push({ ...base, lane: 0 }); chart.push({ ...base, id: `c${i}`, lane: 2, time: t + 0.02 }); }
    else chart.push(base);
  });
  chart.sort((a, b) => a.time - b.time);
  return { cfg, notes: chart, peaks: peaks.length, intro };
}

function judgeByOffsetMs(ms) {
  const a = Math.abs(ms);
  if (a <= judgeWindows.perfect) return { key: 'perfect', name: '完美', color: '#4dff88', fx: 1.35 };
  if (a <= judgeWindows.great) return { key: 'great', name: '很好', color: '#5cb3ff', fx: 1.05 };
  if (a <= judgeWindows.good) return { key: 'good', name: '凑合', color: '#ffaf45', fx: 0.78 };
  return null;
}

function updateScoreRate() {
  const r = state.maxScore > 0 ? (state.score / state.maxScore) * 100 : 0;
  scoreRateText.textContent = `${Math.max(0, r).toFixed(1)}%`;
}

function addFx(lane, color, scale) {
  laneFx[lane] = { until: performance.now() + 220, color, scale };
  laneBursts[lane].push({ born: performance.now(), color, size: scale, sparks: Array.from({ length: Math.round(8 + scale * 8) }, (_, i) => ({ angle: Math.PI * 2 * i / Math.round(8 + scale * 8), speed: 1.3 + Math.random() * (1.5 + scale) })) });
}

function registerJudge(j, lane) {
  state.score += SCORE[j.key];
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  judgeText.textContent = j.name;
  addFx(lane, j.color, j.fx);
  setStreak(j.key === 'perfect' ? 2 : 1);
  beep(j.key === 'perfect' ? 960 : j.key === 'great' ? 790 : 630, 0.07, 'triangle', 0.04);
  comboText.textContent = String(state.combo);
  scoreText.textContent = String(state.score);
  updateScoreRate();
}

function registerMiss(lane, label = '错过') {
  state.score += SCORE.miss;
  state.combo = 0;
  judgeText.textContent = label;
  addFx(lane, '#ff5a6e', 0.85);
  setStreak(-1);
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
  if (!target) return registerMiss(lane);
  const j = judgeByOffsetMs((n - target.time) * 1000);
  if (!j) return registerMiss(lane);

  if (target.type === 'hold') {
    target.started = true;
    state.activeHolds.set(lane, target);
    registerJudge({ ...j, name: `${j.name}·按住`, fx: j.fx + 0.08 }, lane);
    return;
  }
  if (target.type === 'flick') {
    if (!target.firstTapAt || n - target.firstTapAt > target.flickWindow) { target.firstTapAt = n; target.tapsDone = 0; }
    target.tapsDone += 1;
    if (target.tapsDone < target.tapsNeeded) { addFx(lane, '#5cb3ff', 0.5); beep(520, 0.025, 'sine', 0.015); return; }
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
  else registerMiss(lane, '收尾错过');
}

function togglePause() {
  if (!state.playing) return;
  state.paused = !state.paused;
  stateText.textContent = state.paused ? '暂停' : '演奏中';
  if (state.paused) audioCtx.suspend(); else audioCtx.resume();
}

function handleDown(lane) {
  const key = ['f','j','k'][lane];
  state.pressed.add(key); onTap(lane);
}
function handleUp(lane) {
  const key = ['f','j','k'][lane];
  state.pressed.delete(key); onRelease(lane);
}

function onKeyDown(e) {
  const map = { f:0, j:1, k:2 };
  const key = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
  if (!(key in map) || state.pressed.has(key)) return;
  handleDown(map[key]);
}
function onKeyUp(e) {
  const map = { f:0, j:1, k:2 };
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
      if (!n.started && late) { n.judged = true; registerMiss(n.lane); }
      else if (n.started && now > n.endTime + 0.22) { n.judged = true; state.activeHolds.delete(n.lane); registerMiss(n.lane, '收尾错过'); }
      continue;
    }
    if (n.type === 'flick') { if (late) { n.judged = true; registerMiss(n.lane, '双击错过'); } continue; }
    if (late) { n.judged = true; registerMiss(n.lane); }
  }
  if (audioBuffer && now > audioBuffer.duration + 0.5) finishRun();
}

function finishRun() {
  state.playing = false;
  stateText.textContent = '结束';
  const rate = state.maxScore > 0 ? Math.max(0, (state.score / state.maxScore) * 100) : 0;
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
    const alpha = Math.max(10, Math.floor(r * 140)).toString(16).padStart(2,'0');
    ctx.fillStyle = `${a.color}${alpha}`;
    ctx.fillRect(x - laneWidth / 2, hitY - 22, laneWidth, 44);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 3 + a.scale * 2;
    ctx.beginPath();
    ctx.arc(x, hitY + 2, 18 + (1-r)*(30 + a.scale*14), 0, Math.PI * 2);
    ctx.stroke();
  }
  laneBursts[lane] = laneBursts[lane].filter((b) => nowMs - b.born < 380);
  laneBursts[lane].forEach((b) => {
    const t = Math.min(1, (nowMs - b.born) / 380);
    b.sparks.forEach((s) => {
      const d = 14 + t * 56 * s.speed * b.size;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(x + Math.cos(s.angle)*d, hitY + Math.sin(s.angle)*d, Math.max(1, 4*b.size - t*3.1), 0, Math.PI*2);
      ctx.fill();
    });
  });
}

function drawBg(now) {
  const nowMs = performance.now();
  const g = ctx.createLinearGradient(0,0,0,canvas.height);
  g.addColorStop(0,'#0d1324'); g.addColorStop(1,'#172d62');
  ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);
  for (let i=0;i<3;i++) {
    const key = i===0?'f':i===1?'j':'k';
    const down = state.pressed.has(key);
    ctx.fillStyle = down ? '#335ba8cc' : '#223a6b88';
    ctx.fillRect(laneX[i]-laneWidth/2,0,laneWidth,canvas.height);
    ctx.strokeStyle = down ? '#95beff' : '#5d7ec9';
    ctx.strokeRect(laneX[i]-laneWidth/2,0,laneWidth,canvas.height);
  }
  ctx.fillStyle = '#dff0ff'; ctx.fillRect(140, hitY, 720, 7);
  drawLaneFx(0, laneX[0], nowMs); drawLaneFx(1, laneX[1], nowMs); drawLaneFx(2, laneX[2], nowMs);
  if (state.paused) { ctx.fillStyle = '#0008'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#fff'; ctx.font='bold 42px sans-serif'; ctx.textAlign='center'; ctx.fillText('PAUSED', 500, 270); }
}

function yFor(t, now) { return spawnY + (1 - ((t-now)*1000)/travelMs) * (hitY - spawnY); }
function drawNotes(now) {
  for (const n of notes) {
    if (n.judged && n.missed) continue;
    const y = yFor(n.time, now); if (y < -70 || y > canvas.height + 90) continue;
    const x = laneX[n.lane];
    const color = n.type === 'hold' ? '#4dff88' : n.type === 'flick' ? '#ffaf45' : '#5cb3ff';
    if (n.type === 'hold') {
      const y2 = yFor(n.endTime, now);
      ctx.strokeStyle = '#58ff9c'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y2); ctx.stroke();
    }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI*2); ctx.fill();
    if (n.type === 'flick') { ctx.fillStyle='#1a1d27'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center'; ctx.fillText('2x',x,y+4); }
  }
}

function analyzeCurrentTrack() {
  if (!audioBuffer) return (analysisText.textContent = '请先加载音乐。');
  const diff = difficultySelect.value;
  const result = analyzeBuffer(audioBuffer, diff);
  notes = result.notes;
  startBtn.disabled = !notes.length;
  travelMs = result.cfg.travelMs;
  judgeWindows = result.cfg.judge;
  state.maxScore = notes.reduce((s,n)=> s + (n.type === 'hold' ? SCORE.perfect * 2 : SCORE.perfect), 0);
  const count = notes.reduce((a,n)=>((a[n.type]=(a[n.type]||0)+1),a),{});
  analysisText.textContent = `难度: ${diff}\n峰值: ${result.peaks}\n音符: ${notes.length}\nTap/Hold/Flick = ${count.tap||0}/${count.hold||0}/${count.flick||0}\n前奏: ${result.intro.toFixed(1)}s\n长按时长: ${result.cfg.holdLen[0]}-${result.cfg.holdLen[1]}s`;
}

function resetRun() {
  state.combo = 0; state.maxCombo = 0; state.score = 0;
  state.activeHolds.clear(); state.pressed.clear(); state.paused = false;
  comboText.textContent = '0'; scoreText.textContent = '0'; judgeText.textContent = '--'; scoreRateText.textContent = '0%';
  laneFx = [null,null,null]; laneBursts=[[],[],[]];
}

function startGame() {
  if (!audioBuffer || !notes.length) return;
  ensureCtx();
  if (source) source.disconnect();
  resetRun();
  notes.forEach((n)=>{ n.judged=false; n.missed=false; n.started=false; if(n.type==='flick'){n.tapsDone=0;n.firstTapAt=null;} });
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  state.startTime = audioCtx.currentTime + 0.08;
  state.playing = true;
  stateText.textContent = '演奏中';
  resultOverlay.classList.add('hidden');
  source.start(state.startTime);
}

function frame() {
  const now = state.playing && audioCtx ? nowSec() : 0;
  clearStreakIfNeeded();
  drawBg(now); drawNotes(now); updateLogic(now);
  requestAnimationFrame(frame);
}

analyzeBtn.addEventListener('click', analyzeCurrentTrack);
startBtn.addEventListener('click', startGame);
closeResult.addEventListener('click', () => resultOverlay.classList.add('hidden'));
pauseBtn.addEventListener('click', togglePause);
difficultySelect.addEventListener('change', () => {
  const cfg = diffCfg[difficultySelect.value] || diffCfg.normal;
  travelMs = cfg.travelMs; judgeWindows = cfg.judge;
});
audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  audioBuffer = await fileToBuffer(file);
  startBtn.disabled = true;
  analysisText.textContent = `已载入：${file.name}\n点击“分析节奏”生成谱面。`;
  stateText.textContent = '待分析';
});
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

document.querySelectorAll('.touch-key[data-lane]').forEach((btn) => {
  const lane = Number(btn.dataset.lane);
  const down = (e) => { e.preventDefault(); handleDown(lane); };
  const up = (e) => { e.preventDefault(); handleUp(lane); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
});

requestAnimationFrame(frame);
