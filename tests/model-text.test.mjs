import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText, normalizeUrl } from '../src/core/model.js';

test('inline URLs stop at Chinese prose punctuation and preserve citations and following prose', () => {
  const source = '来源：合成当前页面（https://example.com/synthetic-current-page）[1]。另外，这里是接下来的说明。';
  assert.equal(sanitizeText(source), source);
  for (const punctuation of ['（', '）', '，', '。', '！', '？', '；', '、', '：', '「', '」']) {
    const input = `参考 https://example.com/article${punctuation}后续文字`;
    assert.equal(sanitizeText(input), input);
  }
  assert.equal(sanitizeText('来源：https://example.com/article[1]，这是一段说明。'), '来源：https://example.com/article[1]，这是一段说明。');
});

test('Markdown and ASCII delimiters remain outside normalized URLs while credentials are removed', () => {
  const input = '[阅读资料](https://user:password@example.com/article?token=private&q=react)[1]。还有 [第二篇](https://example.org/next?api_key=private)。';
  assert.equal(sanitizeText(input), '[阅读资料](https://example.com/article?q=react)[1]。还有 [第二篇](https://example.org/next)。');
  assert.equal(sanitizeText('See https://example.com/article. Next.'), 'See https://example.com/article. Next.');
  assert.equal(sanitizeText('(https://example.com/article), [https://example.org/page]'), '(https://example.com/article), [https://example.org/page]');
  assert.equal(sanitizeText('https://example.com/a),https://user:secret@example.org/b?access_token=hidden'), 'https://example.com/a),https://example.org/b');
});

test('encoded URL delimiters, useful query values, unicode paths and IPv6 remain valid', () => {
  const encoded = 'https://example.com/a%29b/%E4%B8%AD%E6%96%87?search=a%5Db%EF%BC%89&access_token=secret&utm_source=tracking';
  const safe = normalizeUrl(encoded);
  assert.equal(sanitizeText(`链接（${encoded}）[2]。结束。`), `链接（${safe}）[2]。结束。`);
  assert.equal(sanitizeText('https://example.com/文章?q=中文&session=secret。下一句'), `${normalizeUrl('https://example.com/文章?q=中文')}。下一句`);
  assert.equal(sanitizeText('本地（http://[::1]:9000/read?q=ok&api_key=secret）[1]。'), '本地（http://[::1]:9000/read?q=ok）[1]。');
  assert.equal(sanitizeText('http://user:pass@[::1]:9000/read?token=secret'), 'http://[::1]:9000/read');
});
