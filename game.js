const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const audioFileInput = document.getElementById('audioFile');
const loadDefaultBtn = document.getElementById('loadDefault');
const analyzeBtn = document.getElementById('analyzeBtn');
const startBtn = document.getElementById('startBtn');
const modeLabel = document.getElementById('modeLabel');
const comboText = document.getElementById('combo');
const scoreText = document.getElementById('score');
const judgeText = document.getElementById('judge');
const accuracyText = document.getElementById('accuracy');
const analysisText = document.getElementById('analysisText');

const hitY = 490;
const laneX = [260, 500, 740];
const laneWidth = 160;
const travelMs = 1800;

let audioCtx;
let audioBuffer;
let source;
let notes = [];
let state = {
  startTime: 0,
  playing: false,
  combo: 0,
  score: 0,
  hits: 0,
  judged: 0,
  pressed: new Set(),
  activeHolds: new Map(),
  recentTap: [],
  mode: '等待分析',
};

const modeNames = ['切分点拍', '长线滑翔', '呼应互击', '双押重音'];

function ensureAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

async function fileToBuffer(file) {
  ensureAudioContext();
  const arr = await file.arrayBuffer();
  return audioCtx.decodeAudioData(arr.slice(0));
}

async function loadDefaultTrack() {
  const res = await fetch('Echoes On The Overpass-Electric Guitar.mp3');
  const arr = await res.arrayBuffer();
  ensureAudioContext();
  audioBuffer = await audioCtx.decodeAudioData(arr.slice(0));
  analysisText.textContent = '已加载默认曲目，点击“分析节奏”。';
}

function analyzeBuffer(buffer) {
  const data = buffer.getChannelData(0);
  const win = 1024;
  const hop = 512;
  const energies = [];

  for (let i = 0; i < data.length - win; i += hop) {
    let e = 0;
    for (let j = 0; j < win; j++) {
      const v = data[i + j];
      e += v * v;
    }
    energies.push(Math.sqrt(e / win));
  }

  const smooth = energies.map((v, i) => {
    const left = Math.max(0, i - 8);
    const right = Math.min(energies.length - 1, i + 8);
    let sum = 0;
    for (let k = left; k <= right; k++) sum += energies[k];
    return sum / (right - left + 1);
  });

  const peaks = [];
  for (let i = 2; i < energies.length - 2; i++) {
    const localThr = smooth[i] * 1.32;
    if (energies[i] > localThr && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
      const time = (i * hop) / buffer.sampleRate;
      if (!peaks.length || time - peaks[peaks.length - 1] > 0.13) peaks.push(time);
    }
  }

  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  const median = intervals.length ? intervals.slice().sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : 0.5;
  const bpm = Math.round(60 / Math.max(0.2, Math.min(1.2, median)));

  const generated = [];
  peaks.forEach((t, i) => {
    const section = Math.floor(i / 10) % 4;
    const lane = section === 2 ? (i % 2 === 0 ? 0 : 2) : i % 3;
    const base = {
      id: `n${i}`,
      time: t,
      lane,
      hit: false,
      missed: false,
      judged: false,
      section,
    };

    if (section === 1 && i % 4 === 0) {
      generated.push({ ...base, type: 'hold', endTime: t + Math.max(0.35, median * 1.5), tailDone: false });
    } else if (section === 3 && i % 3 === 0) {
      generated.push({ ...base, type: 'tap' });
      generated.push({ ...base, id: `nf${i}`, type: 'flick', time: t + 0.14, lane: (lane + 1) % 3 });
    } else if (section === 2 && i % 5 === 0) {
      generated.push({ ...base, type: 'tap', lane: 0 });
      generated.push({ ...base, id: `n2${i}`, type: 'tap', lane: 2, time: t + 0.03 });
    } else {
      generated.push({ ...base, type: 'tap' });
    }
  });

  generated.sort((a, b) => a.time - b.time);
  return { bpm, peaks: peaks.length, notes: generated };
}

function analyzeCurrentTrack() {
  if (!audioBuffer) {
    analysisText.textContent = '请先选择音频或加载默认曲目。';
    return;
  }
  const result = analyzeBuffer(audioBuffer);
  notes = result.notes;
  startBtn.disabled = notes.length === 0;
  state.mode = modeNames[0];
  modeLabel.textContent = `${state.mode}（待开始）`;

  const countByType = notes.reduce((acc, n) => ((acc[n.type] = (acc[n.type] || 0) + 1), acc), {});
  analysisText.textContent = [
    `估算 BPM: ${result.bpm}`,
    `检测到重音峰值: ${result.peaks}`,
    `生成音符总数: ${notes.length}`,
    `Tap/Hold/Flick = ${countByType.tap || 0}/${countByType.hold || 0}/${countByType.flick || 0}`,
    `玩法切换：每 10 个事件切换一次模式（${modeNames.join(' → ')}）`,
  ].join('\n');
}

function resetState() {
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
  if (source) source.disconnect();
  ensureAudioContext();
  resetState();

  notes.forEach((n) => {
    n.hit = false;
    n.missed = false;
    n.judged = false;
    if (n.type === 'hold') n.tailDone = false;
  });

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  state.startTime = audioCtx.currentTime + 0.06;
  state.playing = true;
  source.start(state.startTime);
}

function judgeOffset(ms) {
  const abs = Math.abs(ms);
  if (abs <= 45) return { text: 'Perfect', score: 1000, combo: true };
  if (abs <= 95) return { text: 'Great', score: 600, combo: true };
  if (abs <= 140) return { text: 'Good', score: 300, combo: true };
  return null;
}

function onTap(lane) {
  if (!state.playing) return;
  const now = audioCtx.currentTime - state.startTime;
  const candidate = notes.find(
    (n) => !n.judged && n.lane === lane && now >= n.time - 0.2 && now <= n.time + 0.2 && n.type !== 'hold'
  );

  if (!candidate) {
    miss('Miss');
    return;
  }

  if (candidate.type === 'flick') {
    const last = state.recentTap.find((r) => r.lane === lane && now - r.time < 0.19);
    if (!last) {
      miss('Need Double');
      return;
    }
  }

  const result = judgeOffset((now - candidate.time) * 1000);
  if (!result) {
    miss('Late/Early');
    return;
  }

  candidate.hit = true;
  candidate.judged = true;
  registerHit(result);
  state.recentTap.push({ lane, time: now });
  state.recentTap = state.recentTap.filter((r) => now - r.time < 0.25);
}

function onHoldStart(lane) {
  if (!state.playing) return;
  const now = audioCtx.currentTime - state.startTime;
  const hold = notes.find(
    (n) => n.type === 'hold' && !n.judged && n.lane === lane && now >= n.time - 0.16 && now <= n.time + 0.16
  );
  if (!hold) return;

  const result = judgeOffset((now - hold.time) * 1000);
  if (!result) {
    miss('Hold Miss');
    hold.judged = true;
    hold.missed = true;
    return;
  }
  hold.hit = true;
  state.activeHolds.set(lane, hold);
  registerHit({ ...result, score: Math.round(result.score * 0.6), text: `${result.text} Hold` });
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
  const lane = map[key];
  const hold = state.activeHolds.get(lane);
  if (!hold) return;

  const now = audioCtx.currentTime - state.startTime;
  const delta = Math.abs(now - hold.endTime);
  hold.judged = true;
  hold.tailDone = true;
  state.activeHolds.delete(lane);

  if (delta <= 0.14) registerHit({ text: 'Release OK', score: 500, combo: true });
  else miss('Bad Release');
}

function registerHit(result) {
  state.combo += result.combo ? 1 : 0;
  state.score += result.score;
  state.hits += 1;
  state.judged += 1;
  judgeText.textContent = result.text;
  comboText.textContent = String(state.combo);
  scoreText.textContent = String(state.score);
  accuracyText.textContent = `${Math.round((state.hits / state.judged) * 100)}%`;
}

function miss(label) {
  state.combo = 0;
  state.judged += 1;
  judgeText.textContent = label;
  comboText.textContent = '0';
  accuracyText.textContent = `${Math.round((state.hits / state.judged) * 100)}%`;
}

function updateJudge() {
  if (!state.playing) return;
  const now = audioCtx.currentTime - state.startTime;
  for (const n of notes) {
    if (n.judged) continue;
    const tooLate = n.type === 'hold' ? now > n.time + 0.19 : now > n.time + 0.17;
    if (tooLate) {
      n.judged = true;
      n.missed = true;
      miss('Miss');
    }
  }

  const sec = Math.floor((now * 2) / 5);
  state.mode = modeNames[((sec % 4) + 4) % 4];
  modeLabel.textContent = state.mode;

  if (now > audioBuffer.duration + 0.5) state.playing = false;
}

function drawBackground(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#0d1324');
  grad.addColorStop(1, '#162b5a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < laneX.length; i++) {
    ctx.fillStyle = '#20345f88';
    ctx.fillRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
    ctx.strokeStyle = '#5b79c2';
    ctx.strokeRect(laneX[i] - laneWidth / 2, 0, laneWidth, canvas.height);
  }

  ctx.fillStyle = '#d9ebff';
  ctx.fillRect(150, hitY, 700, 6);

  const pulse = 8 + Math.sin(now * 7) * 4;
  ctx.fillStyle = '#7cf7ff66';
  ctx.fillRect(150 - pulse, hitY - 8, 700 + pulse * 2, 22);
}

function drawNotes(now) {
  notes.forEach((n) => {
    if (n.judged && n.missed) return;
    const dt = n.time - now;
    const y = hitY - ((travelMs - dt * 1000) / travelMs) * 440;
    if (y < -80 || y > canvas.height + 80) return;

    const x = laneX[n.lane];
    const color = n.type === 'hold' ? '#7fff9f' : n.type === 'flick' ? '#ffd166' : '#73f2ff';

    if (n.type === 'hold') {
      const endY = hitY - ((travelMs - (n.endTime - now) * 1000) / travelMs) * 440;
      ctx.strokeStyle = '#8ef5a3';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#00131f';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(n.type.toUpperCase(), x, y + 4);
  });
}

function frame() {
  const now = state.playing ? audioCtx.currentTime - state.startTime : 0;
  drawBackground(now);
  drawNotes(now);
  updateJudge();
  requestAnimationFrame(frame);
}

analyzeBtn.addEventListener('click', analyzeCurrentTrack);
startBtn.addEventListener('click', startGame);
loadDefaultBtn.addEventListener('click', async () => {
  await loadDefaultTrack();
});

audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  audioBuffer = await fileToBuffer(file);
  analysisText.textContent = `已载入：${file.name}\n点击“分析节奏”生成谱面。`;
});

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

requestAnimationFrame(frame);
analysisText.textContent = '点击“加载仓库里的示例音乐”，然后“分析节奏”。';
