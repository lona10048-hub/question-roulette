// 2차시 콘텐츠: 질문 틀 12개(고정), 대주제 6개와 제시어, 한 마디 바꾸기 방법 10가지
// 흐름도 문서 「질문하는 힘 기르기 1~4차시 흐름도(수정본)」와 프로그램 명세를 따른다.

// 룰렛에는 종류(찾아보면 알 수 있는 틀 / 따져 봐야 하는 틀)를 표시하지 않는다.
// 룰렛 칸 순서는 두 종류가 섞이도록 번갈아 놓았다. label = 룰렛 칸에 쓰는 짧은 말
export const FRAMES = [
  { id: 'who', label: '누가', text: '누가 ~할까?', kind: 'find' },
  { id: 'why', label: '왜', text: '왜 ~할까?', kind: 'think' },
  { id: 'when', label: '언제', text: '언제 ~했을까?', kind: 'find' },
  { id: 'howto', label: '어떻게 하면', text: '어떻게 하면 ~할 수 있을까?', kind: 'think' },
  { id: 'where', label: '어디에서', text: '어디에서 ~할까?', kind: 'find' },
  { id: 'whatif', label: '만약', text: '만약 ~라면 어떻게 될까?', kind: 'think' },
  { id: 'howmuch', label: '얼마나', text: '얼마나 ~할까?', kind: 'find' },
  { id: 'diff', label: '어떻게 다를까', text: '~와 ~는 어떻게 다를까?', kind: 'think' },
  { id: 'what', label: '무엇일까', text: '~은 무엇일까?', kind: 'find' },
  { id: 'effect', label: '누구에게 영향', text: '~은 누구에게 영향을 줄까?', kind: 'think' },
  { id: 'should', label: '해야 할까', text: '~해야 할까?', kind: 'think' },
  { id: 'future', label: '앞으로', text: '앞으로 ~은 어떻게 될까?', kind: 'think' },
];

// 선생님 진행 화면에 보여 주는 순서 (찾아보면 알 수 있는 틀 → 따져 봐야 하는 틀, 표시는 하지 않음)
export const FRAMES_BOARD = ['who', 'when', 'where', 'howmuch', 'what', 'why', 'howto', 'whatif', 'diff', 'effect', 'should', 'future'].map((id) =>
  FRAMES.find((f) => f.id === id)
);

export const THEMES = [
  { id: 'school', name: '학교', words: ['급식실', '운동장', '쉬는 시간', '교실', '도서관', '숙제', '시험', '방과후'], spare: ['교과서', '체육 대회', '학급 규칙', '선생님'] },
  { id: 'env', name: '환경', words: ['쓰레기', '플라스틱', '나무', '미세먼지', '재활용', '물', '에너지', '폭염'], spare: ['바다', '일회용품', '전기차', '분리배출'] },
  { id: 'town', name: '우리 동네', words: ['시장', '공원', '버스', '횡단보도', '이웃', '가게', '놀이터', '소방서'], spare: ['아파트', '하천', '편의점', '골목길'] },
  { id: 'food', name: '음식', words: ['김치', '라면', '채소', '간식', '편식', '패스트푸드', '농사', '유통기한'], spare: ['쌀', '과일', '배달 음식', '음식물 쓰레기'] },
  { id: 'animal', name: '동물', words: ['반려동물', '길고양이', '동물원', '곤충', '철새', '멸종 위기 동물', '바다 생물', '동물의 집'], spare: ['꿀벌', '동물 병원', '야생 동물', '먹이'] },
  { id: 'future', name: '미래 기술', words: ['로봇', 'AI', '스마트폰', '인터넷', '자율주행 자동차', '드론', '우주 여행', '게임'], spare: ['3D 프린터', '가상 현실', '스마트 홈', '발명'] },
];

export const WORDS_MIN = 4;
export const WORDS_MAX = 12;
export const WORD_MAX_LEN = 10;
export const THEME_MAX_LEN = 12;

// 한 마디 바꾸기 방법 카드 (학생 화면 TIP). ex의 [ ] 안이 바꾼 말
export const METHOD_BASE = '쉬는 시간은 얼마나 길까?';
export const METHODS = [
  { id: 'ask', name: '묻는 말 바꾸기', ex: '쉬는 시간은 [왜] 필요할까?' },
  { id: 'target', name: '대상 바꾸기', ex: '[다른 나라] 학교의 쉬는 시간은 얼마나 길까?' },
  { id: 'time', name: '때 바꾸기', ex: '[100년 전] 학교에도 쉬는 시간이 있었을까?' },
  { id: 'place', name: '장소 바꾸기', ex: '[회사에서는] 쉬는 시간이 얼마나 길까?' },
  { id: 'person', name: '사람(입장) 바꾸기', ex: '[선생님의] 쉬는 시간은 얼마나 길까?' },
  { id: 'size', name: '크기·수 바꾸기', ex: '[1년 동안] 쉬는 시간은 모두 얼마나 길까?' },
  { id: 'opposite', name: '반대로 바꾸기', ex: '[수업 시간은] 얼마나 길까?' },
  { id: 'if', name: "'만약' 붙이기", ex: '[만약] 쉬는 시간이 30분이라면 어떻게 될까?' },
  { id: 'compare', name: '두 가지 비교하기', ex: '쉬는 시간과 [점심시간은 어떻게 다를까?]' },
  { id: 'scope', name: '넓히기·좁히기', ex: '[우리나라] 학교의 쉬는 시간은 얼마나 길까?' },
];
export const METHOD_FREE = '그 밖의 방법';

export const ROULETTE_TIMES = [10, 15, 18, 20];
export const CHANGE_TIMES = [5, 8, 10, 15];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || null;
}

export function frameByText(text) {
  return FRAMES.find((f) => f.text === text) || null;
}

// "[왜]" 표시를 굵은 글씨로
export function markEx(s, esc) {
  return esc(s).replace(/\[([^\]]+)\]/g, '<b>$1</b>');
}

// 질문에 질문 틀이 들어갔는지 살짝 확인할 때 쓰는 말 (없으면 "그래도 저장할까요?" 하고 물어본다)
const FRAME_KEYS = {
  who: /누가|누구/,
  why: /왜/,
  when: /언제/,
  howto: /어떻게/,
  where: /어디/,
  whatif: /만약|만일/,
  howmuch: /얼마나|얼마|몇/,
  diff: /다를|다른|다르|차이/,
  what: /무엇|뭘|뭐|무슨/,
  effect: /영향/,
  should: /해야|할까|될까/,
  future: /앞으로|미래|나중/,
};

const squash = (s) => String(s || '').replace(/[\s?？!.,~·]/g, '').toLowerCase();

export function hasFrame(text, frame) {
  const re = frame && FRAME_KEYS[frame.id];
  return !re || re.test(squash(text));
}

// 제시어가 들어갔는지: 띄어쓰기를 빼고 비교 (예: '쉬는 시간' ↔ '쉬는시간')
export function hasWord(text, word) {
  const w = squash(word);
  return !w || squash(text).includes(w);
}

// 한 마디 바꾸기: 원래 질문과 같은지 (띄어쓰기·물음표만 바꾼 것도 같다고 본다)
export const sameText = (a, b) => squash(a) === squash(b);

// 3차시 프로그램에 올릴 CSV의 열 (3차시도 이 이름으로 읽는다)
export const CSV_HEAD = ['번호', '모둠', '활동', '질문', '질문 틀', '제시어', '원래 질문 번호', '바꾼 방법', '쓴 사람', '별표', '대주제'];
export const KIND_LABEL = { r: '질문 룰렛', c: '한 마디 바꾸기' };
