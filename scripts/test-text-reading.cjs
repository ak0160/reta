// No book content is embedded. Optionally pass a private corrected TXT path.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function load(src){const ast=ts.createSourceFile('x.tsx',src,99,true,ts.ScriptKind.TSX);const names=['convertAozoraRuby','normalizeScannedJapaneseText','normalizeForCompare','normalizeHeadingText','isChapterHeading','preserveAozoraEmphasis','preserveAozoraSubscript','stripAozoraNotes','removeAozoraGuideBlock','cleanAozoraText','splitIntoSentences','buildReadingUnits'];const code=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['KANJI_NUMERAL_PATTERN','SENTENCE_END_MARKS','SENTENCE_TERMINATOR_CHARS','SENTENCE_CLOSING_MARKS'].includes(d.name.getText(ast))))).map(n=>n.getText(ast)).join('\n');return new Function(ts.transpileModule(code,{compilerOptions:{target:7}}).outputText+';return {cleanAozoraText,buildReadingUnits,convertAozoraRuby};')()}

const compiled=ts.transpileModule(fs.readFileSync(path.join(root,'app/text-reading-format.ts'),'utf8'),{compilerOptions:{target:7,module:ts.ModuleKind.CommonJS}}).outputText;
const moduleObject={exports:{}};new Function('exports',compiled)(moduleObject.exports);
const {parseProofreadText,resolveTextReadingFormat}=moduleObject.exports;
const current=load(fs.readFileSync(path.join(root,'app/page.tsx'),'utf8'));
assert.equal(resolveTextReadingFormat(undefined),'legacy');assert.equal(resolveTextReadingFormat('future'),'legacy');assert.equal(resolveTextReadingFormat('proofread-v1'),'proofread-v1');
const sample='Title\r\nAuthor\r\n\r\nⅠ\r\n\r\n  A  B.\r\nC D\r\n\r\n｜Gottes《神の》\r\n';
const p=parseProofreadText(sample);assert.equal(p.length,3);assert.equal(p[0].isHeading,true);assert.equal(p[1].text,'  A  B.\nC D');assert.equal(p[2].text,'｜Gottes《神の》');
assert.equal(parseProofreadText('T\nA\nOne\nTwo\n').length,2);
assert.equal(parseProofreadText('T\nA\n\n').length,0);
const spaces=parseProofreadText('T\nA\n\n  A B。 C  D。  ');const units=current.buildReadingUnits(spaces);assert.equal(units.map(u=>u.html).join(''),'  A B。 C  D。  ');
// Reaction/map positions use the same stable unit indices; future reactions stay hidden.
const mapSource=fs.readFileSync(path.join(root,'app/reading-map-reactions.tsx'),'utf8');
const mapAst=ts.createSourceFile('map.tsx',mapSource,99,true,ts.ScriptKind.TSX);
const mapFn=mapAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='groupMapReactions');
const mapJs=ts.transpileModule(mapFn.getText(mapAst).replace(/^export /,''),{compilerOptions:{target:7}}).outputText;
const groupMapReactions=new Function(mapJs+';return groupMapReactions;')();
const grouped=groupMapReactions([{paragraphIndex:2,emoji:'a'},{paragraphIndex:2,emoji:'b'},{paragraphIndex:8,emoji:'c'}],5);
assert.equal(grouped.get(2).length,2);assert.equal(grouped.has(8),false);
console.log('PASS reaction/map index grouping');
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'text-reading-legacy-baseline.json')));
for(const [name,expected] of Object.entries(baseline)){
 const text=fs.readFileSync(path.join(root,'public/texts',name),'utf8'),ls=text.split('\n');
 const paragraphs=current.cleanAozoraText(text,ls[0].trim(),ls[1].trim(),'ocr'),units=current.buildReadingUnits(paragraphs);
 assert.equal(paragraphs.length,expected.paragraphs);assert.equal(units.length,expected.units);
 assert.equal(crypto.createHash('sha256').update(JSON.stringify([paragraphs,units])).digest('hex'),expected.sha);
 console.log('PASS legacy paragraphs/units/indices:',name,paragraphs.length,units.length);
}
async function sharingCopy(format){
 const src=fs.readFileSync(path.join(root,'app/group-work-sharing.ts'),'utf8'),ast=ts.createSourceFile('sharing.ts',src,99,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='saveSharedTextWork');
 const js=ts.transpileModule(fn.getText(ast).replace(/^export /,''),{compilerOptions:{target:7}}).outputText;
 const data={workId:'source',type:'text',rawText:'T\nA\n\nOne two。',title:'T',author:'A',ownerId:'owner',...(format?{readingFormat:format}:{})};
 const saved={workId:'source',ownerId:'owner',title:'T',author:'A'};const writes=[];
 const doc=(_db,...parts)=>({id:'copy-id',path:parts.join('/')});
 const progress={currentParagraphIndex:12,readingUnitsLength:100,percent:12,bookmarks:[{paragraphIndex:12},null,null,null]};
 const tx={get:async ref=>({exists:()=>true,data:()=>ref.path.startsWith('works/')?data:ref.path.startsWith('readingProgress')?progress:saved}),set:(ref,value)=>writes.push([ref.path,value])};
 const f=new Function('getSavedSharedWork','prepareSharedTextWork','waitForPendingWrites','doc','collection','runTransaction','resolveTextReadingFormat','parseSavedSharedWork',js+';return saveSharedTextWork;')(async()=>saved,async()=>{},async()=>{},doc,()=>({}),async(db,cb)=>cb(tx),resolveTextReadingFormat,(_id,data)=>data);
 await f({},'reader','group','source');const copy=writes.find(([key])=>key.startsWith('works/'))[1];assert.equal(copy.readingFormat,format||'legacy');assert.equal(copy.rawText,data.rawText);
 const copiedProgress=writes.find(([key])=>key.startsWith('readingProgress/'))[1];
 assert.equal(copiedProgress.currentParagraphIndex,progress.currentParagraphIndex);assert.deepEqual(copiedProgress.bookmarks,progress.bookmarks);assert.equal(copiedProgress.readingUnitsLength,progress.readingUnitsLength);
 const loaded=copy.readingFormat==='proofread-v1'?parseProofreadText(copy.rawText):current.cleanAozoraText(copy.rawText,'T','A','ocr');assert(loaded.length>0);
 console.log('PASS shared personal copy format:',copy.readingFormat);
}
(async()=>{
 await sharingCopy('proofread-v1');await sharingCopy(undefined);
 if(process.argv[2]){
  const text=fs.readFileSync(process.argv[2],'utf8'),p=parseProofreadText(text);assert.equal(p.length,634);
  const source=text.replace(/\r\n?/g,'\n').split('\n').slice(2).filter(x=>x.trim()).join('');assert.equal(p.map(x=>x.text).join(''),source);
  for(const h of ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ'])assert(p.some(x=>x.text===h&&x.isHeading));
  const rubies=[...source.matchAll(/｜([^《》]+)《([^《》]+)》/g)];assert.equal(rubies.length,2);
  for(const m of rubies)assert.equal(current.convertAozoraRuby(m[0]),`<ruby>${m[1]}<rt>${m[2]}</rt></ruby>`);
  const units=current.buildReadingUnits(p);p.forEach((paragraph,index)=>assert.equal(units.filter(u=>u.paragraphIndex===index).map(u=>u.html).join(''),paragraph.text));
  const restored=parseProofreadText(JSON.parse(JSON.stringify({rawText:text,readingFormat:'proofread-v1'})).rawText);assert.deepEqual(current.buildReadingUnits(restored),units);
  assert.equal([...source.replace(/｜([^《》]+)《([^《》]+)》/g,'$1')].length,101563);
  console.log('PASS private TXT: 634 paragraphs, 7 chapter headings, 2 ruby, exact spaces/text, stable reading indices after reload; units:',units.length);
 }
 console.log('All TXT reading tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
