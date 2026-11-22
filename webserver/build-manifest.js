// Run after adding/removing assets:  node build-manifest.js
// Scans assets/illustrations/<category>/PNG/*.png and assets/background*/ images, writes assets-manifest.js
const fs=require("fs"),path=require("path");
const root=path.join(__dirname,"assets"),ls=d=>fs.existsSync(d)?fs.readdirSync(d).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})):[];
const illustrations=ls(path.join(root,"illustrations")).filter(d=>fs.statSync(path.join(root,"illustrations",d)).isDirectory()).map(d=>({
  name:d.replace(/^\d+_/,""),dir:d,
  files:ls(path.join(root,"illustrations",d,"PNG")).filter(f=>/\.png$/i.test(f))})).filter(c=>c.files.length);
const bg=ls(root).find(d=>/^backgo?r?u?nds?$/i.test(d)||/^background/i.test(d)||/^backg/i.test(d));
const frames=bg?ls(path.join(root,bg)).filter(f=>/\.(png|jpe?g|webp|svg)$/i.test(f)).map(f=>bg+"/"+f):[];
fs.writeFileSync(path.join(__dirname,"assets-manifest.js"),"window.ASSETS="+JSON.stringify({illustrations,frames},null,1)+";\n");
console.log(illustrations.reduce((n,c)=>n+c.files.length,0)+" stickers,",frames.length+" backgrounds");
