(()=>{'use strict';const API='https://script.google.com/macros/s/AKfycbzGsYA6RRTntLKntkc61IrT6CU33TXO65LrNt-zwcbucM5njuqKJPU8HDSkHHUzB073/exec',Q=x=>document.getElementById(x),video=Q('video'),cam=Q('cam'),start=Q('start'),err=Q('err'),total=Q('total'),sync=Q('sync'),success=Q('success'),pill=Q('pill');let selected=1,stream=null,busy=false,last=0,block=0,audio=null,lastDecode=0,refreshing=false,lastServerTotal=null;let activeScanId=null,overlayTimer=null;function stat(t,c=''){sync.textContent=t;sync.className='sync '+c}function showTotal(n){n=Number(n);if(Number.isFinite(n)){lastServerTotal=n;total.textContent=n.toLocaleString('ko-KR')}}function clock(){let d=new Date();Q('clock').textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}clock();setInterval(clock,15000);document.querySelectorAll('.count').forEach(b=>b.onclick=()=>{selected=+b.dataset.n;document.querySelectorAll('.count').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));Q('sel').textContent=selected});function audioOn(){try{if(!audio)audio=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume()}catch(e){}}function tone(f,t,d,g,type='square'){if(!audio)return;let o=audio.createOscillator(),v=audio.createGain();o.type=type;o.frequency.value=f;v.gain.setValueAtTime(g,audio.currentTime+t);v.gain.exponentialRampToValueAtTime(.01,audio.currentTime+t+d);o.connect(v);v.connect(audio.destination);o.start(audio.currentTime+t);o.stop(audio.currentTime+t+d)}function sound(){audioOn();tone(950,0,.20,.95,'square');tone(1350,.20,.22,.95,'square');tone(1850,.42,.32,.95,'square');setTimeout(()=>{tone(1350,0,.12,.75,'square');tone(1850,.12,.20,.85,'square')},760)}function normalize(d){if(d.requestedHouseholds==null&&d.registrations!=null)return{...d,requestedHouseholds:d.registrations,requestedPeople:d.expectedPeople,attendedHouseholds:d.checkedRegistrations,attendedPeople:d.checkedPeople,totalAttendedHouseholds:d.checkedRegistrations,totalAttendedPeople:d.checkedPeople};return d}async function refresh(){if(refreshing)return;refreshing=true;try{let r=await fetch(API+'?action=dashboard&_='+Date.now(),{cache:'no-store'}),raw=await r.json();if(!raw||!raw.ok)throw Error('bad');let d=normalize(raw),n=Number(d.totalAttendedPeople??d.attendedPeople??d.checkedPeople);showTotal(n);if(!delivery.items.length&&!delivery.storageError)stat('실시간 연결','ok')}catch(e){if(!delivery.items.length&&!delivery.storageError)stat('서버 확인 필요','bad')}finally{refreshing=false}}async function startCam(){if(stream)return;audioOn();start.disabled=true;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:1920},height:{ideal:1080}},audio:false});video.srcObject=stream;await video.play();cam.classList.add('running');loop()}catch(e){start.disabled=false;err.textContent='카메라 권한을 허용해 주세요.'}}start.onclick=startCam;const cv=document.createElement('canvas'),ctx=cv.getContext('2d',{willReadFrequently:true});function decode(){let w=video.videoWidth,h=video.videoHeight;if(!w||!h)return;let ratio=Math.min(1,1400/Math.max(w,h));cv.width=Math.floor(w*ratio);cv.height=Math.floor(h*ratio);ctx.drawImage(video,0,0,cv.width,cv.height);try{let im=ctx.getImageData(0,0,cv.width,cv.height),qr=jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'});if(qr&&qr.data)handle(qr.data.trim())}catch(e){}}function loop(){let now=Date.now();if(video.readyState>=2&&!busy&&now>=block&&now-lastDecode>100){lastDecode=now;decode()}requestAnimationFrame(loop)}function tok(raw){try{if(/^https?:/i.test(raw)){let u=new URL(raw),t=u.searchParams.get('token');if(t)return t}}catch(e){}return raw}function did(){let x='';try{x=localStorage.getItem('hyfl:scanner-device-id')||''}catch(e){}if(!x){x='ipad-'+Date.now();try{localStorage.setItem('hyfl:scanner-device-id',x)}catch(e){}}return x}
function resetView(){
  success.classList.remove('show');busy=false;block=Date.now()+300;selected=1;Q('sel').textContent='1';
  document.querySelectorAll('.count').forEach(b=>b.setAttribute('aria-pressed',b.dataset.n==='1'?'true':'false'));
}
function showResult(kind,count,finish){
  clearTimeout(overlayTimer);
  const confirmed=kind==='confirmed';
  success.style.background=confirmed?'#18ad57':'#925d09';
  success.querySelector('.check').textContent=confirmed?'✓':'…';
  success.querySelector('h1').textContent=confirmed?'체크인이 완료되었습니다.':kind==='sending'?'저장 결과를 확인하고 있습니다.':kind==='waiting'?'인터넷 연결을 기다리고 있습니다.':'저장 확인이 필요합니다.';
  success.querySelector('p').textContent=confirmed?'다음 분을 안내해 주세요.':'담당 선생님께 화면을 보여주세요.';
  pill.textContent=count+'명';success.classList.add('show');
  if(finish)overlayTimer=setTimeout(resetView,2200);
}
const delivery=new CheckinDelivery({
  storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},online:()=>navigator.onLine,
  send:async item=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const {delivery,...payload}=item;
      const r=await fetch(API,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload),signal:controller.signal});
      return {ok:r.ok,data:await r.json()};
    }finally{clearTimeout(timer)}
  },
  onEvent:e=>{
    const pending=delivery.items.length;
    Q('pendingBtn').hidden=!pending;
    Q('pendingBtn').textContent='미확인 '+pending+'건';
    stat(pending?'미확인 '+pending+'건':'실시간 연결',pending?'bad':'ok');
    if(e.type==='storage-error')stat('기기 저장 공간 확인 필요','bad');
    if(e.item&&e.item.scanId===activeScanId&&e.type!=='resolved'){
      showResult(e.type,e.item.count,e.type!=='sending');
      if(e.type==='confirmed')sound();
    }
    if(e.type==='confirmed'){refresh();setTimeout(refresh,1000)}
  }
});
function handle(raw){
  const now=Date.now();if(busy||now<block||now-last<600)return;
  const token=tok(raw);if(!token||token.length<3)return;
  last=now;busy=true;
  try{
    const item=delivery.enqueue({scanId:'scan-'+now+'-'+Math.random().toString(36).slice(2,7),token,count:selected,deviceId:did(),clientAt:new Date().toISOString()});
    activeScanId=item.scanId;showResult(item.delivery,item.count,true);delivery.flush();
  }catch(e){stat(e.message,'bad');showResult('uncertain',selected,true)}
}
Q('pendingBtn').onclick=()=>{
  const list=Q('pendingList');list.replaceChildren();
  for(const item of delivery.items){
    const row=document.createElement('div'),label=document.createElement('p');
    label.textContent=item.clientAt+' / QR 끝자리 '+item.token.slice(-8)+' / '+item.count+'명 / '+(item.delivery==='waiting'?'전송 대기':item.delivery==='sending'?'전송 중':'저장 여부 미확인');row.append(label);
    for(const [text,recorded] of [['시트에서 기록 확인',true],['미기록 확인 후 재전송',false]]){
      const button=document.createElement('button');button.textContent=text;button.disabled=item.delivery==='sending';
      button.onclick=async()=>{
        if(!confirm(recorded?'원본 스캔로그에서 이 QR과 시각의 기록을 확인했습니까?':'원본 스캔로그에 기록이 없음을 확인했습니까? 이미 기록된 경우 재전송하면 중복될 수 있습니다.'))return;
        try{await delivery.resolve(item.scanId,recorded);Q('pendingDialog').close();refresh()}catch(e){alert(e.message)}
      };row.append(button);
    }list.append(row);
  }Q('pendingDialog').showModal();
};
Q('closePending').onclick=()=>Q('pendingDialog').close();
Q('pendingBtn').hidden=!delivery.items.length;
if(delivery.items.length)stat('미확인 '+delivery.items.length+'건','bad');
if(delivery.storageError)stat('기기 저장 공간 확인 필요','bad');
function flush(){return delivery.flush()}
refresh();flush();setInterval(refresh,2000);window.addEventListener('online',()=>{flush();refresh()});window.addEventListener('offline',()=>stat('오프라인','bad'));})();
