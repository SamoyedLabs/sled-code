import { expect, it } from "vite-plus/test";
import { queryFiles, fileTypeCounts, groupFilesByDay } from "./files-view";
import { format } from "./format";
import { t } from "../data/source-text";
import type { StoredFileRow } from "./types";
import { splitMemory, memoryMatches, type MemoryEntry } from "../memory/memory-model";
import { draftOf, draftReady, saveInput, itemMatches } from "../vault/vault-model";
const file=(id:string,name:string,createdAt:string,size:number):StoredFileRow=>({id,name,createdAt,size,mimeType:"application/octet-stream",kind:"file",previewKind:"text",previewUrl:null,source:"attachment",agentId:"agent",conversation:{id:"chat",title:"Work notes"},messageId:`message-${id}`,status:"available",deletable:true});
it("filters all source file types by filename or chat and groups consecutive dates without losing tombstones",()=>{
 const files=[file("a","notes.md","2026-01-02T12:00:00",10),file("b","data.csv","2026-01-01T12:00:00",200),{...file("c","run.ts","2026-01-02T15:00:00",30),status:"missing" as const}];
 expect(fileTypeCounts(queryFiles(files,{search:"Work",type:"all",sort:"newest"}))).toMatchObject({all:3,documents:1,spreadsheets:1,code:1});
 expect(queryFiles(files,{search:"work",type:"code",sort:"name"}).map(row=>[row.id,row.status])).toEqual([["c","missing"]]);
 const groups=groupFilesByDay(queryFiles(files,{search:"",type:"all",sort:"newest"}),new Date("2026-01-02T18:00:00"),t,format);
 expect(groups.map(group=>[group.label,group.files.map(row=>row.id)])).toEqual([["Today",["c","a"]],["Yesterday",["b"]]]);
});
it("uses source memory titles and every-word search without splitting clock times",()=>{
 expect(splitMemory("Brief: Send the report at 7:00.")).toEqual({title:"Brief",body:"Send the report at 7:00."});
 expect(splitMemory("Send it at 7:00 every day.")).toEqual({title:"Send it at 7:00 every day.",body:""});
 const memory:MemoryEntry={id:"a",text:"Prefer brief progress reports",origin:"manual",createdAt:"",updatedAt:""};
 expect(memoryMatches([memory],"REPORTS brief")).toEqual([memory]);expect(memoryMatches([memory],"brief long")).toEqual([]);
});
it("preserves saved vault secrets and approved sites while validating source draft rules",()=>{
 const card={kind:"card" as const,id:"saved",label:"Work",nameOnCard:"Person",expMonth:12,expYear:2031,billingContactId:null,brand:"visa" as const,last4:"1234",fillSites:["https://example.com"]};
 const draft=draftOf("card",card);expect(draftReady(draft,card)).toBe(true);expect(saveInput(draft,"saved")).toMatchObject({number:null,securityCode:null,expMonth:12,expYear:2031,fillSites:["https://example.com"]});
 expect(itemMatches(card,"1234")).toBe(true);expect(itemMatches(card,"visa")).toBe(true);
 const key=draftOf("apiKey",null);expect(draftReady(key,null)).toBe(false);
 expect(draftReady({kind:"apiKey",name:"SERVICE_TOKEN",notes:"",key:"token"},null)).toBe(true);
 expect(draftReady({kind:"apiKey",name:"service token",notes:"",key:"token"},null)).toBe(false);
});
