import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { loadMiniProgram } from './helpers/loadMiniProgram.mjs';
const require = createRequire(import.meta.url);
const { createLocalDiaryStore } = require('../utils/localDiaryStore.js');
const { createLocalMediaStore } = require('../utils/localMediaStore.js');
function setup() {
  const storage = new Map([['voonie_access_token','token'], ['voling_session_user','a']]), files = new Map(), calls = [];
  const faults = { disk: false, storage: false };
  const fs = {
    readFileSync(path) { if (!files.has(path)) throw Error('missing'); return files.get(path); },
    accessSync(path) { if (!files.has(path)) throw Error('missing'); },
    writeFileSync(path, value) { if (faults.disk) throw Error('disk full'); files.set(path,value); },
    renameSync(from,to) { if (faults.disk) throw Error('disk full'); files.set(to,files.get(from)); files.delete(from); },
    unlinkSync(path) { if (faults.disk || !files.has(path)) throw Error('cannot delete'); files.delete(path); },
    statSync(path) { if (!files.has(path)) throw Error('missing'); const v=files.get(path); return {size: v.byteLength || Buffer.byteLength(v)}; },
    readdirSync() { return [...files.keys()].map(p => p.split('/').pop()); },
    access({path,success,fail}) { files.has(path) ? success() : fail(Error('missing')); },
    writeFile({filePath,data,success,fail}) { if(faults.disk) fail(Error('disk full')); else { files.set(filePath,data); success(); } },
    rename({oldPath,newPath,success,fail}) { try { fs.renameSync(oldPath,newPath); success(); } catch(e) { fail(e); } },
  };
  const wx = {env:{USER_DATA_PATH:'/user'},getStorageInfoSync:()=>({keys:[...storage.keys()]}),getStorageSync:k=>storage.get(k),setStorageSync(k,v){if(faults.storage) throw Error('storage full');storage.set(k,structuredClone(v));},removeStorageSync:k=>storage.delete(k),getFileSystemManager:()=>fs,
    getSystemInfoSync:()=>({platform:'devtools'}), request:opts=>calls.push(opts), getImageInfo:({success})=>success({width:4,height:4})};
  const load = () => loadMiniProgram('utils/api.ts',{wx,app:{globalData:{}},globals:{setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,2))}});
  return {storage,files,faults,wx,calls,load};
}
const flush = () => new Promise(r=>setTimeout(r,8));
const raw = {job_id:'d',title:'我的日记',organized_diary:'散步。',edit_version:1,panels:[{panel_id:1,image_url:'/image.png'}]};

test('cold restart keeps text; account B never sees account A copies',()=>{
 const {wx}=setup();const store=createLocalDiaryStore(wx);store.saveList('a',[{id:'d',title:'private',edit_version:2}]);store.pin('a','d',true);
 const cold=createLocalDiaryStore(wx);assert.equal(cold.list('a')[0].title,'private');assert.equal(cold.list('b'),null);assert.equal(cold.isPinned('a','d'),true);
 cold.save('a',{id:'d',title:'older',edit_version:1});assert.equal(cold.get('a','d').title,'private');
});
test('full disk falls back without resurrecting deletions; two-channel failure reports failure',()=>{
 const {wx,faults}=setup();let store=createLocalDiaryStore(wx);store.saveList('a',[{id:'d'}]);faults.disk=true;
 assert.equal(store.remove('a','d'),true);store=createLocalDiaryStore(wx);assert.equal(store.get('a','d'),null);
 faults.storage=true;assert.equal(store.save('a',{id:'new'}),false);assert.equal(createLocalDiaryStore(wx).get('a','new'),null);
});
test('LRU removes only registered recoverable images and leaves originals and pins intact',()=>{
 const {wx,files,storage}=setup();files.set('/user/media-old.png',new ArrayBuffer(8));files.set('/user/media-fixed.png',new ArrayBuffer(8));files.set('/user/voice-original.m4a',new ArrayBuffer(8));files.set('/user/reference-draft.jpg',new ArrayBuffer(8));
 const media=createLocalMediaStore(wx);media.register('a','old','/user/media-old.png',8);media.register('a','fixed','/user/media-fixed.png',8,true);
 assert.equal(media.trim('a',0).removed,8);assert.equal(files.has('/user/media-fixed.png'),true);assert.equal(files.has('/user/voice-original.m4a'),true);assert.equal(files.has('/user/reference-draft.jpg'),true);
 storage.set('voling_media_index_v1:a',{bad:null});assert.deepEqual(media.entries('a'),[]);
});
test('local-first coalesces background sync; offline restart shows copies and retains login',async()=>{
 const {load,calls,storage}=setup();let api=load();const first=api.listDiaries();calls.shift().success({statusCode:200,data:[raw]});await first;
 api=load();const one=api.listDiaries(),two=api.listDiaries();assert.equal((await one)[0].title,raw.title);await two;assert.equal(calls.length,1);
 calls.shift().success({statusCode:503,data:{}});await flush();
 while(calls.length){calls.shift().success({statusCode:503,data:{}});await flush();}
 assert.equal(storage.get('voonie_access_token'),'token');assert.match(api.diarySyncLabel(),/本机副本/);
 storage.set('voling_session_user','b');const b=api.listDiaries();assert.equal(calls.length,1);calls.shift().success({statusCode:200,data:[]});assert.equal((await b).length,0);
});
test('fixed image survives cache cleanup and serves an uncached bookshelf thumbnail offline',async()=>{
 const {load,calls,files}=setup();let api=load();api.localDiaryStore.saveList('a',[{id:'d',title:'local',panels:[{image_url:'/image.png'}]}]);
 const saved=api.saveDiaryOffline('d');await flush();
 for(const call of calls.splice(0)) call.success({statusCode:200,data:call.responseType==='arraybuffer'?new ArrayBuffer(8):raw});await saved;
 assert.equal(api.isDiaryOfflineSaved('d'),true);assert.equal(api.trimLocalImageCache(true).removed,0);
 api=load();const cover=await api.authenticatedMediaUrl(api.thumbnailUrl('/image.png'));assert.ok(files.has(cover));assert.equal(calls.length,0);
});
test('a stale list cannot resurrect a diary deleted by a simultaneous detail refresh',async()=>{
 const {load,calls}=setup();const api=load();api.localDiaryStore.saveList('a',[{id:'d',title:'old'}]);
 const list=api.listDiaries(true);const rejected=assert.rejects(list,/数据已更新/);const detail=api.getDiaryDetail('d',true);const absent=assert.rejects(detail);
 calls[1].success({statusCode:404,data:{}});await absent;calls[0].success({statusCode:200,data:[raw]});await rejected;
 assert.equal(api.localDiaryStore.get('a','d'),null);
});
test('account deletion removes only owned offline copies, recordings and drafts',async()=>{
 const {load,calls,storage,files}=setup();const api=load();
 api.localDiaryStore.saveList('a',[{id:'d'}]);api.localDiaryStore.saveList('b',[{id:'other'}]);
 files.set('/user/voice-owned.m4a',new ArrayBuffer(8));files.set('/user/voice-other.m4a',new ArrayBuffer(8));files.set('/user/legacy-unowned.jpg',new ArrayBuffer(8));
 api.registerLocalRecording('/user/voice-owned.m4a','voice','2026-10-02');storage.set('voling_recordings:b',[{path:'/user/voice-other.m4a',localId:'other'}]);
 storage.set('voonie_diary_draft:a',{audioPath:'/user/voice-owned.m4a'});storage.set('voonie_diary_edit_draft:a:d',{content:'private'});
 const removed=api.deleteAccountData();calls.shift().success({statusCode:200,data:{}});await removed;
 assert.equal(files.has('/user/voice-owned.m4a'),false);assert.equal(files.has('/user/voice-other.m4a'),true);assert.equal(files.has('/user/legacy-unowned.jpg'),true);
 assert.equal(storage.has('voonie_diary_draft:a'),false);assert.equal(storage.has('voonie_diary_edit_draft:a:d'),false);assert.equal(api.localDiaryStore.get('a','d'),null);assert.ok(api.localDiaryStore.get('b','other'));
});
test('503 during token refresh preserves offline identity instead of logging out',async()=>{
 const {load,calls,storage}=setup();storage.set('voonie_refresh_token','refresh');const api=load();
 const pending=api.refreshSession();const rejected=assert.rejects(pending);
 calls.shift().success({statusCode:503,data:{}});await rejected;
 assert.equal(storage.get('voling_session_user'),'a');assert.equal(storage.get('voonie_access_token'),'token');
});
