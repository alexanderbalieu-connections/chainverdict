import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server.js';

const routes = [
 ['GET','/v1/gtin/validate'],['GET','/v1/gtin/checkdigit'],['GET','/v1/gtin/prefix'],
 ['GET','/v1/sscc/validate'],['GET','/v1/container/validate'],['GET','/v1/imo/validate'],
 ['GET','/v1/gs1/decode'],['POST','/v1/gs1/decode'],['GET','/v1/hs/classify'],
];
const key = crypto.generateKeyPairSync('ed25519').privateKey.export({ type:'pkcs8',format:'der' }).toString('base64');
async function boot(t, config) {
 const {app, signer}=createApp({signingKey:key,log:()=>{},...config});
 const server=app.listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 t.after(()=>server.close());
 return {url:`http://127.0.0.1:${server.address().port}`,signer};
}
test('manual retirement blocks every advertised method before any payment work and keeps signing identity',async t=>{
 let calls=0;
 const forbidden=async()=>{calls++;throw new Error('facilitator must not run');};
 const {url,signer}=await boot(t,{retired:true,payTo:'0xAe2634E709c454f2720C65A0b2F9ba168e431842',facilitatorClient:{getSupported:forbidden,verify:forbidden,settle:forbidden}});
 const wk=await(await fetch(url+'/.well-known/signing-key.json')).json();
 const pub=crypto.createPublicKey({key:wk.keys[0],format:'jwk'});
 for(const [method,path] of routes){
  const response=await fetch(url+path+'?q=private-test-value',{method,headers:{'payment-signature':'invalid-but-must-never-be-processed','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({data:'private-test-value'})}:{})});
  assert.equal(response.status,410);assert.equal(response.headers.get('payment-required'),null);
  const body=await response.json();assert.equal(body.error,'service_retired');
  assert.equal(body._attestation.keyId,signer.keyId);assert.ok(!JSON.stringify(body).includes('private-test-value'));
  const[h,p,s]=body._attestation.jws.split('.');
  assert.ok(crypto.verify(null,Buffer.from(`${h}.${p}`),pub,Buffer.from(s,'base64url')));
  assert.equal(JSON.parse(Buffer.from(p,'base64url')).route,`${method} ${path}`);
 }
 for(const path of ['/v1/GTIN/VALIDATE','/v1/gtin/validate/','/v1//gtin/validate']) {
  const res=await fetch(url+path);assert.ok([404,410].includes(res.status));assert.equal(res.headers.get('payment-required'),null);
 }
 const head=await fetch(url+'/v1/gtin/validate',{method:'HEAD'});assert.equal(head.status,410);assert.equal(head.headers.get('payment-required'),null);
 assert.equal(calls,0);
 const discovery=await(await fetch(url+'/.well-known/x402.json')).json();
 assert.deepEqual(discovery.endpoints,[]);assert.equal(discovery.payTo,null);
 assert.deepEqual((await(await fetch(url+'/openapi.json')).json()).paths,{});
 assert.equal((await(await fetch(url+'/health')).json()).mode,'retired');
 for(const path of ['/','/index.html','/llms.txt']) assert.match(await(await fetch(url+path)).text(),/retired/i);
});
test('maintenance notice does not withdraw routes or change the pinned signing identity',async t=>{
 const {url,signer}=await boot(t,{retired:false,payTo:null});
 const notice=await(await fetch(url+'/retirement.json')).json();
 assert.equal(notice.status,'maintenance');assert.equal(notice.automaticRetirement,false);
 assert.equal(notice._attestation.keyId,signer.keyId);
 const res=await fetch(url+'/v1/gtin/validate?code=4006381333931');assert.equal(res.status,200);
 assert.match(res.headers.get('link'),/retirement/);assert.equal((await res.json()).valid,true);
 assert.equal((await(await fetch(url+'/.well-known/x402.json')).json()).endpoints.length,9);
});
