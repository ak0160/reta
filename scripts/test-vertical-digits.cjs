// Synthetic fixtures only; no private book text is embedded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['convertAozoraRuby', 'highlightDictionaryWords', 'uprightVerticalDigits', 'decorateText'];
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const render = new Function('dictionary', js + '; return decorateText;')({ 雁皮紙: 'paper' });
const sample = '0章 第12章 2026年 AI 2.0 ０１２ ① Ⅰ & 3';
const vertical = render(sample, true);
const cells = [...vertical.matchAll(/<span style="([^"]+)">([0-9])<\/span>/g)];
assert.equal(cells.length, (sample.match(/[0-9]/g) || []).length);
for (const [, style] of cells) {
  for (const declaration of ['display: inline-block', 'writing-mode: horizontal-tb', 'text-orientation: upright', 'inline-size: 1em', 'block-size: 1em', 'line-height: 1em', 'letter-spacing: normal', 'text-align: center', 'vertical-align: baseline']) assert(style.includes(declaration));
  assert(!style.includes('font-size'));
}
assert.equal(vertical.replace(/<span style="[^"]+">([0-9])<\/span>/g, '$1'), sample);
assert.equal(render(sample), sample, 'Horizontal text must remain unchanged');
assert.equal(render('０１２ ABC!?', true), '０１２ ABC!?');
const ruby = render('｜第1章《だい1しょう》 雁皮紙', true);
assert.equal(ruby.replace(/<span style="[^"]+">([0-9])<\/span>/g, '$1'), '<ruby>第1章<rt>だい1しょう</rt></ruby> <button class="dict-word" data-word="雁皮紙">雁皮紙</button>');
const markup = render('<b data-id="12" title="x > 3">0章</b>&#49;', true);
assert(markup.includes('data-id="12" title="x > 3"'));
assert(markup.includes('&#49;'));
assert.equal((source.match(/decorateText\(paragraph.text, true\)/g) || []).length, 1);
assert.equal((source.match(/decorateText\(unit.html, true\)/g) || []).length, 1);
assert.equal((source.match(/decorateText\(paragraph.text\)/g) || []).length, 1);
console.log('PASS vertical digits: one centered 1em cell per ASCII digit, upright, unchanged text, horizontal output, ruby, dictionary, attributes and entities; both vertical render paths enabled.');
