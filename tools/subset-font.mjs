/* ============================================================================
 *  폰트 서브셋 — src/01-font.css 생성
 *
 *  판단: 본문은 시스템 한글 폰트(iOS Apple SD Gothic Neo / Android Noto Sans KR)
 *       가 이미 충분히 좋다. 여기에 Pretendard 를 통째로 넣으면 base64 로
 *       ~280KB 를 쓰면서 차이는 미미하다. → 본문은 시스템 폰트 유지.
 *
 *       대신 '개성'이 필요한 곳(로고·역할 이름·회의 제목·결과 화면)에만
 *       둥근 디스플레이 폰트(Jua)를 쓴다. 등장 글자가 한정적이라
 *       서브셋하면 매우 작다.
 *
 *  라이선스: Jua = SIL Open Font License 1.1 (재배포·임베딩 자유)
 *           https://github.com/google/fonts/tree/main/ofl/jua
 *
 *  실행: node tools/subset-font.mjs
 * ==========================================================================*/
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONT_DIR = path.join(root, 'vendor', 'font');
const OUT_DIR = path.join(FONT_DIR, 'subset');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

/* ---- 디스플레이 폰트가 필요한 문자 ----------------------------------------
 * 로고·직업 이름·진영·회의/결과 화면 문구 + 숫자/영문(방 코드).
 * 사용자 닉네임은 무엇이 올지 모르므로 여기 포함하지 않는다.
 * 없는 글자는 시스템 폰트로 자연 폴백된다. */
const DISPLAY_TEXT = [
  // 로고 · 진영
  '마몽어스', '양', '늑대', '중립', '진영',
  // 직업 이름 (표시명 전부)
  '탐정', '장의사', '기술자', '영매', '보안관', '감시견', '정치인', '수의사',
  '추적자', '경호원', '숫양', '암살자', '저격수', '변신술사', '매장인', '첩자',
  '구렁이', '독수리', '모기', '곰',
  // 회의 · 결과 · 추방
  '긴급 회의', '시체 발견', '토론 중', '투표 중', '스킵',
  '승리', '패배', '역할이 정해졌습니다', '우주로 추방되었습니다',
  '님이', '님은', '이었습니다', '였습니다', '남은',
  '게임 시작', '방 만들기', '참가', '임무 진행도', '가로로 돌려주세요',
  // 숫자 · 영문 · 기호
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  ' !?.,·:;·-—…()[]/%+~',
].join('');

const chars = new Set(DISPLAY_TEXT);
const text = [...chars].join('');
const listFile = path.join(OUT_DIR, '_display-chars.txt');
writeFileSync(listFile, text);

/* ---- 서브셋 실행 ----------------------------------------------------------*/
const SRC = path.join(FONT_DIR, 'Jua-Regular.ttf');
const DST = path.join(OUT_DIR, 'Jua.subset.woff2');

execFileSync('python3', [
  '-m', 'fontTools.subset', SRC,
  `--text-file=${listFile}`,
  '--flavor=woff2',
  '--layout-features=*',
  '--no-hinting',
  '--desubroutinize',
  `--output-file=${DST}`,
], { stdio: 'inherit' });

const before = statSync(SRC).size, after = statSync(DST).size;
const b64 = readFileSync(DST).toString('base64');

const css = `/* ============================================================================
 *  Jua — SIL Open Font License 1.1 (재배포·임베딩 자유)
 *  https://github.com/google/fonts/tree/main/ofl/jua
 *
 *  로고·직업명·회의/결과 화면 등 '개성이 필요한 곳'에만 쓴다 (.disp 클래스).
 *  본문은 시스템 한글 폰트를 그대로 쓴다 — 용량 대비 차이가 작기 때문.
 *  서브셋에 없는 글자(사용자 닉네임 등)는 시스템 폰트로 자동 폴백된다.
 * ==========================================================================*/
@font-face{font-family:'MamongDisplay';font-style:normal;font-weight:400;font-display:swap;
src:url(data:font/woff2;base64,${b64}) format('woff2')}
`;

writeFileSync(path.join(root, 'src', '01-font.css'), css);
console.log(`\n수집 문자 ${chars.size}자`);
console.log(`Jua: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(1)}KB (base64 ${(b64.length / 1024).toFixed(0)}KB)`);
console.log('✔ src/01-font.css 생성');
