import { FirstPersonCoach } from "./coach3d.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const shuffle = values => {
  const copy = values.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const LOCAL_DATA_ROOT = "_research/jiakao-baodian-dump/";
const REMOTE_DATA_ROOT = "https://raw.githubusercontent.com/china794/jiakao-baodian-dump/dcd46966537b220e971022d6f926c7229adb64a5/";
const DATA_ROOT = REMOTE_DATA_ROOT;
const BANK_URL = `${DATA_ROOT}data/bank.json`;
const MEDIA_URL = `${DATA_ROOT}data/media_map.json`;
const GRAPH_URL = "data/knowledge_graph.json";
const MEDIA_ROOT = DATA_ROOT;
const LETTERS = "ABCDEFGH".split("");
const STORAGE_KEY = "jiakao-system-v2";

let bank = [];
let mediaMap = {};
let graph = null;
let questionIndex = new Map();
let currentRoute = "home";
let recordTab = "wrong";
let coach = null;
let coachSignalTimer = 0;
let ruleRoadType = "ordinary";

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function defaultLearning() {
  return {
    sequenceIndex: 0,
    wrong: [],
    favorite: [],
    answered: {},
    exams: [],
    totalAnswered: 0,
    totalCorrect: 0,
    bestStreak: 0,
    today: { date: todayKey(), answered: 0, correct: 0, streak: 0 }
  };
}

function loadLearning() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed) return defaultLearning();
    const merged = Object.assign(defaultLearning(), parsed);
    if (!merged.today || merged.today.date !== todayKey()) merged.today = { date: todayKey(), answered: 0, correct: 0, streak: 0 };
    merged.wrong = Array.from(new Set((merged.wrong || []).map(String)));
    merged.favorite = Array.from(new Set((merged.favorite || []).map(String)));
    return merged;
  } catch {
    return defaultLearning();
  }
}

let learning = loadLearning();

function saveLearning() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(learning));
}

const session = {
  mode: "sequence",
  title: "顺序练习",
  queue: [],
  index: 0,
  selected: new Set(),
  locked: false,
  results: new Map(),
  answered: 0,
  correct: 0,
  timer: 0,
  examEndAt: 0
};

function questionOptions(question) {
  return LETTERS.map(letter => question[`option${letter}`]).filter(Boolean);
}

function answerIndexes(question) {
  return questionOptions(question).map((_, index) => index).filter(index => Number(question.answer) & (16 << index));
}

function questionType(question) {
  if (question.optionType === 2) return "多选题";
  if (question.optionType === 0) return "判断题";
  return "单选题";
}

function findQuestion(id) {
  return questionIndex.get(String(id));
}

function stripHtml(value) {
  const element = document.createElement("div");
  element.innerHTML = value || "";
  return element.textContent || "";
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("is-visible"), 1800);
}

class SoundEngine {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.engine = null;
  }
  ensure() {
    if (!this.enabled) return null;
    if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }
  tone(frequency = 440, duration = .08, type = "sine", gain = .03, delay = 0) {
    const context = this.ensure();
    if (!context) return;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + delay);
    volume.gain.setValueAtTime(.0001, context.currentTime + delay);
    volume.gain.exponentialRampToValueAtTime(gain, context.currentTime + delay + .01);
    volume.gain.exponentialRampToValueAtTime(.0001, context.currentTime + delay + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(context.currentTime + delay);
    oscillator.stop(context.currentTime + delay + duration + .03);
  }
  correct() { this.tone(560, .08, "sine", .04); this.tone(820, .12, "sine", .04, .08); }
  wrong() { this.tone(190, .18, "square", .028); }
  tick() { this.tone(810, .045, "square", .018); }
  horn() { this.tone(235, .35, "sawtooth", .065); this.tone(315, .35, "sawtooth", .04); }
  startEngine() {
    const context = this.ensure();
    if (!context || this.engine) return;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = 43;
    filter.type = "lowpass";
    filter.frequency.value = 185;
    volume.gain.value = .018;
    oscillator.connect(filter).connect(volume).connect(context.destination);
    oscillator.start();
    this.engine = { oscillator, volume, filter };
  }
  updateEngine(speed, ignition) {
    if (!ignition) { this.stopEngine(); return; }
    this.startEngine();
    if (!this.engine || !this.context) return;
    const now = this.context.currentTime;
    this.engine.oscillator.frequency.setTargetAtTime(43 + speed * 1.8, now, .08);
    this.engine.filter.frequency.setTargetAtTime(180 + speed * 15, now, .08);
    this.engine.volume.gain.setTargetAtTime(.015 + speed * .00045, now, .08);
  }
  stopEngine() {
    if (!this.engine) return;
    try { this.engine.oscillator.stop(); } catch { /* already stopped */ }
    this.engine = null;
  }
}

const sound = new SoundEngine();

function speak(text) {
  if (!sound.enabled || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = .96;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function navigate(route) {
  if (!$( `[data-page="${route}"]`)) route = "home";
  if (currentRoute === "practice" && route !== "practice" && session.mode === "exam") clearInterval(session.timer);
  if (currentRoute === "coach" && route !== "coach") {
    coach?.stop();
    sound.stopEngine();
    document.body.classList.remove("is-coach");
  }
  currentRoute = route;
  $$("[data-page]").forEach(page => page.classList.toggle("is-active", page.dataset.page === route));
  $$(".side-nav [data-route],.bottom-nav [data-route]").forEach(button => button.classList.toggle("is-active", button.dataset.route === route || (route === "practice" && button.dataset.route === "practice")));
  if (route === "home") renderHome();
  if (route === "knowledge") renderKnowledge();
  if (route === "rules") updateOverspeedCalculator();
  if (route === "records") renderRecords();
  if (route === "coach") enterCoach();
  const page = $(`[data-page="${route}"]`);
  if (page) page.scrollTop = 0;
}

function renderHome() {
  const progress = bank.length ? clamp(learning.sequenceIndex / bank.length, 0, 1) : 0;
  $("#sequenceDone").textContent = Math.min(learning.sequenceIndex, bank.length).toLocaleString("zh-CN");
  $("#sequenceTotal").textContent = `/ ${bank.length.toLocaleString("zh-CN")}`;
  $("#sequenceHint").textContent = learning.sequenceIndex ? `继续第 ${learning.sequenceIndex + 1} 题` : "从第 1 题开始";
  $("#sequenceRing").style.setProperty("--progress", `${progress * 360}deg`);
  const best = learning.exams.length ? Math.max(...learning.exams.map(item => item.score)) : null;
  $("#bestExamScore").textContent = best === null ? "--" : best;
  $("#examRing").style.setProperty("--progress", `${(best || 0) / 100 * 360}deg`);
  $("#examHint").textContent = best === null ? "100 题 · 45 分钟" : `历史最高 ${best} 分`;
  $("#homeWrongCount").textContent = `${learning.wrong.length} 道`;
  $("#homeFavoriteCount").textContent = `${learning.favorite.length} 道`;
  $("#homeExamCount").textContent = `${learning.exams.length} 次`;
  $("#sideWrongCount").textContent = learning.wrong.length || "";
  $("#sideWrongCount").dataset.count = String(learning.wrong.length);
  const today = learning.today;
  $("#todayAnswered").textContent = today.answered;
  $("#todayStatAnswered").textContent = today.answered;
  $("#todayAccuracy").textContent = today.answered ? `${Math.round(today.correct / today.answered * 100)}%` : "--";
  $("#todayStreak").textContent = today.streak;
  $("#totalAnswered").textContent = learning.totalAnswered.toLocaleString("zh-CN");
  $("#todayBar").style.width = `${clamp(today.answered / 30 * 100, 0, 100)}%`;
}

function overspeedMarkerPosition(excess, isOverLimit) {
  if (!isOverLimit) return 7.8;
  if (excess < 20) return 15.7 + excess / 20 * 12.9;
  if (excess < 50) return 28.6 + (excess - 20) / 30 * 21.4;
  if (excess < 70) return 50 + (excess - 50) / 20 * 14.3;
  if (excess < 100) return 64.3 + (excess - 70) / 30 * 21.4;
  return 85.7 + clamp((excess - 100) / 100, 0, 1) * 14.3;
}

function updateOverspeedCalculator() {
  const limitInput = $("#ruleLimitInput");
  const actualInput = $("#ruleActualInput");
  if (!limitInput || !actualInput) return;
  const limit = Number(limitInput.value);
  const actual = Number(actualInput.value);
  const isOverLimit = actual > limit;
  const excess = isOverLimit ? (actual - limit) / limit * 100 : 0;
  const highway = ruleRoadType === "highway";
  let level = 0;
  let band = "未超过道路限速";
  let fine = "无处罚";
  let points = "0 分";
  let license = "无影响";

  if (isOverLimit && excess < 20) {
    level = 1; band = "超过限定时速不足20%"; fine = "警告 · ¥0"; license = "不吊销";
  } else if (excess >= 20 && excess < 50) {
    level = 2; band = "20%以上不足50%"; fine = highway ? "¥200" : "¥100"; points = highway ? "6 分" : "3 分"; license = "不吊销";
  } else if (excess >= 50 && excess < 70) {
    level = 3; band = "50%以上不足70%"; fine = highway ? "¥1000" : "¥500"; points = highway ? "12 分" : "6 分"; license = "可并处吊销";
  } else if (excess >= 70 && excess < 100) {
    level = 4; band = "70%以上不足100%"; fine = highway ? "¥2000" : "¥1000"; points = highway ? "12 分" : "6 分"; license = "并处吊销";
  } else if (excess >= 100) {
    level = 5; band = "超过限定时速100%以上"; fine = "¥2000"; points = highway ? "12 分" : "6 分"; license = "并处吊销";
  }

  $("#ruleLimitOutput").textContent = limit;
  $("#ruleActualOutput").textContent = actual;
  $("#overspeedPercent").textContent = `${Math.round(excess)}%`;
  $("#overspeedBand").textContent = band;
  $("#overspeedFine").textContent = fine;
  $("#overspeedPoints").textContent = points;
  $("#overspeedLicense").textContent = license;
  $("#overspeedScope").textContent = `普通小客车 · ${highway ? "高速 / 快速路" : "普通道路"}`;
  $("#overspeedResult").dataset.level = String(level);
  $("#overspeedMarker").style.left = `${overspeedMarkerPosition(excess, isOverLimit)}%`;
}

function startRulesPractice() {
  const pattern = /(时速|限速|车速|车距|能见度|罚款|记\s*\d+\s*分|警告标志|安全距离)/;
  const questions = bank.filter(question => pattern.test(`${question.question} ${stripHtml(question.explain)}`));
  startPractice("node", { title: "法规数字专项", ids: shuffle(questions).slice(0, 100).map(question => question.questionId) });
}

function handleAction(action) {
  if (action === "sequence") startPractice("sequence");
  if (action === "random") startPractice("random");
  if (action === "exam") $("#examDialog").showModal();
  if (action === "rules-practice") startRulesPractice();
}

function startPractice(mode, options = {}) {
  clearInterval(session.timer);
  session.mode = mode;
  session.results = new Map();
  session.answered = 0;
  session.correct = 0;
  session.selected = new Set();
  session.locked = false;
  if (mode === "sequence") {
    session.title = "顺序练习";
    session.queue = bank;
    session.index = clamp(learning.sequenceIndex, 0, bank.length - 1);
  } else if (mode === "random") {
    session.title = "随机练习";
    session.queue = shuffle(bank);
    session.index = 0;
  } else if (mode === "exam") {
    session.title = "科目一模拟考试";
    session.queue = shuffle(bank).slice(0, 100);
    session.index = 0;
    session.examEndAt = Date.now() + 45 * 60 * 1000;
    session.timer = setInterval(updateExamClock, 1000);
  } else if (mode === "node") {
    session.title = options.title || "专项练习";
    session.queue = (options.ids || []).map(findQuestion).filter(Boolean);
    session.index = 0;
  } else if (mode === "wrong" || mode === "favorite") {
    session.title = mode === "wrong" ? "错题练习" : "收藏练习";
    const ids = mode === "wrong" ? learning.wrong : learning.favorite;
    session.queue = ids.map(findQuestion).filter(Boolean);
    session.index = 0;
  } else if (mode === "single") {
    session.title = "题目练习";
    session.queue = [findQuestion(options.id)].filter(Boolean);
    session.index = 0;
  }
  if (!session.queue.length) {
    toast("这里还没有题目");
    return;
  }
  $("#practiceTitle").textContent = session.title;
  $("#modeBadge").textContent = session.title;
  $("#practiceSubtitle").textContent = mode === "exam" ? "剩余 45:00" : "C1 小车 · 科目一";
  navigate("practice");
  renderQuestion();
}

function currentQuestion() {
  return session.queue[session.index];
}

function renderQuestion() {
  const question = currentQuestion();
  if (!question) return;
  session.selected = new Set(session.results.get(session.index)?.selected || []);
  session.locked = session.results.has(session.index);
  const options = questionOptions(question);
  $("#questionPosition").textContent = session.index + 1;
  $("#questionQueueTotal").textContent = session.queue.length;
  $("#questionProgressBar").style.width = `${(session.index + 1) / session.queue.length * 100}%`;
  $("#questionType").textContent = questionType(question);
  $("#questionId").textContent = `#${question.questionId}`;
  $("#questionDifficulty").textContent = `难度 ${question.difficulty || 1}`;
  $("#questionText").textContent = question.question;
  const favorite = learning.favorite.includes(String(question.questionId));
  $("#favoriteQuestion").setAttribute("aria-pressed", favorite ? "true" : "false");
  $("#favoriteQuestion").textContent = favorite ? "★" : "☆";
  renderQuestionMedia(question);

  const holder = $("#answerOptions");
  holder.replaceChildren();
  const result = session.results.get(session.index);
  const correct = answerIndexes(question);
  options.forEach((text, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    button.dataset.index = index;
    button.innerHTML = `<i>${LETTERS[index]}</i><span></span>`;
    button.querySelector("span").textContent = text;
    if (session.selected.has(index)) button.classList.add("is-selected");
    if (result && session.mode !== "exam") {
      if (correct.includes(index)) button.classList.add("is-correct");
      else if (result.selected.includes(index)) button.classList.add("is-wrong");
    }
    button.disabled = session.locked;
    button.addEventListener("click", () => chooseAnswer(index));
    holder.appendChild(button);
  });
  const isMultiple = question.optionType === 2;
  $("#confirmMultiple").hidden = !isMultiple || session.locked;
  $("#confirmMultiple").disabled = session.selected.size === 0;
  $("#answerAnalysis").hidden = !result || session.mode === "exam";
  if (result && session.mode !== "exam") renderAnalysis(question, result);
  $("#previousQuestion").disabled = session.index === 0;
  $("#nextQuestion").textContent = session.index === session.queue.length - 1 ? (session.mode === "exam" ? "交卷" : "完成") : "下一题";
  updateSessionSummary();
  renderQuestionNavigator();
}

function renderQuestionMedia(question) {
  const holder = $("#questionMedia");
  const path = question.mediaKey ? mediaMap[question.mediaKey] : null;
  holder.replaceChildren();
  holder.hidden = !path;
  if (!path) return;
  const source = `${MEDIA_ROOT}${String(path).replaceAll("\\", "/")}`;
  if (/\.mp4$/i.test(path)) {
    const video = document.createElement("video");
    video.src = source; video.controls = true; video.playsInline = true; video.preload = "metadata";
    holder.appendChild(video);
  } else {
    const image = document.createElement("img");
    image.src = source; image.alt = "题目配图"; image.loading = "eager";
    holder.appendChild(image);
  }
}

function chooseAnswer(index) {
  if (session.locked) return;
  const question = currentQuestion();
  if (question.optionType === 2) {
    if (session.selected.has(index)) session.selected.delete(index);
    else session.selected.add(index);
    $$("#answerOptions .answer-option").forEach(button => button.classList.toggle("is-selected", session.selected.has(Number(button.dataset.index))));
    $("#confirmMultiple").disabled = session.selected.size === 0;
  } else {
    session.selected = new Set([index]);
    submitAnswer();
  }
}

function sameAnswer(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function submitAnswer() {
  if (session.locked || !session.selected.size) return;
  const question = currentQuestion();
  const selected = Array.from(session.selected).sort((a, b) => a - b);
  const correctAnswer = answerIndexes(question).sort((a, b) => a - b);
  const correct = sameAnswer(selected, correctAnswer);
  const result = { selected, correct };
  session.results.set(session.index, result);
  session.locked = true;
  session.answered += 1;
  if (correct) session.correct += 1;
  recordAnswer(question, selected, correct);
  if (session.mode === "exam") {
    sound.tone(500, .025, "sine", .006);
    setTimeout(() => moveQuestion(1), 170);
  } else {
    if (correct) sound.correct(); else sound.wrong();
    renderQuestion();
  }
}

function recordAnswer(question, selected, correct) {
  const id = String(question.questionId);
  learning.answered[id] = { correct, selected, at: Date.now() };
  learning.totalAnswered += 1;
  learning.today.answered += 1;
  if (correct) {
    learning.totalCorrect += 1;
    learning.today.correct += 1;
    learning.today.streak += 1;
    learning.bestStreak = Math.max(learning.bestStreak, learning.today.streak);
  } else {
    learning.today.streak = 0;
    if (!learning.wrong.includes(id)) learning.wrong.push(id);
  }
  if (session.mode === "sequence") learning.sequenceIndex = Math.max(learning.sequenceIndex, session.index + 1);
  saveLearning();
  renderHome();
}

function renderAnalysis(question, result) {
  $("#answerResult").textContent = result.correct ? "回答正确" : "回答错误";
  $("#answerResult").classList.toggle("is-wrong", !result.correct);
  $("#correctAnswer").textContent = answerIndexes(question).map(index => LETTERS[index]).join("、");
  $("#answerExplanation").innerHTML = question.explain || "暂无解析";
}

function updateSessionSummary() {
  $("#sessionAnswered").textContent = session.answered;
  $("#sessionCorrect").textContent = session.correct;
  $("#sideCorrectRate").textContent = session.answered ? `${Math.round(session.correct / session.answered * 100)}%` : "--";
}

function navigatorRange() {
  if (session.queue.length <= 150) return session.queue.map((_, index) => index);
  const start = clamp(session.index - 55, 0, session.queue.length - 120);
  return Array.from({ length: 120 }, (_, offset) => start + offset);
}

function renderQuestionNavigator() {
  const side = $("#sideQuestionGrid");
  const full = $("#fullAnswerGrid");
  side.replaceChildren();
  full.replaceChildren();
  const renderButton = (index, target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = index + 1;
    const result = session.results.get(index);
    if (result) button.classList.add(result.correct ? "is-correct" : "is-wrong", "is-answered");
    if (index === session.index) button.classList.add("is-current");
    button.addEventListener("click", () => { session.index = index; renderQuestion(); $("#answerSheetDialog").close(); });
    target.appendChild(button);
  };
  navigatorRange().forEach(index => renderButton(index, side));
  const fullIndices = session.queue.length <= 500 ? session.queue.map((_, index) => index) : navigatorRange();
  fullIndices.forEach(index => renderButton(index, full));
}

function moveQuestion(direction) {
  if (direction > 0 && !session.locked && session.mode !== "exam") {
    toast("请先选择答案");
    return;
  }
  if (direction > 0 && session.mode === "exam" && !session.locked) {
    session.results.set(session.index, { selected: [], correct: false });
  }
  const next = session.index + direction;
  if (next < 0) return;
  if (next >= session.queue.length) {
    finishSession();
    return;
  }
  session.index = next;
  renderQuestion();
  $(".practice-page").scrollTop = 0;
}

function updateExamClock() {
  const remaining = Math.max(0, session.examEndAt - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  $("#practiceSubtitle").textContent = `剩余 ${minutes}:${seconds}`;
  if (!remaining) finishSession();
}

function finishSession() {
  clearInterval(session.timer);
  if (session.mode === "exam") {
    const score = session.correct;
    learning.exams.unshift({ score, correct: session.correct, answered: session.answered, at: Date.now() });
    learning.exams = learning.exams.slice(0, 30);
    saveLearning();
    showExamResult(score);
  } else {
    toast(`本次答对 ${session.correct} / ${session.answered || 0} 题`);
    navigate("home");
  }
}

function showExamResult(score) {
  const dialog = document.createElement("dialog");
  dialog.className = "exam-dialog";
  dialog.innerHTML = `<div class="exam-dialog-icon">${score >= 90 ? "过" : "练"}</div><h2>${score >= 90 ? "考试通过" : "继续加油"}</h2><p>本次模拟考试 ${score} 分，答对 ${session.correct} 题。</p><dl><div><dt>得分</dt><dd>${score}</dd></div><div><dt>答对</dt><dd>${session.correct}</dd></div><div><dt>及格线</dt><dd>90</dd></div></dl><div><button type="button" data-close>返回首页</button><button class="primary" type="button" data-record>查看成绩</button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-close]").addEventListener("click", () => { dialog.close(); dialog.remove(); navigate("home"); });
  dialog.querySelector("[data-record]").addEventListener("click", () => { dialog.close(); dialog.remove(); recordTab = "score"; navigate("records"); });
  dialog.showModal();
}

let activeKnowledgeGroup = "credentials";

function renderKnowledge() {
  if (!graph) return;
  const groups = graph.nodes.filter(node => node.type === "group");
  const groupHolder = $("#knowledgeGroups");
  groupHolder.replaceChildren();
  groups.forEach(group => {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-active", group.id === activeKnowledgeGroup);
    button.innerHTML = `<span></span><em>${group.stats.count}</em>`;
    button.querySelector("span").textContent = group.label;
    button.addEventListener("click", () => { activeKnowledgeGroup = group.id; renderKnowledge(); });
    groupHolder.appendChild(button);
  });
  renderKnowledgeCards();
}

function renderKnowledgeCards() {
  const query = $("#knowledgeSearch").value.trim().toLowerCase();
  const nodes = graph.nodes.filter(node => node.type === "concept" && (!query ? node.parent === activeKnowledgeGroup : `${node.label} ${node.summary} ${node.memory}`.toLowerCase().includes(query)));
  const holder = $("#knowledgeList");
  holder.replaceChildren();
  nodes.forEach(node => {
    const group = graph.nodes.find(item => item.id === node.parent);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "knowledge-card";
    button.style.setProperty("--card-color", node.color || group?.color || "#ff6a2a");
    button.innerHTML = `<i></i><span><b></b><small></small></span><em>›</em>`;
    button.querySelector("i").textContent = node.label.slice(0, 1);
    button.querySelector("b").textContent = node.label;
    button.querySelector("small").textContent = `${node.stats.count.toLocaleString("zh-CN")} 道题 · 点击练习`;
    button.addEventListener("click", () => startPractice("node", { title: node.label, ids: node.questionIds }));
    holder.appendChild(button);
  });
  if (!nodes.length) holder.innerHTML = '<div class="record-empty"><i>⌕</i><h2>没有找到知识点</h2><p>换一个关键词试试</p></div>';
}

function renderRecords() {
  $$("[data-record-tab]").forEach(button => {
    if (button.closest(".record-tabs")) button.classList.toggle("is-active", button.dataset.recordTab === recordTab);
  });
  $("#tabWrongCount").textContent = learning.wrong.length;
  $("#tabFavoriteCount").textContent = learning.favorite.length;
  const holder = $("#recordContent");
  holder.replaceChildren();
  if (recordTab === "score") {
    if (!learning.exams.length) return renderEmpty(holder, "绩", "还没有考试成绩", "完成一次模拟考试后会显示在这里");
    const list = document.createElement("div"); list.className = "record-list";
    learning.exams.forEach(exam => {
      const article = document.createElement("article");
      article.className = `score-item${exam.score < 90 ? " is-fail" : ""}`;
      article.innerHTML = `<strong>${exam.score}分</strong><div><p>${exam.score >= 90 ? "考试通过" : "未达到及格线"}</p><small>答对 ${exam.correct} 题 · 已答 ${exam.answered} 题</small></div><time>${new Date(exam.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>`;
      list.appendChild(article);
    });
    holder.appendChild(list);
    return;
  }
  const ids = recordTab === "wrong" ? learning.wrong : learning.favorite;
  if (!ids.length) return renderEmpty(holder, recordTab === "wrong" ? "错" : "藏", recordTab === "wrong" ? "还没有错题" : "还没有收藏题目", recordTab === "wrong" ? "答错的题会自动收录" : "答题时点击右上角星标即可收藏");
  const list = document.createElement("div"); list.className = "record-list";
  ids.map(findQuestion).filter(Boolean).slice(0, 120).forEach(question => {
    const article = document.createElement("article"); article.className = "record-item";
    article.innerHTML = `<div><header><span>${questionType(question)}</span><em>#${question.questionId}</em></header><p></p></div><button type="button">练习</button>`;
    article.querySelector("p").textContent = question.question;
    article.querySelector("button").addEventListener("click", () => startPractice("single", { id: question.questionId }));
    list.appendChild(article);
  });
  const practiceAll = document.createElement("button");
  practiceAll.type = "button"; practiceAll.className = "finish-session"; practiceAll.textContent = recordTab === "wrong" ? "练习全部错题" : "练习全部收藏";
  practiceAll.addEventListener("click", () => startPractice(recordTab));
  holder.append(list, practiceAll);
}

function renderEmpty(holder, icon, title, text) {
  holder.innerHTML = `<div class="record-empty"><i>${icon}</i><h2>${title}</h2><p>${text}</p></div>`;
}

function openSearch() {
  const dialog = $("#searchDialog");
  dialog.showModal();
  setTimeout(() => $("#globalSearchInput").focus(), 20);
}

function renderSearch(query) {
  const value = query.trim().toLowerCase();
  const holder = $("#globalSearchResults");
  holder.replaceChildren();
  if (!value) { holder.innerHTML = `<p>输入关键词搜索 ${bank.length.toLocaleString("zh-CN")} 道题</p>`; return; }
  const matches = bank.filter(question => `${question.question} ${question.keywords || ""} ${stripHtml(question.explain)}`.toLowerCase().includes(value)).slice(0, 30);
  if (!matches.length) { holder.innerHTML = "<p>没有找到相关题目</p>"; return; }
  matches.forEach(question => {
    const button = document.createElement("button"); button.type = "button";
    button.innerHTML = `<b></b><span>${questionType(question)} · #${question.questionId}</span>`;
    button.querySelector("b").textContent = question.question;
    button.addEventListener("click", () => { $("#searchDialog").close(); startPractice("single", { id: question.questionId }); });
    holder.appendChild(button);
  });
}

function enterCoach() {
  document.body.classList.add("is-coach");
  if (!coach) initCoach();
  coach.start();
  coach.resize();
}

function initCoach() {
  coach = new FirstPersonCoach($("#coachScene"), {
    onState: renderCoachState,
    onTask: task => {
      $("#coachTaskTitle").textContent = task.title;
      $("#coachTaskText").textContent = task.text;
      $("#coachStepIndex").textContent = `${task.index + 1} / ${task.total}`;
      $("#coachTaskBar").style.width = `${task.index / task.total * 100}%`;
      speak(`${task.title}。${task.text}`);
    },
    onPenalty: event => {
      $("#coachScore").textContent = event.score;
      addCoachEvent(`-${event.points} ${event.text}`, true);
      showCoachMessage(event.text);
      sound.wrong();
      speak(event.text);
    },
    onMessage: showCoachMessage,
    onComplete: result => {
      $("#coachTaskBar").style.width = "100%";
      $("#coachTaskTitle").textContent = result.score >= 90 ? "训练完成" : "完成本次训练";
      $("#coachTaskText").textContent = `本次得分 ${result.score} 分。可重新开始或选择下一项训练。`;
      addCoachEvent(`训练完成，得分 ${result.score}`, false);
      showCoachMessage(`训练完成 · ${result.score} 分`);
      sound.correct();
      speak(`训练完成，本次得分${result.score}分`);
    },
    onReset: () => {
      $("#coachEventLog").innerHTML = "<p>训练已开始</p>";
      $("#coachScore").textContent = "100";
      $("#brakePedal").dataset.latched = "false";
    }
  });
  bindCoachControls();
}

function renderCoachState(state) {
  $("#coachSpeed").textContent = Math.round(state.speedKmh);
  $("#coachGear").textContent = state.gear;
  $("#coachScore").textContent = state.score;
  $("#steeringWheel").style.transform = `rotate(${state.steer * 118}deg)`;
  $("#leftSignalIndicator").classList.toggle("is-active", state.signal === "left");
  $("#rightSignalIndicator").classList.toggle("is-active", state.signal === "right");
  $("#coachLeftSignal").classList.toggle("is-active", state.signal === "left");
  $("#coachRightSignal").classList.toggle("is-active", state.signal === "right");
  $("#seatbeltButton").classList.toggle("is-active", state.seatbelt);
  $("#ignitionButton").classList.toggle("is-active", state.ignition);
  $("#lightsButton").classList.toggle("is-active", state.lights);
  $$("[data-gear]").forEach(button => button.classList.toggle("is-active", button.dataset.gear === state.gear));
  $("#brakePedal").classList.toggle("is-pressed", state.brake);
  sound.updateEngine(state.speedKmh, state.ignition && currentRoute === "coach");
}

function addCoachEvent(text, penalty) {
  const holder = $("#coachEventLog");
  const p = document.createElement("p");
  p.textContent = text;
  p.classList.toggle("is-penalty", penalty);
  holder.prepend(p);
  while (holder.children.length > 4) holder.lastChild.remove();
}

function showCoachMessage(message) {
  const holder = $("#coachMessage");
  holder.textContent = message;
  holder.classList.add("is-visible");
  clearTimeout(showCoachMessage.timer);
  showCoachMessage.timer = setTimeout(() => holder.classList.remove("is-visible"), 1800);
}

function bindHold(button, control) {
  const press = event => { event.preventDefault(); sound.ensure(); coach.setControl(control, true); button.classList.add("is-pressed"); };
  const release = event => { event?.preventDefault(); coach.setControl(control, false); button.classList.remove("is-pressed"); };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", event => { if (event.buttons) release(event); });
}

function bindCoachControls() {
  bindHold($("#acceleratorPedal"), "throttle");
  bindHold($("#brakePedal"), "brake");
  $("#brakePedal").dataset.latched = "false";
  $("#brakePedal").addEventListener("click", event => {
    const latched = event.currentTarget.dataset.latched !== "true";
    event.currentTarget.dataset.latched = String(latched);
    coach.setControl("brake", latched);
    showCoachMessage(latched ? "刹车已踩下" : "刹车已松开");
  });
  $("#seatbeltButton").addEventListener("click", () => { sound.ensure(); coach.toggleSeatbelt(); });
  $("#ignitionButton").addEventListener("click", () => { sound.ensure(); const started = coach.toggleIgnition(); if (started) sound.tone(90, .25, "sawtooth", .04); });
  $("#lightsButton").addEventListener("click", () => { coach.toggleLights(); sound.tone(620, .05, "square", .018); });
  $("#coachLeftSignal").addEventListener("click", () => { coach.toggleSignal("left"); sound.tick(); });
  $("#coachRightSignal").addEventListener("click", () => { coach.toggleSignal("right"); sound.tick(); });
  $("#coachHorn").addEventListener("click", () => { sound.horn(); showCoachMessage("鸣笛"); });
  $$("[data-gear]").forEach(button => button.addEventListener("click", () => { if (coach.setGear(button.dataset.gear)) sound.tone(330, .05, "square", .022); }));
  $("#coachReset").addEventListener("click", () => coach.reset());
  $$("[data-scenario]").forEach(button => button.addEventListener("click", () => {
    $$("[data-scenario]").forEach(item => item.classList.toggle("is-active", item === button));
    coach.reset(button.dataset.scenario);
  }));

  const wheel = $("#steeringWheel");
  let wheelDrag = null;
  wheel.addEventListener("pointerdown", event => {
    event.preventDefault();
    wheel.setPointerCapture(event.pointerId);
    wheelDrag = { x: event.clientX, start: coach.state.steer };
  });
  wheel.addEventListener("pointermove", event => {
    if (!wheelDrag) return;
    coach.setSteering(clamp(wheelDrag.start + (event.clientX - wheelDrag.x) / 75, -1, 1));
  });
  const releaseWheel = () => { if (!wheelDrag) return; wheelDrag = null; coach.releaseSteering(); };
  wheel.addEventListener("pointerup", releaseWheel);
  wheel.addEventListener("pointercancel", releaseWheel);

  clearInterval(coachSignalTimer);
  coachSignalTimer = setInterval(() => {
    if (currentRoute === "coach" && coach?.state.signal !== "off") sound.tick();
  }, 700);
}

function handleCoachKey(event, pressed) {
  if (currentRoute !== "coach" || /INPUT|TEXTAREA/.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  const map = { w: "throttle", arrowup: "throttle", s: "brake", arrowdown: "brake", " ": "brake", a: "left", arrowleft: "left", d: "right", arrowright: "right" };
  if (map[key]) {
    event.preventDefault();
    coach.setControl(map[key], pressed);
    if (pressed) sound.ensure();
  }
  if (!pressed || event.repeat) return;
  if (key === "q") { coach.toggleSignal("left"); sound.tick(); }
  if (key === "e") { coach.toggleSignal("right"); sound.tick(); }
  if (key === "h") { sound.horn(); showCoachMessage("鸣笛"); }
}

function bindAppEvents() {
  document.addEventListener("click", event => {
    const action = event.target.closest("[data-action]");
    if (action) { handleAction(action.dataset.action); return; }
    const route = event.target.closest("[data-route]");
    if (route) {
      const tab = route.dataset.recordTab;
      if (tab) recordTab = tab;
      navigate(route.dataset.route);
    }
  });
  $$("[data-subject]").forEach(button => button.addEventListener("click", () => {
    $$("[data-subject]").forEach(item => item.classList.toggle("is-active", item === button));
    if (button.dataset.subject === "k2" || button.dataset.subject === "k3") {
      navigate("coach");
      const scenario = button.dataset.subject === "k2" ? "park" : "intersection";
      $$("[data-scenario]").forEach(item => item.classList.toggle("is-active", item.dataset.scenario === scenario));
      coach.reset(scenario);
    }
  }));
  $("#continueSequence").addEventListener("click", () => startPractice("sequence"));
  $("#continueSequence").addEventListener("keydown", event => { if (event.key === "Enter") startPractice("sequence"); });
  $("#continueExam").addEventListener("click", () => $("#examDialog").showModal());
  $("#cancelExam").addEventListener("click", () => $("#examDialog").close());
  $("#startExam").addEventListener("click", () => { $("#examDialog").close(); startPractice("exam"); });
  $("#confirmMultiple").addEventListener("click", submitAnswer);
  $("#previousQuestion").addEventListener("click", () => moveQuestion(-1));
  $("#nextQuestion").addEventListener("click", () => moveQuestion(1));
  $("#finishSession").addEventListener("click", finishSession);
  $("#favoriteQuestion").addEventListener("click", () => {
    const question = currentQuestion(); if (!question) return;
    const id = String(question.questionId);
    const index = learning.favorite.indexOf(id);
    if (index >= 0) learning.favorite.splice(index, 1); else learning.favorite.push(id);
    saveLearning(); renderQuestion(); renderHome(); toast(index >= 0 ? "已取消收藏" : "已收藏");
  });
  $("#readQuestion").addEventListener("click", () => { const question = currentQuestion(); if (question) speak(question.question); });
  $("#openAnswerSheet").addEventListener("click", () => $("#answerSheetDialog").showModal());
  $("#closeAnswerSheet").addEventListener("click", () => $("#answerSheetDialog").close());
  $$(".record-tabs [data-record-tab]").forEach(button => button.addEventListener("click", () => { recordTab = button.dataset.recordTab; renderRecords(); }));
  $("#knowledgeSearch").addEventListener("input", renderKnowledgeCards);
  [$("#ruleLimitInput"), $("#ruleActualInput")].forEach(input => input.addEventListener("input", updateOverspeedCalculator));
  $$('[data-road-type]').forEach(button => button.addEventListener("click", () => {
    ruleRoadType = button.dataset.roadType;
    $$('[data-road-type]').forEach(item => item.classList.toggle("is-active", item === button));
    updateOverspeedCalculator();
  }));
  $("#printRules").addEventListener("click", () => window.print());
  const coachSourceDialog = $("#coachSourceDialog");
  $("#coachSourceButton").addEventListener("click", () => { coach?.stop(); coachSourceDialog.showModal(); });
  [$("#closeCoachSource"), $("#ackCoachSource")].forEach(button => button.addEventListener("click", () => coachSourceDialog.close()));
  $("#openRulesFromCoach").addEventListener("click", () => { coachSourceDialog.close(); navigate("rules"); });
  coachSourceDialog.addEventListener("close", () => { if (currentRoute === "coach") coach?.start(); });
  $("#openSearch").addEventListener("click", openSearch);
  $("#mobileSearch").addEventListener("click", openSearch);
  $("#globalSearchInput").addEventListener("input", event => renderSearch(event.target.value));
  $("#soundSwitch").addEventListener("click", event => {
    sound.enabled = !sound.enabled;
    event.currentTarget.setAttribute("aria-pressed", sound.enabled ? "true" : "false");
    event.currentTarget.textContent = sound.enabled ? "♫" : "♪̸";
    if (!sound.enabled) { sound.stopEngine(); window.speechSynthesis?.cancel(); }
  });
  [$("#cityPicker"), $("#mobileCity")].forEach(button => button.addEventListener("click", () => toast("当前题库：武汉")));
  $("#licensePicker").addEventListener("click", () => toast("当前车型：C1 小车"));
  window.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); return; }
    handleCoachKey(event, true);
  });
  window.addEventListener("keyup", event => handleCoachKey(event, false));
  window.addEventListener("blur", () => {
    if (!coach) return;
    ["throttle", "brake", "left", "right"].forEach(control => coach.setControl(control, false));
  });
}

async function initialize() {
  try {
    const [bankResponse, mediaResponse, graphResponse] = await Promise.all([fetch(BANK_URL), fetch(MEDIA_URL), fetch(GRAPH_URL)]);
    if (!bankResponse.ok || !mediaResponse.ok || !graphResponse.ok) throw new Error("题库文件加载失败");
    [bank, mediaMap, graph] = await Promise.all([bankResponse.json(), mediaResponse.json(), graphResponse.json()]);
    questionIndex = new Map(bank.map(question => [String(question.questionId), question]));
    $("#bankVersion").textContent = String(graph.meta.bankVersion || "2026").slice(0, 4);
    bindAppEvents();
    renderHome();
    renderKnowledge();
    $("#appLoading").remove();
    $("#jkApp").hidden = false;
    document.documentElement.dataset.ready = "true";
  } catch (error) {
    $("#appLoading p").textContent = `${error.message}，请通过本地 HTTP 服务打开`;
    $("#appLoading .brand-mark").style.background = "#ef4d4d";
    throw error;
  }
}

initialize();
