/***** 설정 *****/
var API = 'https://script.google.com/macros/s/AKfycbz6RgYyT4s7TgFsGnCKgnM87VxyyhSF-3-ibf6Fwa9Pfs-hvctXc3w-RzmSK3ad9aHV/exec'; // ← 반드시 최신 배포 URL로 교체
var COOLDOWN_MS    = 500;       // 프레임 튐 방지
var NEXT_DELAY_MS  = 2500;      // 성공 후 다음 스캔 대기
var USE_FRONT_DEFAULT = true;   // 전면
var MIRROR_DISPLAY = true;      // 화면은 항상 좌우대칭(거울)
var IDEAL_WIDTH = 1280, IDEAL_HEIGHT = 720;

/***** 요소 *****/
function byId(id){ return document.getElementById(id); }
var video=byId('camera'), startBtn=byId('startBtn'), statusMsg=byId('statusMsg');
var camWrap=document.querySelector('.camera-wrapper');
var lastScanAt=0, blockUntil=0, countdownTimer=null;

/***** 오디오(간단) *****/
var audioCtx=null;
function initAudio(){ try{ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); }catch(_){} }
function beep(f,ms,t,v){ if(!audioCtx) return; var o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type=t||'square'; o.frequency.value=f||1000; g.gain.value=(v!=null?v:0.34); o.connect(g);g.connect(audioCtx.destination); o.start(); setTimeout(function(){try{o.stop();}catch(_){}} ,ms||140); }
function successChime(){ beep(1100,140,'square',0.34); setTimeout(function(){beep(1500,160,'square',0.34);},90); }

/***** 상태표시 *****/
function setStatus(state, text, spin){
  statusMsg.innerHTML = spin ? '<span class="spinner" aria-hidden="true"></span>'+text : text;
  statusMsg.className = '';

  if (camWrap) camWrap.classList.remove('cam-success','cam-error','cam-check','cam-wait');
  document.body.classList.remove('bg-success','bg-error','bg-checking','bg-wait');

  if (state==='ready')    statusMsg.classList.add('state-ready');
  if (state==='checking'){statusMsg.classList.add('state-checking'); camWrap&&camWrap.classList.add('cam-check'); document.body.classList.add('bg-checking');}
  if (state==='success') {statusMsg.classList.add('state-success');  camWrap&&camWrap.classList.add('cam-success'); document.body.classList.add('bg-success');}
  if (state==='error')   {statusMsg.classList.add('state-error');    camWrap&&camWrap.classList.add('cam-error');   document.body.classList.add('bg-error');}
  if (state==='wait')    {statusMsg.classList.add('state-wait');     camWrap&&camWrap.classList.add('cam-wait');    document.body.classList.add('bg-wait');}
}


/***** 비율 보정 *****/
function applyActualAspectRatio(){ var vw=video.videoWidth||0, vh=video.videoHeight||0; if (vw&&vh&&camWrap) camWrap.style.setProperty('--ratio', (vw+' / '+vh)); }

/***** gUM 폴백 공통 *****/
function gUM(c){
  var md=navigator.mediaDevices; if (md && md.getUserMedia) return md.getUserMedia(c);
  var legacy=navigator.getUserMedia||navigator.webkitGetUserMedia||navigator.mozGetUserMedia;
  if (legacy) return new Promise(function(res,rej){ legacy.call(navigator,c,res,rej); });
  return Promise.reject(new Error('getUserMedia not supported'));
}

/***** 시작 *****/
function startAll(){ if(startBtn) startBtn.disabled=true; setStatus('checking','카메라 권한 요청 중...', true); initAudio(); initCamera(); }
window.startAll = startAll;
if (startBtn){
  startBtn.addEventListener('click', startAll, {passive:true});
  startBtn.addEventListener('touchend', function(e){e.preventDefault(); startAll();},{passive:false});
}

/***** 카메라 *****/
function initCamera(){
  video.muted=true; video.setAttribute('muted',''); video.setAttribute('playsinline','');
  if (!(navigator.mediaDevices||navigator.getUserMedia||navigator.webkitGetUserMedia||navigator.mozGetUserMedia)){
    setStatus('error','이 기기는 카메라 API를 지원하지 않습니다.'); return;
  }
  var front={video:{facingMode:'user',width:{ideal:IDEAL_WIDTH},height:{ideal:IDEAL_HEIGHT}},audio:false};
  var back ={video:{facingMode:'environment',width:{ideal:IDEAL_WIDTH},height:{ideal:IDEAL_HEIGHT}},audio:false};
  var low  ={video:{width:{ideal:640},height:{ideal:480}},audio:false};

  var first = USE_FRONT_DEFAULT ? front : back;
  gUM(first).catch(function(){return gUM(USE_FRONT_DEFAULT?back:front);}).catch(function(){return gUM(low);})
  .then(function(stream){
    video.srcObject=stream;
    video.onloadedmetadata=applyActualAspectRatio; video.onresize=applyActualAspectRatio;
    video.play().catch(function(){ setTimeout(function(){ video.play().catch(function(){}); },200); });
    /* ✅ 항상 거울 표시 */
    if (MIRROR_DISPLAY) video.style.transform = 'scaleX(-1)';
    setTimeout(applyActualAspectRatio,120);
    setStatus('ready','🟢 QR을 비춰주세요.');
    startBtn && startBtn.classList.add('hidden');
    startScanning();
  }, function(e){
    var msg='카메라를 사용할 수 없습니다.'; if(e&&(e.name==='NotAllowedError'||e.name==='SecurityError')) msg='카메라 권한이 거부되었습니다.';
    setStatus('error','❌ '+msg); startBtn && (startBtn.disabled=false);
  });
}

/***** 스캔(센터 ROI) — 캔버스는 “미러 보정 없이” 원본 프레임 사용 *****/
var roiCanvas=document.createElement('canvas'), roiCtx=roiCanvas.getContext('2d',{willReadFrequently:true});
var ROI_SCALE=0.62;
function drawFrame(){
  var w=video.videoWidth||640, h=video.videoHeight||480; if(!w||!h) return null;
  var side=Math.floor(Math.min(w,h)*ROI_SCALE), x=Math.floor((w-side)/2), y=Math.floor((h-side)/2);
  roiCanvas.width=side; roiCanvas.height=side;
  roiCtx.drawImage(video,x,y,side,side,0,0,side,side); // ← CSS 미러는 화면용, 디코딩은 원본
  return {side:side};
}

function startScanning(){
  var hasBD=('BarcodeDetector' in window), detector=hasBD?new window.BarcodeDetector({formats:['qr_code']}):null;
  (function loop(){
    var now=Date.now();
    if (now >= blockUntil){
      var roi=drawFrame();
      if (roi){
        if(detector){
          detector.detect(roiCanvas).then(function(codes){
            if(codes&&codes.length){ var txt=(codes[0].rawValue||'').trim(); maybeHandleDecoded(txt); }
          }).catch(function(){});
        }else if(window.jsQR){
          var img=roiCtx.getImageData(0,0,roi.side,roi.side), qr=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
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

/***** 서버 전송 (낙관적) — 실패해도 UI는 기다리지 않음 *****/
function sendAsync(token){
  var payload={ token:token, ua:(navigator.userAgent||'').slice(0,120) };
  if (navigator.sendBeacon){
    var ok=navigator.sendBeacon(API, new Blob([JSON.stringify(payload)], {type:'text/plain;charset=UTF-8'}));
    if (ok) return;
  }
  // fetch keepalive 백업
  try{ fetch(API,{method:'POST',keepalive:true,mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }catch(_){}
}

/***** 성공 후 N초 쿨다운 & 카운트다운 UI(주황, 탈색) *****/
/***** 성공 후 N초 쿨다운 & 정수 카운트다운 UI *****/
/***** 성공 후 N초 쿨다운 & “확인됨 + 정수 카운트다운” 동시 표시 *****/
function startCooldown(ms){
  blockUntil = Date.now() + ms;
  if (countdownTimer){ clearInterval(countdownTimer); countdownTimer=null; }

  let lastShown = -1;

  countdownTimer = setInterval(function(){
    const left = blockUntil - Date.now();
    const sec  = Math.max(0, Math.ceil(left / 1000));   // ← 정수 초

    // 같은 숫자는 다시 그리지 않음(깜빡임 방지)
    if (sec !== lastShown){
      lastShown = sec;

      if (sec > 0){
        // ✅ 확인문구 + 굵은 숫자를 함께 보여줌
        setStatus(
          'wait',
          '✅ 확인되었습니다!' +
          '<span class="count-sub">다음 스캔까지 <span class="count-big">'+sec+'</span>초</span>',
          false
        );
      } else {
        clearInterval(countdownTimer);
        countdownTimer = null;
        setStatus('ready','🟢 QR을 비춰주세요.');
      }
    }
  }, 120);
}

/***** 낙관적 처리 *****/
function maybeHandleDecoded(text){
  var now=Date.now(); if(now - lastScanAt < COOLDOWN_MS) return;
  if(now < blockUntil) return; // 대기중
  var token = extractToken(text); if(!token) return;

  lastScanAt = now;
  setStatus('success','✅ 확인되었습니다!', false);
successChime();
navigator.vibrate && navigator.vibrate(40);

// 곧바로(또는 150~250ms 후) 카운트다운 진입
startCooldown(NEXT_DELAY_MS);


  // 비동기 전송(응답 기다리지 않음)
  sendAsync(token);

  // 대기(주황)로 전환 + 카메라 탈색
  startCooldown(NEXT_DELAY_MS);
}
