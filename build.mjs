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
