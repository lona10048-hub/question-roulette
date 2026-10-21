// 룰렛 그림과 돌리기
//  - 칸은 위쪽(12시)부터 시계 방향으로 놓인다. 위쪽의 화살표가 가리키는 칸이 뽑힌 칸이다.
//  - 멈출 칸은 매번 무작위(crypto)로 정하고, 그 칸이 화살표 아래 오도록 돌린다.

import { esc } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

export const WHEEL_PALETTES = {
  frame: ['#FCE3D6', '#FBF0C8', '#FDEBDD', '#FFF6D6'],
  word: ['#E3F0D8', '#DCEEF6', '#EAF4E1', '#E5F1F8'],
};

export function randomIndex(n) {
  if (n <= 1) return 0;
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

function randomUnit() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

function polar(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function slicePath(r, a0, a1) {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M0 0L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`;
}

// 칸 글자: 바퀴 중심에서 바깥쪽으로 읽히게 놓는다.
// 바퀴가 돌아서 글자가 왼쪽 절반(거꾸로 보이는 쪽)에 오면 뒤집어서 늘 바로 읽히게 한다.
function labelGeom(label, r, n) {
  const ri = r * 0.24;
  const ro = r * 0.93;
  const len = Math.max(2, [...label].length);
  const maxFont = n > 10 ? 17 : n > 8 ? 19 : 21;
  const font = Math.max(10, Math.min(maxFont, Math.floor((ro - ri) / (len * 1.02))));
  return { font, mid: (ri + ro) / 2 + 4 };
}

function labelAttrs(center, mid, flip) {
  const rot = flip ? center + 90 : center - 90;
  return { transform: `rotate(${rot.toFixed(2)})`, x: (flip ? -mid : mid).toFixed(1) };
}

const isFlip = (center, angle) => ((((center + angle) % 360) + 360) % 360) > 180;

function labelSvg(label, center, r, n, angle) {
  const { font, mid } = labelGeom(label, r, n);
  const a = labelAttrs(center, mid, isFlip(center, angle));
  return `<text class="lab" data-c="${center.toFixed(3)}" data-m="${mid.toFixed(1)}" transform="${a.transform}" x="${a.x}" y="${(font * 0.36).toFixed(1)}" text-anchor="middle" font-size="${font}" font-weight="700" fill="#4a3424">${esc(label)}</text>`;
}

// 화살표 자리: top(12시) · right(3시) · left(9시). 화살표가 가리키는 칸이 뽑힌 칸이다.
const POINTER_DEG = { top: 0, right: 90, left: 270 };

function pointerPath(r, where) {
  if (where === 'right') return `M${r + 22} -15L${r + 22} 15L${r - 6} 0Z`;
  if (where === 'left') return `M${-r - 22} -15L${-r - 22} 15L${-r + 6} 0Z`;
  return `M-15 ${-r - 22}L15 ${-r - 22}L0 ${-r + 6}Z`;
}

export function wheelSvg(labels, palette, { title = '', r = 160, pointer = 'top', angle = 0 } = {}) {
  const n = Math.max(1, labels.length);
  const seg = 360 / n;
  let slices = '';
  let texts = '';
  labels.forEach((label, i) => {
    const a0 = i * seg;
    const a1 = (i + 1) * seg;
    const fill = palette[i % palette.length];
    slices += `<path class="slice" data-i="${i}" d="${slicePath(r, a0, a1)}" fill="${fill}" stroke="#7a5c3e" stroke-width="2"/>`;
    texts += labelSvg(label, a0 + seg / 2, r, n, angle);
  });
  const pad = 26;
  const size = r + pad;
  return `<svg class="wheel-svg" viewBox="${-size} ${-size - 6} ${size * 2} ${size * 2 + 6}" role="img" aria-label="${esc(title)} 룰렛">
    <circle r="${r + 12}" fill="#e8c48a" stroke="#7a5c3e" stroke-width="3"/>
    ${Array.from({ length: n }, (_, i) => {
      const [x, y] = polar(r + 6, i * seg);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#fff6dc"/>`;
    }).join('')}
    <g class="wheel-rot" transform="rotate(${angle})">${slices}${texts}</g>
    <circle r="${r * 0.2}" fill="#fffdf6" stroke="#7a5c3e" stroke-width="3"/>
    <text y="${r * 0.07}" text-anchor="middle" font-size="${Math.round(r * 0.2)}" font-weight="700" fill="#e98d64">?</text>
    <path class="pointer pointer-${pointer}" d="${pointerPath(r, pointer)}" fill="#e98d64" stroke="#7a5c3e" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
}

const easeOut = (t) => 1 - Math.pow(1 - t, 4);

export class Wheel {
  constructor(host, labels, palette, opts = {}) {
    this.host = host;
    this.labels = labels;
    this.palette = palette;
    this.title = opts.title || '';
    this.pointer = opts.pointer || 'top';
    this.pdeg = POINTER_DEG[this.pointer] || 0;
    this.angle = 0;
    this.index = null;
    this.spinning = false;
    host.innerHTML = wheelSvg(labels, palette, { title: this.title, pointer: this.pointer });
    this.rot = host.querySelector('.wheel-rot');
    this.svg = host.querySelector('svg');
    this.texts = [...host.querySelectorAll('text.lab')].map((el) => ({ el, c: Number(el.dataset.c), m: Number(el.dataset.m), flip: null }));
    // 처음에는 첫 칸이 화살표 아래에 오도록 둔다
    this.setAngle(this.angleFor(0));
  }

  setAngle(a) {
    this.angle = a;
    this.rot.setAttribute('transform', `rotate(${a.toFixed(3)})`);
    for (const t of this.texts) {
      const flip = isFlip(t.c, a);
      if (flip !== t.flip) {
        t.flip = flip;
        const at = labelAttrs(t.c, t.m, flip);
        t.el.setAttribute('transform', at.transform);
        t.el.setAttribute('x', at.x);
      }
    }
  }

  // index 칸의 가운데가 화살표에 오는 각도
  angleFor(index) {
    const seg = 360 / this.labels.length;
    return this.pdeg - (index * seg + seg / 2);
  }

  // 지금 화살표가 가리키는 칸
  segAt(a) {
    const seg = 360 / this.labels.length;
    return Math.floor((((this.pdeg - a) % 360) + 360) % 360 / seg);
  }

  // 애니메이션 없이 index 칸을 화살표 아래에 둔다 (새로고침해도 뽑힌 칸이 그대로 보이게)
  showIndex(index) {
    this.setAngle(this.angleFor(index));
    this.index = index;
    this.highlight(index);
  }

  highlight(i) {
    this.host.querySelectorAll('.slice').forEach((p) => p.classList.toggle('win', Number(p.dataset.i) === i));
  }

  // index 칸이 위쪽 화살표에 오도록 돌린다. onTick: 칸을 하나 지날 때마다 불림
  spinTo(index, { duration = 3000, turns = 5, onTick } = {}) {
    const n = this.labels.length;
    const seg = 360 / n;
    const jitter = (randomUnit() - 0.5) * seg * 0.6;
    const want = this.angleFor(index) + jitter; // 이 각도(mod 360)가 되면 index 칸이 화살표 아래
    const start = this.angle;
    let delta = (((want - start) % 360) + 360) % 360;
    const target = start + turns * 360 + delta;
    this.spinning = true;
    this.highlight(-1);
    this.host.classList.add('spinning');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce ? 300 : duration;
    let lastSeg = Math.floor((this.pdeg - start) / seg);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const a = start + (target - start) * easeOut(p);
        this.setAngle(a);
        const s = Math.floor((this.pdeg - a) / seg);
        if (s !== lastSeg) {
          lastSeg = s;
          if (onTick) onTick();
        }
        if (p < 1) requestAnimationFrame(frame);
        else {
          this.setAngle(((target % 360) + 360) % 360);
          this.spinning = false;
          this.index = index;
          this.host.classList.remove('spinning');
          this.highlight(index);
          resolve(index);
        }
      };
      requestAnimationFrame(frame);
    });
  }
}

export { NS };
