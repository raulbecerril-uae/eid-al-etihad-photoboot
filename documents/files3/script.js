(function(){
  // Optional: POST endpoint that accepts the JPEG and returns {"url": "https://..."}; leave empty to disable QR
  var CONFIG={uploadUrl:""};

  var $=function(i){return document.getElementById(i)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var W=1080,H=1920,M=56,BAND=320,stream=null,blob=null,photoURL=null,idle=null,T,current="start",busy=false;
  var THEMES=[ // one palette colour per session
    {bg:"#7E955B",soft:"#D5EACF"},{bg:"#DA8755",soft:"#F8CCA9"},{bg:"#7DB1E0",soft:"#C3E1F4"},
    {bg:"#BFABBF",soft:"#D7D9E6"},{bg:"#F9D57B",soft:"#F5E8BE"},{bg:"#CA6858",soft:"#F3C3BD"}
  ];
  var ti=Math.floor(Math.random()*THEMES.length);
  function applyTheme(){T=THEMES[ti];var s=$("stage").style;s.setProperty("--bg",T.bg);s.setProperty("--soft",T.soft)}
  applyTheme();

  // official horizontal lock-up, embedded as a data URI so the canvas is never tainted
  var logoH=new Image();
  var logoReady=new Promise(function(r){logoH.onload=r;logoH.onerror=r});
  logoH.src=window.LOGO_H;

  // buttons: duplicate label for the roll, cursor-aware fill, magnetic pull
  document.querySelectorAll(".btn").forEach(function(b){
    var l=b.querySelector(".lbl");
    if(l){var t=l.textContent;l.className="roll";l.innerHTML="<b>"+t+"</b><b aria-hidden=\"true\">"+t+"</b>"}
    function pos(e){var r=b.getBoundingClientRect();
      b.style.setProperty("--px",(e.clientX-r.left)+"px");b.style.setProperty("--py",(e.clientY-r.top)+"px");return r}
    b.addEventListener("pointerenter",function(e){pos(e);b.classList.add("hot")});
    b.addEventListener("pointermove",function(e){var r=pos(e);
      b.style.setProperty("--tx",((e.clientX-r.left)/r.width-.5)*14+"px");
      b.style.setProperty("--ty",((e.clientY-r.top)/r.height-.5)*8+"px")});
    b.addEventListener("pointerleave",function(e){pos(e);b.classList.remove("hot");
      b.style.setProperty("--tx","0px");b.style.setProperty("--ty","0px")});
  });

  // transition: the incoming screen opens as a circle from the tap point
  function show(id,ev){
    var st=$("stage"),r=st.getBoundingClientRect(),to=$(id),from=$(current);
    if(to===from)return Promise.resolve();
    var cx=ev&&ev.clientX!=null?ev.clientX-r.left:r.width/2,cy=ev&&ev.clientY!=null?ev.clientY-r.top:r.height/2;
    to.style.setProperty("--cx",cx+"px");to.style.setProperty("--cy",cy+"px");
    to.classList.add("on","enter");from.classList.add("out");current=id;
    return sleep(1150).then(function(){
      from.classList.remove("on","out");to.classList.remove("enter");
    });
  }

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

  async function run(ev){
    if(busy)return;busy=true;clearTimeout(idle);stopConfetti();
    try{await openCam()}catch(e){
      $("err").textContent="Camera blocked. Allow camera access, or open this page in its own browser tab.";
      $("pick").hidden=false;busy=false;return;
    }
    var p=show("cam",ev);
    await sleep(800);
    $("hint").textContent="GET READY · استعد";
    await sleep(1500);
    $("hint").textContent="";
    var bar=$("bar");bar.classList.remove("run");void bar.offsetWidth;bar.classList.add("run");
    for(var n=5;n>=1;n--){
      var c=$("num");c.textContent=n;c.classList.remove("tick");void c.offsetWidth;c.classList.add("tick");
      await sleep(1000);
    }
    $("num").textContent="";bar.classList.remove("run");
    $("flash").classList.remove("go");void $("flash").offsetWidth;$("flash").classList.add("go");
    await capture();
    await p;
    await finish();
    busy=false;
  }

  async function finish(){
    var res=$("res");
    res.style.setProperty("--bg",T.bg);res.style.setProperty("--soft",T.soft); // freeze this session's colour
    $("photo").style.animation="none";void $("photo").offsetWidth;$("photo").style.animation="";
    var p=show("res");publish();
    setTimeout(confetti,1000);
    await p;idle=setTimeout(function(){reset()},90000);
  }

  async function capture(src){
    var v=src||$("v"),c=document.createElement("canvas");c.width=W;c.height=H;
    var x=c.getContext("2d"),vw=v.videoWidth||v.naturalWidth||1280,vh=v.videoHeight||v.naturalHeight||720;
    x.fillStyle=T.bg;x.fillRect(0,0,W,H);
    var rx=M,ry=M,rw=W-2*M,rh=H-M-BAND;
    var s=Math.max(rw/vw,rh/vh),dw=vw*s,dh=vh*s;
    x.save();x.beginPath();x.rect(rx,ry,rw,rh);x.clip();
    if(!src){x.translate(W,0);x.scale(-1,1)}
    x.drawImage(v,rx+(rw-dw)/2,ry+(rh-dh)/2,dw,dh);x.restore();
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

  /* confetti: flag-colour paper (rectangles, slivers, curls) thrown from both sides */
  var raf=null;
  function stopConfetti(){cancelAnimationFrame(raf);raf=null;var c=$("confetti"),x=c.getContext("2d");x.clearRect(0,0,c.width,c.height)}
  function confetti(){
    if(current!=="res")return;
    var cv=$("confetti"),st=$("stage"),d=window.devicePixelRatio||1,w=st.clientWidth,h=st.clientHeight;
    cv.width=w*d;cv.height=h*d;var x=cv.getContext("2d");x.scale(d,d);
    var u=w/500,cols=["#C8102E","#00843D","#121a22"],P=[],rnd=function(a,b){return a+Math.random()*(b-a)};
    for(var i=0;i<130;i++){
      var left=i%2===0,ang=rnd(-1.25,-.55),sp=rnd(14,30)*u;
      P.push({t:rnd(0,.5),x:left?-10:w+10,y:h*rnd(.5,.75),vx:(left?1:-1)*Math.cos(ang)*sp*(left?1:-1)*-1*-1,vy:Math.sin(ang)*sp,
        r:rnd(0,6.28),vr:rnd(-.2,.2),ph:rnd(0,6.28),vp:rnd(.08,.25),c:cols[(Math.random()*3)|0],
        k:Math.random()<.5?0:Math.random()<.55?1:2,w:rnd(5,13)*u,l:rnd(9,22)*u});
    }
    P.forEach(function(p){if(p.x>0)p.vx=-Math.abs(p.vx);else p.vx=Math.abs(p.vx)});
    var t0=performance.now(),last=t0;
    (function frame(now){
      var dt=Math.min((now-last)/16.67,3),T=(now-t0)/1000;last=now;
      x.clearRect(0,0,w,h);var alive=0;
      P.forEach(function(p){
        if(T<p.t){alive++;return}
        p.vx*=Math.pow(.985,dt);p.vy=p.vy*Math.pow(.985,dt)+.42*u*dt;
        p.x+=p.vx*dt;p.y+=p.vy*dt;p.r+=p.vr*dt;p.ph+=p.vp*dt;
        if(p.y>h+40)return;alive++;
        x.save();x.translate(p.x,p.y);x.rotate(p.r);x.scale(1,Math.cos(p.ph));
        x.fillStyle=x.strokeStyle=p.c;
        if(p.k===0)x.fillRect(-p.w/2,-p.l/2,p.w,p.l);
        else if(p.k===1)x.fillRect(-p.w/5,-p.l,p.w/3+1,p.l*2);
        else{x.lineWidth=Math.max(2,p.w/3);x.beginPath();x.arc(0,0,p.l/1.6,0,Math.PI*1.1);x.stroke()}
        x.restore();
      });
      if(alive&&T<9)raf=requestAnimationFrame(frame);else stopConfetti();
    })(t0);
  }

  async function reset(ev){
    clearTimeout(idle);stopConfetti();
    ti=(ti+1)%THEMES.length;applyTheme();
    var p=show("start",ev);
    $("qrbox").textContent="Preparing…";$("err").textContent="";
    await p;
  }

  $("go").onclick=run;$("retake").onclick=run;$("done").onclick=reset;
  $("pick").onclick=function(){$("file").click()};
  $("file").onchange=function(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    var im=new Image();im.onload=async function(){await capture(im);await finish()};
    im.src=URL.createObjectURL(f);e.target.value="";
  };
})();
