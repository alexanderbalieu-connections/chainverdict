import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { rejectInvalidPaidPath } from '../src/lib/reject-invalid-paid-path.js';
process.env.CV_NO_LISTEN='1'; process.env.X402_ENABLED='false';
const {app}=await import('../src/index.js');
test('invalid inputs cannot reach payment middleware even with a payment header',async t=>{
 const a=express();let payments=0,handlers=0;
 a.use(rejectInvalidPaidPath({'GET /v1/token/verdict/*':{p:'address',ex:'0x'+'1'.repeat(40)}}));
 a.use((req,res)=>{payments++;handlers++;res.sendStatus(402);});
 const s=a.listen(0);await new Promise(r=>s.once('listening',r));t.after(()=>s.close());
 const base=`http://127.0.0.1:${s.address().port}`;
 for(const v of [':address','%3Aaddress','%7Baddress%7D','%3Caddress%3E','*','%2Faddress','%5Caddress','YOUR_ADDRESS','0x123','not-an-address','%253Aaddress']){
  const r=await fetch(base+'/v1/token/verdict/'+v,{headers:{'payment-signature':'must-not-be-consumed'}});
  assert.equal(r.status,400,v);assert.equal(r.headers.get('payment-required'),null);assert.equal(r.headers.get('payment-response'),null);
 }
 assert.equal(payments,0);assert.equal(handlers,0);
 assert.equal((await fetch(base+'/v1/token/verdict/0x'+'1'.repeat(40))).status,402);
 assert.equal(payments,1);
});
test('every parameterized discovery route rejects its placeholder and supplies a concrete example',async t=>{
 const s=app.listen(0);await new Promise(r=>s.once('listening',r));t.after(()=>s.close());
 const base=`http://127.0.0.1:${s.address().port}`;
 const d=await(await fetch(base+'/.well-known/x402.json')).json();
 for(const r of d.resources){
  assert.ok(r.exampleUrl.startsWith('https://chainverdict.xyz/'));assert.ok(!r.exampleUrl.includes('*'));
  if(!r.path.includes('*'))continue;
  for(const v of [':value','%7Bvalue%7D','*'])assert.equal((await fetch(base+r.path.replace('*',v))).status,400,r.path);
 }
});
