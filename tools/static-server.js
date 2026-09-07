const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".jpg":"image/jpeg",".png":"image/png",".csv":"text/csv; charset=utf-8"};

const server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,"http://127.0.0.1").pathname);
  const target=path.resolve(root,"."+pathname);
  if(!target.startsWith(root)){response.writeHead(403).end("Forbidden");return;}
  fs.stat(target,(statError,stat)=>{
    const file=!statError&&stat.isDirectory()?path.join(target,"index.html"):target;
    fs.readFile(file,(error,data)=>{
      if(error){response.writeHead(404).end("Not found");return;}
      response.writeHead(200,{"Content-Type":types[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});
      response.end(data);
    });
  });
});

server.listen(8765,"0.0.0.0",()=>{
  console.log("本机访问：http://127.0.0.1:8765/campus-all.html");
  for(const addresses of Object.values(os.networkInterfaces())){
    for(const address of addresses||[]){
      if(address.family==="IPv4"&&!address.internal){
        console.log(`手机访问：http://${address.address}:8765/campus-all.html`);
      }
    }
  }
});
