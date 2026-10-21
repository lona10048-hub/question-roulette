// 모둠 태블릿 화면 (2차시 질문 룰렛 놀이)
// 코드 입력 → 모둠 고르기 → 친구 이름·차례 → 대기(룰렛 미리 보기) → ① 질문 룰렛 → 잠시 멈춤 → ② 한 마디 바꾸기 → 끝
// 차례와 룰렛은 이 태블릿 안에서 처리하고, 질문은 저장할 때마다 서버로 보낸다.
// 보내지 못한 질문은 모아 두었다가 다시 보내고, 활동이 끝나면 "다 보냈어요" 표시를 남긴다.

import { $, esc, toast, openModal, confirmBox, watchConnection, brandHtml, catSvg, ICON, isComposingEnter } from './ui.js';
import { groupColor, cleanQuestion, cleanName, findOverlap, normalizeQuestion, formatClock, MAX_TEXT, NAME_MAX } from './game.js';
import { createTimerFx, isSoundOn, setSoundOn, SOUND_ICON, bell, beep, flashBanner, tick as tickSound, ding, unlockAudio } from './effects.js';
import { hasServer, explainError } from './api.js';
import { tabletClient, deriveR2, remainingOfR2 } from './r2api.js';
import { FRAMES, METHODS, METHOD_BASE, METHOD_FREE, markEx, hasFrame, hasWord, sameText } from './content.js';
import { Wheel, WHEEL_PALETTES, randomIndex } from './wheel.js';

const app = document.getElementById('app');
const SESSION_KEY = 'qr2-tablet';
const MAX_MEMBERS = 8;
const RESPINS = 1; // 차례마다 한 번 더 돌릴 수 있는 횟수

const blankSpin = () => ({ frame: null, word: null, spun: false, respin: RESPINS });

const T = {
  cli: null,
  target: null, // 'server' | 'local'
  code: null,
  game: null,
  group: null,
  token: null,
  names: [],
  items: [],
  outbox: [],
  turn: { roulette: 0, change: 0 },
  spin: blankSpin(),
  pickOrig: null,
  method: '',
  doneSent: { roulette: false, change: false },
  tipShown: false,
  view: 'join',
  built: null,
  draftNames: null,
  pickedGroup: null,
  pending: null,
  loop: null,
  pollTimer: null,
  flushTimer: null,
  finishTimer: null,
  flushing: false,
  finishing: false,
  stopConn: null,
  spinning: false,
  justSpun: false,
  fx: createTimerFx('student', (s) =>
    s.stage === 'change'
      ? { start: '한 마디 바꾸기 시작!', startSub: '우리 모둠 질문을 골라 한 마디만 바꿔요', endSub: '바꾼 질문을 선생님께 보내요' }
      : { start: '질문 룰렛 시작!', startSub: '첫 번째 친구가 룰렛을 돌려요', endSub: '만든 질문을 선생님께 보내요' }
  ),
  lastGoAt: null,
  synced: {},
};

// ════════════════════════════════════════════════
// 이어서 하기 (껐다 켜도 이어지도록)
// ════════════════════════════════════════════════

const isLocal = () => T.target === 'local';
const store = () => (isLocal() ? sessionStorage : localStorage);

function saveSession() {
  if (!T.code) return;
  try {
    store().setItem(
      SESSION_KEY,
      JSON.stringify({
        target: T.target,
        code: T.code,
        group: T.group,
        token: T.token,
        names: T.names,
        items: T.items,
        outbox: T.outbox,
        turn: T.turn,
        spin: T.spin,
        doneSent: T.doneSent,
        tipShown: T.tipShown,
      })
    );
  } catch (e) {}
}

function loadSession(local) {
  try {
    const raw = (local ? sessionStorage : localStorage).getItem(SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.code && (s.target === 'server' || s.target === 'local') ? s : null;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

const now = () => (T.cli ? T.cli.serverNow() : Date.now());
const st = () => deriveR2(T.game, now());
// 여러 학교가 함께 쓰는 서버: 실명 대신 번호나 별명을 쓰도록 안내 (연습 모드는 빼고)
const isShared = () => T.target === 'server';
const words = () => (T.game && T.game.theme && T.game.theme.words) || [];
const themeName = () => (T.game && T.game.theme && T.game.theme.name) || '';
const frameById = (id) => FRAMES.find((f) => f.id === id) || null;
const sorted = (list) => list.slice().sort((a, b) => a.no - b.no);
const origs = () => sorted(T.items.filter((x) => x.kind === 'r'));
const changes = () => sorted(T.items.filter((x) => x.kind === 'c'));

function explain(e) {
  return explainError(e, 'student');
}

function topbar(right = '') {
  const sub = T.group ? `${T.group}모둠 태블릿` : '모둠 태블릿용 · 2차시';
  return `<header class="topbar">${brandHtml(sub)}<div class="spacer"></div>${right}</header>`;
}

function soundBtn() {
  const on = isSoundOn('student');
  return `<button type="button" class="btn btn-ghost btn-sm" data-act="sound" id="sound-btn" aria-pressed="${on}">${on ? SOUND_ICON.on : SOUND_ICON.off}${on ? '소리 켜짐' : '소리 꺼짐'}</button>`;
}

const themeChip = () => (themeName() ? `<span class="chip cream">대주제 <b style="margin-left:4px">${esc(themeName())}</b></span>` : '');

// ════════════════════════════════════════════════
// 1. 게임 코드 입력
// ════════════════════════════════════════════════

function renderJoin(prefill = '', error = '') {
  stopLoops();
  T.view = 'join';
  T.built = null;
  app.innerHTML = `
    ${topbar(`<a class="btn btn-cream btn-sm" href="index.html">${ICON.back}처음으로</a>`)}
    <section class="card pad-lg center-card" aria-labelledby="h">
      <span class="deco butter" style="width:220px;height:220px;right:-80px;top:-90px"></span>
      <span class="deco green" style="width:160px;height:160px;left:-60px;bottom:-70px"></span>
      <div class="mascot-row" style="margin-bottom:18px">${catSvg(92)}<div class="bubble">우리 모둠 태블릿이에요!<br>선생님이 알려 준 <b>게임 코드</b>를 입력해 봐요.</div></div>
      <h1 id="h" class="sr-only">질문 룰렛 놀이 입장</h1>
      <form id="join-form" class="stack" style="gap:20px" novalidate>
        <div class="field">
          <label for="code">게임 코드</label>
          <input class="input code" id="code" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]*" placeholder="0000" value="${esc(prefill)}">
        </div>
        <div id="join-err" aria-live="assertive">${error ? `<div class="notice apricot"><div>${esc(error)}</div></div>` : ''}</div>
        <button type="submit" class="btn btn-apricot btn-lg" id="join-btn">들어가기 ${ICON.arrow}</button>
      </form>
    </section>`;
  const codeEl = $('#code');
  codeEl.addEventListener('input', () => {
    codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 4);
  });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    findGame($('#code').value.trim());
  });
  setTimeout(() => {
    if (T.view === 'join' && $('#code')) $('#code').focus();
  }, 50);
}

function joinError(msg) {
  const box = $('#join-err');
  if (box) box.innerHTML = `<div class="notice apricot"><div>${esc(msg)}</div></div>`;
  const btn = $('#join-btn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `들어가기 ${ICON.arrow}`;
  }
}

// 게임은 서버에서 찾는다. 연습 모드 링크(mode=local)로 열었으면 이 컴퓨터 안에서 찾는다.
function candidates() {
  if (urlMode === 'local') return ['local'];
  return hasServer() ? ['server', 'local'] : ['local'];
}

async function findGame(code) {
  if (!/^\d{4}$/.test(code)) return joinError('게임 코드 4자리를 입력해 주세요.');
  const btn = $('#join-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '찾는 중…';
  }
  let lastErr = null;
  const tries = candidates();
  for (const target of tries) {
    try {
      const cli = await tabletClient(target);
      const game = await cli.info(code);
      const sess = loadSession(target === 'local');
      if (sess && sess.code === code && sess.target === target) return restore(sess, cli, game);
      setClient(cli, target);
      resetGame(code);
      T.game = game;
      startLoops();
      render();
      return;
    } catch (e) {
      // 다른 곳에 있는 게임일 수 있으니 계속 찾아본다. 알려 줄 오류는 '없는 게임'보다 다른 오류를 먼저
      if (!lastErr || (lastErr.code === 'NO_GAME' && e.code !== 'NO_GAME')) lastErr = e;
    }
  }
  if (!hasServer() && urlMode !== 'local') return joinError('아직 서버가 준비되지 않았어요. 선생님께 알려 주세요.');
  joinError(lastErr ? explain(lastErr) : '게임 코드를 다시 확인해 주세요.');
}

function setClient(cli, target) {
  T.cli = cli;
  T.target = target;
  if (T.stopConn) T.stopConn();
  T.stopConn = watchConnection(cli);
}

function resetGame(code) {
  Object.assign(T, {
    code,
    game: null,
    group: null,
    token: null,
    names: [],
    items: [],
    outbox: [],
    turn: { roulette: 0, change: 0 },
    spin: blankSpin(),
    pickOrig: null,
    method: '',
    doneSent: { roulette: false, change: false },
    tipShown: false,
    draftNames: null,
    pickedGroup: null,
    pending: null,
    synced: {},
  });
}

function restore(sess, cli, game) {
  setClient(cli, sess.target);
  resetGame(sess.code);
  Object.assign(T, {
    group: sess.group || null,
    token: sess.token || null,
    names: sess.names || [],
    items: Array.isArray(sess.items) ? sess.items : [],
    outbox: Array.isArray(sess.outbox) ? sess.outbox : [],
    turn: { roulette: 0, change: 0, ...(sess.turn || {}) },
    spin: { ...blankSpin(), ...(sess.spin || {}) },
    doneSent: { roulette: false, change: false, ...(sess.doneSent || {}) },
    tipShown: !!sess.tipShown,
  });
  T.game = game;
  startLoops();
  render();
  if (T.group && T.token) {
    syncItems();
    if (T.outbox.length) flush();
  }
}

// ════════════════════════════════════════════════
// 상태 확인
// ════════════════════════════════════════════════

function stopLoops() {
  clearInterval(T.loop);
  clearTimeout(T.pollTimer);
  clearTimeout(T.flushTimer);
  clearTimeout(T.finishTimer);
  T.loop = null;
  T.pollTimer = null;
  T.flushTimer = null;
  T.finishTimer = null;
}

function startLoops() {
  stopLoops();
  T.loop = setInterval(tick, 250);
  poll();
}

function pollDelay() {
  const P = (name) => T.cli.pollMs(name);
  if (document.hidden) return P('hidden');
  const s = st();
  if (!s || s.view === 'lobby') return P('tabletLobby');
  if (s.view === 'roulette' || s.view === 'change') return P('tabletPlay');
  if (s.view === 'break') return P('tabletWaitReveal');
  return P('tabletDone');
}

async function poll() {
  clearTimeout(T.pollTimer);
  if (!T.code || !T.cli) return;
  const code = T.code;
  try {
    const res = await T.cli.poll(code, T.group || '', T.token || '');
    if (T.code !== code) return;
    if (res.gone) return gone('선생님이 게임을 정리했어요. 새 게임 코드를 입력해 주세요.');
    T.game = res.game;
    if (T.group && T.token && res.mine === false) released();
    render();
  } catch (e) {
    if (e.code === 'NO_GAME') return gone('선생님이 게임을 정리했어요. 새 게임 코드를 입력해 주세요.');
  } finally {
    if (T.code === code) T.pollTimer = setTimeout(poll, pollDelay());
  }
}

function released() {
  toast('선생님이 이 태블릿의 모둠 연결을 풀었어요. 모둠을 다시 골라 주세요.', 'warn');
  Object.assign(T, { group: null, token: null, items: [], outbox: [], pickOrig: null, spin: blankSpin(), synced: {} });
  saveSession();
}

function gone(msg) {
  stopLoops();
  clearSession();
  Object.assign(T, { code: null, game: null, group: null, token: null, names: [], items: [] });
  renderJoin('', msg);
}

// 서버의 우리 모둠 질문 + 아직 못 보낸 질문 (선생님이 지운 질문은 빠진다)
function mergeItems(server) {
  const map = new Map();
  (server || []).forEach((x) => map.set(x.id, x));
  T.items.forEach((x) => {
    if (T.outbox.includes(x.id) && !map.has(x.id)) map.set(x.id, x);
  });
  T.items = sorted([...map.values()]);
  T.outbox = T.outbox.filter((id) => map.has(id) && !(server || []).some((x) => x.id === id));
}

async function syncItems() {
  if (!T.group || !T.token) return;
  const code = T.code;
  try {
    const list = await T.cli.mine(T.code, T.group, T.token);
    if (T.code !== code) return;
    mergeItems(list);
    saveSession();
    render();
  } catch (e) {
    if (e.code === 'NOT_MINE') {
      released();
      render();
    }
  }
}

// 저장한 질문 보내기 (같은 질문을 두 번 보내도 서버가 한 번만 저장한다)
async function flush() {
  clearTimeout(T.flushTimer);
  T.flushTimer = null;
  if (T.flushing || !T.outbox.length || !T.token) return;
  T.flushing = true;
  const ids = T.outbox.slice();
  const list = T.items.filter((x) => ids.includes(x.id));
  const code = T.code;
  try {
    if (list.length)
      await T.cli.put(
        T.code,
        T.group,
        T.token,
        list.map((x) => ({ id: x.id, no: x.no, kind: x.kind, text: x.text, frame: x.frame || '', word: x.word || '', parentNo: x.parentNo || null, method: x.method || '', name: x.name || '', at: x.at || now() }))
      );
    if (T.code !== code) return;
    T.outbox = T.outbox.filter((id) => !ids.includes(id));
    saveSession();
  } catch (e) {
    if (e.code === 'NOT_MINE') {
      released();
      render();
    } else if (T.code === code) T.flushTimer = setTimeout(flush, 3000);
  } finally {
    T.flushing = false;
    drawSendStatus();
    if (T.outbox.length && !T.flushTimer && T.token) T.flushTimer = setTimeout(flush, 1500);
  }
}

// 활동이 끝나면: 남은 질문을 모두 보내고 "다 보냈어요" 표시
async function finishStage(stage) {
  if (T.doneSent[stage] || T.finishing || !T.token) return;
  clearTimeout(T.finishTimer);
  T.finishing = true;
  const code = T.code;
  try {
    if (T.outbox.length) await flush();
    if (T.outbox.length) throw Object.assign(new Error('PENDING'), { code: 'PENDING' });
    await T.cli.done(T.code, T.group, T.token, stage);
    if (T.code !== code) return;
    T.doneSent[stage] = true;
    saveSession();
  } catch (e) {
    if (e.code === 'NOT_MINE') {
      released();
      render();
    } else if (T.code === code) T.finishTimer = setTimeout(() => finishStage(stage), 3000);
  } finally {
    T.finishing = false;
    drawSendStatus();
  }
}

function drawSendStatus() {
  const box = $('#send-status');
  if (!box) return;
  const stage = T.view === 'done' ? 'change' : 'roulette';
  let html;
  if (T.doneSent[stage]) html = `<div class="notice green" style="display:inline-flex;text-align:left"><div><strong>선생님께 다 보냈어요!</strong>선생님 화면에서 우리 모둠 질문을 볼 수 있어요.</div></div>`;
  else if (!T.token)
    html = `<div class="notice apricot" style="display:inline-flex;text-align:left"><div><strong>질문을 보내지 못했어요</strong>선생님이 이 태블릿의 모둠 연결을 풀었어요. 선생님께 알려 주세요.</div></div>`;
  else if (T.finishTimer)
    html = `<div class="notice apricot" style="display:inline-flex;text-align:left"><div><strong>인터넷 연결을 확인하는 중이에요</strong>잠시 뒤 다시 보내요. 태블릿을 끄지 말고 기다려 주세요. (남은 질문 ${T.outbox.length}개)</div></div>`;
  else html = `<div class="notice" style="display:inline-flex;text-align:left"><div><strong>질문을 선생님께 보내는 중…</strong>잠깐만 기다려요.</div></div>`;
  if (box.innerHTML !== html) box.innerHTML = html;
}

// ════════════════════════════════════════════════
// 화면 고르기
// ════════════════════════════════════════════════

function viewFor() {
  if (!T.game) return 'join';
  if (!T.group || !T.token) return T.draftNames ? 'names' : 'pick';
  if (T.draftNames) return 'names';
  const s = st();
  return s.view === 'lobby' ? 'wait' : s.view;
}

function render() {
  if (!T.game) return;
  const view = viewFor();
  if (view !== T.view) {
    const prev = T.view;
    T.view = view;
    T.built = null;
    T.pending = null;
    T._lastPlaying = null;
    window.scrollTo(0, 0);
    // 다음 활동으로 넘어가면 서버의 우리 모둠 질문을 다시 받아 둔다 (선생님이 지운 질문 반영)
    if ((view === 'break' || view === 'change' || view === 'done') && prev !== 'join' && !T.synced[view]) {
      T.synced[view] = true;
      syncItems();
    }
  }
  if (T.group && T.token) {
    const s = st();
    if ((s.view === 'break' || s.view === 'change' || s.view === 'done') && !T.doneSent.roulette) finishStage('roulette');
    if (s.view === 'done' && !T.doneSent.change) finishStage('change');
  }
  if (view === 'pick') renderPick();
  else if (view === 'names') renderNames();
  else if (view === 'wait') renderWait();
  else if (view === 'roulette') renderRoulette();
  else if (view === 'break') renderBreak();
  else if (view === 'change') renderChange();
  else if (view === 'done') renderDone();
}

function leaveBtn() {
  return `<button type="button" class="btn btn-ghost btn-sm" data-act="exit">나가기</button>`;
}

// ════════════════════════════════════════════════
// 2. 모둠 고르기 · 3. 친구 이름과 차례
// ════════════════════════════════════════════════

function renderPick() {
  const sig = JSON.stringify([T.game.groups, T.game.stage, T.game.status]);
  if (T.built === 'pick' && T._pickSig === sig) return;
  T._pickSig = sig;
  T.built = 'pick';
  const s = st();
  let cards = '';
  for (let g = 1; g <= T.game.groupCount; g++) {
    const c = groupColor(g);
    const taken = T.game.groups[g];
    cards += `<button type="button" class="group-pick ${taken ? 'taken' : ''}" data-act="pick" data-g="${g}" ${taken ? 'aria-disabled="true"' : ''} style="background:${c.soft};border-color:${c.main}">
      <span class="gt"><span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span>${g}모둠</span>
      <span class="gm">${taken ? esc(taken.names.join(', ')) : '비어 있어요'}</span>
      <span class="gm" style="margin-top:auto"><b>${taken ? '다른 태블릿이 쓰는 중' : '이 모둠으로 들어가기'}</b></span>
    </button>`;
  }
  app.innerHTML = `
    ${topbar(`<span class="chip cream">게임 코드 ${esc(T.code)}</span>${leaveBtn()}`)}
    <section class="card pad" aria-labelledby="h">
      <span class="deco green" style="width:200px;height:200px;right:-70px;top:-80px"></span>
      <div class="mascot-row" style="margin-bottom:16px">${catSvg(80)}<div class="bubble">이 태블릿은 어느 모둠일까요?<br>우리 모둠 번호를 눌러요.</div></div>
      <h1 id="h" class="section-title" style="font-size:30px">모둠 고르기</h1>
      ${
        s.view !== 'lobby'
          ? '<div class="notice" style="margin:12px 0"><div><strong>놀이가 이미 시작됐어요</strong>모둠을 고르고 이름을 쓰면 지금 하는 활동에 함께해요. 우리 모둠이 앞에서 만든 질문도 그대로 이어져요.</div></div>'
          : '<p class="section-desc" style="margin-bottom:16px">선생님이 정해 준 모둠을 눌러요. 한 모둠에 태블릿 한 대예요.</p>'
      }
      <div class="group-picks">${cards}</div>
    </section>`;
}

function pickGroup(g) {
  if (T.game.groups[g]) {
    toast('이 모둠은 이미 다른 태블릿이 쓰고 있어요. 잘못 들어갔다면 선생님께 알려 주세요.', 'warn');
    return;
  }
  T.pickedGroup = String(g);
  T.draftNames = ['', '', '', ''];
  render();
}

function renderNames() {
  const g = T.group || T.pickedGroup;
  const c = groupColor(g);
  const editing = !!T.group;
  if (T.built !== 'names') {
    T.built = 'names';
    app.innerHTML = `
      ${topbar(`<span class="chip cream">게임 코드 ${esc(T.code)}</span>`)}
      <section class="card pad-lg center-card names-card" style="max-width:820px" aria-labelledby="h">
        <span class="deco butter" style="width:220px;height:220px;right:-80px;top:-100px"></span>
        <div class="row" style="margin-bottom:6px">
          <span style="display:inline-flex;align-items:center;gap:12px;padding:10px 18px;border-radius:22px;background:${c.soft};color:${c.ink}"><span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span><b style="font-size:24px">${g}모둠</b></span>
        </div>
        <h1 id="h" class="section-title" style="font-size:30px;margin-top:14px">모둠 친구 이름을 차례대로 써요</h1>
        <p class="section-desc" style="margin-bottom:18px">위에서부터 차례가 돌아가요. 질문을 저장하면 태블릿을 다음 친구에게 넘겨요. (${NAME_MAX}글자까지, ${MAX_MEMBERS}명까지)</p>
        ${
          isShared()
            ? `<div class="notice apricot trial-hint"><div><strong>여러 학교가 함께 쓰는 서버예요: 실명 대신 번호나 별명을 써요</strong>예: 1번, 2번 또는 별빛, 구름처럼 써 주세요. 여러 학교가 함께 쓰는 서버라 진짜 이름은 쓰지 않아요.</div></div>`
            : ''
        }
        <div id="name-list" class="name-list"></div>
        <div class="row" style="margin-top:12px">
          <button type="button" class="btn btn-cream btn-sm" data-act="name-add" id="name-add">${ICON.plus}친구 더하기</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="name-shuffle">${ICON.shuffle}차례 섞기</button>
        </div>
        <div id="names-err" aria-live="assertive" style="margin-top:14px"></div>
        <div class="row" style="margin-top:22px">
          <button type="button" class="btn btn-cream" data-act="names-cancel">${editing ? '고치지 않고 돌아가기' : '다른 모둠 고르기'}</button>
          <div class="spacer"></div>
          <button type="button" class="btn btn-apricot btn-lg" data-act="names-save" id="names-save">${editing ? '고친 내용 저장' : '준비 완료!'}</button>
        </div>
      </section>`;
    drawNameRows(true);
  }
}

function drawNameRows(focusFirst = false) {
  const list = $('#name-list');
  if (!list) return;
  const names = T.draftNames;
  list.innerHTML = names
    .map(
      (n, i) => `<div class="name-row">
        <span class="ord">${i + 1}</span>
        <label class="sr-only" for="nm-${i}">${i + 1}번째 친구 이름</label>
        <input class="input" id="nm-${i}" data-i="${i}" maxlength="${NAME_MAX}" autocomplete="off" placeholder="${isShared() ? `예: ${i + 1}번 또는 별명` : `${i + 1}번째 친구 이름`}" value="${esc(n)}">
        <button type="button" class="btn btn-ghost btn-icon" data-act="name-up" data-i="${i}" aria-label="위로" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-act="name-down" data-i="${i}" aria-label="아래로" ${i === names.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-act="name-del" data-i="${i}" aria-label="지우기" ${names.length <= 1 ? 'disabled' : ''}>${ICON.x}</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', () => {
      T.draftNames[Number(inp.dataset.i)] = inp.value;
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !isComposingEnter(e)) {
        e.preventDefault();
        const next = $(`#nm-${Number(inp.dataset.i) + 1}`);
        if (next) next.focus();
        else saveNames();
      }
    });
  });
  const add = $('#name-add');
  if (add) add.disabled = names.length >= MAX_MEMBERS;
  if (focusFirst) setTimeout(() => $('#nm-0') && $('#nm-0').focus(), 60);
}

function namesError(msg) {
  const box = $('#names-err');
  if (box) box.innerHTML = msg ? `<div class="notice apricot"><div>${esc(msg)}</div></div>` : '';
}

async function saveNames() {
  const raw = T.draftNames.map((n) => String(n || '').trim()).filter(Boolean);
  if (!raw.length) return namesError('모둠 친구 이름을 한 명 이상 써 주세요.');
  const names = [];
  for (const n of raw) {
    const r = cleanName(n);
    if (!r.ok) return namesError(`"${n}": ${r.message}`);
    names.push(r.name);
  }
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) return namesError(`"${dup}" 이름이 두 번 있어요. 성이나 별명을 붙여 구별해 주세요.`);
  const g = T.group || T.pickedGroup;
  const btn = $('#names-save');
  btn.disabled = true;
  btn.textContent = '저장하는 중…';
  try {
    const res = await T.cli.join(T.code, g, names, T.token || '');
    const changedGroup = String(T.group) !== String(res.group);
    T.group = String(res.group);
    T.token = res.token;
    T.names = names;
    if (changedGroup) {
      T.items = [];
      T.outbox = [];
      T.turn = { roulette: 0, change: 0 };
      T.spin = blankSpin();
      T.doneSent = { roulette: false, change: false };
    } else {
      if (T.turn.roulette >= names.length) T.turn.roulette = 0;
      if (T.turn.change >= names.length) T.turn.change = 0;
    }
    mergeItems(res.items || []);
    T.draftNames = null;
    T.pickedGroup = null;
    if (res.game) T.game = res.game;
    saveSession();
    toast(`${g}모둠으로 들어왔어요!`, 'good');
    render();
    if (T.outbox.length) flush();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = T.group ? '고친 내용 저장' : '준비 완료!';
    namesError(explain(e));
    if (e.code === 'GROUP_TAKEN') {
      setTimeout(() => {
        T.draftNames = null;
        T.pickedGroup = null;
        poll();
      }, 2200);
    }
  }
}

// ════════════════════════════════════════════════
// 차례
// ════════════════════════════════════════════════

const turnOf = (stage) => T.turn[stage] % Math.max(1, T.names.length);
const curName = (stage) => T.names[turnOf(stage)] || '';
const nextName = (stage) => T.names[(turnOf(stage) + 1) % Math.max(1, T.names.length)] || '';

function advanceTurn(stage) {
  T.turn[stage] = (turnOf(stage) + 1) % Math.max(1, T.names.length);
}

function turnbarHtml(stage) {
  return (
    `<span style="color:var(--ink-3);margin-right:4px">차례</span>` +
    T.names
      .map((n, i, arr) => `<span class="pchip ${i === turnOf(stage) ? 'turn' : ''}" style="cursor:default">${esc(n)}</span>${i < arr.length - 1 ? '<span class="arrow">›</span>' : ''}`)
      .join('')
  );
}

function handoff(title, sub) {
  const el = $('#handoff');
  if (!el) return;
  el.innerHTML = `<div class="handoff"><div class="handoff-card"><div class="ht">${esc(title)}</div><div class="hs">${sub}</div></div></div>`;
  clearTimeout(handoff._t);
  handoff._t = setTimeout(() => {
    if ($('#handoff')) $('#handoff').innerHTML = '';
  }, 1700);
}

function newId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return (
    't' +
    Date.now().toString(36) +
    btoa(String.fromCharCode(...a))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
}

const nextNo = () => T.items.reduce((m, x) => Math.max(m, Number(x.no) || 0), 0) + 1;

function showOverlap(html) {
  const el = $('#overlap');
  if (el) el.innerHTML = html ? `<div class="overlap">${html}</div>` : '';
}

function pendingFor(raw) {
  if (!T.pending || T.pending.raw !== raw) T.pending = { raw, similar: false, soft: false };
  return T.pending;
}

function updateCover(s) {
  const cover = $('#cover');
  if (!cover) return;
  let html = '';
  let key = '';
  if (s.status === 'paused') {
    key = 'p';
    html = `<div class="pause-cover" role="dialog" aria-label="잠깐 멈춤">${catSvg(110)}<div>잠깐 멈췄어요</div><div style="font-size:19px;font-weight:400;color:var(--ink-2)">선생님이 다시 시작하면 이어서 해요.</div></div>`;
  } else if (s.status === 'ready') {
    const sec = Math.max(1, Math.ceil((Number(s.goAt) - now()) / 1000));
    const again = Number(s.goAt) !== Number(s.startedAt);
    const stage = s.stage === 'change' ? 'change' : 'roulette';
    key = 'r' + sec;
    html = `<div class="pause-cover ready-cover" role="status">${catSvg(100)}<div>${again ? '곧 다시 시작해요!' : stage === 'change' ? '곧 한 마디 바꾸기를 시작해요!' : '곧 질문 룰렛을 시작해요!'}</div><div class="ready-num">${sec}</div>
      <div style="font-size:19px;font-weight:400;color:var(--ink-2)">${again ? `${esc(curName(stage))} 차례부터 이어서 해요` : `첫 번째는 <b>${esc(curName(stage))}</b>! 태블릿을 들어요`}</div></div>`;
  }
  if (cover.dataset.key !== key) {
    cover.dataset.key = key;
    cover.innerHTML = html;
  }
}

function itemRow(x, { isNew = false, showFrame = true } = {}) {
  const meta = [];
  if (showFrame && x.frame) meta.push(`<span class="mini frame">${esc(x.frame)}</span>`);
  if (showFrame && x.word) meta.push(`<span class="mini word">${esc(x.word)}</span>`);
  if (x.method) meta.push(`<span class="mini method">${esc(x.method)}</span>`);
  if (x.name) meta.push(`<span>${esc(x.name)}</span>`);
  return `<div class="qitem ${isNew ? 'new' : ''}"><span class="no">${x.no}</span><div><div class="q">${esc(x.text)}</div>${meta.length ? `<div class="m">${meta.join('')}</div>` : ''}</div><span></span></div>`;
}

// ════════════════════════════════════════════════
// 4. 대기 (룰렛 미리 보기)
// ════════════════════════════════════════════════

function wheelsHtml() {
  return `<div class="wheels">
      <div class="wheel-box frame" id="wf-box"><span class="wt">질문 틀</span><div id="wf"></div></div>
      <div class="wheel-box word" id="ww-box"><span class="wt">제시어</span><div id="ww"></div></div>
    </div>`;
}

function mountWheels() {
  const fb = $('#wf');
  const wb = $('#ww');
  if (!fb || !wb) return;
  // 두 룰렛의 화살표가 가운데를 바라보게: 질문 틀은 오른쪽, 제시어는 왼쪽
  T.wf = new Wheel(fb, FRAMES.map((f) => f.label), WHEEL_PALETTES.frame, { title: '질문 틀', pointer: 'right' });
  T.ww = new Wheel(wb, words(), WHEEL_PALETTES.word, { title: '제시어', pointer: 'left' });
  // 두 바퀴가 한 개의 상자처럼 돌도록 (상자에 spinning 표시)
  T.wf.host = $('#wf-box');
  T.ww.host = $('#ww-box');
}

function renderWait() {
  const sig = JSON.stringify([T.names, T.group, words()]);
  if (T.built === 'wait' && T._waitSig === sig) return;
  T._waitSig = sig;
  T.built = 'wait';
  const g = T.group;
  const c = groupColor(g);
  const list = T.names.map((n, i) => `<span class="pchip" style="cursor:default"><span class="ord">${i + 1}</span>${esc(n)}</span>`).join('<span class="arrow">›</span>');
  app.innerHTML = `
    ${topbar(`${themeChip()}${soundBtn()}${leaveBtn()}`)}
    <div class="r-play">
      <section class="card pad p-turn" style="padding:22px 26px" aria-live="polite">
        <div class="row">
          <span style="display:inline-flex;align-items:center;gap:12px;padding:10px 18px;border-radius:22px;background:${c.soft};color:${c.ink}"><span class="badge" style="background:${c.main};color:#3b2a1a">${g}</span><b style="font-size:24px">우리는 ${g}모둠</b></span>
          <div class="row turn-list">${list}</div>
          <div class="spacer"></div>
          <button type="button" class="btn btn-cream btn-sm" data-act="edit-names">이름·차례 고치기</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="change-group">모둠 바꾸기</button>
        </div>
      </section>
      <section class="card spin-card p-spin" aria-label="우리 모둠 룰렛">
        ${wheelsHtml()}
        <button type="button" class="spin-btn" disabled>${ICON.spin}룰렛 돌리기</button>
        <div class="spin-note">선생님이 시작 신호를 주면 돌릴 수 있어요.</div>
      </section>
      <section class="card pad p-compose" style="padding:26px">
        <div class="mascot-row">${catSvg(96)}<div class="bubble">선생님이 시작 신호를 주면 놀이가 시작돼요!<br>첫 번째 친구 <b>${esc(T.names[0] || '')}</b>가 태블릿을 들고 기다려요.</div></div>
        <h2 class="section-title" style="font-size:24px;margin-top:20px">질문 룰렛 놀이 방법</h2>
        <ol class="tip-list" style="font-size:18px">
          <li>내 차례가 되면 <b>룰렛 돌리기</b>를 눌러요. 두 룰렛이 함께 돌아요.</li>
          <li>나온 <b>질문 틀</b>과 <b>제시어</b>로 질문을 하나 만들어요.</li>
          <li>마음에 안 들면 차례마다 한 번 더 돌릴 수 있어요.</li>
          <li>질문을 저장하면 태블릿을 다음 친구에게 넘겨요.</li>
        </ol>
      </section>
    </div>`;
  mountWheels();
}

// ════════════════════════════════════════════════
// 5. 질문 룰렛 (태블릿 돌려쓰기)
// ════════════════════════════════════════════════

function playHeader(stage) {
  return `<header class="topbar play-top">${brandHtml(`${T.group}모둠 태블릿`)}<div class="spacer"></div>
      ${themeChip()}
      <span class="chip butter" style="font-size:20px" id="timer-chip">남은 시간 <b id="timer" style="margin-left:4px;font-variant-numeric:tabular-nums">--:--</b></span>
      ${stage === 'change' ? `<button type="button" class="btn btn-sm tip-btn" data-act="tip">${ICON.tip}TIP 보기</button>` : ''}
      ${soundBtn()}
    </header>`;
}

function renderRoulette() {
  if (T.built !== 'roulette') {
    T.built = 'roulette';
    T._mineSig = null;
    const c = groupColor(T.group);
    app.innerHTML = `
      ${playHeader('roulette')}
      <div class="r-play">
        <div class="turnbar p-turn" id="turnbar" aria-label="우리 모둠 차례 순서"></div>
        <section class="card spin-card p-spin" aria-label="룰렛">
          ${wheelsHtml()}
          <button type="button" class="spin-btn" data-act="spin" id="spin-btn">${ICON.spin}<span id="spin-label">룰렛 돌리기</span></button>
          <div class="spin-note" id="spin-note"></div>
        </section>
        <section class="card compose p-compose my-turn" id="compose" aria-live="polite">
          <div class="ask" id="ask"></div>
          <div class="sub" id="sub"></div>
          <div class="pick-result" id="pick"></div>
          <label for="q" class="sr-only">질문 쓰기</label>
          <input class="input" id="q" maxlength="${MAX_TEXT + 2}" autocomplete="off" placeholder="질문을 적어주세요.">
          <div class="count-hint"><span id="len">0</span>/${MAX_TEXT}</div>
          <div id="overlap"></div>
          <div class="row" style="margin-top:14px">
            <button type="button" class="btn btn-ghost btn-sm" data-act="pass" id="pass-btn">패스</button>
            <div class="spacer"></div>
            <button type="button" class="btn btn-apricot btn-lg" data-act="save" id="save-btn">질문 저장하기</button>
          </div>
        </section>
        <section class="card mine-card p-mine" aria-labelledby="mine-h">
          <div class="head"><span class="badge" style="background:${c.main};color:#3b2a1a">${T.group}</span><b id="mine-h" style="font-size:21px">우리 모둠 질문</b><span class="chip" style="background:${c.soft};color:${c.ink}" id="mine-n">0개</span></div>
          <div class="q-list" id="mine"></div>
        </section>
      </div>
      <div id="handoff" aria-live="polite"></div>
      <div id="cover"></div>`;
    mountWheels();
    const fi = FRAMES.findIndex((f) => f.id === T.spin.frame);
    const wi = words().indexOf(T.spin.word);
    if (T.spin.spun && fi >= 0 && wi >= 0) {
      T.wf.showIndex(fi);
      T.ww.showIndex(wi);
    } else if (T.spin.spun) T.spin = blankSpin();
    bindInput(saveRoulette);
  }
  updateRoulette();
}

function bindInput(onEnter) {
  const q = $('#q');
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isComposingEnter(e)) {
      e.preventDefault();
      onEnter();
    }
  });
  q.addEventListener('input', () => {
    $('#len').textContent = q.value.length;
    if (!T.pending || q.value !== T.pending.raw) {
      T.pending = null;
      if ($('#overlap') && $('#overlap').innerHTML) showOverlap('');
    }
  });
}

function updateRoulette() {
  if (T.view !== 'roulette') return;
  const s = st();
  const playing = s.status === 'playing';
  const sp = T.spin;
  const frame = frameById(sp.frame);
  $('#turnbar').innerHTML = turnbarHtml('roulette');

  const btn = $('#spin-btn');
  const canSpin = playing && !T.spinning && (!sp.spun || sp.respin > 0);
  btn.disabled = !canSpin;
  btn.classList.toggle('pulse', playing && !sp.spun && !T.spinning);
  $('#spin-label').textContent = T.spinning ? '빙글빙글…' : sp.spun ? `한 번 더 돌리기 (${sp.respin}번 남음)` : '룰렛 돌리기';
  $('#spin-note').textContent = !playing
    ? '선생님이 시작하면 돌릴 수 있어요.'
    : T.spinning
    ? '어떤 질문 틀과 제시어가 나올까요?'
    : sp.spun
    ? sp.respin > 0
      ? '마음에 안 들면 한 번 더 돌릴 수 있어요.'
      : '이번 차례에는 더 돌릴 수 없어요. 나온 것으로 질문을 만들어 봐요!'
    : `${curName('roulette')}, 가운데 버튼을 눌러 룰렛을 돌려요!`;

  $('#ask').innerHTML = `지금은 <b>${esc(curName('roulette'))}</b> 차례!`;
  $('#sub').textContent = T.spinning
    ? '룰렛이 멈추면 나온 질문 틀과 제시어로 질문을 만들어요.'
    : !sp.spun
    ? '먼저 룰렛을 돌려 질문 틀과 제시어를 뽑아요.'
    : T.names.length > 1
    ? `나온 질문 틀과 제시어로 질문을 만들어요. 저장하면 ${nextName('roulette')}에게 태블릿을 넘겨요.`
    : '나온 질문 틀과 제시어로 질문을 만들어요.';
  const pick = $('#pick');
  const pickKey = sp.spun && !T.spinning ? `${sp.frame}|${sp.word}` : T.spinning ? 'spin' : '';
  if (pick.dataset.key !== pickKey) {
    pick.dataset.key = pickKey;
    pick.classList.toggle('pop', T.justSpun);
    pick.innerHTML =
      sp.spun && !T.spinning && frame
        ? `<span class="pick-chip frame"><small>질문 틀</small>${esc(frame.text)}</span><span class="pick-plus">+</span><span class="pick-chip word"><small>제시어</small>${esc(sp.word)}</span>`
        : `<div class="pick-empty">${T.spinning ? '룰렛이 돌고 있어요…' : '룰렛을 돌리면 여기에 나와요.'}</div>`;
    T.justSpun = false;
  }
  const ready = playing && sp.spun && !T.spinning;
  const q = $('#q');
  q.disabled = !ready;
  q.placeholder = ready ? '질문을 적어주세요.' : '룰렛을 돌린 뒤에 쓸 수 있어요.';
  $('#save-btn').disabled = !ready;
  $('#pass-btn').classList.toggle('hidden', !playing || T.names.length < 2 || T.spinning);
  drawMine();
  updateCover(s);
}

function drawMine() {
  const list = origs();
  const sig = JSON.stringify(list.map((x) => [x.id, x.text]));
  if (sig === T._mineSig) return;
  const prev = T._mineSig === null ? list.length : T._mineLen || 0;
  T._mineSig = sig;
  T._mineLen = list.length;
  $('#mine-n').textContent = `${list.length}개`;
  $('#mine').innerHTML = list.length
    ? list
        .slice()
        .reverse()
        .map((x, i) => itemRow(x, { isNew: list.length - i > prev }))
        .join('')
    : '<div class="empty-state" style="padding:14px">아직 만든 질문이 없어요. 첫 질문을 만들어 볼까요?</div>';
}

async function spin() {
  const s = st();
  const sp = T.spin;
  if (s.status !== 'playing' || T.spinning || (sp.spun && sp.respin <= 0)) return;
  unlockAudio();
  const list = words();
  const fi = randomIndex(FRAMES.length);
  const wi = randomIndex(list.length);
  T.spin = { frame: FRAMES[fi].id, word: list[wi], spun: true, respin: sp.spun ? sp.respin - 1 : sp.respin };
  T.spinning = true;
  T.pending = null;
  showOverlap('');
  saveSession();
  updateRoulette();
  const sound = isSoundOn('student');
  await Promise.all([
    T.wf.spinTo(fi, { duration: 2600, turns: 4, onTick: sound ? () => tickSound({ vol: 0.14 }) : null }),
    T.ww.spinTo(wi, { duration: 3400, turns: 5 }),
  ]);
  if (sound) ding();
  T.spinning = false;
  T.justSpun = true;
  if (T.view !== 'roulette') return;
  updateRoulette();
  const q = $('#q');
  if (q && !q.disabled) q.focus();
}

function saveRoulette() {
  const s = st();
  const sp = T.spin;
  if (s.status !== 'playing' || !sp.spun || T.spinning) return;
  const q = $('#q');
  const raw = q.value;
  const cq = cleanQuestion(raw);
  if (!cq.ok) {
    showOverlap(esc(cq.message));
    q.focus();
    return;
  }
  const pend = pendingFor(raw);
  const ov = findOverlap(cq.text, T.items);
  if (ov && ov.type === 'same') {
    showOverlap(`앞에 나온 <b>"${esc(ov.car.text)}"</b>와 같은 질문이에요.<br>다른 질문을 떠올려 볼까요?`);
    q.focus();
    return;
  }
  if (ov && ov.type === 'similar' && !pend.similar) {
    if (T.game.dupMode === 'similar') {
      showOverlap(`<b>"${esc(ov.car.text)}"</b>와 많이 비슷해요.<br>다른 점을 궁금해해 볼까요?`);
      q.focus();
      return;
    }
    showOverlap(`앞에 나온 <b>"${esc(ov.car.text)}"</b>와 비슷해요. 그래도 저장할까요?
      <div class="acts"><button type="button" class="btn btn-apricot btn-sm" data-act="force" data-k="similar">그래도 저장하기</button>
      <button type="button" class="btn btn-cream btn-sm" data-act="rewrite">다시 쓰기</button></div>`);
    return;
  }
  const frame = frameById(sp.frame);
  const missing = [];
  if (!hasFrame(cq.text, frame)) missing.push(`<span class="mini frame">질문 틀 · ${esc(frame.text)}</span>`);
  if (!hasWord(cq.text, sp.word)) missing.push(`<span class="mini word">제시어 · ${esc(sp.word)}</span>`);
  if (missing.length && !pend.soft) {
    showOverlap(`혹시 빠진 게 없나요? ${missing.join(' ')}<br>룰렛에서 나온 것이 질문에 들어갔는지 확인해 봐요.
      <div class="acts"><button type="button" class="btn btn-apricot btn-sm" data-act="force" data-k="soft">이대로 저장하기</button>
      <button type="button" class="btn btn-cream btn-sm" data-act="rewrite">다시 쓰기</button></div>`);
    return;
  }
  const item = { id: newId(), no: nextNo(), kind: 'r', text: cq.text, norm: normalizeQuestion(cq.text), frame: frame.text, word: sp.word, name: curName('roulette'), at: now() };
  T.items.push(item);
  T.outbox.push(item.id);
  advanceTurn('roulette');
  T.spin = blankSpin();
  T.pending = null;
  saveSession();
  flush();
  q.value = '';
  $('#len').textContent = '0';
  showOverlap('');
  T.wf.highlight(-1);
  T.ww.highlight(-1);
  if (isSoundOn('student')) beep({ freq: 1318, dur: 0.09, vol: 0.25 });
  handoff(`${origs().length}번째 질문 저장!${cq.addedMark ? ' (물음표를 붙였어요)' : ''}`, T.names.length > 1 ? `다음은 <b>${esc(curName('roulette'))}</b> 차례! 태블릿을 넘겨 주세요` : '다음 질문도 만들어 봐요!');
  updateRoulette();
}

async function passTurn(stage) {
  const ok = await confirmBox({
    title: `${curName(stage)}, 이번 차례를 넘길까요?`,
    body: '생각이 잘 안 나면 넘겨도 괜찮아요. 다음 차례에 다시 도전해요!',
    ok: '넘기기',
    cancel: '조금 더 생각할래요',
  });
  if (!ok || st().status !== 'playing') return;
  advanceTurn(stage);
  if (stage === 'roulette') {
    T.spin = blankSpin();
    if (T.wf) T.wf.highlight(-1);
    if (T.ww) T.ww.highlight(-1);
  } else {
    T.pickOrig = null;
    T.method = '';
  }
  T.pending = null;
  saveSession();
  const q = $('#q');
  if (q) q.value = '';
  showOverlap('');
  handoff('차례를 넘겼어요', `다음은 <b>${esc(curName(stage))}</b> 차례! 태블릿을 넘겨 주세요`);
  if (stage === 'roulette') updateRoulette();
  else updateChange(true);
}

// ════════════════════════════════════════════════
// 6. 잠시 멈춤 (룰렛이 끝나고 한 마디 바꾸기를 기다릴 때)
// ════════════════════════════════════════════════

function renderBreak() {
  const sig = JSON.stringify([origs().map((x) => [x.id, x.text]), T.names]);
  if (T.built === 'break' && T._breakSig === sig) {
    drawSendStatus();
    return;
  }
  T._breakSig = sig;
  T.built = 'break';
  const g = T.group;
  const c = groupColor(g);
  const list = origs();
  app.innerHTML = `
    ${topbar(`${themeChip()}${soundBtn()}`)}
    <section class="card pad-lg" style="text-align:center">
      <span class="deco butter" style="width:260px;height:260px;right:-90px;top:-110px"></span>
      <div style="display:flex;justify-content:center">${catSvg(110)}</div>
      <h1 style="font-size:clamp(30px,4.6vw,48px);margin:10px 0 6px">땡! 질문 룰렛 끝</h1>
      <p style="font-size:22px;margin:0">우리 ${esc(g)}모둠이 만든 질문은 <b>${list.length}개</b>예요. 수고했어요!</p>
      <div id="send-status" style="margin-top:18px"></div>
      <div class="notice" style="margin:16px auto 0;display:inline-flex;text-align:left"><div><strong>다음은 ② 한 마디 바꾸기</strong>선생님이 시작하면 이 화면이 저절로 넘어가요. 잠시 쉬었다가 해도 우리 모둠 질문은 그대로 남아 있어요.</div></div>
    </section>
    <section class="card pad" style="margin-top:20px">
      <div class="row"><b style="font-size:21px">우리 모둠 질문</b><span class="chip" style="background:${c.soft};color:${c.ink}">${list.length}개</span><div class="spacer"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="edit-names">이름·차례 고치기</button></div>
      <div class="q-list" style="margin-top:14px">${list.length ? list.map((x) => itemRow(x)).join('') : '<div class="empty-state">만든 질문이 없어요.</div>'}</div>
    </section>`;
  drawSendStatus();
}

// ════════════════════════════════════════════════
// 7. 한 마디 바꾸기
// ════════════════════════════════════════════════

function openTip() {
  const m = openModal(
    `<div class="tip-head"><span class="bulb">${ICON.tip.replace('width="20" height="20"', 'width="28" height="28"')}</span><div><h2 style="margin:0">한 마디 바꾸기 TIP</h2><div style="color:var(--ink-3);font-size:16px">이 방법 말고도 좋아요! 딱 한 마디만 바꿔 보세요.</div></div></div>
     <div class="tip-base">원래 질문 <b>${esc(METHOD_BASE)}</b></div>
     <div class="method-grid">${METHODS.map((x, i) => `<div class="method-card"><div class="mn"><span class="n">${i + 1}</span>${esc(x.name)}</div><div class="mx">${markEx(x.ex, esc)}</div></div>`).join('')}</div>
     <div class="actions" style="margin-top:16px"><button type="button" class="btn btn-primary" data-close>알겠어요!</button></div>`,
    { cls: 'tip-modal' }
  );
  m.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) m.close();
  });
}

function renderChange() {
  if (T.built !== 'change') {
    T.built = 'change';
    T._origSig = null;
    T._pairSig = null;
    const c = groupColor(T.group);
    app.innerHTML = `
      ${playHeader('change')}
      <div class="r-play">
        <div class="turnbar p-turn" id="turnbar" aria-label="우리 모둠 차례 순서"></div>
        <section class="card p-spin" style="padding:20px 22px" aria-labelledby="pick-h">
          <div class="step-label" id="pick-h"><span class="form-num">1</span>바꿀 질문 고르기</div>
          <p class="section-desc" style="font-size:16px;margin:0 0 12px">우리 모둠이 룰렛으로 만든 질문 중 하나를 눌러요.</p>
          <div class="orig-list" id="origs" role="group" aria-label="바꿀 질문"></div>
        </section>
        <section class="card compose p-compose my-turn" id="compose" aria-live="polite">
          <div class="ask" id="ask"></div>
          <div class="sub" id="sub"></div>
          <div class="orig-show" id="orig-show"></div>
          <div class="step-label"><span class="form-num">2</span>한 마디만 바꿔 새 질문 쓰기</div>
          <label for="q" class="sr-only">바꾼 질문 쓰기</label>
          <input class="input" id="q" maxlength="${MAX_TEXT + 2}" autocomplete="off" placeholder="질문을 적어주세요." style="margin-top:0">
          <div class="count-hint"><span id="len">0</span>/${MAX_TEXT}</div>
          <div class="step-label"><span class="form-num">3</span>어떤 방법으로 바꿨나요? <button type="button" class="btn btn-ghost btn-sm" data-act="tip" style="margin-left:auto">${ICON.tip}TIP</button></div>
          <div class="method-chips" id="mchips"></div>
          <div id="overlap"></div>
          <div class="row" style="margin-top:14px">
            <button type="button" class="btn btn-ghost btn-sm" data-act="pass-c" id="pass-btn">패스</button>
            <div class="spacer"></div>
            <button type="button" class="btn btn-apricot btn-lg" data-act="save-c" id="save-btn">바꾼 질문 저장하기</button>
          </div>
        </section>
        <section class="card mine-card p-mine" aria-labelledby="mine-h">
          <div class="head"><span class="badge" style="background:${c.main};color:#3b2a1a">${T.group}</span><b id="mine-h" style="font-size:21px">우리 모둠이 바꾼 질문</b><span class="chip" style="background:${c.soft};color:${c.ink}" id="mine-n">0개</span></div>
          <div class="pair-list" id="pairs"></div>
        </section>
      </div>
      <div id="handoff" aria-live="polite"></div>
      <div id="cover"></div>`;
    bindInput(saveChange);
  }
  updateChange();
}

function updateChange(resetInput = false) {
  if (T.view !== 'change') return;
  const s = st();
  const playing = s.status === 'playing';
  $('#turnbar').innerHTML = turnbarHtml('change');
  // 처음 시작할 때 TIP 카드를 한 번 띄워 준다
  if (playing && !T.tipShown) {
    T.tipShown = true;
    saveSession();
    setTimeout(() => {
      if (T.view === 'change' && !document.querySelector('.modal-back')) openTip();
    }, 1900);
  }
  const list = origs();
  const ch = changes();
  const osig = JSON.stringify([list.map((x) => [x.no, x.text]), ch.map((x) => x.parentNo), T.pickOrig]);
  if (osig !== T._origSig) {
    T._origSig = osig;
    $('#origs').innerHTML = list.length
      ? list
          .map((x) => {
            const n = ch.filter((c) => Number(c.parentNo) === Number(x.no)).length;
            return `<button type="button" class="orig-opt" data-act="orig" data-no="${x.no}" aria-pressed="${Number(T.pickOrig) === Number(x.no)}">
              <span class="no">${x.no}</span><span>${esc(x.text)}</span>${n ? `<span class="cnt">바꾼 질문 ${n}</span>` : '<span></span>'}</button>`;
          })
          .join('')
      : '<div class="empty-state" style="padding:14px">우리 모둠이 룰렛으로 만든 질문이 없어요. 선생님께 알려 주세요.</div>';
  }
  const orig = list.find((x) => Number(x.no) === Number(T.pickOrig)) || null;
  if (!orig) T.pickOrig = null;
  $('#ask').innerHTML = `지금은 <b>${esc(curName('change'))}</b> 차례!`;
  $('#sub').textContent = orig
    ? T.names.length > 1
      ? `한 마디만 바꿔 새 질문을 만들어요. 저장하면 ${nextName('change')}에게 태블릿을 넘겨요.`
      : '한 마디만 바꿔 새 질문을 만들어요.'
    : '먼저 바꿀 질문을 하나 골라요.';
  const show = $('#orig-show');
  const showKey = orig ? String(orig.no) : '';
  if (show.dataset.key !== showKey) {
    show.dataset.key = showKey;
    show.innerHTML = orig ? `<small>원래 질문 ${orig.no}</small>${esc(orig.text)}` : '<small>원래 질문</small>아직 고르지 않았어요.';
  }
  const q = $('#q');
  if (resetInput) q.value = orig ? orig.text : '';
  const ready = playing && !!orig;
  q.disabled = !ready;
  q.placeholder = ready ? '질문을 적어주세요.' : '바꿀 질문을 먼저 골라요.';
  $('#len').textContent = q.value.length;
  const msig = T.method;
  const chips = $('#mchips');
  if (chips.dataset.key !== msig || !chips.innerHTML) {
    chips.dataset.key = msig;
    chips.innerHTML = [...METHODS.map((x) => x.name), METHOD_FREE]
      .map((n) => `<button type="button" class="mchip" data-act="method" data-m="${esc(n)}" aria-pressed="${T.method === n}">${esc(n)}</button>`)
      .join('');
  }
  chips.querySelectorAll('.mchip').forEach((b) => (b.disabled = !ready));
  $('#save-btn').disabled = !ready;
  $('#pass-btn').classList.toggle('hidden', !playing || T.names.length < 2);
  drawPairs();
  updateCover(s);
}

function pairListHtml(onlyChanged) {
  const ch = changes();
  const list = origs().filter((o) => !onlyChanged || ch.some((c) => Number(c.parentNo) === Number(o.no)));
  const used = new Set();
  const out = list.map((o) => {
    const mine = ch.filter((c) => Number(c.parentNo) === Number(o.no));
    mine.forEach((c) => used.add(c.id));
    return `<div class="pair ${mine.length ? '' : 'none'}">${itemRow(o)}${
      mine.length
        ? `<div class="changes">${mine.map((c) => `<div class="row" style="gap:8px;flex-wrap:nowrap;align-items:flex-start"><span class="arrow" aria-hidden="true">→</span><div style="flex:1;min-width:0">${itemRow(c, { showFrame: false })}</div></div>`).join('')}</div>`
        : '<div class="nochange">바꾼 질문이 없어요</div>'
    }</div>`;
  });
  const orphan = ch.filter((c) => !used.has(c.id));
  if (orphan.length) out.push(`<div class="pair"><div class="changes" style="margin-left:0">${orphan.map((c) => itemRow(c, { showFrame: false })).join('')}</div></div>`);
  return out.join('');
}

function drawPairs() {
  const ch = changes();
  const sig = JSON.stringify(ch.map((x) => [x.id, x.text]));
  if (sig === T._pairSig) return;
  T._pairSig = sig;
  $('#mine-n').textContent = `${ch.length}개`;
  $('#pairs').innerHTML = ch.length ? pairListHtml(true) : '<div class="empty-state" style="padding:14px">아직 바꾼 질문이 없어요. 첫 번째로 바꿔 볼까요?</div>';
}

function pickOrig(no) {
  if (st().status !== 'playing') return;
  T.pickOrig = Number(no);
  T.pending = null;
  showOverlap('');
  saveSession();
  updateChange(true);
  const q = $('#q');
  if (q && !q.disabled) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
}

function saveChange() {
  const s = st();
  if (s.status !== 'playing') return;
  const orig = origs().find((x) => Number(x.no) === Number(T.pickOrig));
  if (!orig) return showOverlap('먼저 바꿀 질문을 하나 골라요.');
  const q = $('#q');
  const cq = cleanQuestion(q.value);
  if (!cq.ok) {
    showOverlap(esc(cq.message));
    q.focus();
    return;
  }
  if (sameText(cq.text, orig.text)) {
    showOverlap('원래 질문과 똑같아요. 한 마디를 바꿔 볼까요? 막히면 <b>TIP</b>을 눌러 봐요.');
    q.focus();
    return;
  }
  const ov = findOverlap(cq.text, T.items);
  if (ov && ov.type === 'same') {
    showOverlap(`우리 모둠에 이미 <b>"${esc(ov.car.text)}"</b> 질문이 있어요.<br>다른 한 마디를 바꿔 볼까요?`);
    q.focus();
    return;
  }
  if (!T.method) {
    showOverlap('어떤 방법으로 바꿨는지 3번에서 골라 주세요. 잘 모르겠으면 <b>그 밖의 방법</b>을 눌러요.');
    return;
  }
  const item = { id: newId(), no: nextNo(), kind: 'c', text: cq.text, frame: '', word: '', parentNo: orig.no, method: T.method, name: curName('change'), at: now() };
  T.items.push(item);
  T.outbox.push(item.id);
  advanceTurn('change');
  T.pickOrig = null;
  T.method = '';
  T.pending = null;
  saveSession();
  flush();
  q.value = '';
  showOverlap('');
  if (isSoundOn('student')) beep({ freq: 1318, dur: 0.09, vol: 0.25 });
  handoff(`${changes().length}번째 바꾼 질문 저장!`, T.names.length > 1 ? `다음은 <b>${esc(curName('change'))}</b> 차례! 태블릿을 넘겨 주세요` : '다른 질문도 바꿔 봐요!');
  updateChange(true);
}

// ════════════════════════════════════════════════
// 8. 끝
// ════════════════════════════════════════════════

function renderDone() {
  const sig = JSON.stringify(T.items.map((x) => [x.id, x.text]));
  if (T.built === 'done' && T._doneSig === sig) {
    drawSendStatus();
    return;
  }
  T._doneSig = sig;
  T.built = 'done';
  const c = groupColor(T.group);
  const ch = changes();
  app.innerHTML = `
    ${topbar(`${themeChip()}<span class="chip cream">${esc(T.group)}모둠</span>${leaveBtn()}`)}
    <section class="card pad-lg" style="text-align:center">
      <span class="deco butter" style="width:260px;height:260px;right:-90px;top:-110px"></span>
      <div style="display:flex;justify-content:center">${catSvg(110)}</div>
      <h1 style="font-size:clamp(30px,4.6vw,48px);margin:10px 0 6px">한 마디 바꾸기 끝!</h1>
      <p style="font-size:22px;margin:0">룰렛 질문 <b>${origs().length}개</b>에서 <b>${ch.length}개</b>의 새 질문이 태어났어요.</p>
      <div id="send-status" style="margin-top:18px"></div>
    </section>
    <section class="card pad" style="margin-top:20px;background:var(--green-softer)">
      <p style="font-size:clamp(20px,2.6vw,26px);font-weight:700;margin:0 0 4px">한 마디만 바꿨는데 질문이 어떻게 달라졌나요?</p>
      <p class="section-desc">선생님 화면에서 다른 모둠 질문도 함께 살펴봐요.</p>
    </section>
    <section class="card pad" style="margin-top:20px">
      <div class="row"><span class="badge" style="background:${c.main};color:#3b2a1a">${T.group}</span><b style="font-size:21px">우리 모둠 질문</b></div>
      <div class="pair-list" style="margin-top:14px">${pairListHtml(false) || '<div class="empty-state">질문이 없어요.</div>'}</div>
    </section>`;
  drawSendStatus();
}

// ════════════════════════════════════════════════
// 시계
// ════════════════════════════════════════════════

function tick() {
  if (!T.game) return;
  const s = st();
  const t = now();
  if (T.group && T.token) T.fx.update(s, t);
  if (s.status === 'playing' && s.goAt && Number(s.goAt) !== Number(s.startedAt) && T.lastGoAt !== s.goAt && t - Number(s.goAt) < 3000 && (T.view === 'roulette' || T.view === 'change')) {
    T.lastGoAt = s.goAt;
    if (isSoundOn('student')) bell({ strikes: 1, base: 880 });
    flashBanner('다시 시작!', '', 1400);
  }
  const view = viewFor();
  if (view !== T.view) return render();
  if (view === 'roulette' || view === 'change') {
    const rem = remainingOfR2(s, t, T.game);
    const el = $('#timer');
    if (el) el.textContent = formatClock(rem);
    const chip = $('#timer-chip');
    if (chip) chip.classList.toggle('apricot', s.status === 'playing' && rem < 30000);
    const playing = s.status === 'playing';
    if (T._lastPlaying !== playing) {
      T._lastPlaying = playing;
      if (view === 'roulette') updateRoulette();
      else updateChange();
    } else updateCover(s);
  }
}

// ════════════════════════════════════════════════
// 클릭 처리
// ════════════════════════════════════════════════

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const i = Number(el.dataset.i);
  switch (el.dataset.act) {
    case 'pick':
      pickGroup(el.dataset.g);
      break;
    case 'name-add':
      if (T.draftNames.length < MAX_MEMBERS) {
        T.draftNames.push('');
        drawNameRows();
        const last = $(`#nm-${T.draftNames.length - 1}`);
        if (last) last.focus();
      }
      break;
    case 'name-del':
      T.draftNames.splice(i, 1);
      drawNameRows();
      break;
    case 'name-up':
      if (i > 0) [T.draftNames[i - 1], T.draftNames[i]] = [T.draftNames[i], T.draftNames[i - 1]];
      drawNameRows();
      break;
    case 'name-down':
      if (i < T.draftNames.length - 1) [T.draftNames[i + 1], T.draftNames[i]] = [T.draftNames[i], T.draftNames[i + 1]];
      drawNameRows();
      break;
    case 'name-shuffle': {
      const filled = T.draftNames.filter((n) => String(n).trim());
      for (let k = filled.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [filled[k], filled[j]] = [filled[j], filled[k]];
      }
      T.draftNames = filled.length ? filled : T.draftNames;
      drawNameRows();
      break;
    }
    case 'names-save':
      saveNames();
      break;
    case 'names-cancel':
      T.draftNames = null;
      T.pickedGroup = null;
      render();
      break;
    case 'edit-names':
      T.draftNames = T.names.slice();
      render();
      break;
    case 'change-group': {
      const ok = await confirmBox({ title: '모둠을 바꿀까요?', body: '이 태블릿이 지금 모둠에서 빠지고, 모둠 고르기 화면으로 가요.', ok: '모둠 바꾸기' });
      if (!ok) return;
      try {
        const res = await T.cli.leave(T.code, T.group, T.token);
        if (res && res.game) T.game = res.game;
      } catch (err) {}
      Object.assign(T, { group: null, token: null, items: [], outbox: [], turn: { roulette: 0, change: 0 }, spin: blankSpin(), doneSent: { roulette: false, change: false } });
      saveSession();
      render();
      break;
    }
    case 'spin':
      spin();
      break;
    case 'save':
      saveRoulette();
      break;
    case 'force':
      if (T.pending) T.pending[el.dataset.k] = true;
      if (T.view === 'roulette') saveRoulette();
      break;
    case 'rewrite':
      T.pending = null;
      showOverlap('');
      if ($('#q')) $('#q').select();
      break;
    case 'pass':
      passTurn('roulette');
      break;
    case 'pass-c':
      passTurn('change');
      break;
    case 'orig':
      pickOrig(el.dataset.no);
      break;
    case 'method':
      T.method = T.method === el.dataset.m ? '' : el.dataset.m;
      if ($('#overlap') && /3번에서/.test($('#overlap').textContent)) showOverlap('');
      updateChange();
      break;
    case 'save-c':
      saveChange();
      break;
    case 'tip':
      openTip();
      break;
    case 'sound':
      setSoundOn('student', !isSoundOn('student'));
      document.querySelectorAll('#sound-btn').forEach((b) => (b.outerHTML = soundBtn()));
      if (isSoundOn('student')) beep({ freq: 880, dur: 0.12, vol: 0.3 });
      toast(isSoundOn('student') ? '이 태블릿에서도 효과음이 나요.' : '이 태블릿의 효과음을 껐어요.');
      break;
    case 'exit': {
      const s = st();
      const playing = s && (s.view === 'roulette' || s.view === 'change');
      const ok = await confirmBox({
        title: '놀이에서 나갈까요?',
        body: playing ? '놀이가 진행 중이에요. 나가면 아직 보내지 못한 질문이 선생님께 가지 않을 수 있어요.' : '나가면 처음 화면으로 돌아가요.',
        ok: '나가기',
        danger: true,
      });
      if (!ok) return;
      if (T.group && T.token && s && s.view === 'lobby') T.cli.leave(T.code, T.group, T.token).catch(() => {});
      stopLoops();
      clearSession();
      location.href = 'index.html';
      break;
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && T.code) {
    poll();
    if (T.outbox.length) flush();
  }
});

// ════════════════════════════════════════════════
// 시작
// ════════════════════════════════════════════════

const params = new URLSearchParams(location.search);
const urlCode = (params.get('code') || '').replace(/\D/g, '').slice(0, 4);
const urlMode = params.get('mode') === 'local' ? 'local' : null;
// 예전 입장 링크에 붙어 있던 서버 정보(s, u, c)는 쓰지 않으니 주소에서 지운다
if (['s', 'u', 'c'].some((k) => params.has(k))) {
  const keep = new URLSearchParams();
  if (urlCode) keep.set('code', urlCode);
  history.replaceState(null, '', 'student.html' + (keep.toString() ? '?' + keep : ''));
}

(async function boot() {
  // 연습 모드 창은 창마다(sessionStorage), 실제 태블릿은 기기마다(localStorage) 이어서 하기
  const sess = urlMode === 'local' ? loadSession(true) : loadSession(false) || loadSession(true);
  if (sess && (!urlCode || urlCode === sess.code) && (!urlMode || sess.target === 'local')) {
    try {
      const cli = await tabletClient(sess.target);
      const game = await cli.info(sess.code);
      restore(sess, cli, game);
      return;
    } catch (e) {
      if (e.code === 'NO_GAME' || e.code === 'EXPIRED') clearSession();
      else {
        T.target = sess.target;
        renderJoin(sess.code, explain(e));
        return;
      }
    }
  }
  renderJoin(urlCode);
  if (urlCode) findGame(urlCode);
})();
