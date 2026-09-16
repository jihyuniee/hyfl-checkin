const test = require('node:test');
const assert = require('node:assert/strict');
const Delivery = require('../checkin-delivery.js');
const payload = (id = 'one') => ({scanId:id, token:'qr-'+id, count:2, clientAt:'2026-09-12T00:30:00Z'});
function setup(send, saved = []) {
  let value = JSON.stringify(saved); const events=[];
  const storage={getItem:()=>value,setItem:(_,v)=>{value=v}};
  const d=new Delivery({storage,send,onEvent:e=>events.push(e.type)});
  return {d,events,storage};
}
test('completion waits for server acknowledgement; concurrent flushes send once',async()=>{
  let done,calls=0;
  const {d,events}=setup(()=>{calls++;return new Promise(r=>done=r)});
  d.enqueue(payload());const running=d.flush();await d.flush();
  assert.equal(calls,1);assert.equal(events.includes('confirmed'),false);
  done({ok:true,data:{ok:true,count:2}});await running;
  assert.equal(d.items.length,0);assert.equal(events.at(-1),'confirmed');
});
test('lost response remains unresolved and is not replayed after reload',async()=>{
  let calls=0;const send=async()=>{calls++;throw Error('response lost')};
  const {d,storage}=setup(send);d.enqueue(payload());await d.flush();await d.flush();
  const reload=new Delivery({storage,send});await reload.flush();
  assert.equal(calls,1);assert.equal(reload.items[0].delivery,'uncertain');
});
test('offline unsent item survives reload and sends after reconnect',async()=>{
  let calls=0;const {d,storage}=setup(async()=>{calls++;return {ok:true,data:{ok:true}}});
  d.online=()=>false;d.enqueue(payload());await d.flush();assert.equal(calls,0);
  const reload=new Delivery({storage,send:d.send});await reload.flush();assert.equal(calls,1);
});
test('legacy or in-flight saved items require inspection before retransmission',async()=>{
  for(const saved of [payload(),{...payload(),delivery:'sending'}]){
    let calls=0;const {d}=setup(async()=>{calls++},[saved]);await d.flush();assert.equal(calls,0);
  }
});
test('deduped, malformed and negative replies do not report completion',async()=>{
  for(const reply of [{ok:true,data:{ok:true,msg:'deduped'}},{ok:true,data:{ok:false}},{ok:false,data:{ok:true}},{ok:true,data:null}]){
    const {d,events}=setup(async()=>reply);d.enqueue(payload());await d.flush();
    assert.equal(events.includes('confirmed'),false);assert.equal(d.items[0].delivery,'uncertain');
  }
});
test('an unresolved request does not block an unrelated visitor',async()=>{
  const {d}=setup(async x=>{if(x.scanId==='one')throw Error();return {ok:true,data:{ok:true}}});
  d.enqueue(payload());d.enqueue(payload('two'));await d.flush();
  assert.deepEqual(d.items.map(x=>x.scanId),['one']);
});
test('pending QR rescan does not create another request; manual reconciliation is explicit',async()=>{
  let calls=0;const {d}=setup(async()=>{calls++;throw Error()});
  d.enqueue(payload());await d.flush();d.enqueue({...payload('two'),token:'qr-one'});await d.flush();
  assert.equal(d.items.length,1);assert.equal(calls,1);
  await d.resolve('one',true);assert.equal(d.items.length,0);assert.equal(calls,1);
});
test('storage failure before send blocks transmission',async()=>{
  let calls=0;const {d}=setup(async()=>{calls++});d.storage.setItem=()=>{throw Error()};
  assert.throws(()=>d.enqueue(payload()));await d.flush();assert.equal(calls,0);
});
test('invalid count and corrupt outbox are preserved and rejected',()=>{
  const {d}=setup(async()=>{});assert.throws(()=>d.enqueue({...payload(),count:0}));
  const storage={getItem:()=>'{broken',setItem:()=>{throw Error('must not overwrite')}};
  const broken=new Delivery({storage,send:async()=>{}});assert.throws(()=>broken.enqueue(payload()));
});
