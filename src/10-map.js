/* ============================================================================
 *  마몽어스 · MAP MODULE
 *  - 방/복도를 사각형으로 정의 → 타일 그리드로 래스터화
 *  - 타일 충돌 판정, 벽 선분 추출(머지), 2D 가시성 폴리곤(레이캐스트)
 * ==========================================================================*/
const TILE = 32;
const GW = 102, GH = 60;                 // grid width / height (tiles)
const WORLD_W = GW * TILE, WORLD_H = GH * TILE;

/* ---- 방 정의 (타일 좌표) --------------------------------------------------
 * floor: 바닥 재질 (렌더러가 방마다 다른 질감으로 그린다)
 *   plank 나무판자 · straw 짚·흙마당 · stone 돌바닥 · tile 병원타일
 *   soil 온실흙 · grass 잔디 · dirt 맨흙 · concrete 시멘트
 * 구조(위치·크기)는 검증된 값이라 그대로 두고 이름·재질만 목장으로 바꿨다. */
const ROOMS = [
  { id:'upeng',  name:'북쪽 차고',  floor:'dirt',     x: 6, y: 6, w:16, h:12 },
  { id:'react',  name:'물레방아',   floor:'stone',    x: 4, y:24, w:14, h:14 },
  { id:'loweng', name:'남쪽 차고',  floor:'dirt',     x: 6, y:44, w:16, h:12 },
  { id:'secur',  name:'감시초소',   floor:'plank',    x:26, y:27, w:11, h: 9 },
  { id:'medbay', name:'동물병원',   floor:'tile',     x:28, y: 8, w:14, h:11 },
  { id:'cafe',   name:'헛간 앞마당', floor:'straw',   x:48, y: 4, w:22, h:16 },
  { id:'weapon', name:'농기구창고', floor:'plank',    x:76, y: 4, w:16, h:11 },
  { id:'oxygen', name:'온실',       floor:'soil',     x:74, y:20, w:11, h: 9 },
  { id:'navig',  name:'망루',       floor:'plank',    x:88, y:26, w:11, h:10 },
  { id:'shield', name:'전기울타리', floor:'grass',    x:74, y:42, w:13, h:11 },
  { id:'comms',  name:'방송실',     floor:'plank',    x:56, y:44, w:13, h:10 },
  { id:'store',  name:'곡물창고',   floor:'plank',    x:36, y:40, w:16, h:15 },
  { id:'elect',  name:'발전기실',   floor:'concrete', x:22, y:41, w:12, h:11 },
  { id:'admin',  name:'사무실',     floor:'plank',    x:54, y:25, w:13, h:10 },
];

/* ---- 복도 (겹쳐서 방을 연결) ---------------------------------------------*/
const HALLS = [
  { x:21, y:10, w: 8, h: 4 },   // 북쪽 차고 ─ 동물병원
  { x:41, y:11, w: 8, h: 4 },   // 동물병원 ─ 헛간 앞마당
  { x:69, y: 7, w: 8, h: 4 },   // 헛간 앞마당 ─ 농기구창고
  { x:78, y:14, w: 4, h: 7 },   // 농기구창고 ─ 온실
  { x:83, y:22, w: 6, h: 4 },   // 온실 ─ 망루
  { x:90, y:35, w: 4, h:10 },   // 망루 ─ (남쪽)
  { x:85, y:44, w: 7, h: 4 },   // (남쪽) ─ 전기울타리
  { x:68, y:46, w: 7, h: 4 },   // 전기울타리 ─ 방송실
  { x:51, y:46, w: 6, h: 4 },   // 방송실 ─ 곡물창고
  { x:33, y:45, w: 4, h: 4 },   // 곡물창고 ─ 발전기실
  { x:50, y:19, w: 4, h: 5 },   // 헛간 앞마당 ↓
  { x:42, y:21, w:12, h: 4 },   // ↳ 서쪽 통로
  { x:42, y:24, w: 4, h:17 },   // 긴 세로 길 ─ 곡물창고
  { x:45, y:30, w:10, h: 4 },   // 세로길 ─ 사무실
  { x:58, y:34, w: 4, h:11 },   // 사무실 ─ 방송실
  { x:17, y:30, w:10, h: 4 },   // 물레방아 ─ 감시초소
  { x:30, y:18, w: 4, h:10 },   // 동물병원 ─ 감시초소
  { x:10, y:17, w: 4, h: 8 },   // 북쪽 차고 ─ 물레방아
  { x:10, y:37, w: 4, h: 8 },   // 물레방아 ─ 남쪽 차고
  { x:21, y:46, w: 4, h: 4 },   // 남쪽 차고 ─ 발전기실
  { x:29, y:35, w: 4, h: 7 },   // 감시초소 ─ 발전기실
];

/* ---- 그리드 래스터화 ------------------------------------------------------*/
const grid = new Uint8Array(GW * GH);      // 1 = 통행 가능
const roomOf = new Int8Array(GW * GH).fill(-1);
const gi = (x, y) => y * GW + x;

function paint(r, roomIdx) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      grid[gi(x, y)] = 1;
      if (roomIdx >= 0) roomOf[gi(x, y)] = roomIdx;
    }
  }
}
ROOMS.forEach((r, i) => paint(r, i));
HALLS.forEach(h => paint(h, -1));

const walkableTile = (tx, ty) =>
  tx >= 0 && ty >= 0 && tx < GW && ty < GH && grid[gi(tx, ty)] === 1;

const walkablePx = (px, py) => walkableTile((px / TILE) | 0, (py / TILE) | 0);

/** 월드 좌표 → 방 이름 (복도면 '오솔길') */
function roomNameAt(px, py) {
  const tx = (px / TILE) | 0, ty = (py / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return '오솔길';
  const r = roomOf[gi(tx, ty)];
  return r < 0 ? '오솔길' : ROOMS[r].name;
}
function roomIdAt(px, py) {
  const tx = (px / TILE) | 0, ty = (py / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return null;
  const r = roomOf[gi(tx, ty)];
  return r < 0 ? null : ROOMS[r].id;
}

/* ---- 원형 충돌 이동 (축 분리 + 4점 샘플) ---------------------------------*/
const R_PAD = 10;                                   // 캐릭터 충돌 반경
function fits(px, py) {
  return walkablePx(px - R_PAD, py - R_PAD) && walkablePx(px + R_PAD, py - R_PAD)
      && walkablePx(px - R_PAD, py + R_PAD) && walkablePx(px + R_PAD, py + R_PAD);
}
/** 벽을 따라 미끄러지는 이동. {x,y} 반환 */
function moveWithCollision(x, y, dx, dy) {
  let nx = x, ny = y;
  if (dx) { if (fits(nx + dx, ny)) nx += dx; else { const s = Math.sign(dx); for (let k = Math.abs(dx) | 0; k > 0; k--) if (fits(nx + s * k, ny)) { nx += s * k; break; } } }
  if (dy) { if (fits(nx, ny + dy)) ny += dy; else { const s = Math.sign(dy); for (let k = Math.abs(dy) | 0; k > 0; k--) if (fits(nx, ny + s * k)) { ny += s * k; break; } } }
  return { x: nx, y: ny };
}

/* ---- 벽 선분 추출 (인접 동일방향 병합) -----------------------------------*/
const WALLS = [];   // {x1,y1,x2,y2}  월드 픽셀
(function buildWalls() {
  // 가로 경계: y 라인마다 위/아래 통행성이 다른 구간
  for (let y = 0; y <= GH; y++) {
    let run = -1;
    for (let x = 0; x <= GW; x++) {
      const a = walkableTile(x, y - 1), b = walkableTile(x, y);
      const edge = x < GW && (a !== b);
      if (edge && run < 0) run = x;
      if (!edge && run >= 0) { WALLS.push({ x1: run * TILE, y1: y * TILE, x2: x * TILE, y2: y * TILE }); run = -1; }
    }
  }
  // 세로 경계
  for (let x = 0; x <= GW; x++) {
    let run = -1;
    for (let y = 0; y <= GH; y++) {
      const a = walkableTile(x - 1, y), b = walkableTile(x, y);
      const edge = y < GH && (a !== b);
      if (edge && run < 0) run = y;
      if (!edge && run >= 0) { WALLS.push({ x1: x * TILE, y1: run * TILE, x2: x * TILE, y2: y * TILE }); run = -1; }
    }
  }
  for (const w of WALLS) { w.minx = Math.min(w.x1, w.x2); w.maxx = Math.max(w.x1, w.x2); w.miny = Math.min(w.y1, w.y2); w.maxy = Math.max(w.y1, w.y2); }
})();

/* ---- 가시성 폴리곤 --------------------------------------------------------*/
function raySeg(ox, oy, dx, dy, s) {
  const sdx = s.x2 - s.x1, sdy = s.y2 - s.y1;
  const den = dx * sdy - dy * sdx;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t2 = ((s.x1 - ox) * dy - (s.y1 - oy) * dx) / den;
  if (t2 < 0 || t2 > 1) return Infinity;
  /* ⚠️ 나눗셈 축은 '광선'의 지배 성분으로 골라야 한다.
   * 벽 방향으로 고르면(수정 전) 정확히 수평인 광선 × 세로 벽에서 dy=0 나눗셈이
   * 되어 벽을 통과했다 — 시야 원의 보간 광선에 0°·90°·180°·270°가 정확히
   * 포함되어, 눈높이에서 수평·수직으로 빛줄기가 벽을 뚫고 새던 원인. */
  const t1 = Math.abs(dx) > Math.abs(dy)
    ? (s.x1 + sdx * t2 - ox) / dx
    : (s.y1 + sdy * t2 - oy) / dy;
  return t1 > 0.001 ? t1 : Infinity;
}

/** 시점(ox,oy)에서 반경 R 안의 가시 폴리곤. [[x,y],...] */
function visibilityPolygon(ox, oy, R) {
  const near = [];
  for (const w of WALLS) {
    if (w.maxx < ox - R || w.minx > ox + R || w.maxy < oy - R || w.miny > oy + R) continue;
    near.push(w);
  }
  const angles = [];
  for (const w of near) {
    for (const [px, py] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - 0.00035, a, a + 0.00035);
    }
  }
  // 시야 원 보간 (선분이 적을 때 원형 유지)
  const STEPS = 44;
  for (let i = 0; i < STEPS; i++) angles.push((i / STEPS) * Math.PI * 2 - Math.PI);
  angles.sort((a, b) => a - b);

  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = R;
    for (const w of near) { const t = raySeg(ox, oy, dx, dy, w); if (t < best) best = t; }
    pts.push([ox + dx * best, oy + dy * best]);
  }
  return pts;
}

/** 두 점 사이 벽 차단 여부 */
function lineBlocked(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy); if (len < 1) return false;
  const ux = dx / len, uy = dy / len;
  const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), miny = Math.min(ay, by), maxy = Math.max(ay, by);
  for (const w of WALLS) {
    if (w.maxx < minx || w.minx > maxx || w.maxy < miny || w.miny > maxy) continue;
    const t = raySeg(ax, ay, ux, uy, w);
    if (t < len - 0.5) return true;
  }
  return false;
}

/* ---- 벤트 네트워크 --------------------------------------------------------*/
const VENTS = [
  { id:'v1',  room:'upeng',  x:10, y:15, net:'A' },
  { id:'v2',  room:'react',  x: 7, y:27, net:'A' },
  { id:'v3',  room:'loweng', x:10, y:47, net:'A' },
  { id:'v4',  room:'cafe',   x:67, y:17, net:'B' },
  { id:'v5',  room:'weapon', x:89, y: 7, net:'B' },
  { id:'v6',  room:'navig',  x:96, y:33, net:'B' },
  { id:'v7',  room:'medbay', x:39, y:16, net:'C' },
  { id:'v8',  room:'secur',  x:34, y:29, net:'C' },
  { id:'v9',  room:'elect',  x:24, y:49, net:'C' },
  { id:'v10', room:'store',  x:49, y:52, net:'D' },
  { id:'v11', room:'comms',  x:66, y:51, net:'D' },
  { id:'v12', room:'shield', x:84, y:50, net:'D' },
  { id:'v13', room:'admin',  x:64, y:27, net:'E' },
  { id:'v14', room:'oxygen', x:82, y:26, net:'E' },
].map(v => ({ ...v, wx: v.x * TILE + TILE / 2, wy: v.y * TILE + TILE / 2 }));

const ventNeighbors = (id) => {
  const v = VENTS.find(a => a.id === id);
  return v ? VENTS.filter(a => a.net === v.net && a.id !== id) : [];
};

/* ---- 숨는 곳 (건초더미) ---------------------------------------------------
 * 구스구스덕의 덤불처럼, 들어가면 남에게 안 보인다. 한 더미에 한 명.
 * 같은 버튼으로 빈 더미면 숨고, 누가 있으면 튀어나오게 한다(수색).
 * 좌표는 drawProps 의 실제 건초 소품 위치와 맞춰야 한다. */
const HIDE_SPOTS = [
  // type: 'hay'(건초수레·야외) | 'locker'(사물함·실내 — 문이 열리고 닫힌다)
  // wall: 가구가 붙어 있는 벽 (그림·상호작용 안내가 이 방향으로 붙는다)
  { id:'h1', room:'cafe',   x:49.5, y:5.5, type:'hay',    wall:'N' },  // 앞마당 북서 건초수레
  { id:'h2', room:'cafe',   x:66,   y:5.5, type:'hay',    wall:'N' },  // 앞마당 북동 건초수레
  { id:'h3', room:'store',  x:37.5, y:41,  type:'hay',    wall:'N' },  // 곡물창고 구석 건초
  { id:'h4', room:'medbay', x:40,   y:9,   type:'locker', wall:'E' },  // 동물병원 사물함
  { id:'h5', room:'comms',  x:57,   y:50,  type:'locker', wall:'W' },  // 방송실 사물함
  { id:'h6', room:'weapon', x:86,   y:5,   type:'locker', wall:'N' },  // 농기구창고 사물함
  { id:'h7', room:'shield', x:76,   y:43,  type:'hay',    wall:'N' },  // 전기울타리 건초
].map(h => ({ ...h, wx: h.x * TILE + TILE / 2, wy: h.y * TILE + TILE / 2 }));

/* ---- 임무 지점 ------------------------------------------------------------*/
/* kind: 미니게임 ID / long: 장기임무(여러 단계) / vis: 시각임무 */
const TASK_SPOTS = [
  /* 전부 벽에 붙어 있다 — 덕몽어스처럼 '벽의 가구를 만지는' 감각.
   * wall: 가구가 걸린/붙은 벽. 문(복도 개구부)은 피해서 배치했다. */
  { id:'t_wire_e',  room:'elect',  x:24, y:42, wall:'N', kind:'wiring',   name:'전선 잇기',      part:true },
  { id:'t_wire_c',  room:'cafe',   x:49, y:16, wall:'W', kind:'wiring',   name:'전선 잇기',      part:true },
  { id:'t_wire_n',  room:'navig',  x:90.5, y:27, wall:'N', kind:'wiring',   name:'전선 잇기',      part:true },
  { id:'t_wire_s',  room:'secur',  x:27, y:28, wall:'N', kind:'wiring',   name:'전선 잇기',      part:true },
  { id:'t_wire_a',  room:'admin',  x:55, y:27, wall:'W', kind:'wiring',   name:'전선 잇기',      part:true },

  { id:'t_card',    room:'admin',  x:57.3, y:26, wall:'N', kind:'card',     name:'출근 카드 찍기' },
  { id:'t_swipe2',  room:'cafe',   x:68, y:13, wall:'E', kind:'keypad',   name:'사료통 잠금해제' },
  { id:'t_gar_c',   room:'cafe',   x:55, y:18, wall:'S', kind:'garbage',  name:'거름 치우기',    chainNext:'t_gar_s' },
  { id:'t_gar_s',   room:'store',  x:50, y:52, wall:'E', kind:'garbage',  name:'거름 치우기',    chainHidden:true },
  { id:'t_fuel1',   room:'store',  x:37, y:44, wall:'W', kind:'fuel',     name:'경유 채우기',    chainNext:'t_fuel2' },
  { id:'t_fuel2',   room:'upeng',  x: 8, y: 7, wall:'N', kind:'fuel',     name:'경유 채우기',    chainHidden:true, chainNext:'t_fuel3' },
  { id:'t_fuel3',   room:'loweng', x: 8, y:54, wall:'S', kind:'fuel',     name:'경유 채우기',    chainHidden:true },
  { id:'t_align1',  room:'upeng',  x:20, y:16, wall:'E', kind:'align',    name:'트랙터 정비' },
  { id:'t_align2',  room:'loweng', x:20, y:52, wall:'E', kind:'align',    name:'트랙터 정비' },
  { id:'t_ast',     room:'weapon', x:80, y: 5, wall:'N', kind:'asteroid', name:'까마귀 쫓기',    vis:true },
  { id:'t_shield',  room:'shield', x:78, y:51, wall:'S', kind:'shields',  name:'울타리 점검',    vis:true },
  { id:'t_scan',    room:'medbay', x:29, y:16, wall:'W', kind:'scan',     name:'건강 검진',      vis:true },
  { id:'t_sample',  room:'medbay', x:38, y: 9, wall:'N', kind:'sample',   name:'우유 검사' },
  { id:'t_dl',      room:'comms',  x:66.3, y:45, wall:'N', kind:'download', name:'주문서 받기',    chainNext:'t_up' },
  { id:'t_up',      room:'admin',  x:56, y:33, wall:'S', kind:'download', name:'주문서 보내기',  chainHidden:true, up:true },
  { id:'t_leaf',    room:'oxygen', x:75, y:21, wall:'N', kind:'leaves',   name:'여물통 청소' },
  { id:'t_div1',    room:'elect',  x:26, y:50, wall:'S', kind:'divert',   name:'전력 분배' },
  { id:'t_div2',    room:'react',  x: 5, y:35, wall:'W', kind:'divert',   name:'전력 분배' },
  { id:'t_chart',   room:'navig',  x:97, y:30, wall:'E', kind:'chart',    name:'양떼 몰기' },
  { id:'t_cal',     room:'react',  x:15, y:25, wall:'N', kind:'calib',    name:'물레방아 보정' },
  { id:'t_temp1',   room:'loweng', x: 7, y:50, wall:'W', kind:'temp',     name:'온도 조정' },
  { id:'t_temp2',   room:'oxygen', x:80, y:27, wall:'S', kind:'temp',     name:'온도 조정' },
  { id:'t_secur',   room:'secur',  x:34, y:34, wall:'S', kind:'records', name:'출입 기록 정리' },
  { id:'t_shoot',   room:'weapon', x:90, y: 8, wall:'E', kind:'keypad',   name:'창고 잠금해제' },
  { id:'t_store',   room:'store',  x:44, y:53, wall:'S', kind:'sort',     name:'곡물 분류' },
].map(t => ({ ...t, wx: t.x * TILE + TILE / 2, wy: t.y * TILE + TILE / 2 }));

/* ---- 사보타주 지점 --------------------------------------------------------*/
const SAB_SPOTS = {
  lights:  [{ room:'elect',  x:28, y:45 }],
  comms:   [{ room:'comms',  x:63, y:47 }],
  reactor: [{ room:'react',  x: 6, y:30 }, { room:'react',  x:16, y:30 }],
  oxygen:  [{ room:'oxygen', x:79, y:21 }, { room:'admin',  x:57, y:31 }],
};
for (const k in SAB_SPOTS) SAB_SPOTS[k].forEach(s => { s.wx = s.x * TILE + TILE / 2; s.wy = s.y * TILE + TILE / 2; s.key = k; });

/* ---- 특수 지점 ------------------------------------------------------------*/
const EMERGENCY_BTN = { wx: 59 * TILE, wy: 12 * TILE };        // 헛간 종
const ADMIN_TABLE   = { wx: 60 * TILE, wy: 29 * TILE };        // 사무실 목장 지도
const VITALS_PANEL  = { wx: 33 * TILE + 16, wy: 51 * TILE };   // 발전기실
const CAMERA_PANEL  = { wx: 30 * TILE, wy: 33 * TILE };        // 감시초소

/* ---- 스폰 위치 (헛간 앞마당 원형) ----------------------------------------*/
function spawnPoints(n) {
  const cx = 59 * TILE, cy = 12 * TILE, rad = 130;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad };
  });
}

/* ---- 감시 카메라가 비추는 방 ---------------------------------------------*/
const CAM_ROOMS = ['upeng', 'loweng', 'store', 'medbay'];

/* ---- 문(사보타주 잠금) 대상 방 -------------------------------------------*/
const DOOR_ROOMS = ['cafe','elect','medbay','store','upeng','loweng','secur','comms','oxygen','navig','shield','weapon','admin','react'];
