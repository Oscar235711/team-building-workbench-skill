import {handleRequest} from './api.js';
export async function serve(request,env,assets){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/'))return handleRequest(request,env);
 const key=path==='/'?'/index.html':path,body=assets[key];
 if(body===undefined)return new Response('页面不存在',{status:404});
 return new Response(body,{headers:{'Content-Type':key.endsWith('.js')?'text/javascript; charset=utf-8':key.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com"}});
}
