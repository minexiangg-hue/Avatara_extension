// Opt-in real model regression; Chrome/history data are synthetic, not a real profile.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { answerCloud } from '../src/core/assistant.js';
import { createInitialState, normalizeMemory } from '../src/core/model.js';
import { queryChromeHistory } from '../src/background/history-query.js';
import { localDate } from '../src/core/history.js';

let apiKey='';
try {
  if(!process.argv[2])throw Error('Usage: node scripts/live-history-smoke.mjs <credential file>');
  const lines=(await readFile(process.argv[2],'utf8')).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  apiKey=lines.find(line=>!/^https?:/.test(line))||'';
  const baseUrl=lines.find(line=>/^https:\/\//.test(line));
  if(!apiKey||!baseUrl||new URL(baseUrl).hostname!=='api.deepseek.com')throw Error('Only the authorized DeepSeek endpoint is permitted.');
  const model='deepseek-v4-flash',now=new Date();
  const prior=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1,14);
  const priorDate=localDate(prior),todayDate=localDate(now);
  const entries=Array.from({length:12},(_,i)=>({id:`synthetic-${i}`,url:`https://example.com/yesterday-${i}`,title:`合成阅读材料 ${i+1}`,lastVisitTime:now.getTime(),visitCount:1000}));
  const state=createInitialState();state.settings.ai={...state.settings.ai,baseUrl,model};
  state.memories=entries.map(entry=>normalizeMemory({...entry,visitedAt:entry.lastVisitTime}));
  let permission=true;const events=[];
  const api={permissions:{contains:async()=>permission},history:{search:async()=>entries,getVisits:async({url})=>[{visitId:url+'y',visitTime:prior.getTime()},{visitId:url+'t',visitTime:now.getTime()}]}};
  async function run(name,text,verify) {
    const cache=new Map(),observations=[];let rounds=0;
    const answer=await answerCloud(text,state,{apiKey,baseUrl,model,fetchImpl:async(...args)=>{rounds++;return fetch(...args);},executeTool:async(tool,args)=>{assert.equal(tool,'query_history');const result=await queryChromeHistory(api,state,args,{now,cache});observations.push({args,result});return result;}});
    assert.ok(answer.steps.some(step=>step.name==='query_history'),'Model must use the date tool');
    verify(answer,observations);
    const result={case:name,ok:true,rounds,tools:answer.steps.map(step=>step.name),queries:observations.map(({args,result})=>({args,source:result.source,complete:result.complete,totalPages:result.totalPages,totalVisits:result.totalVisits,range:result.range})),sources:answer.sources.length,answer:answer.content};
    events.push(result);console.log(JSON.stringify(result));
  }
  await run('yesterday includes pages revisited today','昨天我都浏览了哪些东西？请列出全部页面标题和这一天的访问次数。',(answer,records)=>{
    const data=records.find(({result})=>result.range.startDate===priorDate&&result.range.endDate===priorDate)?.result;
    assert.ok(data);assert.equal(data.totalPages,12);assert.equal(data.totalVisits,12);assert.equal(data.complete,true);
    assert.match(answer.content,/12/);assert.ok(answer.content.includes('合成阅读材料 12'));assert.ok(answer.content.includes('合成阅读材料 1'));
  });
  await run('daily calendar is available','请按天列出最近七天哪些日期有浏览记录，以及每天的页面数和访问次数。',(answer,records)=>{
    const data=records.find(({result})=>result.view==='days')?.result;assert.ok(data);assert.equal(data.activeDays,2);
    assert.ok(data.results.some(row=>row.date===priorDate&&row.visits===12));assert.ok(data.results.some(row=>row.date===todayDate&&row.visits===12));
  });
  permission=false;
  await run('missing permission is not proof of no browsing','昨天我都浏览了哪些东西？',(answer,records)=>{
    assert.ok(records.length);assert.ok(records.every(({result})=>!result.complete));assert.match(answer.content,/权限|授权|不完整|无法.*确认|不能.*判断/);
  });
  console.log(JSON.stringify({ok:true,passed:events.length,syntheticOnly:true,model}));
} catch(error) {
  console.error(JSON.stringify({ok:false,error:String(error.message).split(apiKey||'__unset__').join('[redacted]')}));process.exitCode=1;
}
