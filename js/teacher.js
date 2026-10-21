// 선생님 화면 (2차시 질문 룰렛 놀이)
// 게임 만들기 → 대기실 → ① 질문 룰렛 진행 → 룰렛 질문 모아보기(잠시 멈춤) → ② 한 마디 바꾸기 진행 → 모아보기 · CSV
// 진행 중에는 질문 내용을 보여 주지 않고, 게임 규칙 · 질문 틀(또는 바꾸기 방법) · 남은 시간만 보여 준다.

import { $, esc, toast, openModal, confirmBox, qrSvg, copyText, downloadText, csvCell, watchConnection, brandHtml, catSvg, ICON, isComposingEnter } from './ui.js';
import { groupColor, formatClock, hasBannedWord, MIN_GROUPS, MAX_GROUPS } from './game.js';
import { createTimerFx, isSoundOn, setSoundOn, SOUND_ICON, bell, beep, flashBanner } from './effects.js';
import { SERVER_RULES } from './config.js';
import { explainError, hasServer } from './api.js';
import { teacherClient, deriveR2, remainingOfR2 } from './r2api.js';
import {
  FRAMES,
  FRAMES_BOARD,
  THEMES,
  WORDS_MIN,
  WORDS_MAX,
  WORD_MAX_LEN,
  THEME_MAX_LEN,
  METHODS,
  METHOD_BASE,
  ROULETTE_TIMES,
  CHANGE_TIMES,
  themeById,
  markEx,
  CSV_HEAD,
  KIND_LABEL,
} from './content.js';
import { wheelSvg, WHEEL_PALETTES } from './wheel.js';

const app = document.getElementById('app');
const FORM_KEY = 'qr2-teacher-form';
const SEEN_FRESH_MS = 15000;
const FAST_ITEMS_MS = 90000;

const STAGE_LABEL = { roulette: '질문 룰렛', change: '한 마디 바꾸기' };
const KEEP_H = SERVER_RULES.keepHours;

const S = {
  cli: null,
  mode: null,
  code: null,
  game: null,
  seen: {},
  items: null,
  itemsSig: '',
  itemsTimer: null,
  itemsSince: 0,
  view: 'home',
  built: null,
  form: loadForm(),
  loop: null,
  pollTimer: null,
  stopConn: null,
  fx: createTimerFx('teacher', (s) =>
    s.stage === 'change'
      ? { start: '한 마디 바꾸기 시작!', startSub: '우리 모둠 질문을 골라 한 마디만 바꿔요', endSub: '바꾼 질문을 모아 볼까요?' }
      : { start: '질문 룰렛 시작!', startSub: '차례인 친구가 룰렛을 돌려요', endSub: '모둠 질문을 모아 볼까요?' }
  ),
  ending: false,
  lastGoAt: null,
  builtSig: '',
};

// ════════════════════════════════════════════════
// 설정값 (이 브라우저에 기억)
// ════════════════════════════════════════════════

// 수업은 늘 서버에서 한다. 연습 모드는 이 컴퓨터에서 미리 해 볼 때만 (기억하지 않음)
function defaultMode() {
  return hasServer() ? 'server' : 'local';
}

function themeWordsOf(id) {
  const t = themeById(id);
  return t ? t.words.slice() : [];
}

function loadForm() {
  const base = {
    mode: defaultMode(),
    themeId: THEMES[0].id,
    themeName: THEMES[0].name,
    words: themeWordsOf(THEMES[0].id),
    removed: [],
    roulette: 15,
    change: 10,
    groups: 6,
    dupMode: 'same',
  };
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) || '{}');
    if (ROULETTE_TIMES.includes(saved.roulette)) base.roulette = saved.roulette;
    if (CHANGE_TIMES.includes(saved.change)) base.change = saved.change;
    if (saved.groups >= MIN_GROUPS && saved.groups <= MAX_GROUPS) base.groups = saved.groups;
    if (saved.dupMode === 'similar') base.dupMode = 'similar';
    if (saved.themeId === 'custom' || themeById(saved.themeId)) {
      base.themeId = saved.themeId;
      base.themeName = saved.themeId === 'custom' ? String(saved.themeName || '') : themeById(saved.themeId).name;
      base.words = Array.isArray(saved.words) ? saved.words.filter((w) => typeof w === 'string').slice(0, WORDS_MAX) : themeWordsOf(saved.themeId);
    }
  } catch (e) {}
  return base;
}

function saveForm() {
  const f = S.form;
  try {
    localStorage.setItem(
      FORM_KEY,
      JSON.stringify({ mode: f.mode, themeId: f.themeId, themeName: f.themeName, words: f.words, roulette: f.roulette, change: f.change, groups: f.groups, dupMode: f.dupMode })
    );
  } catch (e) {}
}

const squash = (s) => String(s || '').replace(/\s/g, '').toLowerCase();

// 예비 제시어: 대주제의 기본 제시어 + 예비 제시어 + 이번에 뺀 말 중 아직 룰렛에 없는 것
function spareWords() {
  const f = S.form;
  const t = themeById(f.themeId);
  const pool = [...(t ? t.words : []), ...(t ? t.spare : []), ...f.removed];
  const have = new Set(f.words.map(squash));
  const out = [];
  pool.forEach((w) => {
    const k = squash(w);
    if (!have.has(k)) {
      have.add(k);
      out.push(w);
    }
  });
  return out;
}

function addWord(raw) {
  const f = S.form;
  const w = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!w) return '제시어를 써 주세요.';
  if (w.length > WORD_MAX_LEN) return `제시어는 ${WORD_MAX_LEN}글자까지 쓸 수 있어요.`;
  if (hasBannedWord(w)) return '다른 말로 바꿔 볼까요?';
  if (f.words.some((x) => squash(x) === squash(w))) return `"${w}"는 이미 룰렛에 있어요.`;
  if (f.words.length >= WORDS_MAX) return `제시어는 ${WORDS_MAX}개까지 넣을 수 있어요.`;
  f.words.push(w);
  f.removed = f.removed.filter((x) => squash(x) !== squash(w));
  return '';
}

function explain(e) {
  const c = (e && e.code) || '';
  if (c === 'BAD_WORDS') return `제시어를 ${WORDS_MIN}개 이상 넣어 주세요.`;
  if (c === 'BAD_THEME') return '대주제를 써 주세요.';
  if (c === 'NO_ITEM') return '이미 지워진 질문이에요.';
  return explainError(e, 'teacher');
}

function topbar(right = '') {
  return `<header class="topbar">${brandHtml('선생님용 · 2차시')}<div class="spacer"></div>${right}</header>`;
}

function setLayout(mode) {
  app.classList.toggle('wide', mode === 'board');
  app.classList.toggle('board-mode', mode === 'board');
}

const now = () => (S.cli ? S.cli.serverNow() : Date.now());
const st = () => deriveR2(S.game, now());
const joinedGroups = () =>
  Object.keys((S.game && S.game.groups) || {})
    .map(Number)
    .sort((a, b) => a - b);
const namesOf = (g) => ((S.game && S.game.groups[g] && S.game.groups[g].names) || []).slice();
const isFresh = (g) => S.seen[g] && now() - S.seen[g] < SEEN_FRESH_MS;
const doneOf = (stage, g) => !!(S.game && S.game.done && S.game.done[stage] && S.game.done[stage][g]);
const minutesOf = (stage) => Math.round(((S.game && S.game.durations && S.game.durations[stage]) || 0) / 60);
const keepNote = () =>
  S.mode === 'local' ? '연습 모드 게임은 이 컴퓨터에만 남아 있어요.' : `게임 코드와 질문은 게임을 만든 뒤 ${KEEP_H}시간 동안 남아 있다가 저절로 지워져요.`;

// ════════════════════════════════════════════════
// 1. 게임 만들기 (처음 화면)
// ════════════════════════════════════════════════

function showHome() {
  closeGame();
  S.view = 'home';
  S.built = null;
  history.replaceState(null, '', 'teacher.html');
  renderHome();
  loadGameList();
}

function renderHome() {
  setLayout('normal');
  app.innerHTML = `
    ${topbar(`<a class="btn btn-cream btn-sm" href="index.html">${ICON.back}처음으로</a>`)}
    <section class="card pad-lg" aria-labelledby="h">
      <span class="deco green" style="width:260px;height:260px;right:-90px;top:-110px"></span>
      <div class="eyebrow">선생님용 · 놀이 준비</div>
      <h1 id="h" style="font-size:clamp(32px,4vw,46px);margin:10px 0 6px">질문 룰렛 놀이 만들기</h1>
      <p class="section-desc" style="font-size:19px;margin-bottom:20px">대주제와 제시어, 활동 시간을 정하면 모둠 태블릿이 들어올 게임 코드가 만들어져요.</p>
      <div id="home-form"></div>
    </section>
    <section class="card pad" style="margin-top:22px" aria-labelledby="rl">
      <div class="row">
        <div>
          <h2 class="section-title" id="rl">지난 게임 이어서 하기</h2>
          <p class="section-desc" id="rl-desc"></p>
        </div>
        <div class="spacer"></div>
      </div>
      <div class="room-list" id="room-list" style="margin-top:14px"><div class="empty-state" style="padding:16px">불러오는 중…</div></div>
    </section>`;
  renderForm();
}

function serverNotice() {
  const f = S.form;
  if (f.mode === 'local')
    return `<div class="notice apricot"><div><strong>연습 모드예요</strong>이 컴퓨터의 여러 창에서만 미리 해 볼 수 있어요. 학생 태블릿은 들어올 수 없어요.${
      hasServer() ? `<div style="margin-top:10px"><button type="button" class="btn btn-cream btn-sm" data-act="practice">수업 모드로 돌아가기</button></div>` : ''
    }</div></div>`;
  return `<div class="notice green"><div><strong>준비할 것 없이 바로 시작해요</strong>게임 코드를 만들면 모둠 태블릿이 바로 들어올 수 있어요. 질문은 게임을 만든 뒤 <b>${KEEP_H}시간</b>이 지나면 저절로 지워지니, 활동이 끝나면 <b>질문 내려받기 (CSV)</b>로 꼭 저장해 두세요. 여러 학교가 함께 쓰는 서버라 모둠 친구 이름은 실명 대신 번호나 별명으로 쓰도록 태블릿에서 안내해요.<div style="margin-top:10px"><button type="button" class="btn btn-cream btn-sm" data-act="practice">인터넷 없이 이 컴퓨터에서 연습해 보기</button></div></div></div>`;
}

function renderForm() {
  const box = $('#home-form');
  if (!box) return;
  const f = S.form;
  const themes =
    THEMES.map(
      (t) => `<button type="button" class="theme-opt" data-act="theme" data-id="${t.id}" aria-pressed="${f.themeId === t.id}">
        <span class="t">${esc(t.name)}</span><span class="d">${esc(t.words.slice(0, 3).join(' · '))} …</span></button>`
    ).join('') +
    `<button type="button" class="theme-opt free" data-act="theme" data-id="custom" aria-pressed="${f.themeId === 'custom'}">
      <span class="t">직접 입력</span><span class="d">대주제와 제시어를 마음대로 정해요</span></button>`;
  const words = f.words.length
    ? f.words.map((w, i) => `<span class="wchip">${esc(w)}<button type="button" data-act="word-del" data-i="${i}" aria-label="${esc(w)} 빼기">${ICON.x}</button></span>`).join('')
    : '<span class="empty">아래 예비 제시어를 누르거나 직접 써서 넣어요.</span>';
  const spare = spareWords();
  const nOk = f.words.length >= WORDS_MIN;
  const nameOk = f.themeName.trim().length > 0;

  box.innerHTML = `
    ${serverNotice()}
    <div class="setup-grid" style="margin-top:28px">
      <div class="full field">
        <div class="field-label"><span class="form-num">1</span>대주제 <span style="font-weight:400;color:var(--ink-3);font-size:16px">· 반 전체가 함께 써요</span></div>
        <div class="theme-grid">${themes}</div>
        <div class="theme-name-row">
          <label for="theme-name" style="font-weight:700">대주제 이름</label>
          <input class="input" id="theme-name" maxlength="${THEME_MAX_LEN}" autocomplete="off" placeholder="예: 우리 학교 운동회" value="${esc(f.themeName)}">
          <span style="color:var(--ink-3);font-size:15px">${THEME_MAX_LEN}글자까지 · 학생 화면 위쪽에 보여요</span>
        </div>
      </div>
      <div class="full field">
        <div class="field-label"><span class="form-num">2</span>제시어 룰렛 <span style="font-weight:400;color:var(--ink-3);font-size:16px">· ${WORDS_MIN}~${WORDS_MAX}개</span></div>
        <div class="word-box">
          <div>
            <div class="word-chips" id="word-chips" aria-label="룰렛에 들어갈 제시어">${words}</div>
            <div class="word-count ${nOk ? '' : 'bad'}" id="word-count">룰렛 칸 ${f.words.length}개${nOk ? '' : ` · ${WORDS_MIN}개 이상 넣어 주세요`}</div>
            ${
              spare.length
                ? `<div class="spare-label">예비 제시어 · 누르면 룰렛에 들어가요</div>
                   <div class="spare-chips">${spare.map((w) => `<button type="button" class="wchip spare" data-act="word-add-spare" data-w="${esc(w)}">${ICON.plus}${esc(w)}</button>`).join('')}</div>`
                : ''
            }
            <div class="word-add">
              <label for="word-in" class="sr-only">제시어 직접 쓰기</label>
              <input class="input" id="word-in" maxlength="${WORD_MAX_LEN}" autocomplete="off" placeholder="제시어 직접 쓰기 (${WORD_MAX_LEN}글자까지)">
              <button type="button" class="btn btn-cream" data-act="word-add">${ICON.plus}넣기</button>
            </div>
          </div>
          <div class="wheel-preview" aria-hidden="true">
            ${f.words.length >= 2 ? wheelSvg(f.words, WHEEL_PALETTES.word, { title: '제시어' }) : ''}
            <div class="cap">학생 태블릿의 제시어 룰렛</div>
          </div>
        </div>
      </div>
      <div class="full field">
        <div class="field-label"><span class="form-num">3</span>질문 틀 룰렛 <span style="font-weight:400;color:var(--ink-3);font-size:16px">· 12가지 (정해져 있어요)</span></div>
        <div class="frame-chips">${FRAMES.map((x) => `<span class="chip apricot">${esc(x.text)}</span>`).join('')}</div>
      </div>
      <div class="field">
        <div class="field-label"><span class="form-num">4</span>① 질문 룰렛 시간</div>
        <div class="seg" role="group" aria-label="질문 룰렛 시간">
          ${ROULETTE_TIMES.map((m) => `<button type="button" data-act="t-roulette" data-v="${m}" aria-pressed="${f.roulette === m}">${m}분</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label"><span class="form-num">5</span>② 한 마디 바꾸기 시간</div>
        <div class="seg" role="group" aria-label="한 마디 바꾸기 시간">
          ${CHANGE_TIMES.map((m) => `<button type="button" data-act="t-change" data-v="${m}" aria-pressed="${f.change === m}">${m}분</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label"><span class="form-num">6</span>모둠 수</div>
        <div class="stepper">
          <button type="button" class="btn btn-cream btn-icon" data-act="groups-dec" aria-label="모둠 하나 줄이기" ${f.groups <= MIN_GROUPS ? 'disabled' : ''}>−</button>
          <span class="value" aria-live="polite">${f.groups}</span>
          <button type="button" class="btn btn-cream btn-icon" data-act="groups-inc" aria-label="모둠 하나 늘리기" ${f.groups >= MAX_GROUPS ? 'disabled' : ''}>+</button>
          <span style="color:var(--ink-3);font-size:17px">모둠 (${MIN_GROUPS}~${MAX_GROUPS}) · 모둠마다 태블릿 1대</span>
        </div>
      </div>
      <div class="field">
        <div class="field-label"><span class="form-num">7</span>겹치는 질문 판정</div>
        <div class="seg" role="group" aria-label="겹치는 질문 판정">
          <button type="button" data-act="dup" data-v="same" aria-pressed="${f.dupMode === 'same'}">똑같은 것만 막기</button>
          <button type="button" data-act="dup" data-v="similar" aria-pressed="${f.dupMode === 'similar'}">비슷한 것도 막기</button>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:34px;justify-content:flex-end">
      ${f.mode !== 'local' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="practice" style="margin-right:auto">이 컴퓨터에서 연습해 보기</button>' : ''}
      <span style="color:var(--ink-3);font-size:17px" id="create-sum">${esc(summary())}</span>
      <button type="button" class="btn btn-primary btn-lg" data-act="create" id="create-btn" ${nOk && nameOk ? '' : 'disabled'}>게임 코드 만들기</button>
    </div>`;

  const name = $('#theme-name');
  name.addEventListener('input', () => {
    f.themeName = name.value;
    $('#create-btn').disabled = !(f.words.length >= WORDS_MIN && f.themeName.trim());
    $('#create-sum').textContent = summary();
  });
  const wi = $('#word-in');
  wi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isComposingEnter(e)) {
      e.preventDefault();
      submitWord();
    }
  });
}

function submitWord() {
  const wi = $('#word-in');
  if (!wi) return;
  const msg = addWord(wi.value);
  if (msg) {
    toast(msg, 'warn');
    wi.focus();
    return;
  }
  renderForm();
  const again = $('#word-in');
  if (again) again.focus();
}

function summary() {
  const f = S.form;
  return `${f.mode === 'local' ? '연습 모드 · ' : ''}${f.themeName.trim() || '대주제 없음'} · 제시어 ${f.words.length}개 · 룰렛 ${f.roulette}분 · 바꾸기 ${f.change}분 · ${f.groups}모둠`;
}

function stageLabel(g) {
  if (g.stage === 'lobby') return ['대기 중', 'cream'];
  if (g.stage === 'roulette') return g.status === 'ended' ? ['룰렛 끝 · 바꾸기 전', 'apricot'] : ['룰렛 진행 중', 'butter'];
  return g.status === 'ended' ? ['모두 끝', 'cream'] : ['바꾸기 진행 중', 'butter'];
}

function leftLabel(expiresAt) {
  if (!expiresAt) return '';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return '곧 정리돼요';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}분 뒤 정리`;
  if (h < 48) return `${h}시간 뒤 정리`;
  return `${Math.floor(h / 24)}일 뒤 정리`;
}

async function loadGameList() {
  const box = $('#room-list');
  if (!box) return;
  const mode = S.form.mode;
  const desc = $('#rl-desc');
  if (desc)
    desc.textContent =
      mode === 'local'
        ? '이 컴퓨터에서 연습 모드로 만든 게임이에요.'
        : `이 브라우저에서 만든 게임이에요. 룰렛이 끝난 게임은 다시 열어 한 마디 바꾸기를 이어 할 수 있어요. 게임을 만든 뒤 ${KEEP_H}시간이 지나면 질문까지 모두 지워져요.`;
  try {
    const cli = await teacherClient(mode);
    const res = await cli.listGames();
    if (!$('#room-list') || S.form.mode !== mode) return;
    const games = res.games || [];
    if (!games.length) {
      box.innerHTML = `<div class="empty-state" style="padding:14px">아직 만든 게임이 없어요.</div>`;
      return;
    }
    box.innerHTML = games
      .slice(0, 12)
      .map((g) => {
        const [label, tone] = stageLabel(g);
        const when = g.createdAt ? new Date(g.createdAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        return `<div class="room-item">
          <span class="rc">${esc(g.code)}</span>
          <span class="chip ${tone}">${label}</span>
          <span style="color:var(--ink-2);font-weight:700">${esc(g.themeName || '')}</span>
          <span style="color:var(--ink-3)">${esc(when)} · 태블릿 ${g.joined}/${g.groupCount} · ${esc(leftLabel(g.expiresAt))}</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn-primary btn-sm" data-act="open-room" data-code="${esc(g.code)}">이어서 열기</button>
          <button type="button" class="btn btn-danger btn-sm" data-act="del-room" data-code="${esc(g.code)}">${ICON.trash}지우기</button>
        </div>`;
      })
      .join('');
  } catch (e) {
    console.warn(e);
    if ($('#room-list') && S.form.mode === mode) box.innerHTML = `<div class="notice apricot"><div>${esc(explain(e))}</div></div>`;
  }
}

async function createGame() {
  const f = S.form;
  const themeName = f.themeName.replace(/\s+/g, ' ').trim();
  if (!themeName) return toast('대주제 이름을 써 주세요.', 'warn');
  if (f.words.length < WORDS_MIN) return toast(`제시어를 ${WORDS_MIN}개 이상 넣어 주세요.`, 'warn');
  const btn = $('#create-btn');
  btn.disabled = true;
  btn.textContent = '만드는 중…';
  try {
    const cli = await teacherClient(f.mode);
    const res = await cli.createGame({
      groupCount: f.groups,
      dupMode: f.dupMode,
      themeName,
      words: f.words.slice(),
      durations: { roulette: f.roulette * 60, change: f.change * 60 },
    });
    f.themeName = themeName;
    saveForm();
    await openGame(f.mode, res.code, { game: res.game, cli });
  } catch (e) {
    console.warn(e);
    toast('게임을 만들지 못했어요. ' + explain(e), 'warn');
    btn.disabled = false;
    btn.textContent = '게임 코드 만들기';
  }
}

// ════════════════════════════════════════════════
// 게임 열기 · 상태 받아오기
// ════════════════════════════════════════════════

function closeGame() {
  clearInterval(S.loop);
  clearTimeout(S.pollTimer);
  clearTimeout(S.itemsTimer);
  if (S.stopConn) S.stopConn();
  Object.assign(S, {
    loop: null,
    pollTimer: null,
    itemsTimer: null,
    stopConn: null,
    code: null,
    game: null,
    seen: {},
    items: null,
    itemsSig: '',
    built: null,
    builtSig: '',
    lastGoAt: null,
  });
}

async function openGame(mode, code, preset = {}) {
  closeGame();
  app.innerHTML = `<div class="empty-state">게임을 여는 중이에요…</div>`;
  const cli = preset.cli || (await teacherClient(mode));
  const first = preset.game ? { game: preset.game, seen: {} } : await cli.view(code);
  Object.assign(S, { cli, mode, code, game: first.game, seen: first.seen || {} });
  history.replaceState(null, '', `teacher.html?room=${code}&mode=${mode}`);
  S.stopConn = watchConnection(cli);
  S.loop = setInterval(tick, 250);
  render();
  poll();
}

async function poll() {
  clearTimeout(S.pollTimer);
  if (!S.code) return;
  const code = S.code;
  try {
    const res = await S.cli.view(code);
    if (S.code !== code) return;
    S.game = res.game;
    S.seen = res.seen || {};
    render();
  } catch (e) {
    if (S.code !== code) return;
    if (e.code === 'NO_GAME') {
      toast('게임이 정리되었어요.');
      return showHome();
    }
    if (e.code === 'NOT_OWNER') {
      toast(explain(e), 'warn');
      return showHome();
    }
  } finally {
    if (S.code === code) S.pollTimer = setTimeout(poll, S.cli.pollMs(document.hidden ? 'hidden' : 'teacher'));
  }
}

// 모아보기 화면에서 질문을 받아온다: 처음 1분 30초는 자주, 그다음은 가끔
async function loadItems() {
  clearTimeout(S.itemsTimer);
  if (!S.code || (S.view !== 'break' && S.view !== 'done')) return;
  const code = S.code;
  try {
    const map = await S.cli.teacherItems(code);
    if (S.code !== code) return;
    setItems(map);
  } catch (e) {
    if (S.items === null && S.code === code) {
      S.items = {};
      S.itemsSig = 'err';
      render();
    }
  } finally {
    if (S.code === code && (S.view === 'break' || S.view === 'done')) {
      const fast = Date.now() - S.itemsSince < FAST_ITEMS_MS;
      S.itemsTimer = setTimeout(loadItems, S.cli.pollMs(document.hidden ? 'hidden' : fast ? 'items' : 'itemsSlow'));
    }
  }
}

function setItems(map) {
  const sig = JSON.stringify(map || {});
  S.items = map || {};
  if (sig !== S.itemsSig) {
    S.itemsSig = sig;
    render();
  }
}

function render() {
  if (!S.code || !S.game) return;
  const s = st();
  const view = s.view;
  if (view !== S.view) {
    S.view = view;
    S.built = null;
    S.builtSig = '';
    window.scrollTo(0, 0);
    if (view === 'break' || view === 'done') {
      S.items = null;
      S.itemsSig = '';
      S.itemsSince = Date.now();
      loadItems();
    }
  }
  if (view === 'lobby') renderLobby();
  else if (view === 'roulette' || view === 'change') renderBoard(view);
  else if (view === 'break') renderBreak();
  else renderDone();
}

function joinUrl() {
  const u = new URL('student.html', location.href);
  u.search = '';
  u.searchParams.set('code', S.code);
  Object.entries(S.cli.linkParams()).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

function shortJoin() {
  const u = new URL('student.html', location.href);
  return u.host + u.pathname;
}

// ════════════════════════════════════════════════
// 2. 대기실
// ════════════════════════════════════════════════

function settingChips() {
  const g = S.game;
  const modeChip = S.mode === 'local' ? '<span class="chip apricot">연습 모드</span>' : '';
  return `${modeChip}<span class="chip cream">룰렛 ${minutesOf('roulette')}분</span><span class="chip cream">바꾸기 ${minutesOf('change')}분</span><span class="chip cream">${g.groupCount}모둠</span>`;
}

function joinCardHtml() {
  const tiles = S.code
    .split('')
    .map((d) => `<span>${esc(d)}</span>`)
    .join('');
  const share =
    S.mode !== 'local'
      ? `<div class="qr-box" aria-label="모둠 태블릿 입장 QR 코드">${qrSvg(joinUrl())}</div>
         <p class="join-url">모둠 태블릿으로 QR을 찍거나<br><b>${esc(shortJoin())}</b> 에서 코드를 입력해요</p>
         <div class="row" style="justify-content:center"><button type="button" class="btn btn-cream btn-sm" data-act="copy-link">${ICON.copy}입장 링크 복사</button></div>`
      : `<div class="notice" style="text-align:left"><div><strong>연습 모드예요</strong>이 컴퓨터에서 모둠 태블릿 창을 여러 개 열어 미리 해 볼 수 있어요. 다른 기기에서는 들어올 수 없어요.</div></div>
         <div class="row" style="justify-content:center"><button type="button" class="btn btn-apricot btn-sm" data-act="open-student">모둠 태블릿 창 열기</button></div>`;
  return `<div class="eyebrow" style="text-align:center">게임 코드</div>
    <div class="code-tiles" style="margin:14px 0 20px" aria-label="게임 코드 ${esc(S.code.split('').join(' '))}">${tiles}</div>
    <div class="stack" style="gap:14px">${share}</div>`;
}

function themeBox() {
  const t = S.game.theme || { name: '', words: [] };
  return `<div class="card pad" style="padding:22px 24px">
      <div class="row" style="margin-bottom:12px"><span class="eyebrow">오늘의 대주제</span><b style="font-size:26px">${esc(t.name)}</b></div>
      <div class="wheels" aria-hidden="true">
        <div class="wheel-box frame"><span class="wt">질문 틀</span>${wheelSvg(
          FRAMES.map((f) => f.label),
          WHEEL_PALETTES.frame,
          { title: '질문 틀', pointer: 'right' }
        )}</div>
        <div class="wheel-box word"><span class="wt">제시어</span>${wheelSvg(t.words, WHEEL_PALETTES.word, { title: '제시어', pointer: 'left' })}</div>
      </div>
      <p class="section-desc" style="margin-top:12px;font-size:16px">학생 태블릿에 이 두 룰렛이 보여요. "룰렛 돌리기"를 누르면 두 룰렛이 함께 돌아요.</p>
    </div>`;
}

function renderLobby() {
  if (S.built !== 'lobby') {
    S.built = 'lobby';
    setLayout('normal');
    app.innerHTML = `
      ${topbar(`${settingChips()}<button type="button" class="btn btn-cream btn-sm" data-act="home">${ICON.back}게임 목록</button>`)}
      <div class="lobby">
        <section class="card pad" aria-label="입장 안내">
          <span class="deco butter" style="width:180px;height:180px;left:-70px;top:-80px"></span>
          ${joinCardHtml()}
        </section>
        <section class="stack" style="gap:18px">
          <div class="card pad" style="padding:24px 28px">
            <span class="deco green" style="width:200px;height:200px;right:-70px;top:-90px"></span>
            <div class="row">
              <div>
                <h1 class="section-title" style="font-size:30px">모둠 대기실</h1>
                <p class="section-desc" id="lobby-desc">모둠 태블릿이 들어와 친구 이름을 쓰면 여기에 보여요.</p>
              </div>
              <div class="spacer"></div>
              <span class="chip" id="count">0모둠</span>
              <button type="button" class="btn btn-apricot btn-lg" data-act="start" id="start-btn">${ICON.play}질문 룰렛 시작!</button>
            </div>
          </div>
          <div class="groups-grid" id="groups"></div>
          ${themeBox()}
        </section>
      </div>`;
  }
  const joined = joinedGroups();
  $('#count').textContent = `태블릿 ${joined.length}/${S.game.groupCount}모둠`;
  $('#start-btn').disabled = joined.length === 0;
  $('#lobby-desc').textContent = joined.length ? '모둠 카드를 누르면 태블릿 연결을 풀 수 있어요.' : '모둠 태블릿이 들어와 친구 이름을 쓰면 여기에 보여요.';
  let html = '';
  for (let g = 1; g <= S.game.groupCount; g++) {
    const c = groupColor(g);
    const names = namesOf(g);
    const has = names.length > 0;
    const fresh = isFresh(g);
    html += `<${has ? 'button type="button" data-act="group-menu" data-g="' + g + '"' : 'div'} class="group-card ${has ? 'clickable' : ''}" aria-label="${g}모둠${has ? ' 태블릿 관리' : ''}">
      <div class="gh" style="background:${c.soft};color:${c.ink}">
        <span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span>${g}모둠
        <span class="spacer"></span>
        ${has ? `<span class="conn ${fresh ? '' : 'off'}"><span class="dot ${fresh ? '' : 'off'}"></span>${fresh ? '태블릿 연결됨' : '연결 확인 중'}</span>` : ''}
      </div>
      <div class="gb">${
        has
          ? names.map((n, i) => `<span class="pchip" style="cursor:inherit"><span class="ord">${i + 1}</span>${esc(n)}</span>`).join('')
          : '<span class="empty">아직 태블릿이 들어오지 않았어요</span>'
      }</div>
    </${has ? 'button' : 'div'}>`;
  }
  $('#groups').innerHTML = html;
}

function groupMenu(g) {
  const names = namesOf(g);
  if (!names.length) return;
  const m = openModal(`<h2>${g}모둠 태블릿</h2>
    <p>차례: ${names.map(esc).join(' → ') || '없음'}</p>
    <p style="font-size:16px;color:var(--ink-3)">다른 모둠이 잘못 들어왔거나 태블릿을 바꿔야 할 때 연결을 풀어요. 연결을 풀어도 이 모둠이 저장한 질문은 그대로 남고, 새 태블릿으로 같은 모둠에 들어오면 이어서 할 수 있어요.</p>
    <div class="actions">
      <button type="button" class="btn btn-danger" data-release>연결 풀기</button>
      <button type="button" class="btn btn-cream" data-close>닫기</button>
    </div>`);
  m.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-release]')) {
      m.close();
      try {
        S.game = await S.cli.release(S.code, g);
        S.builtSig = '';
        render();
        toast(`${g}모둠 태블릿 연결을 풀었어요.`, 'good');
      } catch (err) {
        toast(explain(err), 'warn');
      }
    } else if (e.target.closest('[data-close]')) m.close();
  });
}

async function startGame() {
  const joined = joinedGroups();
  if (!joined.length) return toast('들어온 모둠 태블릿이 아직 없어요.', 'warn');
  const empty = [];
  for (let g = 1; g <= S.game.groupCount; g++) if (!joined.includes(g)) empty.push(g);
  if (empty.length) {
    const ok = await confirmBox({
      title: '질문 룰렛을 시작할까요?',
      body: esc(`${empty.join(', ')}모둠은 아직 태블릿이 들어오지 않았어요. 놀이 중에 들어오면 남은 시간 동안 함께할 수 있어요.`),
      ok: '시작하기',
    });
    if (!ok) return;
  }
  const btn = $('#start-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '시작 신호 보내는 중…';
  }
  try {
    S.game = await S.cli.stage(S.code, 'start');
    render();
  } catch (e) {
    toast('시작하지 못했어요. ' + explain(e), 'warn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${ICON.play}질문 룰렛 시작!`;
    }
  }
}

// ════════════════════════════════════════════════
// 3. 진행 (전자칠판): 규칙 · 질문 틀(바꾸기 방법) · 남은 시간
// ════════════════════════════════════════════════

const RULES = {
  roulette: ['차례인 친구가 "룰렛 돌리기"를 눌러요', '나온 질문 틀 + 제시어로 질문 만들기', '저장하면 태블릿을 다음 친구에게'],
  change: ['우리 모둠 질문을 하나 골라요', '딱 한 마디만 바꿔 새 질문 만들기', '바꾸는 방법이 궁금하면 TIP 카드!'],
};
const RULE_TONE = ['', 'butter', 'apricot'];

const CHEERS = {
  roulette: [
    '마음에 안 드는 조합이 나오면 한 번 더 돌릴 수 있어요 (차례마다 1번)',
    '질문을 저장했으면 태블릿을 다음 친구에게 넘겨요',
    '엉뚱한 조합도 좋아요. 어떤 질문이 나올까요?',
    '앞에 나온 우리 모둠 질문과 겹치지 않게 만들어요',
  ],
  change: [
    '묻는 말, 대상, 때만 있는 게 아니에요. 장소, 입장, 크기도 바꿔 봐요',
    '한 마디만 바꿔도 전혀 다른 질문이 될 수 있어요',
    '같은 질문을 여러 방법으로 바꿔 봐도 좋아요',
    '바꾼 질문을 저장하면 태블릿을 다음 친구에게 넘겨요',
  ],
};

function boardShell(stage, inner, foot) {
  const n = stage === 'change' ? 2 : 1;
  return `
    <header class="topbar">${brandHtml('2차시 · 질문하는 힘 기르기')}<div class="spacer"></div>
      <span class="chip cream" style="font-size:18px">게임 코드 <b style="letter-spacing:.12em;margin-left:4px">${esc(S.code)}</b></span>
      <button type="button" class="btn btn-ghost btn-sm" data-act="sound" id="sound-btn"></button>
      <button type="button" class="btn btn-cream btn-sm" data-act="join-info">태블릿 입장 안내</button>
    </header>
    <div class="board-head r2-head">
      <div class="card stage-card">
        <div class="eyebrow">지금 활동</div>
        <div class="st"><span class="n">${n}</span>${STAGE_LABEL[stage]}</div>
        <div class="theme">대주제 · <b>${esc((S.game.theme && S.game.theme.name) || '')}</b></div>
      </div>
      <div class="card rules">${RULES[stage].map((r, i) => `<span class="chip ${RULE_TONE[i]}">${esc(r)}</span>`).join('')}</div>
      <div class="card timer-card">
        <div class="lbl" id="timer-lbl">남은 시간</div>
        <div class="timer" id="timer" aria-live="off">--:--</div>
        <div class="progress" aria-hidden="true"><i id="prog" style="width:100%"></i></div>
      </div>
    </div>
    ${inner}
    <div class="board-foot">${foot}</div>
    <div id="cover"></div>`;
}

function renderBoard(stage) {
  const key = 'board:' + stage;
  if (S.built !== key) {
    S.built = key;
    setLayout('board');
    const t = S.game.theme || { name: '', words: [] };
    const main =
      stage === 'roulette'
        ? `<section class="card" style="padding:18px 20px" aria-labelledby="fp">
            <h2 class="panel-title" id="fp"><span class="chip apricot">질문 틀</span>룰렛에 나오는 질문 틀 12가지</h2>
            <div class="frame-grid">${FRAMES_BOARD.map((f) => `<div class="frame-card">${esc(f.text)}</div>`).join('')}</div>
          </section>`
        : `<section class="card" style="padding:18px 20px" aria-labelledby="mp">
            <h2 class="panel-title" id="mp"><span class="chip butter">TIP</span>한 마디 바꾸기 방법 (이것 말고도 좋아요!)</h2>
            <div class="base-ex">원래 질문 <b>${esc(METHOD_BASE)}</b> 에서 한 마디만 바꾸면…</div>
            <div class="method-grid board-methods">${methodCards()}</div>
          </section>`;
    app.innerHTML = boardShell(
      stage,
      `<div class="r2-board">
        ${main}
        <aside class="side-stack">
          <div class="card words-card">
            <h2 class="panel-title" style="font-size:19px"><span class="chip">제시어</span>${esc(t.name)}</h2>
            <div class="word-cloud">${t.words.map((w) => `<span class="chip">${esc(w)}</span>`).join('')}</div>
          </div>
          <div class="card grow">
            <h2 class="panel-title" style="font-size:19px">모둠 태블릿</h2>
            <div class="tablet-list" id="tablets"></div>
          </div>
        </aside>
      </div>`,
      `<div class="cheer">${catSvg(64)}<span class="bubble" id="cheer">곧 시작해요!</span></div>
        <div class="spacer"></div>
        <button type="button" class="btn btn-cream" data-act="pause" id="pause-btn"></button>
        <button type="button" class="btn btn-apricot" data-act="end">${ICON.flag}${stage === 'change' ? '바꾸기 끝!' : '룰렛 끝!'}</button>`
    );
    S.builtSig = '';
    tick();
  }
  renderTablets();
  updateSoundBtn();
  updateBoardState();
}

function methodCards() {
  return METHODS.map(
    (m, i) => `<div class="method-card"><div class="mn"><span class="n">${i + 1}</span>${esc(m.name)}</div><div class="mx">${markEx(m.ex, esc)}</div></div>`
  ).join('');
}

function renderTablets() {
  const box = $('#tablets');
  if (!box) return;
  const sig = JSON.stringify([S.game.groups, Object.keys(S.seen).map((g) => isFresh(g))]);
  if (sig === S.builtSig) return;
  S.builtSig = sig;
  let html = '';
  for (let g = 1; g <= S.game.groupCount; g++) {
    const c = groupColor(g);
    const names = namesOf(g);
    const fresh = isFresh(g);
    const has = names.length > 0;
    html += `<${has ? `button type="button" data-act="group-menu" data-g="${g}"` : 'div'} class="tablet-row">
      <span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span>
      <span class="nm">${has ? esc(names.join(' · ')) : '태블릿 없음'}</span>
      ${has ? `<span class="st ${fresh ? '' : 'off'}" title="${fresh ? '연결됨' : '확인 중'}"><span class="dot ${fresh ? '' : 'off'}"></span><span class="lbl">${fresh ? '연결됨' : '확인 중'}</span></span>` : ''}
    </${has ? 'button' : 'div'}>`;
  }
  box.classList.toggle('two', S.game.groupCount > 4);
  box.innerHTML = html;
}

function updateBoardState() {
  const s = st();
  const paused = s.status === 'paused';
  const ready = s.status === 'ready';
  const pb = $('#pause-btn');
  if (pb) {
    pb.innerHTML = paused ? `${ICON.play}다시 시작` : `${ICON.pause}잠깐 멈춤`;
    pb.disabled = ready;
  }
  const cover = $('#cover');
  if (!cover) return;
  let html = '';
  if (paused)
    html = `<div class="pause-cover" role="dialog" aria-label="잠깐 멈춤">${catSvg(120)}<div>잠깐 멈췄어요</div>
        <div style="font-size:20px;font-weight:400;color:var(--ink-2)">남은 시간 ${formatClock(s.remainingMs || 0)}</div>
        <button type="button" class="btn btn-primary btn-lg" data-act="pause">${ICON.play}다시 시작</button></div>`;
  else if (ready) {
    const sec = Math.max(1, Math.ceil((Number(s.goAt) - now()) / 1000));
    const again = Number(s.goAt) !== Number(s.startedAt);
    const first = s.stage === 'change' ? '한 마디 바꾸기를' : '질문 룰렛을';
    html = `<div class="pause-cover ready-cover" role="status">${catSvg(110)}
        <div>${again ? '곧 다시 시작해요!' : `곧 ${first} 시작해요!`}</div>
        <div class="ready-num">${sec}</div>
        <div style="font-size:20px;font-weight:400;color:var(--ink-2)">${again ? '태블릿을 든 친구부터 이어서 해요' : '모둠 태블릿은 첫 번째 친구가 들고 있어요'}</div></div>`;
  }
  const key = paused ? 'p' + s.remainingMs : ready ? 'r' + Math.ceil((Number(s.goAt) - now()) / 1000) : '';
  if (cover.dataset.key !== key) {
    cover.dataset.key = key;
    cover.innerHTML = html;
  }
}

function updateSoundBtn() {
  const b = $('#sound-btn');
  if (!b) return;
  const on = isSoundOn('teacher');
  b.innerHTML = `${on ? SOUND_ICON.on : SOUND_ICON.off}${on ? '소리 켜짐' : '소리 꺼짐'}`;
  b.setAttribute('aria-pressed', String(on));
}

function updateCheer(s, rem) {
  const el = $('#cheer');
  if (!el) return;
  let msg;
  const list = CHEERS[s.stage] || CHEERS.roulette;
  if (s.status === 'ready') msg = '곧 시작해요! 첫 번째 친구가 태블릿을 들어요';
  else if (s.status === 'paused') msg = '잠깐 쉬어 가요';
  else if (rem < 60000) msg = '1분도 안 남았어요! 쓰던 질문을 마무리해요';
  else msg = list[Math.floor((now() / 15000) % list.length)];
  if (el.textContent !== msg) el.textContent = msg;
}

function tick() {
  if (!S.code || !S.game) return;
  const t = now();
  const s = st();
  S.fx.update(s, t);
  if (s.status === 'playing' && s.goAt && Number(s.goAt) !== Number(s.startedAt) && S.lastGoAt !== s.goAt && t - Number(s.goAt) < 3000) {
    S.lastGoAt = s.goAt;
    if (isSoundOn('teacher')) bell({ strikes: 1, base: 880 });
    flashBanner('다시 시작!', '', 1400);
  }
  if (s.view !== S.view) return render();
  if (s.view === 'roulette' || s.view === 'change') {
    const rem = remainingOfR2(s, t, S.game);
    const total = (S.game.durations[s.stage] || 1) * 1000;
    const timer = $('#timer');
    if (timer) {
      timer.textContent = formatClock(rem);
      timer.classList.toggle('low', s.status === 'playing' && rem < 30000);
      $('#prog').style.width = `${Math.max(0, Math.min(100, (rem / total) * 100))}%`;
      $('#timer-lbl').textContent = s.status === 'paused' ? '멈춤' : s.status === 'ready' ? '시작 준비' : '남은 시간';
    }
    updateCheer(s, rem);
    updateBoardState();
    renderTablets();
  }
  // 마감 시각이 지나면 서버에도 끝났다고 적어 둔다 (목록 표시용)
  if (s.status === 'ended' && S.game.status !== 'ended' && !S.ending) {
    S.ending = true;
    S.cli
      .stage(S.code, 'end')
      .then((g) => {
        if (g && g.code === S.code) S.game = g;
      })
      .catch(() => {})
      .finally(() => (S.ending = false));
  }
}

async function togglePause() {
  const s = st();
  try {
    if (s.status === 'playing') S.game = await S.cli.stage(S.code, 'pause');
    else if (s.status === 'paused') S.game = await S.cli.stage(S.code, 'resume');
    else return;
    render();
  } catch (e) {
    toast('바꾸지 못했어요. 다시 눌러 주세요.', 'warn');
  }
}

async function endNow() {
  const s = st();
  const ok = await confirmBox({
    title: s.stage === 'change' ? '한 마디 바꾸기를 끝낼까요?' : '질문 룰렛을 끝낼까요?',
    body:
      s.stage === 'change'
        ? '남은 시간과 상관없이 바로 끝나요. 모둠 태블릿이 질문을 보내면 원래 질문과 바꾼 질문을 함께 볼 수 있어요.'
        : '남은 시간과 상관없이 바로 끝나요. 모둠 질문을 모아 본 뒤, 원하는 때에 한 마디 바꾸기를 시작할 수 있어요.',
    ok: '끝내기',
  });
  if (!ok) return;
  try {
    S.game = await S.cli.stage(S.code, 'end');
    render();
  } catch (e) {
    toast('끝내지 못했어요. ' + explain(e), 'warn');
  }
}

function joinInfo() {
  const m = openModal(`<div style="text-align:center">${joinCardHtml()}</div>
    <div class="actions" style="margin-top:18px"><button type="button" class="btn btn-cream" data-close>닫기</button></div>`);
  m.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) m.close();
    else if (e.target.closest('[data-act="copy-link"]')) copyLink();
    else if (e.target.closest('[data-act="open-student"]')) openStudentWindow();
  });
}

async function copyLink() {
  const ok = await copyText(joinUrl());
  toast(ok ? '입장 링크를 복사했어요. 클래스룸이나 패들렛에 붙여 넣어 주세요.' : '복사하지 못했어요.', ok ? 'good' : 'warn');
}

function openStudentWindow() {
  window.open(joinUrl(), '_blank', 'noopener');
}

// ════════════════════════════════════════════════
// 4. 모아보기
// ════════════════════════════════════════════════

function itemsOf(g) {
  return ((S.items && S.items[g]) || []).slice().sort((a, b) => a.no - b.no);
}

// 모아보기에 보일 모둠: 태블릿이 들어와 있거나 질문을 저장한 모둠
function collectGroups() {
  const set = new Set(joinedGroups());
  Object.keys(S.items || {}).forEach((g) => {
    if ((S.items[g] || []).length) set.add(Number(g));
  });
  return [...set].sort((a, b) => a - b);
}

function itemHtml(x, g, { showFrame = true } = {}) {
  const meta = [];
  if (showFrame && x.frame) meta.push(`<span class="mini frame">${esc(x.frame)}</span>`);
  if (showFrame && x.word) meta.push(`<span class="mini word">${esc(x.word)}</span>`);
  if (x.method) meta.push(`<span class="mini method">${esc(x.method)}</span>`);
  if (x.name) meta.push(`<span>${esc(x.name)}</span>`);
  return `<div class="qitem">
    <span class="no">${x.no}</span>
    <div><div class="q">${esc(x.text)}</div>${meta.length ? `<div class="m">${meta.join('')}</div>` : ''}</div>
    <div class="acts">
      <button type="button" class="icon-btn ${x.star ? 'on' : ''}" data-act="star" data-g="${g}" data-id="${esc(x.id)}" aria-pressed="${!!x.star}" aria-label="별표">${x.star ? ICON.star : ICON.starLine}</button>
      <button type="button" class="icon-btn danger" data-act="del-item" data-g="${g}" data-id="${esc(x.id)}" data-kind="${x.kind}" aria-label="이 질문 지우기">${ICON.trash}</button>
    </div>
  </div>`;
}

function arriveGrid(stage) {
  const groups = joinedGroups();
  Object.keys((S.game.done && S.game.done[stage]) || {}).forEach((g) => {
    if (!groups.includes(Number(g))) groups.push(Number(g));
  });
  groups.sort((a, b) => a - b);
  if (!groups.length) return '';
  return `<div class="arrive-grid" style="margin-top:18px">${groups
    .map((g) => {
      const c = groupColor(g);
      const ok = doneOf(stage, g);
      const n = itemsOf(g).filter((x) => x.kind === (stage === 'change' ? 'c' : 'r')).length;
      const has = namesOf(g).length > 0;
      return `<${has ? `button type="button" data-act="group-menu" data-g="${g}"` : 'div'} class="arrive-item ${ok ? 'ok' : ''}" style="--soft:${c.soft};--main:${c.main}">
        <span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span>
        <div><div class="gn">${g}모둠</div><div class="as">${ok ? `${ICON.check}도착! 질문 ${n}개` : `<span class="dots"><i></i><i></i><i></i></span>보내는 중 (${n}개 도착)`}</div></div>
      </${has ? 'button' : 'div'}>`;
    })
    .join('')}</div>`;
}

function collectTopbar() {
  return topbar(`<button type="button" class="btn btn-cream btn-sm" data-act="refresh">${ICON.refresh}새로 받기</button>
    <button type="button" class="btn btn-cream btn-sm" data-act="csv">${ICON.download}질문 내려받기 (CSV)</button>
    <button type="button" class="btn btn-ghost btn-sm" data-act="home">게임 목록</button>`);
}

function renderBreak() {
  const sig = JSON.stringify(['break', S.itemsSig, S.game.done, S.game.groups]);
  if (S.built === 'break' && S.builtSig === sig) return;
  S.built = 'break';
  S.builtSig = sig;
  setLayout('normal');
  const groups = collectGroups();
  const loading = S.items === null;
  const total = groups.reduce((a, g) => a + itemsOf(g).filter((x) => x.kind === 'r').length, 0);
  const missing = joinedGroups().filter((g) => !doneOf('roulette', g));
  const sections = loading
    ? '<div class="card empty-state">모둠 질문을 받아오는 중이에요…</div>'
    : groups.length
    ? groups
        .map((g) => {
          const c = groupColor(g);
          const list = itemsOf(g).filter((x) => x.kind === 'r');
          return `<section class="card result-group" aria-label="${g}모둠 질문">
            <div class="rh"><span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span><span class="gn">${g}모둠</span>
              <span class="chip" style="background:${c.soft};color:${c.ink}">질문 ${list.length}개</span>
              <span style="color:var(--ink-3)">${esc(namesOf(g).join(', '))}</span></div>
            <div class="q-list">${list.length ? list.map((x) => itemHtml(x, g)).join('') : '<div class="empty-state" style="padding:10px">아직 도착한 질문이 없어요.</div>'}</div>
          </section>`;
        })
        .join('')
    : '<div class="card empty-state">들어온 모둠이 없어요.</div>';
  const scrollY = window.scrollY;
  app.innerHTML = `
    ${collectTopbar()}
    <section class="card pad-lg">
      <span class="deco butter" style="width:280px;height:280px;right:-90px;top:-120px"></span>
      <div class="mascot-row">${catSvg(96)}<div class="bubble">땡! 질문 룰렛이 끝났어요.<br>우리 반이 룰렛으로 만든 질문은 <b>${total}개</b>예요.</div></div>
      <h1 class="display" style="font-size:clamp(34px,4.6vw,56px);margin:18px 0 0">질문 룰렛 모아보기</h1>
      ${arriveGrid('roulette')}
      ${
        missing.length
          ? `<p class="section-desc" style="margin-top:12px">${missing.join(', ')}모둠 태블릿이 질문을 마저 보내고 있어요. 이 화면에 저절로 더해져요.</p>`
          : ''
      }
    </section>
    <section class="card pad next-card" aria-labelledby="nx">
      <div class="row">
        <div style="flex:1 1 380px">
          <div class="t" id="nx">② 한 마디 바꾸기 (${minutesOf('change')}분)</div>
          <div class="d">준비가 되면 아래 버튼을 눌러요. 모든 모둠 태블릿이 함께 한 마디 바꾸기로 넘어가요.<br>잠시 쉬었다가 해도 돼요. ${esc(keepNote())} 그 안에는 이 브라우저의 <b>게임 목록 → 이어서 열기</b>로 다시 열 수 있어요.</div>
        </div>
        <button type="button" class="btn btn-apricot btn-lg" data-act="next-stage">${ICON.play}한 마디 바꾸기 시작</button>
      </div>
    </section>
    ${
      S.mode !== 'local'
        ? `<div class="notice" style="margin-top:16px"><div><strong>질문은 ${KEEP_H}시간 뒤 저절로 지워져요</strong>질문을 남겨 두려면 위쪽 <b>질문 내려받기 (CSV)</b>로 파일을 저장해 두세요.</div></div>`
        : ''
    }
    <div class="collect-grid">${sections}</div>
    <div class="row" style="margin-top:28px;justify-content:center">
      <button type="button" class="btn btn-danger" data-act="delete-room">${ICON.trash}게임 정리하기</button>
    </div>`;
  if (scrollY) window.scrollTo(0, scrollY);
}

async function startChange() {
  const missing = joinedGroups().filter((g) => !doneOf('roulette', g));
  const ok = await confirmBox({
    title: '한 마디 바꾸기를 시작할까요?',
    body: esc(
      `${minutesOf('change')}분 동안 해요. 모든 모둠 태블릿이 함께 넘어가요.` +
        (missing.length ? ` (${missing.join(', ')}모둠 질문이 아직 다 도착하지 않았어요. 태블릿이 연결되면 계속 보내져요.)` : '')
    ),
    ok: '시작하기',
  });
  if (!ok) return;
  try {
    S.game = await S.cli.stage(S.code, 'next');
    render();
  } catch (e) {
    toast('시작하지 못했어요. ' + explain(e), 'warn');
  }
}

function pairsHtml(g) {
  const list = itemsOf(g);
  const origs = list.filter((x) => x.kind === 'r');
  const changes = list.filter((x) => x.kind === 'c');
  const used = new Set();
  const out = origs.map((o) => {
    const ch = changes.filter((c) => Number(c.parentNo) === Number(o.no));
    ch.forEach((c) => used.add(c.id));
    return `<div class="pair ${ch.length ? '' : 'none'}">
      ${itemHtml(o, g)}
      ${ch.length ? `<div class="changes">${ch.map((c) => `<div class="row" style="gap:8px;flex-wrap:nowrap;align-items:flex-start"><span class="arrow" aria-hidden="true">→</span><div style="flex:1;min-width:0">${itemHtml(c, g, { showFrame: false })}</div></div>`).join('')}</div>` : '<div class="nochange">바꾼 질문이 없어요</div>'}
    </div>`;
  });
  const orphan = changes.filter((c) => !used.has(c.id));
  if (orphan.length)
    out.push(`<div class="pair"><div class="nochange" style="margin:0 0 6px">원래 질문이 지워진 바꾼 질문</div><div class="changes" style="margin-left:0">${orphan.map((c) => itemHtml(c, g, { showFrame: false })).join('')}</div></div>`);
  return out.join('') || '<div class="empty-state" style="padding:10px">질문이 없어요.</div>';
}

function renderDone() {
  const sig = JSON.stringify(['done', S.itemsSig, S.game.done, S.game.groups]);
  if (S.built === 'done' && S.builtSig === sig) return;
  S.built = 'done';
  S.builtSig = sig;
  setLayout('normal');
  const groups = collectGroups();
  const loading = S.items === null;
  let nr = 0;
  let nc = 0;
  groups.forEach((g) =>
    itemsOf(g).forEach((x) => {
      if (x.kind === 'c') nc++;
      else nr++;
    })
  );
  const missing = joinedGroups().filter((g) => !doneOf('change', g));
  const sections = loading
    ? '<div class="card empty-state">모둠 질문을 받아오는 중이에요…</div>'
    : groups.length
    ? groups
        .map((g) => {
          const c = groupColor(g);
          const list = itemsOf(g);
          const r = list.filter((x) => x.kind === 'r').length;
          return `<section class="card result-group" aria-label="${g}모둠 질문">
            <div class="rh"><span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span><span class="gn">${g}모둠</span>
              <span class="chip" style="background:${c.soft};color:${c.ink}">룰렛 ${r} · 바꾸기 ${list.length - r}</span>
              <span style="color:var(--ink-3)">${esc(namesOf(g).join(', '))}</span></div>
            <div class="pair-list" style="margin-top:12px">${pairsHtml(g)}</div>
          </section>`;
        })
        .join('')
    : '<div class="card empty-state">들어온 모둠이 없어요.</div>';
  const scrollY = window.scrollY;
  app.innerHTML = `
    ${collectTopbar()}
    <section class="card pad-lg">
      <span class="deco butter" style="width:300px;height:300px;right:-100px;top:-120px"></span>
      <span class="deco green" style="width:200px;height:200px;left:-70px;bottom:-100px"></span>
      <div class="mascot-row">${catSvg(96)}<div class="bubble">한 마디 바꾸기까지 모두 끝!<br>룰렛 질문 <b>${nr}개</b>, 바꾼 질문 <b>${nc}개</b>가 모였어요.</div></div>
      <h1 class="display" style="font-size:clamp(34px,4.6vw,56px);margin:18px 0 0">질문 모아보기</h1>
      ${missing.length ? arriveGrid('change') : ''}
      <div class="notice green" style="margin-top:18px"><div><strong>3차시에 이어서 쓰려면</strong>위쪽 <b>질문 내려받기 (CSV)</b>를 눌러 파일을 저장해 두세요. 3차시 프로그램에서 이 파일을 올리면 룰렛 질문과 바꾼 질문이 모두 들어가요.</div></div>
      ${
        S.mode !== 'local'
          ? `<div class="notice" style="margin-top:12px"><div><strong>질문은 ${KEEP_H}시간 뒤 저절로 지워져요</strong>CSV 파일을 꼭 내려받아 두세요.</div></div>`
          : ''
      }
    </section>
    <section class="card pad" style="margin-top:20px;background:var(--green-softer)">
      <div class="row"><span class="chip">함께 생각해요</span></div>
      <p style="font-size:clamp(22px,2.6vw,30px);font-weight:700;margin:12px 0 4px">한 마디만 바꿨는데 질문이 어떻게 달라졌나요?</p>
      <p class="section-desc">원래 질문과 바꾼 질문을 견주어 보며, 더 알아보고 싶어진 질문에 별표를 눌러 보세요.</p>
    </section>
    <div class="collect-grid">${sections}</div>
    <div class="row" style="margin-top:28px;justify-content:center">
      <button type="button" class="btn btn-ghost" data-act="home">새 게임 만들기</button>
      <button type="button" class="btn btn-danger" data-act="delete-room">${ICON.trash}게임 정리하기</button>
    </div>`;
  if (scrollY) window.scrollTo(0, scrollY);
}

// 3차시에 올릴 CSV: 원래 질문 번호는 이 파일 안의 번호로 바꿔 적는다.
function exportCsv() {
  if (!S.items) return toast('질문을 받아오는 중이에요. 잠시 뒤 다시 눌러 주세요.', 'warn');
  const theme = (S.game.theme && S.game.theme.name) || '';
  const rows = [CSV_HEAD];
  const numOf = {};
  let n = 0;
  const groups = collectGroups();
  groups.forEach((g) => itemsOf(g).forEach((x) => (numOf[`${g}:${x.no}`] = ++n)));
  groups.forEach((g) =>
    itemsOf(g).forEach((x) => {
      const parent = x.kind === 'c' && x.parentNo ? numOf[`${g}:${x.parentNo}`] || '' : '';
      rows.push([numOf[`${g}:${x.no}`], `${g}모둠`, KIND_LABEL[x.kind] || KIND_LABEL.r, x.text, x.frame || '', x.word || '', parent, x.method || '', x.name || '', x.star ? '★' : '', theme]);
    })
  );
  if (rows.length === 1) return toast('아직 내려받을 질문이 없어요.', 'warn');
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  downloadText(`질문룰렛_${S.code}_${stamp}.csv`, csv);
  toast(`질문 ${rows.length - 1}개를 내려받았어요. 3차시 프로그램에 올릴 수 있어요.`, 'good');
}


async function deleteGame(code, cli) {
  const ok = await confirmBox({
    title: `${code} 게임을 지울까요?`,
    body: '이 게임의 질문까지 모두 지워져요. 지운 뒤에는 되돌릴 수 없어요. 필요하면 먼저 CSV로 내려받아 두세요.',
    ok: '모두 지우기',
    danger: true,
  });
  if (!ok) return false;
  try {
    await cli.deleteGame(code, true);
    toast('게임과 질문을 모두 지웠어요.', 'good');
    return true;
  } catch (e) {
    toast('지우지 못했어요. ' + explain(e), 'warn');
    return false;
  }
}

async function editItem(g, id, op, value) {
  try {
    const map = await S.cli.editItem(S.code, g, id, op, value);
    setItems(map);
  } catch (e) {
    toast('바꾸지 못했어요. ' + explain(e), 'warn');
  }
}

// ════════════════════════════════════════════════
// 클릭 처리
// ════════════════════════════════════════════════

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const f = S.form;
  switch (act) {
    case 'practice':
      f.mode = f.mode === 'local' ? defaultMode() : 'local';
      renderForm();
      loadGameList();
      window.scrollTo(0, 0);
      break;
    case 'theme': {
      const id = el.dataset.id;
      if (id === f.themeId) break;
      f.themeId = id;
      f.removed = [];
      if (id === 'custom') {
        f.themeName = '';
        f.words = [];
      } else {
        f.themeName = themeById(id).name;
        f.words = themeWordsOf(id);
      }
      renderForm();
      if (id === 'custom' && $('#theme-name')) $('#theme-name').focus();
      break;
    }
    case 'word-del': {
      const w = f.words.splice(Number(el.dataset.i), 1)[0];
      if (w) f.removed.push(w);
      renderForm();
      break;
    }
    case 'word-add-spare': {
      const msg = addWord(el.dataset.w);
      if (msg) toast(msg, 'warn');
      renderForm();
      break;
    }
    case 'word-add':
      submitWord();
      break;
    case 't-roulette':
      f.roulette = Number(el.dataset.v);
      renderForm();
      break;
    case 't-change':
      f.change = Number(el.dataset.v);
      renderForm();
      break;
    case 'groups-dec':
      f.groups = Math.max(MIN_GROUPS, f.groups - 1);
      renderForm();
      break;
    case 'groups-inc':
      f.groups = Math.min(MAX_GROUPS, f.groups + 1);
      renderForm();
      break;
    case 'dup':
      f.dupMode = el.dataset.v;
      renderForm();
      break;
    case 'create':
      createGame();
      break;
    case 'open-room':
      openGame(f.mode, el.dataset.code).catch((err) => {
        toast(explain(err), 'warn');
        showHome();
      });
      break;
    case 'del-room': {
      const cli = await teacherClient(f.mode).catch(() => null);
      if (cli && (await deleteGame(el.dataset.code, cli))) loadGameList();
      break;
    }
    case 'home':
      showHome();
      break;
    case 'copy-link':
      copyLink();
      break;
    case 'open-student':
      openStudentWindow();
      break;
    case 'group-menu':
      groupMenu(Number(el.dataset.g));
      break;
    case 'start':
      startGame();
      break;
    case 'pause':
      togglePause();
      break;
    case 'end':
      endNow();
      break;
    case 'next-stage':
      startChange();
      break;
    case 'join-info':
      joinInfo();
      break;
    case 'sound':
      setSoundOn('teacher', !isSoundOn('teacher'));
      updateSoundBtn();
      if (isSoundOn('teacher')) beep({ freq: 880, dur: 0.12, vol: 0.3 });
      toast(isSoundOn('teacher') ? '효과음을 켰어요.' : '효과음을 껐어요.');
      break;
    case 'refresh':
      S.itemsSince = Date.now();
      loadItems();
      poll();
      toast('새로 받아 왔어요.');
      break;
    case 'csv':
      exportCsv();
      break;
    case 'star': {
      const list = itemsOf(el.dataset.g);
      const x = list.find((y) => y.id === el.dataset.id);
      if (x) editItem(el.dataset.g, x.id, 'star', !x.star);
      break;
    }
    case 'del-item': {
      const orig = el.dataset.kind !== 'c' && S.view === 'done';
      const ok = await confirmBox({
        title: '이 질문을 지울까요?',
        body: orig ? '부적절한 질문일 때만 지워 주세요. 이 질문을 바꾼 질문은 남아 있어요.' : '부적절한 질문일 때만 지워 주세요. 지운 질문은 되돌릴 수 없어요.',
        ok: '지우기',
        danger: true,
      });
      if (ok) editItem(el.dataset.g, el.dataset.id, 'delete');
      break;
    }
    case 'delete-room': {
      const { cli, code } = S;
      if (await deleteGame(code, cli)) showHome();
      break;
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.code) {
    poll();
    if (S.view === 'break' || S.view === 'done') loadItems();
  }
});

// ════════════════════════════════════════════════
// 시작
// ════════════════════════════════════════════════

(async function boot() {
  const p = new URLSearchParams(location.search);
  const room = p.get('room');
  if (room) {
    const m = p.get('mode');
    const mode = m === 'local' ? 'local' : 'server';
    try {
      await openGame(mode, room);
      return;
    } catch (e) {
      console.warn(e);
      toast(explain(e), 'warn');
    }
  }
  showHome();
})();
