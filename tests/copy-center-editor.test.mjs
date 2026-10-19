import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as core from '../apps/copy-center/core.mjs';
async function harness(){
 const source=await readFile(new URL('../apps/copy-center/app.mjs',import.meta.url),'utf8');
 const controls=[{disabled:false},{disabled:false}],elements=new Map(),listeners={};
 const element=key=>{if(key==='#source-form'||key==='#version-form')return null;if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',className:'',classList:{add(){}},disabled:false});return elements.get(key);};
 const storage=new Map();const sandbox={...core,console,setTimeout,clearTimeout,URL,Blob,TextEncoder,TextDecoder,fetch:()=>new Promise(()=>{}),confirm:()=>true,matchMedia:()=>({matches:true}),sessionStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),getItem:k=>storage.get(k)||null},document:{querySelector:element,querySelectorAll:()=>controls,body:{classList:{toggle(){},remove(){}}},addEventListener:(name,fn)=>listeners[name]=fn},window:{addEventListener:(name,fn)=>listeners[name]=fn,scrollTo(){}},navigator:{clipboard:{writeText:async()=>{}}}};
 vm.createContext(sandbox);const code=source.slice(0,source.lastIndexOf("\napi('/state')")).replace(/^import[^\n]+\n/,'');vm.runInContext(code+'\nglobalThis.app={S,saveDraft,previewImport};',sandbox);
 const a={id:'abc',code:'NB-001',name:'广告 A',region:'国内',location:'广州',facts:'',description:'',theme:'',assetUrl:'',versions:{},revision:1,updatedAt:'2026-10-20'};Object.assign(sandbox.app.S,{ads:[a],draft:structuredClone(a),rules:core.DEFAULT_RULES,page:'editor',dirty:true});
 return {sandbox,...sandbox.app,controls,elements,listeners,storage,ad:a};
}
test('普通保存期间锁定编辑和导航，响应返回后才解锁',async()=>{
 const h=await harness();let release;h.sandbox.fetch=()=>new Promise(r=>release=r);const pending=h.saveDraft();assert.equal(h.S.busy,true,'保存必须立即锁定编辑');assert.ok(h.controls.every(c=>c.disabled));
 await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{nav:'library'}})}});assert.equal(h.S.page,'editor');
 release({ok:true,status:200,json:async()=>({...h.ad,revision:2})});await pending;assert.equal(h.S.busy,false);assert.ok(h.controls.every(c=>!c.disabled));assert.equal(h.S.dirty,false);
});
test('离开并返回编辑器仍保留未保存状态和卸载提醒',async()=>{
 const h=await harness();h.storage.set('nbo-copy-draft:abc','retained');
 await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{nav:'library'}})}});assert.equal(h.S.dirty,true,'离开不能把本机草稿标成云端已保存');
 await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{nav:'editor'}})}});assert.equal(h.S.dirty,true);let prevented=false;h.listeners.beforeunload({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.storage.get('nbo-copy-draft:abc'),'retained');
});
test('100 条广告五地区八平台的完整备份可以预览恢复',async()=>{
 const h=await harness();h.S.ads=[];const ads=Array.from({length:100},(_,i)=>({id:'ad-'+i,code:'NB-'+i,name:'广告 '+i,versions:Object.fromEntries(core.REGIONS.flatMap(region=>core.PLATFORMS.map(p=>[core.versionKey(region,p.id),{platform:p.id,region,title:'真实男士写真',body:'这是照片文案'.repeat(36),tags:[],cta:'站内咨询'}])))}));
 const text=JSON.stringify({format:'nanbo-copy-center',ads});const bytes=new TextEncoder().encode(text).byteLength;assert.ok(bytes>2_000_000);
 await h.previewImport({name:'完整备份.json',size:bytes,text:async()=>text});assert.equal(h.S.importData.ads.length,100);
});
