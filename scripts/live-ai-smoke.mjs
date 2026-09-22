// Opt-in only. Uses synthetic records, never a browser profile or exported history.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { answerCloud, testConnection } from '../src/core/assistant.js';
import { createInitialState, normalizeMemory, createGoal } from '../src/core/model.js';

const credentialsPath = process.argv[2];
if (!credentialsPath) {
  console.error('Usage: node scripts/live-ai-smoke.mjs <local credential file>');
  process.exitCode = 1;
} else {
  let apiKey = '';
  try {
    const lines = (await readFile(resolve(credentialsPath), 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const baseUrl = lines.find(line => /^https:\/\//.test(line));
    apiKey = lines.find(line => !/^https?:\/\//.test(line)) || '';
    if (!apiKey || !baseUrl) throw new Error('Credential file needs one key line and one HTTPS endpoint line.');
    if (new URL(baseUrl).hostname !== 'api.deepseek.com') throw new Error('Live smoke is scoped to the authorized DeepSeek endpoint.');
    const options = { baseUrl, model: 'deepseek-v4-flash', apiKey };
    const start = Date.now();
    const ping = await testConnection(options);
    console.log(JSON.stringify({ case: 'synthetic connection', ok: true, model: ping.model, ms: Date.now() - start }));
    const state = createInitialState();
    state.settings.ai = { ...state.settings.ai, ...options, enabled: true };
    delete state.settings.ai.apiKey;
    state.memories = [normalizeMemory({url:'https://example.com/avatara-memory',title:'Avatara 测试笔记：记忆检索',excerpt:'这是一段合成测试资料。Avatara 的测试设计要求：先用关键词召回相关记忆，再附上来源链接。合成测试暗号为「银杏书签」。',visitedAt:new Date().toISOString(),source:'manual',tags:['记忆检索'],saved:true})];
    state.goals = [createGoal({title:'精读两篇测试文章',why:'验证目标上下文',target:2,unit:'篇'})];
    const answer = await answerCloud('根据已保存的记忆，记忆检索的测试暗号是什么？请引用来源，用一句话回答。',state,options);
    if (!answer.content.includes('银杏书签') || answer.sources.length !== 1 || !answer.content.includes('[1]')) throw new Error('Grounded answer failed its synthetic fact/citation check.');
    console.log(JSON.stringify({case:'grounded source answer',ok:true,mode:answer.mode,sources:answer.sources.length,content:answer.content}));
    const goalAnswer = await answerCloud('我的目标下一步可以做什么？请依据我的目标名称与进度，用一句话回答。',state,options);
    if (!goalAnswer.content.includes('精读两篇测试文章')) throw new Error('Goal answer did not use the synthetic goal context.');
    console.log(JSON.stringify({case:'goal context answer',ok:true,mode:goalAnswer.mode,content:goalAnswer.content}));
  } catch (error) {
    const safe = String(error.message).split(apiKey || '__no_key__').join('[redacted]');
    console.error(JSON.stringify({ok:false,error:safe}));
    process.exitCode=1;
  }
}
