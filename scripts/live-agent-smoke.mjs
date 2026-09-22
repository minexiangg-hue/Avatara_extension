// Explicitly opt-in. Real model, synthetic Chrome APIs/data only. Never reads a browser profile.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInitialState, normalizeMemory, createGoal } from '../src/core/model.js';
import { answerCloud, testConnection } from '../src/core/assistant.js';
import { createRuntime, STATE_KEY, API_KEY } from '../src/background/service-worker.js';

let apiKey = '';
try {
  if (!process.argv[2]) throw new Error('Usage: node scripts/live-agent-smoke.mjs <credential file>');
  const lines = (await readFile(resolve(process.argv[2]), 'utf8')).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const baseUrl = lines.find(line=>/^https:\/\//.test(line));
  apiKey = lines.find(line=>!/^https?:\/\//.test(line)) || '';
  if (!apiKey || !baseUrl || new URL(baseUrl).hostname !== 'api.deepseek.com') throw new Error('This opt-in test only uses the authorized DeepSeek endpoint.');
  const model = 'deepseek-v4-flash';
  let rounds = 0;
  const fetchImpl = async (...args) => { rounds += 1; return fetch(...args); };
  const options = { baseUrl, apiKey, model, fetchImpl };
  const state = createInitialState();
  state.settings.ai = { enabled:true,baseUrl,model,hasKey:false };
  state.memories = [normalizeMemory({id:'memory_synthetic',url:'https://example.com/agent-memory',title:'合成实验记录：蓝湾计划',excerpt:'本记录是用于自动化验收的合成资料。蓝湾计划测试工具读取。'.repeat(35)+'\n正文结尾给出的实验暗号是：银杏书签。',saved:true,source:'manual'})];
  state.goals = [createGoal({title:'精读两篇合成文章',target:2,unit:'篇',why:'验证自动工具调用'})];
  const persistent = {[STATE_KEY]:structuredClone(state)};
  const session = {[API_KEY]:apiKey};
  const storage = store => ({async get(key){return {[key]:structuredClone(store[key])};},async set(data){Object.assign(store,structuredClone(data));},async remove(key){delete store[key];}});
  const progress = [];
  const page={url:'https://example.com/synthetic-current-page',title:'合成当前页面',excerpt:'当前页面的测试色彩名称是雾蓝。页面阅读不会自动保存任何记忆。'};
  const api={
    runtime:{id:'synthetic-agent-runtime',async sendMessage(message){progress.push(structuredClone(message));}},
    storage:{local:storage(persistent),session:storage(session)},
    permissions:{async contains(){return true;}},
    tabs:{async query(){return [{id:101,active:true,title:page.title,url:page.url}];}},
    scripting:{async executeScript(){return [{result:page}];}},
  };
  const runtime=createRuntime(api,{cloud:(text,snapshot,bridge)=>answerCloud(text,snapshot,{...options,...bridge})});
  const send=async(type,payload={})=>{const result=await runtime.handle({type,payload},{id:api.runtime.id});if(!result.ok)throw new Error(result.error);return result.data;};
  const chat=async(text)=>{
    await send('chat.clear');
    const before=rounds;const started=Date.now();
    const result=await send('chat.send',{text,requestId:crypto.randomUUID()});
    return {state:result,answer:result.messages.at(-1),rounds:rounds-before,ms:Date.now()-started};
  };
  const report=(name,result)=>console.log(JSON.stringify({case:name,ok:true,model,rounds:result?.rounds,ms:result?.ms,tools:result?.answer?.steps?.map(step=>step.name),sources:result?.answer?.sources?.length,actions:result?.answer?.actions?.map(action=>({name:action.name,status:action.status})),answer:result?.answer?.content}));

  await testConnection(options);report('connection');
  const plain=await chat('用一句话解释什么是番茄工作法。这是一般知识问题，不需要我的任何个人资料。');
  assert.equal(plain.answer.steps.length,0,'Ordinary conversation should use no tools');assert.equal(plain.answer.sources.length,0);report('ordinary chat, no history lookup',plain);

  const recall=await chat('请找出已保存的蓝湾计划实验记录，再阅读正文结尾，告诉我实验暗号。引用来源，用一句话回答。');
  assert.ok(recall.answer.steps.some(step=>step.name==='search_memories'));assert.ok(recall.answer.steps.some(step=>step.name==='read_memory'));
  assert.match(recall.answer.content,/银杏书签/);assert.equal(recall.answer.sources.length,1);assert.match(recall.answer.content,/\[1\]/);report('search then read memory',recall);

  const create=await chat('帮我创建一个目标：本周读完 3 篇文章，目标名称就是“本周读完三篇文章”，数量 3，单位 篇。请发起待确认操作。');
  const createAction=create.answer.actions.find(action=>action.name==='create_goal');assert.ok(createAction);assert.equal(createAction.args.target,3);assert.equal(create.state.goals.length,1);report('create goal pending, unchanged before confirmation',create);
  const approved=await send('chat.confirm',{messageId:create.answer.id,actionId:createAction.id,decision:'approve'});assert.equal(approved.goals.length,2);
  const replay=await send('chat.confirm',{messageId:create.answer.id,actionId:createAction.id,decision:'approve'});assert.equal(replay.goals.length,2);report('approved creation and idempotent replay');

  const advance=await chat('我已经读完了“精读两篇合成文章”里的第一篇。请查一下这个目标，把进度增加 1，发起待确认操作。');
  assert.ok(advance.answer.steps.some(step=>step.name==='list_goals'));
  const advanceAction=advance.answer.actions.find(action=>action.name==='advance_goal');assert.ok(advanceAction);assert.equal(advanceAction.args.delta,1);assert.equal(advance.state.goals.find(goal=>goal.id===advanceAction.args.id).progress,0);report('list goals then propose progress update',advance);
  const advanced=await send('chat.confirm',{messageId:advance.answer.id,actionId:advanceAction.id,decision:'approve'});assert.equal(advanced.goals.find(goal=>goal.id===advanceAction.args.id).progress,1);
  const advancedAgain=await send('chat.confirm',{messageId:advance.answer.id,actionId:advanceAction.id,decision:'approve'});assert.equal(advancedAgain.goals.find(goal=>goal.id===advanceAction.args.id).progress,1);report('approved progress and idempotent replay');

  const current=await chat('请读取当前页面，告诉我文中测试色彩名称是什么，引用来源。');
  assert.ok(current.answer.steps.some(step=>step.name==='read_current_page'&&step.status==='completed'));assert.match(current.answer.content,/雾蓝/);assert.equal(current.state.memories.length,1);report('read synthetic active page without saving',current);
  assert.ok(progress.length>=5);assert.ok(progress.every(event=>event.type==='agent.progress'&&event.requestId));
  assert.equal(JSON.stringify(persistent).includes(apiKey),false);report('progress events and durable credential isolation');
} catch(error) {
  console.error(JSON.stringify({ok:false,error:String(error.message).split(apiKey||'__unset__').join('[redacted]')}));
  process.exitCode=1;
}
