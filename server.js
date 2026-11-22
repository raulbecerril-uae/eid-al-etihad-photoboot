// Local photobooth server (replaces "php -S", which handles ONE request at a time and stalls the QR upload).
// Serves the folder, and accepts POST /upload.php exactly like upload.php does.  Run: node server.js
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const ROOT=__dirname,PORT=+process.env.PORT||8080,PHOTOS=path.join(ROOT,"photos");
const MIME={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json",
 ".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",
 ".ico":"image/x-icon",".ttf":"font/ttf",".otf":"font/otf",".woff":"font/woff",".woff2":"font/woff2"};
fs.mkdirSync(PHOTOS,{recursive:true});
const json=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(obj))};
const pad=n=>String(n).padStart(2,"0");

function upload(req,res){
  const chunks=[];let size=0;
  req.on("data",c=>{size+=c.length;if(size>15*1024*1024){json(res,400,{error:"bad size"});req.destroy()}else chunks.push(c)});
  req.on("end",()=>{
    const d=Buffer.concat(chunks);
    if(d.length<100)return json(res,400,{error:"bad size"});
    let ext;
    if(d[0]===0xFF&&d[1]===0xD8&&d[2]===0xFF)ext="jpg";
    else if(d.slice(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])))ext="png";
    else return json(res,415,{error:"not a jpg/png"});
    const t=new Date(),name=""+t.getFullYear()+pad(t.getMonth()+1)+pad(t.getDate())+"-"+pad(t.getHours())+pad(t.getMinutes())+pad(t.getSeconds())+"-"+crypto.randomBytes(4).toString("hex")+"."+ext;
    fs.writeFile(path.join(PHOTOS,name),d,err=>err?json(res,500,{error:"write failed"}):json(res,200,{url:"photos/"+name}));
  });
}

http.createServer((req,res)=>{
  let p;try{p=decodeURIComponent(new URL(req.url,"http://x").pathname)}catch(e){res.writeHead(400);return res.end()}
  if(p==="/upload.php"){return req.method==="POST"?upload(req,res):json(res,405,{error:"POST only"})}
  if(p.endsWith("/"))p+="index.html";
  const f=path.normalize(path.join(ROOT,p));
  if(!f.startsWith(ROOT+path.sep)&&f!==ROOT){res.writeHead(403);return res.end()}
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404,{"Content-Type":"text/plain"});return res.end("Not found");}
    res.writeHead(200,{"Content-Type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream","Content-Length":st.size,"Cache-Control":p.indexOf("/photos/")===0?"no-store":"no-cache"});
    fs.createReadStream(f).pipe(res);
  });
}).listen(PORT,"0.0.0.0",()=>console.log("Photobooth server on port "+PORT));
