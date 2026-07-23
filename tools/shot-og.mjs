/* tools/make-og.html 을 헤드리스로 렌더해 docs/og.jpg 로 저장한다.  node tools/shot-og.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1240,height:700} });
await p.goto('file://' + process.cwd() + '/tools/make-og.html');
await p.waitForTimeout(1200);
const el = await p.$('#c');
await el.screenshot({ path: 'docs/og.jpg', type: 'jpeg', quality: 88 });
await b.close();
console.log('docs/og.jpg', (fs.statSync('docs/og.jpg').size / 1024 | 0) + 'KB');
