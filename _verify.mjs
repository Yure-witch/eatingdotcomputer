import puppeteer from 'puppeteer';
import { homedir } from 'os'; import { join } from 'path';
const b = await puppeteer.launch({ headless:'shell', userDataDir: join(homedir(),'.eatingdotcomputer-capture-profile'), args:['--no-sandbox'], protocolTimeout:240000 });
const p = (await b.pages())[0] ?? await b.newPage();
await p.setViewport({ width:430, height:932, deviceScaleFactor:3, isMobile:true, hasTouch:true });
await p.goto('http://localhost:5175/onboarding/profile', { waitUntil:'load', timeout:150000 });
await new Promise(r=>setTimeout(r,6000));
await p.evaluate(() => { const x=[...document.querySelectorAll('button')].find(b=>/Pick expression/i.test(b.textContent)); x?.click(); });
await new Promise(r=>setTimeout(r,4500));
console.log(JSON.stringify(await p.evaluate(() => {
  const panel=document.querySelector('.expr-panel'); const av=document.querySelector('.ap-avatar, .avatar, [class*="avatar"]');
  const pr=panel?.getBoundingClientRect(); const ar=av?.getBoundingClientRect();
  return {
    panelH: pr?Math.round(pr.height):null, panelTop: pr?Math.round(pr.top):null,
    avatarTop: ar?Math.round(ar.top):null, avatarBottom: ar?Math.round(ar.bottom):null,
    avatarVisibleAbovePicker: !!(pr&&ar) && ar.bottom <= pr.top,
    viewportH: window.innerHeight
  };
}), null, 1));
await p.screenshot({ path:'/tmp/_ap.png' });
await b.close();
