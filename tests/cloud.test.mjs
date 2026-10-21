import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const box={window:{}};vm.runInNewContext(readFileSync(new URL('../team-building-workbench/assets/workbench/public/cloud.js',import.meta.url),'utf8'),box);const cloud=box.window.CloudRenderer;
const names=['公园徒步','茶点分享','团队聚餐','室内运动场','桌游','饮品外卖','KTV','团队公益','登山','露营','音乐分享','飞盘','骑行','羽毛球','美术体验','手工制作'];
for(const width of [320,640])test(`cloud ${width}px has no duplicate, overlapping or outside-mask words`,()=>{const layout=cloud.layout(names.map((name,i)=>({id:String(i),name,count:i+1})),{width,height:640});assert.equal(layout.length,names.length);assert.equal(new Set(layout.map(w=>w.id)).size,names.length);for(const a of layout){for(const b of layout)if(a.id!==b.id)assert.ok(a.bounds.right<=b.bounds.left||a.bounds.left>=b.bounds.right||a.bounds.bottom<=b.bounds.top||a.bounds.top>=b.bounds.bottom);for(const [x,y] of [[a.bounds.left,a.bounds.top],[a.bounds.right,a.bounds.bottom],[a.bounds.left,a.bounds.bottom],[a.bounds.right,a.bounds.top]])assert.equal(cloud.inCloud(x,y,width,640),true);}});
test('zero support produces an empty cloud',()=>assert.equal(cloud.layout(names.map(name=>({name,count:0})),{width:320}).length,0));
