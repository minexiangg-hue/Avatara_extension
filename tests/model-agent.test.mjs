import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentStep, normalizeAgentAction, sanitizeState, createInitialState } from '../src/core/model.js';

const action = () => ({ id: 'act-1', name: 'create_goal', args: { title: '每周读书', target: 3, unit: '篇' }, title: '创建读书目标', description: '每周三篇，等待确认。', status: 'pending', createdAt: '2026-09-22T00:00:00.000Z', expiresAt: '2026-09-22T00:30:00.000Z' });
test('agent action sanitizer preserves only safe executable arguments and fails closed on extra fields', () => {
  const safe = normalizeAgentAction({ ...action(), apiKey: 'never-store', args: { ...action().args } });
  assert.equal(safe.status, 'pending');
  assert.equal('apiKey' in safe, false);
  assert.deepEqual(safe.args, action().args);
  for (const args of [{ ...action().args, script: 'run()' }, { ...action().args, target: '3' }, { ...action().args, dueDate: '2026-02-30' }, { ...action().args, unit: '' }, { ...action().args, dueDate: '' }]) {
    const failed = normalizeAgentAction({ ...action(), args });
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.args, {});
  }
  assert.equal(normalizeAgentAction({ ...action(), name: 'open_url' }), null);
});

test('agent metadata survives repeated sanitation with bounded counts and cannot be attached to user messages', () => {
  const state = createInitialState();
  const steps = Array.from({ length: 30 }, (_, i) => ({ id: `step-${i}`, name: 'list_goals', label: '查看目标', status: 'completed', summary: 'x'.repeat(900), rawResult: { secret: 'not-public' } }));
  const actions = Array.from({ length: 12 }, (_, i) => ({ ...action(), id: `act-${i}` }));
  state.messages = [
    { id: 'user', role: 'user', content: '目标', steps, actions },
    { id: 'assistant', role: 'assistant', content: '请确认', steps, actions },
  ];
  const result = sanitizeState(state);
  assert.deepEqual(result.messages[0].actions, []);
  assert.deepEqual(result.messages[0].steps, []);
  assert.equal(result.messages[1].actions.length, 8);
  assert.equal(result.messages[1].steps.length, 24);
  assert.equal(result.messages[1].steps[0].summary.length, 400);
  assert.equal('rawResult' in result.messages[1].steps[0], false);
  assert.deepEqual(sanitizeState(result), result);
});

test('invalid action times and terminal status tampering cannot create a pending executable operation', () => {
  for (const change of [{ expiresAt: 'bad' }, { createdAt: 'bad' }, { expiresAt: '2026-09-23T00:00:00Z' }, { status: 'executing' }]) assert.equal(normalizeAgentAction({ ...action(), ...change }).status, 'failed');
  for (const status of ['pending', 'approved', 'rejected', 'expired', 'failed']) assert.equal(normalizeAgentAction({ ...action(), status }).status, status);
  assert.equal(normalizeAgentStep({ id: 'step', name: 'shell_exec', status: 'completed' }), null);
  assert.equal(normalizeAgentStep({ id: 'step', name: 'list_tabs', status: 'unknown' }), null);
  assert.equal(normalizeAgentStep({ id: 'step', name: 'unknown_tool', status: 'error', label: '未支持', summary: '不支持的工具。' }).status, 'error');
  assert.equal(normalizeAgentStep({ id: 'step', name: 'unknown_tool', status: 'completed' }), null);
});
