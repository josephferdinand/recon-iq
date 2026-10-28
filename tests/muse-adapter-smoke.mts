import assert from 'node:assert/strict';
import { createMuseCompatible } from '../src/lib/ai/muse-provider.server.ts';

process.env.META_API_KEY = 'dummy-offline-fixture-key';
delete process.env.META_API_BASE_URL;
delete process.env.META_MUSE_MODEL;
let requests = 0;
const fakeFetch = async (input: any, init: any) => {
  requests++;
  assert.equal(input, 'https://api.meta.ai/v1/chat/completions');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'muse-spark-1.3');
  assert.equal(body.messages[0].content[0].text, 'Explain this synthetic difference.');
  return new Response(JSON.stringify({ id: 'fixture', model: body.model, choices: [{ message: {
    content: 'The two synthetic amounts differ by one.',
    tool_calls: [{ id: 'fixture-tool', function: { name: 'inspect_break', arguments: '{"id":"synthetic-1"}' } }],
  }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 8 } }), { status: 200 });
};
const model = createMuseCompatible({ apiKey: 'dummy', fetch: fakeFetch as any })('muse-spark-1.3');
const prompt = [{ role: 'user', content: [{ type: 'text', text: 'Explain this synthetic difference.' }] }];
const result = await model.doGenerate({ prompt });
assert.equal(result.content[0].type, 'text');
assert.equal(result.content[1].toolName, 'inspect_break');
assert.equal(result.finishReason.unified, 'tool-calls');
assert.equal(result.usage.inputTokens.total, 10);
const reader = (await model.doStream({ prompt })).stream.getReader();
const chunks = [];
while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); }
assert(chunks.some(x => x.type === 'text-delta'));
assert(chunks.some(x => x.type === 'tool-call'));
assert.equal(chunks.at(-1)?.type, 'finish');
const rejected = createMuseCompatible({ baseURL: 'https://example.invalid', fetch: fakeFetch as any })('muse-spark-1.3');
await assert.rejects(() => rejected.doGenerate({ prompt }));
const refused = createMuseCompatible({ fetch: (async () => new Response('private upstream body', { status: 401 })) as any })('muse-spark-1.3');
await assert.rejects(() => refused.doGenerate({ prompt }), (error: any) => !error.message.includes('private upstream body'));
assert.equal(requests, 2);
console.log('PASS: offline generation, tool calls, usage, buffered stream, endpoint guard and safe error handling. No network requests.');
