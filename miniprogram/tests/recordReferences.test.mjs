import assert from "node:assert/strict";
import test from "node:test";
import { loadMiniProgram } from "./helpers/loadMiniProgram.mjs";
function setup(){
 const storage=new Map(); const uploads=[],jobs=[]; let active=0,max=0,fail=true;
 const wx={env:{USER_DATA_PATH:"/user"},getRecorderManager:()=>new Proxy({},{get:()=>()=>{}}),getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),getFileSystemManager:()=>({writeFileSync(){},readFileSync(){throw Error("absent")},accessSync(){}}),showToast(){},navigateTo(){}};
 const api={diaryDraftKey:()=>"draft:a",ensureIdempotencyKey:()=>"local-key",getActiveCharacterId:()=>"",nowIsoDate:()=>"2026-10-02",localTimezone:()=>"Asia/Shanghai",findJobByKey:async()=>null,createTextEntry:async()=>({id:"entry"}),createComicJob:async(...args)=>{jobs.push(args);return{job_id:"job"}},uploadDiaryReference:async(id,path,options)=>{uploads.push(path);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,3));active--;if(path==="/b.jpg"&&fail)throw Error("offline");options.onProgress(100);return{id:path.slice(1),image_url:path}}};
 const page=loadMiniProgram("pages/record/index.ts",{wx,api});page.canGenerateDiary=async()=>true;
 page.setData({draftText:"早上散步。\n\n下午读书。\n\n晚上做饭。",references:["a","b","c"].map(key=>({key,path:`/${key}.jpg`,type:"scene",includeInContent:key!=="b",status:"ready"}))});
 return{page,storage,uploads,jobs,max:()=>max,recover:()=>fail=false};
}
test("partial uploads preserve successes, retry only failed photo, then submit all three",async()=>{
 const s=setup();await s.page.onSubmitText();assert.equal(s.max(),2);assert.equal(s.jobs.length,0);assert.equal(s.page.data.references.filter(r=>r.status==="uploaded").length,2);
 s.recover();await s.page.onSubmitText();assert.deepEqual(s.uploads,["/a.jpg","/b.jpg","/c.jpg","/b.jpg"]);assert.equal(s.jobs.length,1);assert.equal(s.jobs[0][3].ids.length,3);assert.equal(s.storage.get("draft:a").references[1].includeInContent,false);
});
test("invalid saved reference retains text and blocks generation",async()=>{
 const s=setup();s.page.data.references[0].missing=true;await s.page.onSubmitText();assert.equal(s.jobs.length,0);assert.equal(s.storage.get("draft:a").text,s.page.data.draftText);
});
