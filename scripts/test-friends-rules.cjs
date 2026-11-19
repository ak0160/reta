const assert = require('node:assert/strict');
const project = 'demo-reta-friends';
const base = `http://127.0.0.1:8787/v1/projects/${project}/databases/(default)/documents`;
function encode(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: fields(value) } };
}
function fields(data) { return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)])); }
function token(uid) {
  const b = v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  return `${b({alg:'none',typ:'JWT'})}.${b({aud:project,iss:`https://securetoken.google.com/${project}`,sub:uid,user_id:uid,iat:now,exp:now+3600,firebase:{sign_in_provider:'password',identities:{}}})}.`;
}
let count=0;
async function request(label, method, path, uid, data, allowed) {
  const headers={'Content-Type':'application/json'};
  if(uid) headers.Authorization=`Bearer ${uid==='ADMIN'?'owner':token(uid)}`;
  const response=await fetch(`${base}/${path}`,{method,headers,...(data?{body:JSON.stringify({fields:fields(data)})}:{})});
  const result=await response.text();
  if(allowed) assert(response.ok, `${label}: expected allow, got ${response.status}: ${result}`);
  else assert.equal(response.status,403,`${label}: expected deny, got ${response.status}: ${result}`);
  count++;console.log(`PASS ${label} (${response.status})`);
}
async function seed(path,data){return request('seed '+path,'PATCH',path,'ADMIN',data,true)}
const friendship=(overrides={})=>({memberIds:['alice','bob'],fromUid:'alice',toUid:'bob',fromName:'Alice',toName:'Bob',status:'pending',createdAt:100,updatedAt:100,...overrides});
(async()=>{
  await seed('friendsAccess/config',{enabled:true});
  await seed('usernames/Alice',{uid:'alice',username:'Alice'});
  await seed('usernames/Bob',{uid:'bob',username:'Bob'});
  await request('authenticated reads flag','GET','friendsAccess/config','alice',null,true);
  await request('anonymous cannot read flag','GET','friendsAccess/config',null,null,false);
  await request('client cannot change flag','PATCH','friendsAccess/config','alice',{enabled:false},false);
  await request('client cannot delete flag','DELETE','friendsAccess/config','alice',null,false);
  await request('missing pair can be checked','GET','friendships/alice__bob','alice',null,true).catch(async error=>{
    // Missing-document GET is allowed by rules and returns NOT_FOUND rather than a document.
    if(!String(error.message).includes('404'))throw error;
    count++;console.log('PASS missing pair can be checked (404, not 403)');
  });
  await request('sender creates pending','PATCH','friendships/alice__bob','alice',friendship(),true);
  await request('sender reads own request','GET','friendships/alice__bob','alice',null,true);
  await request('recipient reads own request','GET','friendships/alice__bob','bob',null,true);
  await request('third party cannot read','GET','friendships/alice__bob','charlie',null,false);
  await request('anonymous cannot read','GET','friendships/alice__bob',null,null,false);
  await request('sender cannot self-approve','PATCH','friendships/alice__bob','alice',friendship({status:'accepted',updatedAt:200}),false);
  await request('third party cannot approve','PATCH','friendships/alice__bob','charlie',friendship({status:'accepted',updatedAt:200}),false);
  await request('recipient cannot change members','PATCH','friendships/alice__bob','bob',friendship({memberIds:['alice','charlie'],toUid:'charlie',status:'accepted'}),false);
  await request('recipient approves','PATCH','friendships/alice__bob','bob',friendship({status:'accepted',updatedAt:200}),true);
  await request('accepted cannot become pending','PATCH','friendships/alice__bob','bob',friendship(),false);
  await request('third party cannot delete','DELETE','friendships/alice__bob','charlie',null,false);
  await request('participant removes friendship','DELETE','friendships/alice__bob','bob',null,true);
  await request('direct accepted create rejected','PATCH','friendships/alice__bob','alice',friendship({status:'accepted'}),false);
  await request('self request rejected','PATCH','friendships/alice__alice','alice',friendship({memberIds:['alice','alice'],toUid:'alice',toName:'Alice'}),false);
  await request('impersonating sender rejected','PATCH','friendships/alice__bob','charlie',friendship(),false);
  await request('name/UID mismatch rejected','PATCH','friendships/alice__bob','alice',friendship({toName:'Alice'}),false);
  await request('extra fields rejected','PATCH','friendships/alice__bob','alice',friendship({unexpected:true}),false);
  await request('foreign username modification rejected','PATCH','usernames/Bob','alice',{uid:'alice',username:'Bob'},false);
  await request('owner username update allowed','PATCH','usernames/Alice','alice',{uid:'alice',username:'Alice',updatedAt:200},true);
  await request('new username create allowed','PATCH','usernames/Charlie','charlie',{uid:'charlie',username:'Charlie'},true);
  await request('pending creation for rejection test','PATCH','friendships/alice__bob','alice',friendship(),true);
  await request('recipient rejects','DELETE','friendships/alice__bob','bob',null,true);
  await request('pending creation for cancel test','PATCH','friendships/alice__bob','alice',friendship(),true);
  await request('sender cancels','DELETE','friendships/alice__bob','alice',null,true);
  await request('seed pending for list test','PATCH','friendships/alice__bob','alice',friendship(),true);
  async function list(uid,filter,allow){const headers={'Content-Type':'application/json',Authorization:`Bearer ${token(uid)}`};const response=await fetch(`${base}:runQuery`,{method:'POST',headers,body:JSON.stringify({structuredQuery:{from:[{collectionId:'friendships'}],...(filter?{where:{fieldFilter:{field:{fieldPath:'memberIds'},op:'ARRAY_CONTAINS',value:{stringValue:uid}}}}:{})}})});const body=await response.text();if(allow)assert(response.ok,body);else assert.equal(response.status,403,body);count++;console.log(`PASS list ${uid} filter=${filter} (${response.status})`)}
  await list('alice',true,true);await list('charlie',false,false);
  await seed('friendsAccess/config',{enabled:false});
  await request('disabled blocks read','GET','friendships/alice__bob','alice',null,false);
  await request('disabled blocks approval','PATCH','friendships/alice__bob','bob',friendship({status:'accepted'}),false);
  await request('disabled blocks delete','DELETE','friendships/alice__bob','alice',null,false);
  console.log(`ALL ${count} checks passed; only emulator project ${project} was used.`);
})().catch(e=>{console.error(e);process.exit(1)});
