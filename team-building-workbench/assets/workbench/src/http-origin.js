// PUBLIC_ORIGIN is a server setting, never a forwarded request header.
export function requestURL(rawUrl,host,publicOrigin){
 const base=new URL(publicOrigin||`http://${host||'127.0.0.1'}`);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('PUBLIC_ORIGIN 须为完整的 HTTP/HTTPS 来源，不含路径或凭据');
 const target=new URL(rawUrl,base.origin);
 if(target.origin!==base.origin)throw new Error('请求路径不能跳转到其他来源');
 return target;
}
