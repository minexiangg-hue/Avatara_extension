import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { historyRange, aggregateHistory, historyPage, storedHistory, temporalHistoryRequest } from '../src/core/history.js';
import { validateToolArgs } from '../src/core/agent-tools.js';
import { createInitialState, normalizeMemory, sanitizeState } from '../src/core/model.js';
import { runAgent } from '../src/core/agent.js';
import { queryChromeHistory } from '../src/background/history-query.js';
import { answerCloud, answerLocal } from '../src/core/assistant.js';
import { createRuntime, STATE_KEY, API_KEY } from '../src/background/service-worker.js';

const now = new Date(2026, 8, 22, 12);
const yesterday = hour => new Date(2026, 8, 21, hour).getTime();
const today = hour => new Date(2026, 8, 22, hour).getTime();
const args = (extra={}) => validateToolArgs('query_history', { period: 'yesterday', ...extra });
function setup({permission=true, entries, getVisits, state=createInitialState()}={}) {
  let searches=0, visits=0;const calls=[];
  const api={permissions:{contains:async()=>permission},history:{
    search:async query=>{searches++;calls.push(query);return entries??[{url:'https://example.com/revisited?utm_source=x',title:'昨天和今天都读的文章',lastVisitTime:today(10),visitCount:9000}];},
    getVisits:async query=>{visits++;calls.push(query);return getVisits?getVisits(query):[{visitId:'a',visitTime:yesterday(0)},{visitId:'b',visitTime:yesterday(20)},{visitId:'c',visitTime:today(0)},{visitId:'d',visitTime:today(10)}];},
  }};
  return {api,state,calls,counts:()=>({searches,visits}),query:(a=args(),opts={})=>queryChromeHistory(api,state,a,{now,...opts})};
}

test('relative and explicit dates use local calendar boundaries, including yesterday midnight',()=>{
  const range=historyRange(args(),now);
  assert.equal(range.startDate,'2026-09-21');assert.equal(range.endDate,'2026-09-21');
  assert.equal(range.startTime,yesterday(0));assert.equal(range.endTime,today(0));
  assert.deepEqual(historyRange(args(),now),historyRange({startDate:'2026-09-21',endDate:'2026-09-21'},now));
  assert.equal(historyRange({period:'last_7_days'},now).startDate,'2026-09-16');
  assert.deepEqual(temporalHistoryRequest('昨天我都浏览了哪些东西'),{period:'yesterday',view:'pages',limit:30,offset:0});
  assert.equal(temporalHistoryRequest('昨天的天气怎么样'),null);
});
test('Shanghai UTC rollover and New York DST days are not treated as UTC days or fixed 24h',()=>{
  const moduleUrl=new URL('../src/core/history.js',import.meta.url).href;
  const execute=(zone,instant)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {historyRange} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(historyRange({period:'yesterday'},new Date(${JSON.stringify(instant)}))));`],{env:{...process.env,TZ:zone},encoding:'utf8',windowsHide:true}));
  const shanghai=execute('Asia/Shanghai','2026-09-21T17:00:00Z');
  assert.equal(shanghai.startDate,'2026-09-21');assert.equal(shanghai.startTime,Date.parse('2026-09-20T16:00:00Z'));
  const spring=execute('America/New_York','2026-03-09T12:00:00Z');assert.equal(spring.endTime-spring.startTime,23*3600000);
  const autumn=execute('America/New_York','2026-11-02T12:00:00Z');assert.equal(autumn.endTime-autumn.startTime,25*3600000);
});
test('date tool schema rejects ambiguous periods, invalid calendar dates, huge ranges and injected args',()=>{
  assert.doesNotThrow(()=>validateToolArgs('query_history',{startDate:'2023-01-01',endDate:'2023-12-31'}));
  assert.doesNotThrow(()=>validateToolArgs('query_history',{startDate:'2024-01-01',endDate:'2024-12-31'}));
  assert.throws(()=>validateToolArgs('query_history',{startDate:'2024-01-01',endDate:'2025-01-01'}));
  for(const input of [{},{period:'bad'},{period:'yesterday',startDate:'2026-09-21'},{startDate:'2026-02-30',endDate:'2026-03-02'},{startDate:'2026-09-22',endDate:'2026-09-21'},{startDate:'2020-01-01',endDate:'2026-09-21'},{period:'today',offset:-1},{period:'today',offset:'0'},{period:'today',limit:51},{period:'today',view:'raw'},{period:'today',url:'https://evil.test'}])assert.throws(()=>validateToolArgs('query_history',input));
});
test('revisiting today does not hide yesterday; ranges count actual VisitItems not lifetime visitCount',async()=>{
  const fixture=setup();const result=await fixture.query();
  assert.equal(result.complete,true);assert.equal(result.totalVisits,2);assert.equal(result.totalPages,1);assert.equal(result.activeDays,1);
  assert.equal(result.results[0].visits,2);assert.equal(result.results[0].url,'https://example.com/revisited');assert.deepEqual(result.results[0].dates,['2026-09-21']);
  assert.equal(fixture.calls[0].startTime,yesterday(0));assert.ok(fixture.calls[0].endTime>today(10));
  assert.equal(fixture.calls[1].url,'https://example.com/revisited?utm_source=x','getVisits must receive the original raw search URL');
  assert.equal(fixture.state.memories.length,0,'a query must not import or persist history');
});
test('day inventory, pagination totals and per-turn cache retain all observed dates',async()=>{
  const entries=Array.from({length:7},(_,i)=>({url:`https://example.com/${i}`,title:`页面 ${i}`,lastVisitTime:today(10)}));
  const f=setup({entries,getVisits:async({url})=>[{visitId:url+'a',visitTime:yesterday(8)},{visitId:url+'b',visitTime:today(8)}]});
  const cache=new Map();const range=validateToolArgs('query_history',{startDate:'2026-09-21',endDate:'2026-09-22',limit:3});
  const first=await f.query(range,{cache});assert.equal(first.totalPages,7);assert.equal(first.totalVisits,14);assert.equal(first.results.length,3);assert.equal(first.nextOffset,3);
  const next=await f.query({...range,offset:first.nextOffset},{cache});assert.equal(next.results.length,3);assert.equal(next.nextOffset,6);assert.notEqual(next.results[0].id,first.results[0].id);
  const days=await f.query({...range,view:'days'},{cache});assert.deepEqual(days.results,[{date:'2026-09-22',visits:7,pages:7},{date:'2026-09-21',visits:7,pages:7}]);assert.equal(days.nextOffset,null);assert.deepEqual(f.counts(),{searches:1,visits:7});
});
test('excluded and non-web URLs are never passed to getVisits; sensitive URL parameters never escape',async()=>{
  const state=createInitialState();state.settings.excludedDomains=['private.example'];
  const f=setup({state,entries:[{url:'https://sub.private.example./x'},{url:'chrome://settings'},{url:'https://example.com/page?access_token=private&x=1',title:'public'}]});
  const result=await f.query();assert.equal(f.counts().visits,1);assert.equal(result.results[0].url,'https://example.com/page?x=1');assert.equal(JSON.stringify(result).includes('access_token'),false);
});
test('missing permission uses honestly incomplete legacy evidence and cannot claim absence',async()=>{
  const state=createInitialState();state.memories=[normalizeMemory({url:'https://example.com/revisited',visitedAt:today(10)})];
  const f=setup({permission:false,state});const result=await f.query();assert.equal(result.complete,false);assert.equal(result.totalVisits,0);assert.equal(result.source,'stored_latest_visits');assert.match(result.note,/不能.*断言/);assert.deepEqual(f.counts(),{searches:0,visits:0});
  const local=answerLocal('昨天我都浏览了哪些东西',state);assert.match(local.content,/查询不完整/);assert.doesNotMatch(local.content,/没有.*昨天.*记录/);
});
test('caps, failed visit reads and timeouts are visibly incomplete, never empty-complete',async()=>{
  const capped=await setup().query(args(),{maxCandidates:1});assert.equal(capped.complete,false);assert.match(capped.reasons.join(''),/上限/);
  const failed=await setup({getVisits:async()=>{throw Error('private failure');}}).query();assert.equal(failed.complete,false);assert.equal(failed.totalPages,0);assert.match(failed.reasons.join(''),/读取失败/);assert.equal(JSON.stringify(failed).includes('private failure'),false);
  const hung=await setup({getVisits:()=>new Promise(()=>{})}).query(args(),{budgetMs:15});assert.equal(hung.complete,false);
});
test('date aggregation deduplicates event IDs, groups URL variants and excludes end midnight',()=>{
  const range=historyRange(args(),now);const events=[{url:'https://example.com/a?utm_source=x',visitTime:yesterday(1),eventId:'a'},{url:'https://example.com/a',visitTime:yesterday(1),eventId:'a'},{url:'https://example.com/a',visitTime:yesterday(2),eventId:'b'},{url:'https://example.com/a',visitTime:today(0),eventId:'c'}];
  const result=aggregateHistory(events,range);assert.equal(result.totalVisits,2);assert.equal(result.totalPages,1);assert.equal(historyPage({...result,range,complete:true},{limit:1}).nextOffset,null);
  const fallback=storedHistory([normalizeMemory({url:'https://example.com/a',visitedAt:yesterday(1),visitCount:10000})],args(),now);assert.equal(fallback.totalVisits,1);assert.equal(fallback.complete,false);
});
test('agent date tool returns range, true totals, pagination and actual source citations',async()=>{
  const f=setup();let calls=0;
  const answer=await answerCloud('昨天我都浏览了哪些东西',createInitialState(),{apiKey:'synthetic-history-test-key',executeTool:(name,input)=>{assert.equal(name,'query_history');return f.query(input);},fetchImpl:async(_,options)=>{
    const body=JSON.parse(options.body);calls++;
    const message=calls===1?{role:'assistant',content:null,tool_calls:[{id:'history-call',type:'function',function:{name:'query_history',arguments:JSON.stringify({period:'yesterday'})}}]}:{role:'assistant',content:'昨天核对到 1 个页面、2 次访问：「昨天和今天都读的文章」[1]。'};
    if(calls===2){const data=JSON.parse(body.messages.at(-1).content).data;assert.equal(data.totalVisits,2);assert.equal(data.range.startDate,'2026-09-21');assert.equal(data.results[0].citation,1);assert.equal(body.messages.at(-1).tool_call_id,'history-call');}
    return {ok:true,status:200,json:async()=>({choices:[{message,finish_reason:calls===1?'tool_calls':'stop'}]})};
  }});
  assert.equal(calls,2);assert.equal(answer.sources.length,1);assert.equal(answer.steps[0].name,'query_history');assert.match(answer.content,/2 次/);
});
test('runtime date query and local chat use authorized visits without mutating memories',async()=>{
  const f=setup();const initial=createInitialState();const local={[STATE_KEY]:initial},session={[API_KEY]:'test-session-key'};
  const area=store=>({get:async key=>({[key]:structuredClone(store[key])}),set:async data=>Object.assign(store,structuredClone(data))});
  f.api.runtime={id:'date-test'};f.api.storage={local:area(local),session:area(session)};
  const runtime=createRuntime(f.api,{now:()=>now});const send=(type,payload)=>runtime.handle({type,payload},{id:'date-test'});
  const invalid=await send('history.query',{period:'yesterday',secret:true});assert.equal(invalid.ok,false);assert.equal(f.counts().searches,0);
  const query=await send('history.query',{period:'yesterday'});assert.equal(query.ok,true);assert.equal(query.data.totalVisits,2);
  const chat=await send('chat.send',{text:'昨天我都浏览了哪些东西'});assert.equal(chat.ok,true);assert.match(chat.data.messages.at(-1).content,/2 条访问记录/);assert.equal(chat.data.memories.length,0);assert.equal(chat.data.settings.captureEnabled,false);
});

test('date lists with twelve real citations survive finalization and persisted-state sanitization',async()=>{
  const entries=Array.from({length:12},(_,i)=>({url:`https://example.com/${i}`,title:`页面 ${i}`,lastVisitTime:today(10)}));
  const f=setup({entries,getVisits:async({url})=>[{visitId:url,visitTime:yesterday(8)}]});let rounds=0;
  const answer=await runAgent({text:'昨天全部页面',state:createInitialState(),executeTool:(_,input)=>f.query(input),request:async()=>++rounds===1
    ?{role:'assistant',tool_calls:[{id:'dates',function:{name:'query_history',arguments:'{"period":"yesterday"}'}}]}
    :{role:'assistant',content:entries.map((_,i)=>`页面 ${i} [${i+1}]`).join('\n')}});
  assert.equal(answer.sources.length,12);assert.match(answer.content,/\[12\]/);
  const saved=sanitizeState({messages:[{...answer,role:'assistant'}]}).messages[0];
  assert.equal(saved.sources.length,12);assert.equal(saved.sources[11].url,answer.sources[11].url);
});

test('incomplete queries and unread pages carry deterministic caveats even if the model omits them',async()=>{
  const f=setup({permission:false});let rounds=0;
  const answer=await runAgent({text:'昨天浏览',state:createInitialState(),executeTool:(_,input)=>f.query(input),request:async()=>++rounds===1
    ?{role:'assistant',tool_calls:[{id:'dates',function:{name:'query_history',arguments:'{"period":"yesterday"}'}}]}
    :{role:'assistant',content:'本次查询返回零条。'}});
  assert.match(answer.content,/日期查询说明：.*不完整/);
  const entries=Array.from({length:4},(_,i)=>({url:`https://example.com/${i}`,lastVisitTime:today(10)}));
  const full=setup({entries,getVisits:async({url})=>[{visitId:url,visitTime:yesterday(8)}]});rounds=0;
  const partial=await runAgent({text:'昨天浏览',state:createInitialState(),executeTool:(_,input)=>full.query(input),request:async()=>++rounds===1
    ?{role:'assistant',tool_calls:[{id:'dates',function:{name:'query_history',arguments:'{"period":"yesterday","limit":2}'}}]}
    :{role:'assistant',content:'已找到四个页面。'}});
  assert.match(partial.content,/已向模型提供 2 \/ 4 条结果/);
});

test('completed pagination clears the partial-page caveat and permission revocation bypasses cached visits',async()=>{
  const entries=Array.from({length:4},(_,i)=>({url:`https://example.com/${i}`,lastVisitTime:today(10)}));
  const f=setup({entries,getVisits:async({url})=>[{visitId:url,visitTime:yesterday(8)}]});
  const cache=new Map();let rounds=0;
  const answer=await runAgent({text:'昨天全部浏览',state:createInitialState(),executeTool:(_,input)=>f.query(input,{cache}),request:async()=>++rounds<=2
    ?{role:'assistant',tool_calls:[{id:`dates-${rounds}`,function:{name:'query_history',arguments:JSON.stringify({period:'yesterday',limit:2,offset:(rounds-1)*2})}}]}
    :{role:'assistant',content:'四条已读取完毕。'}});
  assert.doesNotMatch(answer.content,/尚未读取全部分页/);assert.equal(f.counts().searches,1);
  f.api.permissions.contains=async()=>false;
  const denied=await f.query(args(),{cache});assert.equal(denied.complete,false);assert.equal(denied.totalPages,0);
});

test('an empty successful Chrome search is complete only within the available-history scope',async()=>{
  const result=await setup({entries:[]}).query();assert.equal(result.complete,true);assert.equal(result.totalPages,0);
  assert.equal(result.nextOffset,null);assert.match(result.note,/不代表已删除、无痕/);
  const f=setup();f.api.history.search=async()=>{throw Error('unavailable');};
  const failed=await f.query();assert.equal(failed.complete,false);assert.equal(failed.source,'stored_latest_visits');
});
