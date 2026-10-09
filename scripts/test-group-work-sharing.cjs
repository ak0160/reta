// 接続先はローカルのデモプロジェクトに固定。本番には接続しない。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, collection, getDocFromServer, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, runTransaction, terminate } = require('firebase/firestore');
const project = 'demo-reta-sharing';
const base = `http://127.0.0.1:8787/v1/projects/${project}/databases/(default)/documents`;
const sourceFile = path.resolve(__dirname, '../app/group-work-sharing.ts');
const compiled = new Module(sourceFile, module);
compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(path.dirname(sourceFile));
compiled._compile(ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, sourceFile);
const { shareOwnedTextWork, prepareSharedTextWork } = compiled.exports;
const apps = [];
function client(uid) {
  const app = initializeApp({ projectId: project, apiKey: 'demo-only' }, uid);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8787, { mockUserToken: { sub: uid, user_id: uid } });
  return db;
}
function value(data) {
  if (typeof data === 'string') return { stringValue: data };
  if (typeof data === 'number') return { integerValue: String(data) };
  if (typeof data === 'boolean') return { booleanValue: data };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(data).map(([k,v]) => [k,value(v)])) } };
}
async function seed(route, data) {
  const response = await fetch(`${base}/${route}`, { method:'PATCH', headers:{ Authorization:'Bearer owner','Content-Type':'application/json' }, body:JSON.stringify(value(data).mapValue) });
  assert(response.ok, await response.text());
}
let checks = 0;
async function allow(label, task) { const result = await task(); checks++; console.log('PASS',label); return result; }
async function deny(label, task) { await assert.rejects(task, error => error.code === 'permission-denied'); checks++; console.log('PASS',label); }
const sharingPath = work => ['groupWorkShares','group1','works',work];
const work = { workId:'text_one', type:'text', title:'共有テスト作品', author:'著者', rawText:'本文一。\n本文二。', ownerId:'alice', sourceUrl:'', updatedAt:Date.now() };
const stops = [];
function observe(db, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('notification timeout '+name)),10000);
    const stop = onSnapshot(collection(db,'groupWorkShares','group1','works'), snapshot => {
      if (snapshot.docs.some(item => item.id==='text_one')) {
        clearTimeout(timer); stop(); resolve(snapshot.docs.map(item=>item.id));
      }
    }, error=>{clearTimeout(timer);reject(error)});
    stops.push(()=>{clearTimeout(timer);stop()});
  });
}
(async()=>{
  const a=client('alice'),b=client('bob'),c=client('charlie'),d=client('outsider');
  const now=Date.now();
  await seed('groupSharingAccess/config',{enabled:true});
  await seed('groups/group1',{name:'テストグループ',code:'TEST123',createdBy:'alice',createdAt:now,memberIds:['alice','bob','charlie'],memberLastSeen:{alice:now,bob:now,charlie:now}});
  await seed('groups/group2',{name:'別グループ',code:'OTHER12',createdBy:'outsider',createdAt:now,memberIds:['outsider'],memberLastSeen:{outsider:now}});
  await seed('groupInvites/TEST123',{groupId:'group1'});
  await seed('works/text_one',work);
  await deny('B cannot fetch private TXT before sharing',()=>getDocFromServer(doc(b,'works','text_one')));
  await deny('outside cannot fetch private TXT',()=>getDocFromServer(doc(d,'works','text_one')));
  await deny('outside cannot list groups/codes',()=>getDocs(collection(d,'groups')));
  await deny('outside cannot list invitation index',()=>getDocs(collection(d,'groupInvites')));
  await deny('outside cannot fetch group without invitation proof',()=>getDocFromServer(doc(d,'groups','group1')));
  await deny('outside cannot forge another user membership',()=>updateDoc(doc(d,'groups','group2'),{memberIds:['outsider','bob'],memberLastSeen:{outsider:now,bob:now}}));
  await deny('member cannot add other users',()=>updateDoc(doc(a,'groups','group1'),{memberIds:['alice','bob','outsider'],memberLastSeen:{alice:now,bob:now,outsider:now}}));
  await deny('cannot claim ownerId',()=>updateDoc(doc(b,'works','text_one'),{ownerId:'bob'}));
  const notifyB=observe(b,'B'),notifyC=observe(c,'C');
  assert.equal(await allow('A shares existing TXT',()=>shareOwnedTextWork(a,'alice','Alice','group1','text_one')),true);
  await allow('B receives realtime share',()=>notifyB);
  await allow('C receives realtime share',()=>notifyC);
  assert.equal(await allow('repeated share is idempotent',()=>shareOwnedTextWork(a,'alice','Alice','group1','text_one')),false);
  const originalShare=(await getDocFromServer(doc(a,...sharingPath('text_one')))).data();
  assert.equal((await getDocs(collection(a,'groupWorkShares','group1','works'))).size,1);
  const wb=await allow('B prepares shared TXT',()=>prepareSharedTextWork(b,'bob','group1','text_one'));
  const wc=await allow('C prepares shared TXT',()=>prepareSharedTextWork(c,'charlie','group1','text_one'));
  assert.equal(wb.workId,work.workId);assert.equal(wc.workId,work.workId); checks++;console.log('PASS A/B/C use identical workId');
  assert.equal((await getDocFromServer(doc(b,'works',wb.workId))).data().rawText,work.rawText);
  await assert.rejects(()=>shareOwnedTextWork(b,'bob','Bob','group1','text_one'),/自分で追加/);checks++;console.log('PASS recipient cannot re-share someone else TXT');
  await deny('forged owner share rejected by rules',()=>setDoc(doc(b,...sharingPath('text_two')),{...originalShare,workId:'text_two',ownerId:'bob',sharedBy:'bob'}));
  await deny('outside cannot read share metadata',()=>getDocFromServer(doc(d,...sharingPath('text_one'))));
  await deny('outside cannot list shares',()=>getDocs(collection(d,'groupWorkShares','group1','works')));
  await deny('outside cannot forge access reference',()=>setDoc(doc(d,'sharedWorkAccess','outsider','works','text_one'),{groupId:'group1'}));
  await deny('cannot forge another user access reference',()=>setDoc(doc(d,'sharedWorkAccess','bob','works','text_one'),{groupId:'group1'}));
  await deny('outside cannot read TXT after sharing',()=>getDocFromServer(doc(d,'works','text_one')));
  await deny('shared metadata cannot be repeatedly overwritten',()=>updateDoc(doc(a,...sharingPath('text_one')),{sharedAt:Date.now()}));
  await allow('B saves independent position',()=>setDoc(doc(b,'readingProgress','bob_text_one'),{userId:'bob',workId:'text_one',currentParagraphIndex:2}));
  await allow('C saves independent position',()=>setDoc(doc(c,'readingProgress','charlie_text_one'),{userId:'charlie',workId:'text_one',currentParagraphIndex:5}));
  assert.equal((await getDocFromServer(doc(b,'readingProgress','bob_text_one'))).data().currentParagraphIndex,2);
  assert.equal((await getDocFromServer(doc(c,'readingProgress','charlie_text_one'))).data().currentParagraphIndex,5);
  checks++;console.log('PASS saved positions remain independent');
  await allow('participant position uses same workId',()=>setDoc(doc(b,'participants','bob'),{name:'Bob',groupId:'group1',workId:wb.workId,paragraphIndex:2,isReading:true,updatedAt:Date.now()}));
  await allow('reaction uses same workId/group',()=>setDoc(doc(c,'reactions','testReaction'),{participantId:'charlie',groupId:'group1',workId:wc.workId,emoji:'❤️',paragraphIndex:2,createdAt:Date.now()}));
  const reactions=await getDocs(query(collection(b,'reactions'),where('groupId','==','group1')));
  assert.equal(reactions.docs[0].data().workId,wb.workId);checks++;console.log('PASS B reads C reaction for same work');
  await allow('owner creates second TXT',()=>setDoc(doc(a,'works','text_two'),{...work,workId:'text_two',title:'別作品'}));
  await allow('second TXT shared independently',()=>shareOwnedTextWork(a,'alice','Alice','group1','text_two'));
  assert.equal((await getDocs(collection(b,'groupWorkShares','group1','works'))).size,2);checks++;console.log('PASS multiple works retained');
  assert.deepEqual((await getDocFromServer(doc(a,...sharingPath('text_one')))).data(),originalShare);checks++;console.log('PASS original notice timestamp unchanged');
  await allow('member heartbeat preserved',()=>updateDoc(doc(b,'groups','group1'),{memberLastSeen:{alice:now,bob:Date.now(),charlie:now}}));
  await allow('B leaves group',()=>updateDoc(doc(b,'groups','group1'),{memberIds:['alice','charlie'],memberLastSeen:{alice:now,charlie:now}}));
  await deny('after exit TXT access revoked despite saved grant',()=>getDocFromServer(doc(b,'works','text_one')));
  await deny('after exit share metadata denied',()=>getDocFromServer(doc(b,...sharingPath('text_one'))));
  await deny('after exit share list denied',()=>getDocs(collection(b,'groupWorkShares','group1','works')));
  await deny('cannot rejoin without invitation proof',()=>updateDoc(doc(b,'groups','group1'),{memberIds:['alice','charlie','bob'],memberLastSeen:{alice:now,charlie:now,bob:Date.now()}}));
  await allow('invitation code creates own join proof',()=>setDoc(doc(b,'groupJoinAccess','bob','groups','group1'),{code:'TEST123'}));
  await allow('join proof permits group lookup',()=>getDocFromServer(doc(b,'groups','group1')));
  await allow('rejoin self through invitation',()=>updateDoc(doc(b,'groups','group1'),{memberIds:['alice','charlie','bob'],memberLastSeen:{alice:now,charlie:now,bob:Date.now()}}));
  await allow('access returns after rejoin',()=>getDocFromServer(doc(b,'works','text_one')));
  await allow('owner deletes shared TXT',()=>deleteDoc(doc(a,'works','text_two')));
  await assert.rejects(()=>prepareSharedTextWork(c,'charlie','group1','text_two'),/削除/);checks++;console.log('PASS deleted TXT produces explicit error');
  await allow('public Aozora metadata save preserved',()=>setDoc(doc(b,'works','url_test'),{workId:'url_test',type:'url',title:'青空文庫',author:'著者',sourceUrl:'https://example.com',updatedAt:now}));
  await allow('public Aozora metadata readable',()=>getDocFromServer(doc(d,'works','url_test')));
  await deny('TXT cannot be relabelled public',()=>updateDoc(doc(a,'works','text_one'),{type:'url'}));
  await allow('new secure group and invitation created atomically',()=>runTransaction(d,async transaction=>{
    const invite=doc(d,'groupInvites','NEW1234');await transaction.get(invite);
    const time=Date.now();transaction.set(doc(d,'groups','newGroup'),{name:'新グループ',code:'NEW1234',createdBy:'outsider',createdAt:time,memberIds:['outsider'],memberLastSeen:{outsider:time}});
    transaction.set(invite,{groupId:'newGroup'});
  }));
  await deny('invitation cannot point at foreign group',()=>setDoc(doc(b,'groupInvites','FAKE123'),{groupId:'group2'}));
  await deny('future heartbeat spoof rejected',()=>updateDoc(doc(a,'groups','group1'),{memberLastSeen:{alice:Date.now()+3600000,bob:now,charlie:now}}));
  await deny('client cannot enable sharing',()=>setDoc(doc(a,'groupSharingAccess','config'),{enabled:true}));
  await seed('groupSharingAccess/config',{enabled:false});
  await deny('feature disabled blocks share reads',()=>getDocFromServer(doc(c,...sharingPath('text_one'))));
  await deny('feature disabled blocks granted TXT read',()=>getDocFromServer(doc(c,'works','text_one')));
  await allow('owner still reads own TXT with feature disabled',()=>getDocFromServer(doc(a,'works','text_one')));
  console.log(`ALL ${checks} checks passed. Only local emulator ${project} was used.`);
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{stops.forEach(stop=>stop());for(const app of apps){await terminate(getFirestore(app));await deleteApp(app)}});
