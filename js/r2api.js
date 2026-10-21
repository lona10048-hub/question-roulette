// 2차시 질문 룰렛 놀이: 서버(gas/Code.gs의 r2.* 기능)와 이야기하는 곳
//  서버  → 개발진이 배포한 Apps Script 웹 앱 하나를 모든 반이 함께 쓴다
//  연습 모드 → 같은 코드를 이 브라우저 안에서 돌린다

import { getLocalApi, getServerApi, explainError, pollMs } from './api.js';

// ════════════════════════════════════════════════
// 서버 (Apps Script) · 연습 모드
// ════════════════════════════════════════════════

export class GasR2 {
  constructor(api) {
    this.api = api;
    this.kind = api.kind; // 'server' | 'local'
  }

  get id() {
    return this.kind === 'local' ? 'local' : this.api.url;
  }

  serverNow() {
    return this.api.serverNow();
  }

  onConnection(cb) {
    return this.api.onConnection(cb);
  }

  pollMs(name) {
    return pollMs(this.api, name);
  }

  linkParams() {
    return this.kind === 'local' ? { mode: 'local' } : {};
  }

  // 선생님
  async createGame(settings) {
    const r = await this.api.teacher('r2.create', { settings });
    return { code: r.code, game: r.game };
  }

  async listGames() {
    this.api.teacher('cleanup').catch(() => {});
    const r = await this.api.teacher('r2.list');
    return { games: r.games || [], sheetUrl: r.sheetUrl || '' };
  }

  view(code) {
    return this.api.teacher('r2.view', { code });
  }

  async stage(code, op) {
    return (await this.api.teacher('r2.stage', { code, op })).game;
  }

  async release(code, group) {
    return (await this.api.teacher('r2.release', { code, group })).game;
  }

  async teacherItems(code) {
    return (await this.api.teacher('r2.items', { code })).items || {};
  }

  async editItem(code, group, id, op, value) {
    return (await this.api.teacher('r2.edit', { code, group, id, op, value })).items || {};
  }

  deleteGame(code, rows) {
    return this.api.teacher('r2.delete', { code, rows });
  }

  // 모둠 태블릿
  async info(code) {
    return (await this.api.call('r2.info', { code })).game;
  }

  join(code, group, names, token) {
    return this.api.call('r2.join', { code, group, names, token: token || '' });
  }

  leave(code, group, token) {
    return this.api.call('r2.leave', { code, group, token });
  }

  poll(code, group, token) {
    return this.api.call('r2.poll', { code, group: group || '', token: token || '' });
  }

  async mine(code, group, token) {
    return (await this.api.call('r2.mine', { code, group, token })).items || [];
  }

  put(code, group, token, items) {
    return this.api.call('r2.put', { code, group, token, items });
  }

  done(code, group, token, stage) {
    return this.api.call('r2.done', { code, group, token, stage });
  }

  explain(e, who) {
    return explainError(e, who);
  }
}

// ════════════════════════════════════════════════
// 고르기: mode = 'server' | 'local'
// ════════════════════════════════════════════════

export async function teacherClient(mode) {
  if (mode === 'local') return new GasR2(await getLocalApi());
  return new GasR2(getServerApi());
}

export async function tabletClient(mode) {
  return teacherClient(mode);
}

// 화면에서 쓰는 진행 상태
//   view: lobby · roulette · break · change · done
//   phase: ready(곧 출발) · playing · paused · ended
export function deriveR2(game, now) {
  if (!game) return null;
  let status = game.status;
  let endedAt = game.endedAt;
  if (status === 'playing' && game.endsAt && now >= game.endsAt) {
    status = 'ended';
    endedAt = game.endsAt;
  }
  if (status === 'playing' && game.goAt && now < game.goAt) status = 'ready';
  let view = 'lobby';
  if (game.stage === 'roulette') view = status === 'ended' ? 'break' : 'roulette';
  else if (game.stage === 'change') view = status === 'ended' ? 'done' : 'change';
  return { stage: game.stage, view, status, startedAt: game.startedAt, goAt: game.goAt, endsAt: game.endsAt, remainingMs: game.remainingMs, endedAt };
}

export function remainingOfR2(st, now, game) {
  if (!st) return 0;
  const dur = (game && game.durations && game.durations[st.stage === 'change' ? 'change' : 'roulette']) || 0;
  if (st.stage === 'lobby') return dur * 1000;
  if (st.status === 'ready') return Math.max(0, Number(st.endsAt) - Number(st.goAt));
  if (st.status === 'playing') return Math.max(0, Number(st.endsAt) - now);
  if (st.status === 'paused') return Math.max(0, Number(st.remainingMs) || 0);
  return 0;
}
