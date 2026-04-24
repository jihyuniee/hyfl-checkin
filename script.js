/***** 설정 *****/
var API = 'https://script.google.com/macros/s/AKfycbz6RgYyT4s7TgFsGnCKgnM87VxyyhSF-3-ibf6Fwa9Pfs-hvctXc3w-RzmSK3ad9aHV/exec';
var COOLDOWN_MS       = 500;
var NEXT_DELAY_MS     = 3000;
var USE_FRONT_DEFAULT = false;   // 후면 카메라
var MIRROR_DISPLAY    = false;
var IDEAL_WIDTH = 1920, IDEAL_HEIGHT = 1080;

/***** 인원 선택 *****/
var selectedCount = 1;

function updateCountUI(){
  document.querySelectorAll('.count-btn').forEach(function(btn){
    btn.classList.toggle('selected', parseInt(btn.dataset.count,10) === selectedCount);
  });
}

(function(){
  document.querySelectorAll('.count-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      selectedCount = parseInt(btn.dataset.count, 10);
      updateCountUI();
    });
  });
})();

/***** 화면 꺼짐 방지 *****/
var _wakeLock = null;
async function requestWakeLock(){
  try{ if('wakeLock' in navigator) _wakeLock = await navigator.wakeLock.request('screen'); }catch(_){}
}
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'visible') requestWakeLock();
});

/***** 요소 *****/
function byId(id){ return document.getElementById(id); }
var video=byId('camera'), startBtn=byId('startBtn'), statusMsg=byId('statusMsg');
var lastScanAt=0, blockUntil=0, cooldownTimer=null;

/***** 오디오 *****/
var audioCtx=null;
function initAudio(){ try{ if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); }catch(_){} }
function beep(f,ms,t,v){ if(!audioCtx) return; var o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type=t||'sine'; o.frequency.value=f||1000; g.gain.value=(v!=null?v:0.28); o.connect(g); g.connect(audioCtx.destination); o.start(); setTimeout(function(){try{o.stop();}catch(_){}},ms||140); }
function successChime(){ beep(1100,120,'sine',0.28); setTimeout(function(){beep(1500,140,'sine',0.28);},80); }

/***** 상태표시 *****/
function setStatus(state, text, spin){
  statusMsg.innerHTML = spin ? '<span class="spinner"></span>'+text : text;
  statusMsg.className = 'state-'+state;
}

/***** gUM 폴백 *****/
function gUM(c){
  var md=navigator.mediaDevices; if(md&&md.getUserMedia) return md.getUserMedia(c);
  var legacy=navigator.getUserMedia||navigator.webkitGetUserMedia||navigator.mozGetUserMedia;
  if(legacy) return new Promise(function(res,rej){ legacy.call(navigator,c,res,rej); });
  return Promise.reject(new Error('getUserMedia not supported'));
}

/***** 시작 *****/
function startAll(){
  if(startBtn) startBtn.disabled=true;
  setStatus('checking','카메라 권한 요청 중...',true);
  initAudio();
  requestWakeLock();
  initCamera();
}
window.startAll = startAll;
if(startBtn){
  startBtn.addEventListener('click', startAll, {passive:true});
  startBtn.addEventListener('touchend', function(e){ e.preventDefault(); startAll(); }, {passive:false});
}

/***** 카메라 *****/
function initCamera(){
  video.muted=true; video.setAttribute('muted',''); video.setAttribute('playsinline','');
  if(!(navigator.mediaDevices||navigator.getUserMedia||navigator.webkitGetUserMedia||navigator.mozGetUserMedia)){
    setStatus('error','이 기기는 카메라를 지원하지 않습니다.'); return;
  }
  var back ={video:{facingMode:'environment',width:{ideal:IDEAL_WIDTH},height:{ideal:IDEAL_HEIGHT}},audio:false};
  var front={video:{facingMode:'user',    width:{ideal:IDEAL_WIDTH},height:{ideal:IDEAL_HEIGHT}},audio:false};
  var low  ={video:{width:{ideal:640},height:{ideal:480}},audio:false};
  var first = USE_FRONT_DEFAULT ? front : back;
  gUM(first)
    .catch(function(){ return gUM(USE_FRONT_DEFAULT ? back : front); })
    .catch(function(){ return gUM(low); })
    .then(function(stream){
      video.srcObject=stream;
      video.play().catch(function(){ setTimeout(function(){ video.play().catch(function(){}); },200); });
      if(MIRROR_DISPLAY) video.style.transform='scaleX(-1)';
      setStatus('ready','QR코드를 비춰주세요');
      if(startBtn) startBtn.classList.add('hidden');
      startScanning();
    }, function(e){
      var msg='카메라를 사용할 수 없습니다.';
      if(e&&(e.name==='NotAllowedError'||e.name==='SecurityError')) msg='카메라 권한이 거부되었습니다.';
      setStatus('error', msg);
      if(startBtn) startBtn.disabled=false;
    });
}

/***** 스캔 — ROI 3단계 순환 *****/
var roiCanvas=document.createElement('canvas'), roiCtx=roiCanvas.getContext('2d',{willReadFrequently:true});
var ROI_SCALES=[0.45, 0.65, 0.80], roiIdx=0;

function drawFrame(scale){
  var w=video.videoWidth||640, h=video.videoHeight||480; if(!w||!h) return null;
  var side=Math.floor(Math.min(w,h)*scale), x=Math.floor((w-side)/2), y=Math.floor((h-side)/2);
  roiCanvas.width=side; roiCanvas.height=side;
  roiCtx.drawImage(video,x,y,side,side,0,0,side,side);
  return {side:side};
}

function startScanning(){
  var hasBD=('BarcodeDetector' in window), detector=hasBD?new window.BarcodeDetector({formats:['qr_code']}):null;
  (function loop(){
    var now=Date.now();
    if(now >= blockUntil){
      var scale=ROI_SCALES[roiIdx % ROI_SCALES.length]; roiIdx++;
      var roi=drawFrame(scale);
      if(roi){
        if(detector){
          detector.detect(roiCanvas).then(function(codes){
            if(codes&&codes.length) maybeHandleDecoded((codes[0].rawValue||'').trim());
          }).catch(function(){});
        } else if(window.jsQR){
          var img=roiCtx.getImageData(0,0,roi.side,roi.side);
          var qr=jsQR(img.data,img.width,img.height,{inversionAttempts:'attemptBoth'});
          if(qr&&qr.data) maybeHandleDecoded(qr.data.trim());
        }
      }
    }
    requestAnimationFrame(loop);
  })();
}

/***** 토큰 정규화 *****/
function extractToken(text){
  try{ if(/^https?:\/\//i.test(text)){ var u=new URL(text); var t=u.searchParams.get('token'); if(t) return t; } }catch(_){}
  return text;
}

/***** 서버 전송 *****/
function sendAsync(token, count){
  var payload={ token:token, count:count, ua:(navigator.userAgent||'').slice(0,200) };
  if(navigator.sendBeacon){
    var ok=navigator.sendBeacon(API, new Blob([JSON.stringify(payload)],{type:'text/plain;charset=UTF-8'}));
    if(ok) return;
  }
  try{ fetch(API,{method:'POST',keepalive:true,mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }catch(_){}
}

/***** 성공 후 3초 유지 → 자동 초기화 *****/
function startCooldown(ms){
  blockUntil = Date.now() + ms;
  if(cooldownTimer){ clearTimeout(cooldownTimer); cooldownTimer=null; }
  cooldownTimer = setTimeout(function(){
    cooldownTimer = null;
    selectedCount = 1;
    updateCountUI();
    setStatus('ready','QR코드를 비춰주세요');
  }, ms);
}

/***** 낙관적 처리 *****/
function maybeHandleDecoded(text){
  var now=Date.now(); if(now - lastScanAt < COOLDOWN_MS) return;
  if(now < blockUntil) return;
  var token=extractToken(text); if(!token) return;

  lastScanAt = now;
  var count = selectedCount;
  setStatus('success', '✅ '+count+'명 입장 완료!', false);
  successChime();
  navigator.vibrate && navigator.vibrate(40);
  sendAsync(token, count);
  startCooldown(NEXT_DELAY_MS);
}
