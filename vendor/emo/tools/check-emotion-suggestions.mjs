import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const cases = [
 {text:'heart', family:true, first:'❤️', includes:['🧡','🩷','💔','❤️‍🔥','❤️‍🩹','💟','♥️','🫶']},
 {text:'hearts', family:true, first:'❤️', includes:['🧡','🩷','💔','❤️‍🔥','❤️‍🩹','💟','♥️','🫶']},
 {text:'heart', limit:3, first:'❤️', includes:['🧡','💛']},
 {text:'murder', includes:['🔪','🗡️','🩸','💀','⚔️']},
 {text:'murder', limit:3, includes:['🔪','🗡️','🩸']},
 {text:'watching a murder mystery', includes:['🔪','🗡️','🩸']},
 {text:'goth', includes:['🖤','🥀','🦇','🩸']},
 {text:'knives', includes:['🔪','🗡️','⚔️']},
 {text:'burnout', includes:['🪫','🫠']},
 {text:'homesick', includes:['🏠','🥺']},
 {text:'deadline', includes:['⏰','⏳']},
 {text:'hangover', includes:['🤕','🤢']},
 {text:'daggr', includes:['🗡️']},
 {text:'skulll', includes:['💀']},
 {text:'buterfly', includes:['🦋']},
 {text:'haert', includes:['❤️'], fuzzyCount:2},
 {text:'red haert', includes:['❤️']},
 {text:'kithcen knife', includes:['🔪']},
 {text:'not murder', excludes:['🔪','🗡️','🩸']},
 {text:'silly', first:'🤪'},
 {text:'SILLY', first:'🤪'},
 {text:"I'm feeling silly", first:'🤪', excludes:['💀']},
 {text:'goofy', first:'🤪'},
 {text:'wacky', includes:['🤪']},
 {text:'foolish', includes:['🤪']},
 {text:'crazy', includes:['🤪']},
 {text:'zany face', first:'🤪'},
 {text:'celebration', includes:['🥳','🎉']},
 {text:'sarcastic', includes:['🫠']},
 {text:'straight face', first:'😐'},
 {text:'angry', includes:['😠','😡']},
 {text:"I'm angry", includes:['😡']},
 {text:'so angry right now', includes:['😡']},
 {text:'anger', includes:['😡']},
 {text:'furious', includes:['😡']},
 {text:'frustrated', includes:['😤']},
 {text:'mad', includes:['😡']},
 {text:'sad', includes:['😢']},
 {text:"I'm sad", includes:['😢']},
 {text:'upset', includes:['😞']},
 {text:'worried', includes:['😟']},
 {text:'crying', includes:['😭']},
 {text:'disappointed', includes:['😞']},
 {text:'happy', includes:['😊']},
 {text:'not angry', excludes:['😠','😡','😤']},
 {text:'not sad', excludes:['😞','😢','😔','😭']},
 {text:'not very sad', excludes:['😞','😢','😔','😭']},
 {text:'pouting face', first:'😡'},
 {text:'POUTING FACE', first:'😡'},
 {text:'angry face', first:'😠', includes:['😡']},
 {text:':rage:', first:'😡'},
 {text:'pouting', includes:['😡','🙎']},
 {text:'loudly crying face', first:'😭'},
 {text:'red heart', first:'❤️'},
 {text:'black cat', first:'🐈‍⬛', excludes:['🐈']},
 {text:'black-cat', first:'🐈‍⬛', excludes:['🐈']},
 {text:'hot dog', first:'🌭'},
 {text:'I want a red heart', first:'❤️'},
 {text:'sewing needle', first:'🪡'},
 {text:'rocket', first:'🚀'},
 {text:'fly', first:'🪰'},
 {text:'brain', first:'🧠'},
 {text:'pizza', first:'🍕'},
 {text:'angry about my pizza', includes:['🍕','😡']},
 {text:'has anyone heard about the fly neurons?', includes:['🪰','🧠']},
 {text:'angry', limit:2, includes:['😡']},
 {text:'red', includes:['❤️']},
 {text:'face', includes:['😀']}
];
const browser = await puppeteer.launch({ headless: true });
try {
 const page = await browser.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await page.setRequestInterception(true);
 page.on('request', r => {
  if (r.url()==='http://localhost:5175/__emo-emotions') return r.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Emo emotion check</title>'});
  if (r.url().includes('platform.desertant.ai')) return r.abort();
  return r.continue();
 });
 await page.goto('http://localhost:5175/__emo-emotions');
 const result = await page.evaluate(async cases => {
  const base='https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/vendor/emo';
  const {Emo}=await import('/node_modules/@desert-ant-labs/emo/browser.js');
  const model=await Emo.load({litertWasmDir:`${base}/litert-2.5.3/`,modelBaseUrl:`${base}/model-v0.7.0/`});
  const rows=[];
  for(const c of cases) rows.push({...c,raw:await model.suggestions(c.text,{limit:8})});
  model.dispose();
  const {initEmo,suggestEmoji}=await import('/src/lib/emo-suggest.js');
  await initEmo();
  for(const row of rows) row.app=await suggestEmoji(row.text,row.family?undefined:row.limit??8);
  return rows;
 },cases);
 writeFileSync('vendor/emo/emotion-suggestions.json',JSON.stringify(result,null,2)+'\n');
 assert.deepEqual(errors,[]);
 for(const r of result) {
  const emoji=r.app.map(x=>x.emoji);
  console.log(JSON.stringify({text:r.text,limit:r.limit,app:emoji}));
  assert(emoji.length<=(r.family?48:r.limit??8),`${r.text}: too many suggestions`);
  if(r.family) assert(emoji.length>=34,`${r.text}: missing heart family members`);
  assert.equal(new Set(emoji).size,emoji.length,`${r.text}: duplicate suggestions`);
  const fuzzy=r.app.filter(h=>h.match==='fuzzy');
  assert(fuzzy.length<=2,`${r.text}: too many fuzzy suggestions`);
  if(fuzzy.length) assert(r.app.slice(-fuzzy.length).every(h=>h.match==='fuzzy'),`${r.text}: fuzzy suggestions must be last`);
  if(r.fuzzyCount!==undefined) assert.equal(fuzzy.length,r.fuzzyCount,`${r.text}: fuzzy count`);
  assert(!emoji.includes('🍆')&&!emoji.includes('🍑'),`${r.text}: blocked emoji`);
  if(r.first) assert.equal(emoji[0],r.first,`${r.text}: first literal match`);
  for(const expected of r.includes??[]) assert(emoji.includes(expected),`${r.text}: missing ${expected}`);
  for(const excluded of r.excludes??[]) assert(!emoji.includes(excluded),`${r.text}: unexpected ${excluded}`);
 }
 console.log(`Passed ${result.length} emotion/literal-name cases.`);
} finally {await browser.close();}
