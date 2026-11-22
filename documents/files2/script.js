(function(){
  // Optional: POST endpoint that accepts the JPEG and returns {"url": "https://..."}; leave empty to disable QR
  var CONFIG={uploadUrl:""};

  var $=function(i){return document.getElementById(i)};
  var W=1080,H=1920,M=56,BAND=320,stream=null,blob=null,photoURL=null,idle=null,T;
  var THEMES=[ // one palette colour per session
    {bg:"#7E955B",soft:"#D5EACF"},{bg:"#DA8755",soft:"#F8CCA9"},{bg:"#7DB1E0",soft:"#C3E1F4"},
    {bg:"#BFABBF",soft:"#D7D9E6"},{bg:"#F9D57B",soft:"#F5E8BE"},{bg:"#CA6858",soft:"#F3C3BD"}
  ];
  var ti=Math.floor(Math.random()*THEMES.length);
  function applyTheme(){T=THEMES[ti];var s=$("stage").style;s.setProperty("--bg",T.bg);s.setProperty("--soft",T.soft)}
  applyTheme();

  // official horizontal lock-up, drawn onto the saved photo
  var logoH=new Image();logoH.src="logo-horizontal.svg";
  var logoReady=new Promise(function(r){logoH.onload=r;logoH.onerror=r});

  // label roll: duplicate each label so hover can slide one over the other
  document.querySelectorAll(".btn .lbl").forEach(function(l){
    var t=l.textContent;l.className="roll";l.innerHTML="<b>"+t+"</b><b aria-hidden=\"true\">"+t+"</b>";
  });

  // curtain transition: screens swap while every strip is covering the stage
  function show(id){
    var w=$("wipe");w.classList.remove("go");void w.offsetWidth;w.classList.add("go");
    setTimeout(function(){["start","cam","res"].forEach(function(s){$(s).classList.toggle("on",s===id)})},760);
    return sleep(1150);
  }
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}

  // gentle parallax on the start screen
  $("start").addEventListener("pointermove",function(e){
    var r=this.getBoundingClientRect();
    $("stage").style.setProperty("--mx",((e.clientX-r.left)/r.width-.5).toFixed(3));
    $("stage").style.setProperty("--my",((e.clientY-r.top)/r.height-.5).toFixed(3));
  });

  async function openCam(){
    if(stream)return;
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1080},height:{ideal:1920}},audio:false});
    $("v").srcObject=stream;
    await $("v").play().catch(function(){});
  }

  var busy=false;
  async function run(){
    if(busy)return;busy=true;clearTimeout(idle);
    try{await openCam()}catch(e){
      $("err").textContent="Camera blocked. Allow camera access, or open this page in its own browser tab.";
      $("pick").hidden=false;busy=false;return;
    }
    await show("cam");
    $("hint").textContent="GET READY · استعد";
    await sleep(1400);
    $("hint").textContent="";
    var bar=$("bar");bar.classList.remove("run");void bar.offsetWidth;bar.classList.add("run");
    for(var n=5;n>=1;n--){
      var c=$("num");c.textContent=n;c.classList.remove("tick");void c.offsetWidth;c.classList.add("tick");
      await sleep(1000);
    }
    $("num").textContent="";bar.classList.remove("run");
    $("flash").classList.remove("go");void $("flash").offsetWidth;$("flash").classList.add("go");
    await capture();
    await finish();
    busy=false;
  }

  async function finish(){
    $("photo").style.animation="none";void $("photo").offsetWidth;$("photo").style.animation="";
    var p=show("res");publish();await p;idle=setTimeout(reset,90000);
  }

  async function capture(src){
    var v=src||$("v"),c=document.createElement("canvas");c.width=W;c.height=H;
    var x=c.getContext("2d"),vw=v.videoWidth||v.naturalWidth||1280,vh=v.videoHeight||v.naturalHeight||720;
    // frame in the session colour
    x.fillStyle=T.bg;x.fillRect(0,0,W,H);
    var rx=M,ry=M,rw=W-2*M,rh=H-M-BAND;
    var s=Math.max(rw/vw,rh/vh),dw=vw*s,dh=vh*s;
    x.save();x.beginPath();x.rect(rx,ry,rw,rh);x.clip();
    if(!src){x.translate(W,0);x.scale(-1,1);rx=W-rx-rw}
    x.drawImage(v,rx+(rw-dw)/2,ry+(rh-dh)/2,dw,dh);x.restore();
    // official logo, centred in the bottom band
    await logoReady;
    var lw=620,lh=lw*299.78/911.61;
    x.drawImage(logoH,(W-lw)/2,H-BAND+(BAND-lh)/2,lw,lh);
    blob=await new Promise(function(r){c.toBlob(r,"image/jpeg",.92)});
    if(photoURL)URL.revokeObjectURL(photoURL);
    photoURL=URL.createObjectURL(blob);
    $("photo").src=photoURL;$("save").href=photoURL;
  }

  async function upload(b){
    if(CONFIG.uploadUrl){
      var r=await fetch(CONFIG.uploadUrl,{method:"POST",headers:{"Content-Type":"image/jpeg"},body:b});
      return (await r.json()).url;
    }
    if(window.claude&&claude.use){ // Claude artifact hosting
      var a=await claude.use("assets");if(!a)throw 0;
      var u=await a.upload(new File([b],"eid-"+Date.now()+".jpg",{type:"image/jpeg"}));
      return new URL(u.url,location.href).href;
    }
    throw 0;
  }

  async function publish(){
    $("qrbox").textContent="Preparing…";$("msg").textContent="";
    var mine=blob;
    try{
      var url=await upload(mine);if(mine!==blob)return;
      var q=qrcode(0,"M");q.addData(url);q.make();
      $("qrbox").innerHTML=q.createSvgTag({cellSize:6,margin:0,scalable:true});
    }catch(e){
      $("qrbox").textContent="QR unavailable";
      $("msg").textContent="Use Save to download the photo";
    }
  }

  async function reset(){
    clearTimeout(idle);
    var p=show("start");
    await sleep(760);
    $("qrbox").textContent="Preparing…";$("err").textContent="";
    ti=(ti+1)%THEMES.length;applyTheme();
    await p;
  }

  $("go").onclick=run;$("retake").onclick=run;$("done").onclick=reset;
  $("pick").onclick=function(){$("file").click()};
  $("file").onchange=function(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    var im=new Image();im.onload=async function(){await capture(im);finish()};
    im.src=URL.createObjectURL(f);e.target.value="";
  };
})();
