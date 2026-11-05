import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {describe, expect, it} from "vitest";

const script = readFileSync(new URL("./HHExpense.js",import.meta.url),"utf8").replace("__WIDGET_TOKEN__","a".repeat(64));
const category = {id:"pet1",name:"Pet",icon:"cat"};
const summary = {month:"2026-11-01",monthly_budget:1000,spent:12,daily_budget:30,left_today:18,recent:[{label:"Lunch",amount_sgd:12}]};
type Options = {mode?:string; size?:string; tap?:boolean; open?:string; spent?:number; offline?:boolean; revoked?:boolean; answers?:number[]; cache?:Map<string,string>};
async function simulate(opts:Options={}) {
  const cache=opts.cache ?? new Map<string,string>();
  const texts:string[]=[], urls:string[]=[], alerts:string[]=[], writes:unknown[]=[], notifications:string[]=[];
  const opened:string[]=[];
  class WebView { async loadURL(url:string){opened.push(url)} async present(){} }
  class Stack {
    set url(value:string){urls.push(value)}
    addText(value:string){texts.push(value);return {}}
    addStack(){return new Stack()}
    addImage(){return {}}
    layoutVertically(){} addSpacer(){} setPadding(){}
  }
  class Request {
    body=""; response={statusCode:200};
    constructor(public url:string){}
    async loadString(){
      if(opts.offline)throw new Error("Offline");
      if(opts.revoked){this.response.statusCode=403;return JSON.stringify({message:"Widget token is invalid."})}
      const rpc=this.url.split("/").pop();
      if(rpc==="widget_add_expense"){writes.push(JSON.parse(this.body));return JSON.stringify("saved")}
      return JSON.stringify(rpc==="widget_summary"?{...summary,spent:opts.spent ?? summary.spent}:rpc==="widget_categories"?[category]:["Lunch"]);
    }
  }
  class Alert {
    message=""; addAction(){} addCancelAction(){}
    addTextField(){return {setDecimalPadKeyboard(){}}}
    textFieldValue(){return "1025"}
    presentAlert(){alerts.push(this.message);return 0}
    presentSheet(){return 0}
  }
  const fm={documentsDirectory:()=>"/cache",joinPath:(a:string,b:string)=>a+"/"+b,
    writeString:(p:string,v:string)=>cache.set(p,v),readString:(p:string)=>cache.get(p),fileExists:(p:string)=>cache.has(p),remove:(p:string)=>cache.delete(p)};
  class Color {static dynamic(a:unknown){return a}}
  class Drawing {setFillColor(){} fillRect(){} getImage(){return {}}}
  class Notification {body=""; schedule(){notifications.push(this.body)}}
  const context={FileManager:{local:()=>fm},Color,Font:{systemFont:()=>0,boldSystemFont:()=>0},Size:class{},Rect:class{},
    WebView,Request,Alert,Notification,ListWidget:Stack,DrawContext:Drawing,SFSymbol:{named:()=>({image:{}})},
    config:{widgetFamily:opts.size || "medium",runsInWidget:true},args:{widgetParameter:opts.mode,queryParameters:opts.tap?{categoryId:category.id}:opts.open?{open:opts.open}:{}},
    Script:{name:()=>"HHExpense",setWidget(){},complete(){} }};
  await runInNewContext("(async()=>{"+script+"})()",context);
  return {cache,texts,urls,alerts,writes,notifications,opened};
}
describe("Scriptable widgets",()=>{
  it("renders the medium summary and stale offline copy, and rejects revoked access",async()=>{
    const first=await simulate();
    expect(first.texts).toContain("Lunch");
    expect(first.texts).toContain("S$12.00");
    expect((await simulate({size:"small"})).texts).not.toContain("Lunch");
    expect((await simulate({offline:true,cache:first.cache})).texts).toContain("Stale · last saved");
    expect((await simulate({revoked:true,cache:first.cache})).texts).not.toContain("Lunch");
    expect(first.cache.size).toBe(0);
  });
  it("renders category tap targets and handles an unsupported size",async()=>{
    const result=await simulate({mode:"add"});
    expect(result.urls).toContain("scriptable:///run?scriptName=HHExpense&categoryId=pet1");
    expect((await simulate({mode:"add",offline:true,cache:result.cache})).texts).toContain("Pet");
    expect((await simulate({mode:"add",size:"small"})).texts).toContain("Use a medium or large widget for quick add.");
  });
  it("opens the real app routes inside Scriptable without expense prompts",async()=>{
    expect((await simulate({tap:true})).opened).toEqual(["__APP_URL__/add?category=pet1"]);
    expect((await simulate({open:"summary"})).opened).toEqual(["__APP_URL__/"]);
    expect((await simulate({open:"add"})).opened).toEqual(["__APP_URL__/add"]);
    expect((await simulate()).urls).toContain("scriptable:///run?scriptName=HHExpense&open=summary");
  });
  it("reads latest totals on a scheduled render even without widget entry",async()=>{
    const first=await simulate();
    const next=await simulate({cache:first.cache,spent:22});
    expect(next.texts).toContain("S$22.00");
    expect(next.texts.some(t=>t.startsWith("Updated "))).toBe(true);
  });
});
