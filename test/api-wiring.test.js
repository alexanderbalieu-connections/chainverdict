import test from 'node:test';import assert from 'node:assert/strict';
import {fork} from 'node:child_process';import {generateKeyPairSync,createPublicKey,createPrivateKey} from 'node:crypto';
import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const key=()=>generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const jwk=k=>createPublicKey(createPrivateKey({key:Buffer.from(k,'base64'),format:'der',type:'pkcs8'})).export({format:'jwk'});
test('real API launcher keeps both signing identities and unpaid gates separate', {timeout:45000}, async()=>{
 const keys={chainverdict:key(),traderails:key(),pulse:key()},payTo='0x1234567890123456789012345678901234567890';
 const facilitator=http.createServer(async(req,res)=>{for await(const c of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453'}],extensions:[],signers:{}}));});
 await new Promise(r=>facilitator.listen(0,'127.0.0.1',r));
 const base={PAY_TO_ADDRESS:payTo,FACILITATOR_URL:'http://127.0.0.1:'+facilitator.address().port,X402_NETWORK:'eip155:8453'};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cv-wiring-'));
 const env={PATH:process.env.PATH,HOME:os.tmpdir(),...base,ATTEST_PRIVATE_KEY:keys.pulse,DATA_DIR:dir,PORT:'0',ENABLE_SCHEDULER:'0',ENABLE_BAZAAR_SYNC:'0',CHAINVERDICT_LEGACY_CONFIG:JSON.stringify({...base,SIGNING_KEY_PKCS8_B64:keys.chainverdict}),TRADERAILS_LEGACY_CONFIG:JSON.stringify({...base,SIGNING_KEY_PKCS8_B64:keys.traderails})};
 const processChild=fork(new URL('../scripts/serve-apis.mjs',import.meta.url),[],{env,execArgv:['--max-old-space-size=64'],stdio:['ignore','pipe','pipe','ipc']});let port,exited=false;const pids={};processChild.on('exit',()=>{exited=true;});processChild.on('message',m=>{if(m.childReady)pids[m.childReady]=m.pid;if(m.childExited)delete pids[m.childExited];});
 processChild.stdout.on('data',b=>{const m=String(b).match(/portfolio gateway listening on (\d+)/);if(m)port=Number(m[1]);});processChild.stderr.on('data',()=>{});
 const request=(host,url)=>new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:url,headers:{host}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString(),headers:res.headers}));});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('request timeout')));});
 try{
  const until=Date.now()+25000;let ready=false;while(Date.now()<until&&!exited){if(port){try{ready=(await request('localhost','/_portfolio/health')).status===200;}catch{}}if(ready)break;await sleep(100);}
  assert.ok(ready,'both children become ready');
  const main=await request('chainverdict.xyz','/.well-known/signing-key.json');assert.equal(main.status,200);assert.equal(JSON.parse(main.body).public_key_spki_b64,createPublicKey(createPrivateKey({key:Buffer.from(keys.chainverdict,'base64'),format:'der',type:'pkcs8'})).export({format:'der',type:'spki'}).toString('base64'));
  for(const [role,host]of [['traderails','trade.chainverdict.xyz']]){const r=await request(host,'/.well-known/signing-key.json');assert.equal(r.status,200);assert.equal(JSON.parse(r.body).keys[0].x,jwk(keys[role]).x);}
  for(const [host,url]of [['chainverdict.xyz','/v1/validate/iban/DE89370400440532013000'],['trade.chainverdict.xyz','/v1/imo/validate?code=9074729']])assert.equal((await request(host,url)).status,402);
  assert.equal((await request('evil.test','/.well-known/signing-key.json')).status,404);
  const old=pids.traderails;assert.ok(old);process.kill(old,'SIGKILL');
  await sleep(250);assert.equal((await request('chainverdict.xyz','/.well-known/signing-key.json')).status,200);
  assert.equal((await request('trade.chainverdict.xyz','/health')).status,503);
  const restartDeadline=Date.now()+10000;while(Date.now()<restartDeadline&&(!pids.traderails||pids.traderails===old))await sleep(100);
  assert.ok(pids.traderails&&pids.traderails!==old);const restored=await request('trade.chainverdict.xyz','/.well-known/signing-key.json');assert.equal(JSON.parse(restored.body).keys[0].x,jwk(keys.traderails).x);
 }finally{
  processChild.kill('SIGTERM');await Promise.race([new Promise(r=>processChild.once('exit',r)),sleep(22000).then(()=>processChild.kill('SIGKILL'))]);
  await new Promise(r=>facilitator.close(r));fs.rmSync(dir,{recursive:true,force:true});
 }
});
