/* 맵 전체를 PNG 로 뽑는다.  node tools/shot-map.mjs out.png  (서버 불필요) */
import { chromium } from 'playwright';
import fs from 'fs';
const out = process.argv[2] || 'map.png';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1200,height:800} });
await p.goto('file://' + process.cwd() + '/docs/index.html');
await p.waitForTimeout(1500);
const d = await p.evaluate(() => { Render.buildMap(); return Render.mapCv.toDataURL('image/png'); });
fs.writeFileSync(out, Buffer.from(d.split(',')[1], 'base64'));
await b.close();
console.log('saved', out);
