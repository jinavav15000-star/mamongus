/* 덕몽어스 빌드: 모든 소스를 단일 HTML 파일로 인라인 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');

/* CSS 는 파일명 순서대로 이어 붙인다 (01-font.css 는 tools/subset-font.mjs 가 생성) */
const cssFiles = readdirSync(src).filter(f => f.endsWith('.css')).sort();
const css = cssFiles.map(f => readFileSync(join(src, f), 'utf8')).join('\n');
const peer = readFileSync(join(root, 'vendor', 'peerjs.min.js'), 'utf8');

const jsFiles = readdirSync(src).filter(f => f.endsWith('.js')).sort();
const js = jsFiles.map(f => `\n/* ═══ ${f} ═══ */\n` + readFileSync(join(src, f), 'utf8')).join('\n');

let html = readFileSync(join(root, 'template.html'), 'utf8');
// 문자열 치환 대신 함수 치환 ($& 등 특수 패턴이 소스에 있어도 안전)
html = html.replace('/*__CSS__*/', () => css)
           .replace('/*__PEERJS__*/', () => peer)
           .replace('/*__JS__*/', () => js);

mkdirSync(join(root, 'docs'), { recursive: true });
const out = join(root, 'docs', 'index.html');
writeFileSync(out, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`✔ docs/index.html  (${kb} KB)  ←  ${jsFiles.length}개 JS + CSS + PeerJS`);
console.log('  포함:', [...cssFiles, ...jsFiles].join(', '));

/* 소리 시험실 — 효과음만 따로 들어 보는 페이지.
 * 게임 코드(10-map + 30-audio)를 그대로 인라인하므로 소리가 어긋날 일이 없다.
 * 게임에서 링크하지 않는 별도 페이지라 index.html 용량에는 영향이 없다. */
const audioSrc = ['10-map.js', '30-audio.js'].map(f => readFileSync(join(src, f), 'utf8')).join('\n');
const labTpl = readFileSync(join(root, 'tools', 'sfx-lab.html'), 'utf8');
const MARK = '/*__' + 'AUDIO__*/';        // 이 파일 안에서도 표식이 그대로 안 보이게 쪼개 둔다
// replace 는 첫 번째 것만 바꾼다. 표식이 주석에도 있으면 코드가 주석 안으로 들어가
// 조용히 빈 페이지가 나온다 (실제로 한 번 당했다). 개수를 세서 막는다.
if (labTpl.split(MARK).length !== 2) {
  throw new Error(`sfx-lab.html 의 치환 표식이 ${labTpl.split(MARK).length - 1}개다 — 정확히 1개여야 한다`);
}
const lab = labTpl.replace(MARK, () => audioSrc);
if (!/const\s+Sfx\s*=/.test(lab) || lab.includes(MARK)) throw new Error('sfx.html 인라인 실패');
writeFileSync(join(root, 'docs', 'sfx.html'), lab);
console.log(`✔ docs/sfx.html    (${(Buffer.byteLength(lab) / 1024).toFixed(0)} KB)  ←  소리 시험실`);
