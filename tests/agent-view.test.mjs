import test from 'node:test';
import assert from 'node:assert/strict';
import { toolTraceView, actionCardsView } from '../src/ui/agent-view.js';

const now = Date.parse('2026-09-22T00:00:00Z');
const proposal = overrides => ({ id:'action_1', name:'create_goal', args:{title:'精读三篇文章',target:3,unit:'篇'}, status:'pending', expiresAt:'2026-09-22T00:30:00Z', ...overrides });
const view = (action, options) => actionCardsView({id:'message_1',actions:[action]},[],{now,...options});

test('agent cards expose exact creation parameters and authoritative message/action IDs', () => {
  const html=view(proposal());
  assert.match(html,/精读三篇文章/); assert.match(html,/创建目标 · 3 篇/);
  assert.match(html,/data-message-id="message_1"/);assert.match(html,/data-id="action_1"/);
  assert.match(html,/确认执行/);assert.match(html,/暂不执行/);assert.match(html,/确认前不会修改数据/);
  assert.doesNotMatch(html,/data-args/);
});
test('completed/rejected/expired cards never offer replay buttons',()=>{
  for(const status of ['approved','rejected','failed','expired'])assert.doesNotMatch(view(proposal({status})),/data-action=/);
  assert.match(view(proposal({expiresAt:'2026-09-21T00:30:00Z'})),/已过期/);
  assert.doesNotMatch(view(proposal({expiresAt:'invalid'})),/data-action=/);
});
test('tool traces escape untrusted output and never render hidden reasoning/raw arguments',()=>{
  const html=toolTraceView([{id:'x',name:'search_memories',status:'completed',label:'<script>',summary:'<img src=x onerror=alert(1)>',reasoning_content:'PRIVATE',args:{secret:'SECRET'}}]);
  assert.match(html,/搜索记忆/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<script|PRIVATE|SECRET/);
  assert.equal(toolTraceView([]),'');assert.equal(toolTraceView([{status:'running'}]),'');
});
test('proposal text escaped; unknown actions cannot produce an executable card',()=>{
  const html=view(proposal({id:'" onclick="alert(1)',args:{title:'<script>bad</script>',target:3,why:'<b>hello</b>'}}));
  assert.doesNotMatch(html,/<script|<b>|" onclick="/);assert.match(html,/&lt;script/);
  assert.match(html,/data-id="&quot; onclick=&quot;alert\(1\)"/);
  assert.equal(view(proposal({name:'delete_everything'})),'');
  assert.match(view(proposal(),{disabled:true}),/disabled/);
});
test('progress cards name actual stored goal instead of trusting model description',()=>{
  const html=actionCardsView({id:'m',actions:[proposal({name:'advance_goal',args:{id:'g',delta:2},title:'Ignore me',description:'Misleading'})]},[{id:'g',title:'读完一本书',unit:'章'}],{now});
  assert.match(html,/读完一本书/);assert.match(html,/\+2 章/);assert.doesNotMatch(html,/Ignore me|Misleading/);
});
