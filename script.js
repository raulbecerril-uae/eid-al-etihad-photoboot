(function(){
  // POST endpoint that stores the photo on the server (see upload.php) and returns {"url":"photos/xxxx.jpg"}
  var CONFIG={uploadUrl:"upload.php",publicBase:(function(){var p=new URLSearchParams(location.search).get("pub")||"";return /^https?:\/\//i.test(p)?p:""})()}; // ?pub= = address the phone should use in the QR (local test only)

  var $=function(i){return document.getElementById(i)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var W=1080,H=1920,M=56,BAND=320,stream=null,blob=null,photoURL=null,idle=null,T,current="intro",busy=false;
  var THEMES=[ // one palette colour per session
    {bg:"#7E955B",soft:"#D5EACF"},{bg:"#DA8755",soft:"#F8CCA9"},{bg:"#7DB1E0",soft:"#C3E1F4"},
    {bg:"#BFABBF",soft:"#D7D9E6"},{bg:"#F9D57B",soft:"#F5E8BE"},{bg:"#CA6858",soft:"#F3C3BD"}
  ];
  var ti=Math.floor(Math.random()*THEMES.length);
  function applyTheme(){T=THEMES[ti];var s=$("stage").style;s.setProperty("--bg",T.bg);s.setProperty("--soft",T.soft)}
  applyTheme();

  /* ---- official backgrounds, 55 marks ---- */
  var ROOT="assets/",BGCATS={cities:"Cities",coastals:"Coastals",desert:"Desert",mountains:"Mountains"},BGS=[];
  Object.keys(BGCATS).forEach(function(k){for(var i=1;i<=4;i++)BGS.push(ROOT+"backgrounds/"+k+"/EidAlEtihad_"+BGCATS[k]+"Backgrounds_V_RGB-0"+i+".jpg")});
  var U=function(p){return encodeURI(p)},rnd=function(a){return a[Math.floor(Math.random()*a.length)]},clamp=function(v,a,b){return Math.min(b,Math.max(a,v))};
  var resBg=null,baseC=null,baseURL=null,stickers=[],sel=null;
  var FILEMODE=location.protocol==="file:";
  var tainted=false,degraded=false;
  function warnFile(){}
  var loadImg=function(s){return new Promise(function(res,rej){var i=new Image();i.onload=function(){res(i)};i.onerror=rej;i.src=s})};
  var toBlob=function(c,t){return new Promise(function(r){c.toBlob(r,t||"image/jpeg",.92)})};
  var PAL=["#BFABBF","#CA6858","#7DB1E0","#F9D57B","#DA8755","#E8C7B5","#028E85","#D7D9E6","#AE4E27","#306880","#E6BF5E","#A86847","#E7E0CD","#7E955B","#D3DAD0","#F3C3BD","#C3E1F4","#F5E8BE","#F8CCA9","#F1ECD7","#D5EACF"],COLS=PAL.concat(["#ffffff","#121a22","#C8102E","#00843D"]); // colours allowed for the 55 mark: brand scheme + flag + white/ink
  var lumOf=function(h){h=h.replace("#","");var a=[0,2,4].map(function(i){var v=parseInt(h.substr(i,2),16)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
  var contrast=function(a,b){var x=lumOf(a),y=lumOf(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  function markURI(i,col){return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(window.MARK_SVG[i].replace(/#00000b/gi,col))}
  var CORNERS=[{top:"3%",right:"4%"},{top:"3%",left:"4%"},{bottom:"3%",right:"4%"},{bottom:"3%",left:"4%"}];
  function decorate(el,bg,solid){ // solid = a plain colour chosen as the photo frame
    el.style.setProperty("--bgimg",solid?"none":'url("'+U(bg||sessBg)+'")');
    if(solid)el.style.setProperty("--bg",solid);else el.style.removeProperty("--bg");
    if(el.id==="intro")return;
    var m=el.querySelector(":scope > .mark");
    if(!m){m=document.createElement("img");m.className="mark";m.alt="";el.prepend(m)}
    m.style.cssText="";m.style.left=(2+Math.random()*75).toFixed(1)+"%";m.style.top=(2+Math.random()*86).toFixed(1)+"%";m.style.rotate=(Math.random()*30-15).toFixed(1)+"deg";
    var mi=Math.floor(Math.random()*4);m.dataset.i=mi;m.src=markURI(mi,(el.id==="res"&&curMark)||sessMark);
  }
  var sessBg=null,sessCol=null,sessMark=null; // sessMark = colour of the "55" (always different from the logo colour)
  var logoSVG=atob(document.querySelector("#intro > .logo").src.split(",")[1]); // original lock-up, recoloured per session
  function applyLogo(){ // logo panel takes the session colour; type flips to ink on light colours
    var txt=contrast(sessCol,"#ffffff")<2.6?"#121a22":"#ffffff";
    var svg=logoSVG.replace(/(\.cls-1\s*\{\s*fill:\s*)#fff/i,"$1"+txt).replace(/(\.cls-2\s*\{\s*fill:\s*)#121a22/i,"$1"+sessCol);
    var u="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
    Array.prototype.forEach.call(document.querySelectorAll("img.logo"),function(i){i.src=u});
  }
  function applySessionColor(){applyLogo();Array.prototype.forEach.call(document.querySelectorAll(".screen:not(#res) > .mark"),function(m){m.src=markURI(+m.dataset.i||0,sessMark)})}
  var POOL=PAL.concat(["#C8102E","#00843D"]); // whole brand palette + flag colours
  var rgb=function(h){h=h.replace("#","");return[0,2,4].map(function(i){return parseInt(h.substr(i,2),16)})};
  var cdist=function(a,b){var x=rgb(a),y=rgb(b);return Math.hypot(x[0]-y[0],x[1]-y[1],x[2]-y[2])};
  var markOK=function(c,bg){return contrast(c,bg)>=1.8&&cdist(c,sessCol)>110};
  function saveSess(){try{localStorage.setItem("eidSess",JSON.stringify({bg:sessBg,col:sessCol,mark:sessMark}))}catch(e){}}
  async function refineSession(){ // keep logo + 55 readable against this background (needs pixel access)
    var now=sessBg;
    try{
      var im=await loadImg(U(now)),c=document.createElement("canvas");c.width=c.height=1;var x=c.getContext("2d");x.drawImage(im,0,0,1,1);
      var d=x.getImageData(0,0,1,1).data,hex="#"+[d[0],d[1],d[2]].map(function(v){return("0"+v.toString(16)).slice(-2)}).join("");
      if(now!==sessBg)return;
      var ch=false;
      if(contrast(sessCol,hex)<1.8){var ok=POOL.filter(function(c){return contrast(c,hex)>=1.8});if(ok.length){sessCol=rnd(ok);ch=true}}
      if(!markOK(sessMark,hex)){var ok2=POOL.filter(function(c){return markOK(c,hex)});if(ok2.length){sessMark=rnd(ok2);ch=true}}
      if(ch){saveSess();applySessionColor()}
    }catch(e){}
  }
  function newSession(){ // a clearly different background, logo colour and 55 colour from the previous start / photo
    var l={};try{l=JSON.parse(localStorage.getItem("eidSess")||"{}")}catch(e){}
    sessBg=rnd(BGS.filter(function(b){return b!==l.bg}));
    var far=l.col?POOL.filter(function(c){return cdist(c,l.col)>120}):POOL;
    sessCol=rnd(far.length?far:POOL);
    var mf=POOL.filter(function(c){return cdist(c,sessCol)>110&&(!l.mark||cdist(c,l.mark)>60)});
    sessMark=rnd(mf.length?mf:POOL.filter(function(c){return cdist(c,sessCol)>110}));
    saveSess();
    applyLogo();
    refineSession();
  }
  newSession();
  decorate($("intro"));
  (async function(){try{var i=await loadImg(U(BGS[0])),c=document.createElement("canvas");c.width=c.height=1;var q=c.getContext("2d");q.drawImage(i,0,0,1,1);q.getImageData(0,0,1,1)}catch(e){if(e&&e.name==="SecurityError"){tainted=true;warnFile()}}})();

  /* ---- return to the intro only after 120 s without any activity ---- */
  var lastAct=Date.now();
  ["pointerdown","pointermove","keydown","wheel","touchstart"].forEach(function(ev){addEventListener(ev,function(){lastAct=Date.now()},{passive:true,capture:true})});
  setInterval(function(){if(current!=="intro"&&current!=="cam"&&!busy&&Date.now()-lastAct>120000)reset()},5000);

  /* ---- intro: floating illustrations (random each time), cycling 55 ---- */
  var SPRP=["04_Celebration/PNG/EE55_Celebration_Ayyala_01.webp","04_Celebration/PNG/EE55_Celebration_Ayyala_02.webp","04_Celebration/PNG/EE55_Celebration_Ayyala_03.webp","04_Celebration/PNG/EE55_Celebration_Naashat.webp","03_Arts & Crafts/PNG/EE55_Arts&Crafts_Talli.webp","03_Arts & Crafts/PNG/EE55_Arts&Crafts_Khoos-Weaver.webp","09_Vehicles/PNG/EE55_Vehicles_New-Taxi.webp","09_Vehicles/PNG/EE55_Vehicles_Old-Taxi.webp","11_Structures/PNG/EE55_Buildings&Structures_Park-Playground_01.webp","11_Structures/PNG/EE55_Buildings&Structures_Park-Playground_02.webp","11_Structures/PNG/EE55_Buildings&Structures_Street-Post-Banner_01.webp","11_Structures/PNG/EE55_Buildings&Structures_Street-Post-Light_02.webp","11_Structures/PNG/EE55_Buildings&Structures_Street-Post-Light_03.webp","01_People/PNG/EE55_People_02.webp","01_People/PNG/EE55_People_17.webp","06_Fauna/PNG/EE55_Fauna_Cat_01.webp"];
  var POS=[[3,5],[72,3],[82,19],[2,24],[78,40],[3,44],[84,58],[5,62],[68,74],[20,82],[46,87],[84,83]];
  var shuf=function(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a};
  var POS2=[[40,1],[9,9],[62,8],[89,30],[-2,33],[90,50],[-1,69],[76,62],[7,88],[60,90],[87,87],[32,94]];
  function fillDrift(dr,pos,n,skip){
    dr.innerHTML="";var pick=shuf(SPRP.filter(function(p){return skip.indexOf(p)<0})).concat(shuf(SPRP.filter(function(p){return skip.indexOf(p)>=0}))).slice(0,n),pp=shuf(pos);
    pick.forEach(function(p,i){
      var im=document.createElement("img");im.className="spr";im.alt="";im.src=U(ROOT+"illustrations/"+p);
      var q=pp[i%pp.length];im.style.cssText="left:"+q[0]+"%;top:"+q[1]+"%;height:"+(9+Math.random()*6).toFixed(1)+"vh;--dl:"+(.5+i*.15).toFixed(2)+"s;--dur:"+(5+Math.random()*4).toFixed(1)+"s";
      dr.appendChild(im);
    });
    return pick;
  }
  function buildSprites(){var a=fillDrift($("drift"),POS,12,[]);fillDrift($("drift2"),POS2,10,a)} // second screen: other illustrations, other positions
  buildSprites();
  var DOPT={waveColor:"#ffffff",backgroundColor:"transparent",ditherMode:"noise",colorNum:3,pixelSize:4,waveSpeed:0,waveFrequency:3,waveAmplitude:.3,mouseEffect:"erase",mouseRadius:.28,mouseStrength:2.2,trail:.99,clickRipple:true,intro:false,dpr:1,brightness:0,contrast:1.2,scale:1,enableMouseInteraction:true,disableAnimation:false,palette:[]};
  var DITH={intro:null,start:null};
  try{DITH.intro=new Dither($("dth"),Object.assign({active:true},DOPT));DITH.start=new Dither($("dth2"),Object.assign({active:false},DOPT))}catch(e){}
  function dithOn(id,on){var d=DITH[id];if(d)d.setActive(on)}
  /* ===== TEMP: dither tuning panel — delete this whole block (and the "TEMP PANEL" CSS) when done. Toggle with the gear or the P key. ===== */
  (function(){
    var ui={opacity:.49,blend:"soft-light",bgT:true,bgC:"#121a22",pal:""};
    var cur=Object.assign({},DOPT);
    var PRESETS={
      "My settings":{c:{ditherMode:"noise",pixelSize:4,colorNum:3,contrast:1.2,brightness:0,scale:1,waveFrequency:3,waveAmplitude:.3,waveSpeed:0,mouseRadius:.28,mouseStrength:2.2,trail:.99},u:{opacity:.49,blend:"soft-light"}},
      "Retro bayer":{c:{ditherMode:"bayer",pixelSize:4,colorNum:2,contrast:1.4,brightness:0,scale:1,waveFrequency:3,waveAmplitude:.3},u:{opacity:.5}},
      "Chunky 1-bit":{c:{ditherMode:"bayer4",pixelSize:7,colorNum:2,contrast:1.7,brightness:0,scale:.6,waveFrequency:2.4,waveAmplitude:.4},u:{opacity:.6}},
      "Halftone":{c:{ditherMode:"halftone",pixelSize:5,colorNum:2,contrast:1.5,brightness:0,scale:.8,waveFrequency:3,waveAmplitude:.3},u:{opacity:.55}},
      "Scanlines":{c:{ditherMode:"lines",pixelSize:3,colorNum:2,contrast:1.5,brightness:0,scale:1,waveFrequency:3,waveAmplitude:.3},u:{opacity:.5}},
      "Crosshatch":{c:{ditherMode:"crosshatch",pixelSize:3,colorNum:2,contrast:1.5,brightness:0,scale:1,waveFrequency:3,waveAmplitude:.3},u:{opacity:.5}},
      "Noise grain":{c:{ditherMode:"noise",pixelSize:2,colorNum:3,contrast:1.2,brightness:0,scale:1,waveFrequency:3,waveAmplitude:.3},u:{opacity:.45}},
      "Soft clouds (old)":{c:{ditherMode:"bayer",pixelSize:3,colorNum:4,contrast:1,brightness:-.05,scale:1,waveFrequency:3,waveAmplitude:.3},u:{opacity:.3}}
    };
    var G=[
      ["Pattern",[
        {k:"ditherMode",t:"sel",o:["bayer","bayer4","bayer2","halftone","lines","crosshatch","noise","none"]},
        {k:"pixelSize",t:"r",min:1,max:16,step:1},
        {k:"colorNum",t:"r",min:2,max:8,step:1}]],
      ["Wave",[
        {k:"waveSpeed",t:"r",min:0,max:1,step:.005},
        {k:"waveFrequency",t:"r",min:.5,max:8,step:.05},
        {k:"waveAmplitude",t:"r",min:0,max:1,step:.01},
        {k:"scale",t:"r",min:.1,max:4,step:.05},
        {k:"contrast",t:"r",min:0,max:4,step:.05},
        {k:"brightness",t:"r",min:-1,max:1,step:.01}]],
      ["Colour",[
        {k:"waveColor",t:"col"},
        {k:"bgT",u:1,l:"transparent bg",t:"chk"},
        {k:"bgC",u:1,l:"bg colour",t:"col"},
        {k:"pal",u:1,l:"palette (#hex, #hex…)",t:"txt"},
        {k:"opacity",u:1,t:"r",min:0,max:1,step:.01},
        {k:"blend",u:1,t:"sel",o:["normal","multiply","screen","overlay","soft-light","hard-light","difference","exclusion","lighten","darken","color-dodge","luminosity"]}]],
      ["Mouse",[
        {k:"enableMouseInteraction",t:"chk"},
        {k:"mouseEffect",t:"sel",o:["erase","reveal","ripple"]},
        {k:"mouseRadius",t:"r",min:.05,max:1.5,step:.01},
        {k:"mouseStrength",t:"r",min:0,max:3,step:.05},
        {k:"trail",t:"r",min:0,max:1,step:.01},
        {k:"clickRipple",t:"chk"}]],
      ["Motion",[
        {k:"disableAnimation",t:"chk"},
        {k:"intro",t:"chk"}]]
    ];
    var root=document.createElement("div");root.id="dpanel";root.className="off";
    root.innerHTML='<div class="dh"><b>Dither settings</b><span>temp</span></div><div class="dn">Shown on the language + Start screens</div><div class="dp"></div><div class="db"></div><div class="dg"></div><textarea class="do" readonly rows="6"></textarea><div class="db"><button data-a="copy">Copy settings</button><button data-a="replay">Replay intro</button><button data-a="reset">Reset</button><button data-a="diag">Asset check</button></div><textarea class="do dd" readonly rows="14" style="display:none"></textarea>';
        document.body.appendChild(root);
    var syncs=[],out=root.querySelector(".do");
    function src(f){return f.u?ui:cur}
    G.forEach(function(g){
      var h=document.createElement("div");h.className="dt";h.textContent=g[0];root.querySelector(".dg").appendChild(h);
      g[1].forEach(function(f){
        var row=document.createElement("label");row.className="dr";var l=document.createElement("span");l.className="dl";l.textContent=f.l||f.k;row.appendChild(l);
        var el,val=document.createElement("em");
        if(f.t==="sel"){el=document.createElement("select");f.o.forEach(function(o){var op=document.createElement("option");op.value=op.textContent=o;el.appendChild(op)})}
        else{el=document.createElement("input");el.type=f.t==="r"?"range":f.t==="col"?"color":f.t==="chk"?"checkbox":"text";if(f.t==="r"){el.min=f.min;el.max=f.max;el.step=f.step}if(f.t==="txt")el.placeholder="#121a22, #7E955B, #F4EED7"}
        function read(){var v=f.t==="chk"?el.checked:f.t==="r"?+el.value:el.value;src(f)[f.k]=v;val.textContent=f.t==="r"?(+v).toFixed(f.step<.01?3:f.step<1?2:0):"";apply()}
        function sync(){var v=src(f)[f.k];if(f.t==="chk")el.checked=!!v;else el.value=Array.isArray(v)?"#ffffff":v;if(f.t==="r")val.textContent=(+v).toFixed(f.step<.01?3:f.step<1?2:0)}
        el.addEventListener(f.t==="sel"||f.t==="chk"?"change":"input",read);
        syncs.push(sync);row.appendChild(el);row.appendChild(val);root.querySelector(".dg").appendChild(row);
      });
    });
    var pp=root.querySelector(".db");
    Object.keys(PRESETS).forEach(function(n){var b=document.createElement("button");b.textContent=n;b.onclick=function(){Object.assign(cur,PRESETS[n].c);Object.assign(ui,PRESETS[n].u);syncAll();apply()};pp.appendChild(b)});
    function opts(){var o=Object.assign({},cur);o.backgroundColor=ui.bgT?"transparent":ui.bgC;o.palette=ui.pal.split(/[\s,]+/).filter(function(c){return /^#[0-9a-f]{3,8}$/i.test(c)});return o}
    function apply(){
      var o=opts();["intro","start"].forEach(function(id){if(DITH[id])DITH[id].update(o)});
      var s=document.documentElement.style;s.setProperty("--dop",ui.opacity);s.setProperty("--dblend",ui.blend);
      var j=Object.assign({},o);j.canvasOpacity=ui.opacity;j.canvasBlend=ui.blend;out.value=JSON.stringify(j,null,1);
    }
    function syncAll(){syncs.forEach(function(f){f()})}
    function rebuild(){var o=opts();["intro","start"].forEach(function(id){var box=$(id==="intro"?"dth":"dth2");if(DITH[id])DITH[id].destroy();box.innerHTML="";DITH[id]=new Dither(box,Object.assign({active:current===id},o))})}
    async function runDiag(btn){
      var dd=root.querySelector(".dd"),L=[];dd.style.display="block";dd.value="running...";
      var abs=function(u){try{return new URL(u,location.href).href}catch(e){return u}};
      L.push("PAGE  "+location.href);
      L.push("secure context: "+isSecureContext+" | online: "+navigator.onLine);
      L.push("UA    "+navigator.userAgent.slice(0,90));
      try{await Promise.race([document.fonts.ready,sleep(4000)])}catch(e){}
      var ff=[];document.fonts.forEach(function(f){ff.push("  "+f.family+" "+f.weight+" -> "+f.status)});
      L.push("FONT FACES ("+ff.length+")"+(ff.length?"":"  <- none registered: the Google Fonts / Font Awesome CSS did not load"));
      L=L.concat(ff.slice(0,14));
      [].forEach.call(document.querySelectorAll("link[rel=stylesheet]"),function(l){L.push("CSS "+(l.sheet?"loaded ":"MISSING")+" "+l.href.slice(0,95))});
      L.push("QR library (qrcode): "+(typeof qrcode));
      L.push("");L.push("BLOCKED / FAILED while loading:");
      (window.__v||[]).forEach(function(x){L.push("  "+x.slice(0,140))});if(!(window.__v||[]).length)L.push("  (nothing recorded)");
      L.push("");L.push("IMAGE FILES (fetch + decode):");
      var tests=[["background",BGS[0]],["sticker",CATS[0].items[0]],["illustration",ROOT+"illustrations/"+SPRP[0]],["icon","icons/favicon-32.png"]];
      for(var i=0;i<tests.length;i++){
        var u=U(tests[i][1]),line="  "+tests[i][0]+": "+abs(u).slice(-70);
        try{
          var r=await fetch(u,{cache:"no-store"}),b=await r.blob();
          line+="\n     HTTP "+r.status+" | "+(r.headers.get("content-type")||"no type")+" | "+b.size+" bytes"+(r.redirected?" | REDIRECTED to "+r.url.slice(-50):"");
          if(r.ok&&/text\/html/i.test(r.headers.get("content-type")||""))line+="\n     !! server returned an HTML page instead of the image (missing file / rewrite rule / hotlink protection)";
        }catch(err){line+="\n     fetch failed: "+err.message}
        try{var im=await loadImg(u);line+="\n     decoded "+im.naturalWidth+"x"+im.naturalHeight}catch(err){line+="\n     !! browser could not decode it as an image"}
        L.push(line);
      }
      var bad=[];try{performance.getEntriesByType("resource").forEach(function(r){if(r.responseStatus>=400)bad.push("  "+r.responseStatus+" "+r.name.slice(-90))})}catch(e){}
      L.push("");L.push("HTTP errors seen by the browser ("+bad.length+"):");L=L.concat(bad.slice(0,12));
      dd.value=L.join("\n");dd.scrollTop=0;
      dd.select();var done=function(){btn.textContent="Asset check (copied)"};try{navigator.clipboard.writeText(dd.value).then(done,function(){try{document.execCommand("copy")&&done()}catch(_){}})}catch(_){try{document.execCommand("copy")&&done()}catch(__){}}
    }
    root.addEventListener("click",function(e){
      var a=e.target.dataset&&e.target.dataset.a;if(!a)return;
      if(a==="diag"){runDiag(e.target);return}
      if(a==="replay")rebuild();
      if(a==="reset"){Object.assign(cur,DOPT);Object.assign(ui,{opacity:.49,blend:"soft-light",bgT:true,bgC:"#121a22",pal:""});syncAll();apply();rebuild()}
      if(a==="copy"){out.select();try{navigator.clipboard.writeText(out.value)}catch(_){try{document.execCommand("copy")}catch(__){}}e.target.textContent="Copied";setTimeout(function(){e.target.textContent="Copy settings"},1200)}
    });
    ["pointerdown","pointermove","pointerup","touchstart","wheel","keydown"].forEach(function(ev){root.addEventListener(ev,function(e){e.stopPropagation()},{passive:true})});
    function toggle(){root.classList.toggle("off")}
    var ct=0,cl=0; // two quick taps in the top-left corner show / hide the panel
    addEventListener("pointerdown",function(e){if(e.clientX>70||e.clientY>70){ct=0;return}var n=Date.now();ct=n-cl<700?ct+1:1;cl=n;if(ct>=2){ct=0;toggle()}},true);
    syncAll();apply();
  })();
  var b55=0;
  function swap55(){var im=$("big55");im.classList.remove("pop");void im.offsetWidth;im.src=markURI(b55++%4,sessMark);im.classList.add("pop")}
  swap55();setInterval(function(){if(current==="intro")swap55()},2600);
  Array.prototype.forEach.call(document.querySelectorAll(".lang"),function(b){b.onclick=function(e){setLang(b.dataset.l);if(!stream)warmCam();show("start",e)}});
  $("intro").addEventListener("pointermove",function(e){
    var r=this.getBoundingClientRect();
    $("stage").style.setProperty("--mx",((e.clientX-r.left)/r.width-.5).toFixed(3));
    $("stage").style.setProperty("--my",((e.clientY-r.top)/r.height-.5).toFixed(3));
  });

  /* ---- stickers ---- */

  /* ---- language: one language at a time ---- */
  var LANG="en",TX={
    en:{mbg:"Background",mlogo:"Logo",m55:"55",mstk:"Stickers",cleared:"Cleared",limit:"Sticker limit reached",saved:"Saved",s1:"Pose",s2:"Decorate",s3:"Scan",start:"Start",pick:"Take photo instead",ready:"GET READY",retake:"Retake",clear:"Clear",done:"Done",save:"Save",scan:"SCAN TO DOWNLOAD",prep:"Preparing…",qrfail:"QR unavailable",usesave:"Use Save to download the photo",na:"Unavailable",saving:"Saving…",savefail:"Could not save the photo. Try again.",cam:"Camera blocked. Allow camera access, or open this page in its own browser tab.",deg:"Stickers are not included in this copy"},
    ar:{mbg:"الخلفية",mlogo:"الشعار",m55:"55",mstk:"ملصقات",cleared:"تم المسح",limit:"بلغت الحد الأقصى للملصقات",saved:"تم الحفظ",s1:"التقط",s2:"زيّن",s3:"امسح",start:"ابدأ",pick:"التقط صورة بدلاً من ذلك",ready:"استعدّ",retake:"إعادة",clear:"مسح",done:"تم",save:"حفظ",scan:"امسح للتحميل",prep:"جارٍ التحضير…",qrfail:"تعذّر إنشاء الرمز",usesave:"استخدم زر حفظ لتنزيل الصورة",na:"غير متاح",saving:"جارٍ الحفظ…",savefail:"تعذّر حفظ الصورة. حاول مرة أخرى.",cam:"الكاميرا محظورة. اسمح بالوصول إلى الكاميرا أو افتح الصفحة في تبويب مستقل.",deg:"لم تُضَف الملصقات إلى هذه النسخة"}
  },CATN={en:["Frame"],ar:["الإطار","الأشخاص","العائلات","احتفال","عرض","حيوانات","نباتات","مركبات","معالم","بيوت","منشآت","حرف","حياة عصرية"]};
  var tr=function(k){return TX[LANG][k]};
  function setLang(l){
    LANG=l;var st=$("stage");st.setAttribute("lang",l);st.setAttribute("dir",l==="ar"?"rtl":"ltr");document.documentElement.lang=l;
    Array.prototype.forEach.call(st.querySelectorAll("[data-i]"),function(el){
      var v=tr(el.dataset.i);if(v==null)return;
      if(el.classList.contains("roll"))Array.prototype.forEach.call(el.querySelectorAll("b"),function(b){b.textContent=v});else el.textContent=v;
    });
    Array.prototype.forEach.call(st.querySelectorAll(".arr"),function(a){a.textContent=l==="ar"?"←":"→"});
    Array.prototype.forEach.call($("tabs").children,function(b){if(b.dataset.c==null)return;var n=l==="ar"?CATN.ar[+b.dataset.c+1]:CATS[+b.dataset.c].label;b.title=n;b.setAttribute("aria-label",n)});
    movePill();
  }
  var ex=function(s){var m=s.match(/^(.*?)(\d+)\.\.(\d+)$/);if(!m)return[s];var o=[];for(var i=+m[2];i<=+m[3];i++)o.push(m[1]+String(i).padStart(m[2].length,"0"));return o};
  var pack=function(label,dir,pre,names){return{label:label,items:[].concat.apply([],names.map(ex)).map(function(n){return ROOT+"illustrations/"+dir+"/PNG/"+pre+n+".webp"})}};
  var CATS=[
    pack("People","01_People","EE55_",["People_01..23","People_MilitaryFlag_01..04","People_Military_01..02"]),
    pack("Families","02_Families","EE55_Families_",["Emirati_01..03","SouthAsian_01..03","Western_01"]),
    pack("Celebration","04_Celebration","EE55_Celebration_",["Ayyala_01..03","Balloons_01..02","CarParade_01..02","HoldingFlag_01..04","Naashat","ParadeGirl_01..02","ParadePerson_Black","ParadePerson_Green","ParadePerson_Red","ParadePerson_White"]),
    pack("Parade","12_Parade","EE55_Parade_",["Camel","Child01..03","Horse01..02","Kite01..04","Puppets"]),
    pack("Fauna","06_Fauna","EE55_Fauna_",["Camel_01..02","Cat_01..02","Falcon_01..02","Flamingo_01..02","Fox_01..02","Gazelle","Horse-B","Peacock","Pigeon_01..02"]),
    pack("Flora","05_Flora","EE55_Flora_",["Ghaff-Tree_01..02","Jahanamiyah","Palm-Tree_01"]),
    pack("Vehicles","09_Vehicles","EE55_Vehicles_",["Delivery-Bike_01..02","Delivery-Truck_01..02","Dhow_01..02","Firefighter","Flying-Jet","Helicopter","Mercedes","New-Taxi","Old-Taxi","Patrol_01..02","Police_01..02","Toyota-Pickup"]),
    pack("Landmarks","08_Monuments & Landmarks","EE55_Monuments_Landmarks_",["AbuDhabi","Ajman","Dubai","Fujairah","RasAlKhaimah","UmmAlQuwain"]),
    pack("Houses","07_Houses","EE55_Houses_",["ModernHouse_01..02","ShaabiHouse"]),
    pack("Structures","11_Structures","EE55_Buildings&Structures_",["Bridge","Park-Playground_01..02","Street-Post-Banner_01","Street-Post-Light_01..03"]),
    pack("Crafts","03_Arts & Crafts","EE55_Arts&Crafts_",["Khoos-Weaver","Net-Weaver","Pearl-Shelling","Pottery","Talli"]),
    pack("Modern","10_Modern Scenarios","EE55_Scenarios_",["DesertCamping_01..02","Majlis"])
  ];
  var FCOLS=PAL,mode="stk",catI=0,order=[],frame=null,cseq=0,photoC=null;
  var RM=!!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches);
  var LCOLS=PAL.concat(["#C8102E","#00843D","#121a22"]);
  LCOLS=LCOLS.filter(function(c){return contrast(c,"#ffffff")>=2.6}).concat(LCOLS.filter(function(c){return contrast(c,"#ffffff")<2.6})); // legible with white type first
  var IC=["user-group","people-roof","champagne-glasses","flag","paw","leaf","car","landmark","house","building","palette","campground"];
  function enter(p){ // staggered entrance for freshly built pickers
    if(RM||!p.firstChild||!p.firstChild.animate)return;
    Array.prototype.forEach.call(p.children,function(n,i){n.animate([{opacity:0,transform:"translateY(1.6vh) scale(.88)"},{opacity:1,transform:"none"}],{duration:520,delay:Math.min(i,14)*32,easing:"cubic-bezier(.16,1,.3,1)",fill:"backwards"})});
  }
  function shake(el){if(RM||!el.animate)return;el.animate([{transform:"translateX(0)"},{transform:"translateX(-1.2vh)"},{transform:"translateX(1.2vh)"},{transform:"translateX(-.8vh)"},{transform:"translateX(.5vh)"},{transform:"translateX(0)"}],{duration:420,easing:"ease-out"})}
  var toastT;
  function toast(text,ic,sticky){
    var t=$("toast");clearTimeout(toastT);
    t.querySelector("i").className="fa-solid fa-"+({check:"check",x:"xmark",info:"circle-info",spin:"circle-notch fa-spin"}[ic]||"check");
    t.querySelector("span").textContent=text;t.dataset.k=ic;t.classList.add("show");
    if(!sticky)toastT=setTimeout(hideToast,1900);
  }
  function hideToast(){clearTimeout(toastT);$("toast").classList.remove("show")}
  function movePill(){}
  addEventListener("resize",movePill);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(movePill);
  function setTab(){Array.prototype.forEach.call($("tabs").children,function(b){var on=mode==="stk"?(b.dataset.c!=null&&+b.dataset.c===catI):b.dataset.m===mode;b.classList.toggle("on",on)})}
  function buildTabs(){ // one tab bar: Background, Logo, then sticker categories in a fresh random order
    var t=$("tabs");t.innerHTML="";t.scrollLeft=0;order=shuf(CATS.map(function(_,i){return i}));CATS.forEach(function(c){c.mix=shuf(c.items)});
    [["bg","image","mbg"],["logo","fill-drip","mlogo"],["mark","stamp","m55"]].forEach(function(m){var b=document.createElement("button");b.className="t";b.dataset.m=m[0];b.innerHTML='<i class="fa-solid fa-'+m[1]+'"></i><span data-i="'+m[2]+'"></span>';b.onclick=function(){setMode(m[0])};t.appendChild(b)});
    var dv=document.createElement("i");dv.className="dv";t.appendChild(dv);
    order.forEach(function(i){var b=document.createElement("button");b.dataset.c=i;b.innerHTML='<i class="fa-solid fa-'+IC[i]+'"></i>';b.onclick=function(){setMode("stk",i)};t.appendChild(b)});
    setLang(LANG);enter(t);
  }
  function pickCat(i){
    catI=i;setTab();var p=$("picker");p.innerHTML="";p.scrollLeft=0;
    (CATS[i].mix||CATS[i].items).forEach(function(src){var im=document.createElement("img");im.loading="lazy";im.decoding="async";im.draggable=false;im.alt="";im.src=U(src);im.onclick=function(){im.classList.remove("tp");void im.offsetWidth;im.classList.add("tp");addSticker(src)};p.appendChild(im)});
    enter(p);
  }
  function pickFrame(){
    var p=$("picker");p.innerHTML="";p.scrollLeft=0;
    BGS.forEach(function(s){var im=document.createElement("img");im.className="sw";im.loading="lazy";im.decoding="async";im.draggable=false;im.alt="";im.src=U(s);im.dataset.k="b"+s;im.onclick=function(){setFrame({type:"bg",src:s})};p.appendChild(im)});
    FCOLS.forEach(function(c){var d=document.createElement("div");d.className="sw";d.style.background=c;d.dataset.k="c"+c;d.onclick=function(){setFrame({type:"color",color:c})};p.appendChild(d)});
    markFrame();enter(p);
  }
  function pickLogo(){
    var p=$("picker");p.innerHTML="";p.scrollLeft=0;
    LCOLS.forEach(function(c){var d=document.createElement("div");d.className="sw lc";d.style.background=c;d.dataset.k="l"+c;d.onclick=function(){setLogo(c)};p.appendChild(d)});
    markFrame();enter(p);
  }
  function pickMark(){
    var p=$("picker");p.innerHTML="";p.scrollLeft=0;
    COLS.filter(function(c){return contrast(c,"#ffffff")>=1.5}).forEach(function(c){var d=document.createElement("div");d.className="sw lc";d.style.background=c;d.dataset.k="m"+c;d.onclick=function(){setMark(c)};p.appendChild(d)});
    markFrame();enter(p);
  }
  function setMark(c){ // the 55 on the photo strip and the 55 marks on every screen take the chosen colour
    markCol=c;sessMark=c;saveSess();
    Array.prototype.forEach.call(document.querySelectorAll(".mark"),function(m){m.src=markURI(+m.dataset.i||0,c)});
    ready();markFrame();compose();
  }
  function markFrame(){
    Array.prototype.forEach.call($("picker").querySelectorAll(".sw"),function(n){
      var k=n.dataset.k,on=false;
      if(mode==="bg"){on=!!frame&&k===(frame.type==="color"?"c"+frame.color:"b"+frame.src);if(k.charAt(0)==="c")n.classList.toggle("dis",k.slice(1)===panelCol)}
      else if(mode==="mark")on=k==="m"+curMark;
      else if(mode==="logo"){on=k==="l"+panelCol;n.classList.toggle("dis",!!frame&&frame.type==="color"&&frame.color===k.slice(1))}
      n.classList.toggle("on",on);
    });
  }
  function setMode(m,ci){
    mode=m;if(ci!=null)catI=ci;setTab();
    if(m==="bg")pickFrame();else if(m==="logo")pickLogo();else if(m==="mark")pickMark();else pickCat(catI);
  }
  function ready(){$("edone").classList.add("cta")}
  function setFrame(f){if(f.type==="color"&&f.color===panelCol)return;frame=f;ready();resBg=f.type==="bg"?f.src:rnd(BGS);markFrame();compose()}
  function setLogo(c){if(frame&&frame.type==="color"&&frame.color===c)return;panelCol=c;ready();markFrame();compose()}
  function setBase(url){ // crossfade between compositions
    var cur=$("base"),old=null,pre=new Image();
    pre.onload=pre.onerror=function(){
      if(cur.getAttribute("src")&&!RM&&cur.animate){old=cur.cloneNode();old.removeAttribute("id");old.className="oldbase";cur.parentNode.insertBefore(old,$("layer"))}
      cur.src=url;
      if(old)old.animate([{opacity:1},{opacity:0}],{duration:520,easing:"ease",fill:"forwards"}).onfinish=function(){old.remove()};
    };
    pre.src=url;
  }

  function dragScroll(el){ // mouse/pen drag-to-scroll (touch scrolls natively)
    var d=null,moved=false;
    el.addEventListener("pointerdown",function(e){if(e.pointerType==="touch")return;d={x:e.clientX,s:el.scrollLeft};moved=false});
    el.addEventListener("pointermove",function(e){if(!d)return;var dx=e.clientX-d.x;if(!moved&&Math.abs(dx)>6){moved=true;el.setPointerCapture(e.pointerId)}if(moved)el.scrollLeft=d.s-dx});
    el.addEventListener("pointerup",function(){d=null});el.addEventListener("pointercancel",function(){d=null});
    el.addEventListener("click",function(e){if(moved){e.stopPropagation();e.preventDefault();moved=false}},true);
    el.addEventListener("wheel",function(e){if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){el.scrollLeft+=e.deltaY;e.preventDefault()}},{passive:false});
  }
  dragScroll($("tabs"));dragScroll($("picker"));
  document.addEventListener("dragstart",function(e){e.preventDefault()});

  // trim transparent padding so the selection box hugs the artwork
  var stkCache={};
  async function prep(src){
    if(stkCache[src])return stkCache[src];
    var im=await loadImg(U(src)),sw=im.naturalWidth,sh=im.naturalHeight,cx=0,cy=0,cw=sw,ch=sh;
    try{
      var k=Math.min(1,160/Math.max(sw,sh)),sc=document.createElement("canvas");sc.width=Math.max(1,Math.round(sw*k));sc.height=Math.max(1,Math.round(sh*k));
      var sx=sc.getContext("2d");sx.drawImage(im,0,0,sc.width,sc.height);
      var d=sx.getImageData(0,0,sc.width,sc.height).data,x0=sc.width,y0=sc.height,x1=-1,y1=-1;
      for(var y=0;y<sc.height;y++)for(var x=0;x<sc.width;x++)if(d[(y*sc.width+x)*4+3]>10){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
      if(x1>=0){x0=Math.max(0,x0-2);y0=Math.max(0,y0-2);x1=Math.min(sc.width-1,x1+2);y1=Math.min(sc.height-1,y1+2);cx=x0/k;cy=y0/k;cw=(x1-x0+1)/k;ch=(y1-y0+1)/k}
    }catch(e){}
    var f=Math.min(1,800/Math.max(cw,ch)),cv=document.createElement("canvas");cv.width=Math.round(cw*f);cv.height=Math.round(ch*f);
    cv.getContext("2d").drawImage(im,cx,cy,cw,ch,0,0,cv.width,cv.height);
    return stkCache[src]=cv;
  }

  var layer=$("layer"),hud=$("hud"),MINW=.08,MAXW=1.4;
  function place(st){
    var s=st.el.style;s.left=st.x*100+"%";s.top=st.y*100+"%";s.width=st.w*100+"%";s.transform="translate(-50%,-50%) rotate("+st.r+"rad)";
    if(st===sel)sync();
  }
  function sync(){ // selection box lives outside the clipped layer so its handles never get cut off
    if(!sel){hud.classList.remove("on");return}
    hud.classList.add("on");var el=sel.el,b=$("sb").style;
    b.left=layer.offsetLeft+sel.x*layer.offsetWidth+"px";b.top=layer.offsetTop+sel.y*layer.offsetHeight+"px";
    b.width=el.offsetWidth+"px";b.height=el.offsetHeight+"px";b.transform="translate(-50%,-50%) rotate("+sel.r+"rad)";
  }
  function select(st){var ch=st!==sel;sel=st;sync();if(st&&ch){hud.classList.remove("pop");void hud.offsetWidth;hud.classList.add("pop")}}
  function front(st){layer.appendChild(st.el);stickers=stickers.filter(function(s){return s!==st});stickers.push(st)}
  function mount(cv,o){
    var d=document.createElement("div");d.className="stk";var c2=document.createElement("canvas");c2.width=cv.width;c2.height=cv.height;c2.getContext("2d").drawImage(cv,0,0);d.appendChild(c2);
    var ratio=cv.height/cv.width,st={el:d,cv:cv,x:.5+(Math.random()-.5)*.2,y:.5+(Math.random()-.5)*.2,w:Math.min(.5,.42/Math.sqrt(Math.max(ratio,.6))),r:0};
    if(o)for(var k in o)st[k]=o[k];
    d._st=st;d.classList.add("new");setTimeout(function(){d.classList.remove("new")},600);layer.appendChild(d);stickers.push(st);place(st);ready();
    var bu=document.createElement("i");bu.className="pburst";bu.style.left=st.x*100+"%";bu.style.top=st.y*100+"%";layer.appendChild(bu);setTimeout(function(){bu.remove()},750);
    return st;
  }
  async function addSticker(src){
    if(stickers.length>=14){toast(tr("limit"),"info");shake($("editor"));return}
    var cv;try{cv=await prep(src)}catch(e){return}
    select(mount(cv));
  }
  function removeSel(){if(!sel)return;var st=sel;stickers=stickers.filter(function(s){return s!==st});select(null);st.el.classList.add("gone");setTimeout(function(){st.el.remove()},340)}
  function clearStickers(anim){var a=stickers;stickers=[];select(null);a.forEach(function(s,i){if(anim===true&&!RM){s.el.style.animationDelay=i*40+"ms";s.el.classList.add("gone");setTimeout(function(){s.el.remove()},380+i*40)}else s.el.remove()})}
  // pressing anywhere outside a sticker hides its controls
  $("edit").addEventListener("pointerdown",function(e){if(!sel)return;if(e.target.closest&&e.target.closest(".stk,.hd"))return;select(null)});

  // gestures: drag = move, two fingers = resize + rotate, wheel = resize (shift/alt = rotate), tap a selected sticker again = pick the one beneath
  var ptrs={},g=null,tap=null;
  function begin(){
    var ids=Object.keys(ptrs);g=null;if(!sel)return;var r=layer.getBoundingClientRect();
    if(ids.length===1){var p=ptrs[ids[0]];g={t:"drag",ox:(p.x-r.left)/r.width-sel.x,oy:(p.y-r.top)/r.height-sel.y}}
    else if(ids.length>1){var a=ptrs[ids[0]],b=ptrs[ids[1]];g={t:"pinch",d:Math.hypot(b.x-a.x,b.y-a.y)||1,an:Math.atan2(b.y-a.y,b.x-a.x),w:sel.w,r:sel.r}}
  }
  layer.addEventListener("pointerdown",function(e){
    e.preventDefault();layer.setPointerCapture(e.pointerId);ptrs[e.pointerId]={x:e.clientX,y:e.clientY};
    if(Object.keys(ptrs).length===1){
      var st=e.target._st||null;tap={x:e.clientX,y:e.clientY,moved:false,st:st,was:!!st&&st===sel};
      if(st){front(st);select(st)}else select(null);
    }
    begin();
  });
  layer.addEventListener("pointermove",function(e){
    if(!ptrs[e.pointerId])return;ptrs[e.pointerId]={x:e.clientX,y:e.clientY};
    if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>8)tap.moved=true;
    if(!g||!sel)return;var ids=Object.keys(ptrs),r=layer.getBoundingClientRect();
    if(g.t==="drag"&&ids.length===1){sel.x=clamp((e.clientX-r.left)/r.width-g.ox,0,1);sel.y=clamp((e.clientY-r.top)/r.height-g.oy,0,1);place(sel)}
    else if(g.t==="pinch"&&ids.length>1){
      var a=ptrs[ids[0]],b=ptrs[ids[1]];
      sel.w=clamp(g.w*Math.hypot(b.x-a.x,b.y-a.y)/g.d,MINW,MAXW);sel.r=g.r+Math.atan2(b.y-a.y,b.x-a.x)-g.an;place(sel);
    }
  });
  function lift(e){
    if(!ptrs[e.pointerId])return;delete ptrs[e.pointerId];
    if(!Object.keys(ptrs).length){
      if(tap&&!tap.moved&&tap.was){ // switch to the next sticker under the finger
        var hit=document.elementsFromPoint(tap.x,tap.y).filter(function(n){return n._st}).map(function(n){return n._st});
        if(hit.length>1){var nx=hit[(hit.indexOf(sel)+1)%hit.length];front(nx);select(nx)}
      }
      tap=null;g=null;
    }else begin();
  }
  layer.addEventListener("pointerup",lift);layer.addEventListener("pointercancel",lift);
  layer.addEventListener("wheel",function(e){
    if(!sel)return;e.preventDefault();
    if(e.shiftKey||e.altKey)sel.r+=e.deltaY*.003;else sel.w=clamp(sel.w*(e.deltaY<0?1.07:1/1.07),MINW,MAXW);
    place(sel);
  },{passive:false});
  // corner handle: drag to resize and rotate; x handle removes
  $("rs").addEventListener("pointerdown",function(e){
    if(!sel)return;e.preventDefault();e.stopPropagation();var h=this,st=sel;h.setPointerCapture(e.pointerId);
    var r=layer.getBoundingClientRect(),cx=r.left+st.x*r.width,cy=r.top+st.y*r.height;
    var d0=Math.hypot(e.clientX-cx,e.clientY-cy)||1,a0=Math.atan2(e.clientY-cy,e.clientX-cx),w0=st.w,r0=st.r;
    function mv(ev){st.w=clamp(w0*Math.hypot(ev.clientX-cx,ev.clientY-cy)/d0,MINW,MAXW);st.r=r0+Math.atan2(ev.clientY-cy,ev.clientX-cx)-a0;place(st)}
    function up(){h.removeEventListener("pointermove",mv);h.removeEventListener("pointerup",up)}
    h.addEventListener("pointermove",mv);h.addEventListener("pointerup",up);
  });
  $("dl").addEventListener("pointerdown",function(e){e.preventDefault();e.stopPropagation();removeSel()});

  $("clear").onclick=function(){if(stickers.length){clearStickers(true);toast(tr("cleared"),"check")}};
  $("eretake").onclick=function(e){clearStickers();run(e)};

  async function openEdit(){
    clearStickers();$("edone").classList.remove("cta");hideToast();
    buildTabs();catI=order[0];setMode("stk");
    var p=show("edit");await p;
  }
  $("edone").onclick=async function(e){
    if(busy)return;busy=true;degraded=false;select(null);toast(tr("saving"),"spin",true);
    try{await composeP}catch(_){}
    var c=document.createElement("canvas");c.width=W;c.height=H;var x=c.getContext("2d");var ft=frameTaint?"image/png":"image/jpeg";if(!frameTaint){x.fillStyle=frame.type==="color"?frame.color:T.bg;x.fillRect(0,0,W,H)}x.drawImage(baseC,0,0);
    var rx=M,ry=M,rw=W-2*M,rh=H-M-BAND;
    try{ // stickers are clipped to the photo area, the frame stays clean
      x.save();x.beginPath();x.rect(rx,ry,rw,rh);x.clip();
      for(var i=0;i<stickers.length;i++){
        var st=stickers[i],w=st.w*rw,h=w*st.cv.height/st.cv.width;
        x.save();x.translate(rx+st.x*rw,ry+st.y*rh);x.rotate(st.r);x.drawImage(st.cv,-w/2,-h/2,w,h);x.restore();
      }
      x.restore();blob=await toBlob(c,ft);if(!blob)throw 0;
    }catch(err){ // canvas tainted (page opened from file://): save the photo without stickers instead of failing
      try{blob=await toBlob(baseC,ft);degraded=stickers.length>0}catch(e2){blob=null}
    }
    if(!blob){toast(tr("savefail"),"x");busy=false;return}
    if(photoURL)URL.revokeObjectURL(photoURL);
    photoURL=URL.createObjectURL(blob);$("photo").src=photoURL;$("save").href=photoURL;$("save").download=frameTaint?"eid-al-etihad-photo.png":"eid-al-etihad-photo.jpg";$("pwrap").style.background=(frameTaint&&frame.type==="bg")?'url("'+U(frame.src)+'") center/cover no-repeat':"";
    hideToast();
    var pl=$("player");pl.innerHTML="";
    if(degraded)stickers.forEach(function(st){var d=document.createElement("div");d.className="stk";d.style.cssText=st.el.style.cssText;var c2=document.createElement("canvas");c2.width=st.cv.width;c2.height=st.cv.height;c2.getContext("2d").drawImage(st.cv,0,0);d.appendChild(c2);pl.appendChild(d)});
    $("save").style.display=degraded?"none":"";
    try{await finish(e)}finally{busy=false}
  };

  // official horizontal lock-up, embedded as a data URI so the canvas is never tainted
  var logoRaw=atob(window.LOGO_H.split(",")[1]).replace(/#121a22/gi,"none");
  var logoH=new Image(),logoK=new Image(); // white type / ink type for light panels
  var logoReady=Promise.all([logoH,logoK].map(function(i){return new Promise(function(r){i.onload=r;i.onerror=r})}));
  logoH.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(logoRaw);
  logoK.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(logoRaw.replace(/(\.cls-1\s*\{\s*fill:\s*)#fff/i,"$1#121a22"));

  // buttons: duplicate label for the roll, cursor-aware fill, magnetic pull
  document.querySelectorAll(".btn").forEach(function(b){
    var l=b.querySelector(".lbl");
    if(l){var t=l.textContent;l.className="roll";l.innerHTML="<b>"+t+"</b><b aria-hidden=\"true\">"+t+"</b>"}
    b.addEventListener("pointerenter",function(e){if(e.pointerType!=="mouse")return;var r=b.getBoundingClientRect();
      b.style.setProperty("--px",(e.clientX-r.left)+"px");b.style.setProperty("--py",(e.clientY-r.top)+"px");b.classList.add("hot")});
    b.addEventListener("pointerleave",function(){b.classList.remove("hot")});
    b.addEventListener("pointerdown",function(e){if(e.pointerType!=="mouse")b.classList.remove("hot")});
  });

  // transition: the incoming screen opens as a circle from the tap point
  function show(id,ev,o){
    var st=$("stage"),r=st.getBoundingClientRect(),to=$(id),from=$(current),fx=o&&o.kind==="fx",dur=fx?900:1150;
    if(to===from)return Promise.resolve();
    if(id!=="cam")decorate(to,id==="res"?resBg:null,id==="res"&&frame&&frame.type==="color"?frame.color:null);
    var cx=ev&&ev.clientX!=null?ev.clientX-r.left:r.width/2,cy=ev&&ev.clientY!=null?ev.clientY-r.top:r.height/2;
    to.style.setProperty("--cx",cx+"px");to.style.setProperty("--cy",cy+"px");
    if(fx){to.classList.add("fx");from.classList.add("fx")}
    var fid=current;dithOn(id,true);to.classList.add("on","enter");from.classList.add("out");current=id;
    return sleep(dur).then(function(){
      from.classList.remove("on","out","fx");to.classList.remove("enter","fx");if(fid!==current)dithOn(fid,false);
    });
  }

  $("start").addEventListener("pointermove",function(e){
    var r=this.getBoundingClientRect();
    $("stage").style.setProperty("--mx",((e.clientX-r.left)/r.width-.5).toFixed(3));
    $("stage").style.setProperty("--my",((e.clientY-r.top)/r.height-.5).toFixed(3));
  });

  var camP=null;
  function openCam(){
    if(stream)return Promise.resolve();
    return camP||(camP=(async function(){
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1080},height:{ideal:1920}},audio:false});
      $("v").srcObject=stream;
      await $("v").play().catch(function(){});
    })().catch(function(e){camP=null;throw e}));
  }
  function warmCam(){try{openCam().catch(function(){})}catch(e){}} // ask for the camera as soon as the page opens

  async function run(ev){
    if(busy)return;busy=true;clearTimeout(idle);stopConfetti();
    try{await openCam()}catch(e){
      $("err").textContent="Camera blocked. Allow camera access, or open this page in its own browser tab.";
      $("pick").hidden=false;busy=false;return;
    }
    var p=show("cam",ev);
    await sleep(800);
    $("hint").textContent=tr("ready");
    await sleep(1500);
    $("hint").textContent="";
    var bar=$("bar");bar.classList.remove("run");void bar.offsetWidth;bar.classList.add("run");
    for(var n=3;n>=1;n--){
      var c=$("num");c.textContent=n;c.classList.remove("tick");void c.offsetWidth;c.classList.add("tick");var rg=$("ring");rg.classList.remove("go");void rg.offsetWidth;rg.classList.add("go");
      await sleep(1000);
    }
    $("num").textContent="";bar.classList.remove("run");
    $("flash").classList.remove("go");void $("flash").offsetWidth;$("flash").classList.add("go");var vv=$("v");vv.classList.remove("shot");void vv.offsetWidth;vv.classList.add("shot");
    await capture();
    await p;
    await openEdit();
    busy=false;
  }

  function land(){ // photo has settled: shine sweep, confirmation badge, haptic
    if(current!=="res")return;
    var pw=$("pwrap");
    pw.classList.remove("shine");void pw.offsetWidth;pw.classList.add("shine");
    setTimeout(function(){pw.classList.remove("hit");void pw.offsetWidth;pw.classList.add("hit")},280);
    if(navigator.vibrate)try{navigator.vibrate(30)}catch(e){}
  }
  async function finish(ev){ // the edited photo flies from the editor to its place on the result screen
    var pw=$("pwrap"),er=$("editor").getBoundingClientRect();
    var p=show("res",ev,{kind:"fx"});publish();
    var pr=pw.getBoundingClientRect();
    if(pw.animate&&!RM&&pr.width){
      var k=er.width/pr.width,dx=er.left-pr.left,dy=er.top-pr.top;
      pw.animate([{transformOrigin:"0 0",transform:"translate("+dx+"px,"+dy+"px) scale("+k+")"},{transformOrigin:"0 0",transform:"translate(0,0) scale(1)"}],{duration:1100,delay:150,easing:"cubic-bezier(.22,1.2,.36,1)",fill:"backwards"});
    }
    setTimeout(land,1250);setTimeout(confetti,1300);
    await p;
  }

  async function capture(src){
    var v=src||$("v"),vw=v.videoWidth||v.naturalWidth||1280,vh=v.videoHeight||v.naturalHeight||720;
    var rw=W-2*M,rh=H-M-BAND;
    photoC=document.createElement("canvas");photoC.width=rw;photoC.height=rh;var x=photoC.getContext("2d");
    var s=Math.max(rw/vw,rh/vh),dw=vw*s,dh=vh*s;
    if(!src){x.translate(rw,0);x.scale(-1,1)}
    x.drawImage(v,(rw-dw)/2,(rh-dh)/2,dw,dh);
    resBg=sessBg;frame={type:"bg",src:resBg};panelCol=sessCol;markCol=null;markN=Math.floor(Math.random()*4);markFrame();
    $("base").removeAttribute("src");
    await compose();
  }

  var composeP=Promise.resolve(),panelCol=null,markN=0,frameTaint=false,markCol=null,curMark=null;
  function pickPanel(){ // random panel colour keeps white type legible; a colour chosen by the person is kept
    var ok=PAL.filter(function(c){return contrast(c,"#ffffff")>=2.6&&!(frame.type==="color"&&frame.color===c)});
    if(!panelCol||(frame.type==="color"&&frame.color===panelCol))panelCol=rnd(ok);return panelCol;
  }
  function photoMark(col){ // the 55 sits on white: own colour, clearly different from the logo panel
    var m=sessMark;if(cdist(m,col)>110&&contrast(m,"#ffffff")>=2)return m;
    var ok=PAL.filter(function(c){return cdist(c,col)>110&&contrast(c,"#ffffff")>=2});
    return ok.length?rnd(ok):"#121a22";
  }
  function compose(){return composeP=composeRun()}
  async function composeRun(){ // frame (colour or backgrounds artwork) + photo + two-part logo lock-up
    var my=++cseq,c=document.createElement("canvas");c.width=W;c.height=H;var x=c.getContext("2d");
    frameTaint=false;
    if(frame.type==="color"){x.fillStyle=frame.color;x.fillRect(0,0,W,H)}
    else{
      try{
        var bi=await loadImg(U(frame.src)),pc=document.createElement("canvas");pc.width=pc.height=1;
        var px=pc.getContext("2d");px.drawImage(bi,0,0,1,1);px.getImageData(0,0,1,1);
        var k=Math.max(W/bi.width,H/bi.height);x.drawImage(bi,(W-bi.width*k)/2,(H-bi.height*k)/2,bi.width*k,bi.height*k);
      }catch(e){frameTaint=true} // file:// blocks pixel export: leave the frame transparent, the editor shows the artwork behind it
    }
    var rx=M,ry=M,rw=W-2*M,rh=H-M-BAND,gap=30,ty=H-BAND+gap,th=BAND-M-gap;
    x.drawImage(photoC,rx,ry);
    var col=pickPanel(),lpw=Math.round(rw*.64),bw=6,light=contrast(col,"#ffffff")<2.6;curMark=markCol||photoMark(col);markFrame();
    x.fillStyle="#fff";x.fillRect(M,ty,rw,th);
    x.fillStyle=col;x.fillRect(M,ty,lpw,th);
    x.save();x.beginPath();x.rect(M,ty,rw,th);x.clip();x.strokeStyle=col;x.lineWidth=bw*2;x.strokeRect(M,ty,rw,th);x.restore();
    await logoReady;
    var lw=lpw*.7,lh=lw*299.78/911.61;
    x.drawImage(light?logoK:logoH,M+(lpw-lw)/2,ty+(th-lh)/2,lw,lh);
    var vb=window.MARK_SVG[markN].match(/viewBox="[\d.\s-]*?([\d.]+) ([\d.]+)"/),ar=vb[1]/vb[2],pw=rw-lpw;
    try{
      var mi=await loadImg(markURI(markN,curMark)),mw=Math.min(pw*.7,th*.62*ar),mh=mw/ar;
      x.drawImage(mi,M+lpw+(pw-mw)/2,ty+(th-mh)/2,mw,mh);
    }catch(e){}
    if(my!==cseq)return;
    baseC=c;var b=await toBlob(c,"image/png");if(my!==cseq)return;
    var oldU=baseURL;baseURL=URL.createObjectURL(b);setBase(baseURL);if(oldU)setTimeout(function(){URL.revokeObjectURL(oldU)},1500);
    $("editor").style.background=(frame.type==="bg"&&frameTaint)?'url("'+U(frame.src)+'") center/cover no-repeat':"";
  }

  async function upload(b){
    if(!CONFIG.uploadUrl)throw 0;
    var lastErr;
    for(var n=0;n<3;n++){ // never hang: 10 s per try, up to 3 tries
      var ac=new AbortController(),tm=setTimeout(function(){ac.abort()},10000);
      try{
        var r=await fetch(CONFIG.uploadUrl,{method:"POST",headers:{"Content-Type":b.type||"image/jpeg"},body:b,cache:"no-store",signal:ac.signal});
        if(!r.ok)throw new Error("HTTP "+r.status);
        var j=await r.json();if(!j||!j.url)throw new Error("no url in reply");
        clearTimeout(tm);
        return new URL(j.url,CONFIG.publicBase||location.href).href; // full public link, this is what the QR code contains
      }catch(e){clearTimeout(tm);lastErr=e;console.warn("upload try "+(n+1)+" failed:",e);await sleep(400)}
    }
    throw lastErr||0;
  }

  async function publish(){
    $("qrbox").textContent=tr("prep");$("msg").textContent="";
    if(degraded){$("qrbox").textContent=tr("na");$("msg").textContent=tr("deg");return}
    var mine=blob;
    try{
      var url=await upload(mine);if(mine!==blob)return;
      var q=qrcode(0,"M");q.addData(url);q.make();
      $("qrbox").innerHTML=q.createSvgTag({cellSize:6,margin:0,scalable:true});var qb=$("qrbox");qb.classList.remove("ok");void qb.offsetWidth;qb.classList.add("ok");
    }catch(e){
      console.error("QR/upload failed:",e);
      $("qrbox").textContent=tr("qrfail");
      $("msg").textContent=tr("usesave");
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
    ti=(ti+1)%THEMES.length;applyTheme();clearStickers();newSession();
    buildSprites();var p=show("intro",ev);
    $("qrbox").textContent=tr("prep");$("err").textContent="";warnFile();
    await p;
  }


  function navUpd(sc){var n=sc.parentNode;n.querySelector(".nav.l").classList.toggle("show",sc.scrollLeft>6);n.querySelector(".nav.r").classList.toggle("show",sc.scrollLeft+sc.clientWidth<sc.scrollWidth-6)}
  ["tabs","picker"].forEach(function(id){var sc=$(id),n=sc.parentNode;
    sc.addEventListener("scroll",function(){navUpd(sc)},{passive:true});
    n.querySelector(".nav.l").onclick=function(){sc.scrollBy({left:-sc.clientWidth*.7,behavior:"smooth"})};
    n.querySelector(".nav.r").onclick=function(){sc.scrollBy({left:sc.clientWidth*.7,behavior:"smooth"})};
  });
  setInterval(function(){if(current==="edit"){navUpd($("tabs"));navUpd($("picker"))}},400);
  function tick(){var t=$("tick");t.querySelector("img").src=markURI(markN,"#F4EED7");t.classList.remove("go");void t.offsetWidth;t.classList.add("go")}
  $("save").addEventListener("click",function(){tick();toast(tr("saved"),"check")});
  document.querySelectorAll(".btn").forEach(function(b){
    b.addEventListener("click",function(){b.classList.remove("cf");void b.offsetWidth;b.classList.add("cf")});
    b.addEventListener("animationend",function(e){if(e.animationName==="cf")b.classList.remove("cf")});
  });
  setLang("en");warmCam();
  /* ===== logo intro (~4 s): the lock-up opens, the Arabic mark is written in, the wordmark settles. Tap to skip. ===== */
  var CINE={attractMs:60000}; // replay after this much idle time on the language screen, 0 = never
  var cineOn=false;
  function svgEl(t,a,p){var e=document.createElementNS("http://www.w3.org/2000/svg",t);for(var k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
  async function playCine(){
    var st=$("stage"),root=$("cine");
    if(cineOn||!root)return;
    if(RM||!root.animate){st.classList.remove("cine");root.classList.remove("on");return}
    cineOn=true;st.classList.add("cine");root.classList.add("on");root.innerHTML="";
    var finished=false,timers=[];
    function finish(fast){
      if(finished)return;finished=true;timers.forEach(clearTimeout);
      st.classList.remove("cine");lastAct=Date.now();
      var a=root.animate([{opacity:1},{opacity:0}],{duration:fast?200:500,easing:"ease-out",fill:"forwards"});
      a.onfinish=function(){root.classList.remove("on");root.innerHTML="";a.cancel();cineOn=false};
    }
    root.onpointerdown=function(e){e.preventDefault();e.stopPropagation();finish(true)};
    try{
      await Promise.race([loadImg(U(sessBg)).catch(function(){}),sleep(2000)]);
      if(finished)return;
      var txt=contrast(sessCol,"#ffffff")<2.6?"#121a22":"#ffffff";
      var doc=new DOMParser().parseFromString(logoSVG,"image/svg+xml"),svg=document.importNode(doc.documentElement,true),od=svg.querySelector("defs");
      if(od)svg.removeChild(od);
      Array.prototype.forEach.call(svg.querySelectorAll(".cls-2"),function(p){p.style.fill=sessCol});
      Array.prototype.forEach.call(svg.querySelectorAll(".cls-1"),function(p){p.style.fill=txt});
      root.innerHTML='<div class="l-bg"></div><div class="l-cam"><div class="l-logo"><div class="l-lg"></div></div></div><div class="l-veil"></div>';
      var q=function(s){return root.querySelector(s)};
      q(".l-bg").style.backgroundImage='url("'+U(sessBg)+'")';
      q(".l-lg").appendChild(svg);
      /* Arabic mark: soft right-to-left wipe, like calligraphy being written */
      var gg=svg.querySelector("#Layer_1-2 > g"),grp=gg?gg.children:[],dateP=grp[0]?grp[0].children:[],wordP=grp[1]?grp[1].children:[],arG=grp[2];
      var uid="m"+Math.floor(Math.random()*1e6),defs=svgEl("defs",{},svg),lgr=svgEl("linearGradient",{id:uid+"g",x1:"0",y1:"0",x2:"1",y2:"0"},defs);
      [[0,"#000"],[.5,"#000"],[.6,"#fff"],[1,"#fff"]].forEach(function(s){svgEl("stop",{offset:s[0],"stop-color":s[1]},lgr)});
      var mk=svgEl("mask",{id:uid,maskUnits:"userSpaceOnUse",x:"-20",y:"-20",width:"560",height:"490"},defs);
      var rc=svgEl("rect",{x:"0",y:"-20",width:"1400",height:"490",fill:"url(#"+uid+"g)"},mk);
      if(arG)arG.setAttribute("mask","url(#"+uid+")");
      var EZ="cubic-bezier(.16,1,.3,1)",IO="cubic-bezier(.65,0,.35,1)";
      var A=function(el,kf,delay,dur,ease,x){return el.animate(kf,Object.assign({delay:delay,duration:dur,easing:ease||EZ,fill:"both"},x||{}))};
      A(q(".l-bg"),[{transform:"scale(1.08)"},{transform:"scale(1)"}],0,4000,"cubic-bezier(.2,.6,.2,1)");     // slow push-out
      A(q(".l-cam"),[{transform:"scale(1.12)"},{transform:"scale(1)"}],0,3800,"cubic-bezier(.2,.6,.2,1)");
      A(q(".l-veil"),[{opacity:1},{opacity:0}],150,1500,"ease-in-out");                                    // up from black
      A(q(".l-lg"),[{clipPath:"inset(50% 0 50% 0)"},{clipPath:"inset(0 0 0 0)"}],450,1000,IO);              // panel opens from the centre line
      if(arG)A(rc,[{transform:"translateX(0px)"},{transform:"translateX(-860px)"}],1300,1300,IO);
      var n=wordP.length;
      Array.prototype.forEach.call(wordP,function(p,i){A(p,[{opacity:0,transform:"translateY(12px)"},{opacity:1,transform:"translateY(0px)"}],2000+Math.abs(i-(n-1)/2)*70,800)});
      Array.prototype.forEach.call(dateP,function(p,i){A(p,[{opacity:0,transform:"translateY(-8px)"},{opacity:1,transform:"translateY(0px)"}],2500+i*55,700)});
      timers.push(setTimeout(function(){finish(false)},3600));
    }catch(e){finish(true)}
  }
  setInterval(function(){if(CINE.attractMs&&current==="intro"&&!cineOn&&!busy&&Date.now()-lastAct>CINE.attractMs)playCine().catch(function(){})},3000);
  playCine().catch(function(){var st=$("stage");st.classList.remove("cine");$("cine").classList.remove("on");cineOn=false});
  $("go").onclick=run;$("retake").onclick=run;$("done").onclick=reset;
  $("pick").onclick=function(){$("file").click()};
  $("file").onchange=function(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    var im=new Image();im.onload=async function(){await capture(im);await openEdit()};
    im.src=URL.createObjectURL(f);e.target.value="";
  };

  /* kiosk lock: no context menu, selection, zoom or pinch */
  var stop=function(e){e.preventDefault()};
  ["contextmenu","selectstart","dragstart","dblclick","gesturestart","gesturechange","gestureend"].forEach(function(ev){document.addEventListener(ev,stop,{passive:false})});
  document.addEventListener("touchmove",function(e){if(e.touches&&e.touches.length>1||(e.scale&&e.scale!==1))e.preventDefault()},{passive:false});
  document.addEventListener("wheel",function(e){if(e.ctrlKey)e.preventDefault()},{passive:false});
  document.addEventListener("keydown",function(e){if((e.ctrlKey||e.metaKey)&&["+","-","=","_","0"].indexOf(e.key)>=0)e.preventDefault()});
})();
