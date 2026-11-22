(function(){
  // Optional: POST endpoint that accepts the JPEG and returns {"url": "https://..."}; leave empty to disable QR
  var CONFIG={uploadUrl:""};

  var $=function(i){return document.getElementById(i)};
  var W=1080,H=1920,stream=null,blob=null,photoURL=null,idle=null,T;
  var THEMES=[ // one palette colour per session
    {bg:"#7E955B",soft:"#D5EACF"},{bg:"#DA8755",soft:"#F8CCA9"},{bg:"#7DB1E0",soft:"#C3E1F4"},
    {bg:"#BFABBF",soft:"#D7D9E6"},{bg:"#F9D57B",soft:"#F5E8BE"},{bg:"#CA6858",soft:"#F3C3BD"}
  ];
  var ti=Math.floor(Math.random()*THEMES.length);
  function applyTheme(){T=THEMES[ti];var s=$("stage").style;s.setProperty("--bg",T.bg);s.setProperty("--soft",T.soft)}
  applyTheme();

  function show(id){
    var w=$("wipe");w.classList.remove("go");void w.offsetWidth;w.classList.add("go");
    setTimeout(function(){["start","cam","res"].forEach(function(s){$(s).classList.toggle("on",s===id)})},450);
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

  async function run(){
    clearTimeout(idle);
    try{await openCam()}catch(e){
      $("err").textContent="Camera blocked. Allow camera access, or open this page in its own browser tab.";
      $("pick").hidden=false;return;
    }
    show("cam");
    $("hint").textContent="GET READY · استعد";
    await sleep(1600);
    $("hint").textContent="";
    var bar=$("bar");bar.classList.remove("run");void bar.offsetWidth;bar.classList.add("run");
    for(var n=5;n>=1;n--){
      var c=$("count");c.textContent=n;c.classList.remove("tick");void c.offsetWidth;c.classList.add("tick");
      await sleep(1000);
    }
    $("count").textContent="";$("bar").classList.remove("run");
    $("flash").classList.remove("go");void $("flash").offsetWidth;$("flash").classList.add("go");
    await capture();
    finish();
  }

  function finish(){
    $("photo").style.animation="none";void $("photo").offsetWidth;$("photo").style.animation="";
    show("res");idle=setTimeout(reset,90000);publish();
  }

  async function capture(src){
    var v=src||$("v"),c=document.createElement("canvas");c.width=W;c.height=H;
    var x=c.getContext("2d"),vw=v.videoWidth||v.naturalWidth||1280,vh=v.videoHeight||v.naturalHeight||720;
    var s=Math.max(W/vw,H/vh),dw=vw*s,dh=vh*s;
    x.save();if(!src){x.translate(W,0);x.scale(-1,1)}
    x.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh);x.restore();
    try{await document.fonts.load("700 80px 'Reem Kufi'");await document.fonts.load("600 40px Oswald")}catch(e){}
    var bh=300;
    x.fillStyle=T.bg;x.fillRect(0,H-bh,W,bh);
    x.fillStyle=T.soft;x.fillRect(0,H-bh,W,12);
    x.fillStyle="#131a21";x.textAlign="center";
    x.font="700 130px 'Reem Kufi', serif";x.fillText("عيد الاتحاد",W/2,H-bh+165);
    x.font="600 44px Oswald, sans-serif";x.fillText("E I D   A L   E T I H A D",W/2,H-bh+235);
    x.globalAlpha=.7;x.font="500 28px Oswald, sans-serif";x.fillText("D E C .  0 2",W/2,H-bh+60);x.globalAlpha=1;
    blob=await new Promise(function(r){c.toBlob(r,"image/jpeg",.9)});
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

  function reset(){
    clearTimeout(idle);
    $("qrbox").textContent="Preparing…";$("err").textContent="";
    ti=(ti+1)%THEMES.length;applyTheme();
    show("start");
  }

  $("go").onclick=run;$("retake").onclick=run;$("done").onclick=reset;
  $("pick").onclick=function(){$("file").click()};
  $("file").onchange=function(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    var im=new Image();im.onload=async function(){await capture(im);finish()};
    im.src=URL.createObjectURL(f);e.target.value="";
  };
})();
