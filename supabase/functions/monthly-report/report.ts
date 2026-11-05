export interface ReportStats {
  month:string; budget:number; total:number; daily:number; fixed:number; previous:number;
  unconfirmed:number; days_over:number;
  categories:{id:string;name:string;icon:string;amount:number;previous:number;prior_average:number}[];
  trips:{name:string;amount:number}[];
  largest:{description:string;icon:string;amount:number;spent_on:string;trip:boolean}[];
}
export const cash=(n:number)=>new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD',currencyDisplay:'narrowSymbol'}).format(Number(n));
export const monthName=(m:string)=>new Intl.DateTimeFormat('en-SG',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'T12:00:00Z'));
const safeIcons:Record<string,string>={
  'shopping-bag':'shopping',phone:'communication','tools-kitchen-2':'food and drink',book:'education',
  movie:'entertainment',basket:'groceries',gift:'gifts',home:'housing',cat:'pets','ball-volleyball':'sport',taxi:'transport',
  plane:'travel',heartbeat:'health','users-group':'family',coffee:'coffee',car:'car',train:'train',bed:'hotel'
};
function safeCategory(icon:string){return Object.hasOwn(safeIcons,icon)?safeIcons[icon]:'other'}
export function aiStats(s:ReportStats){
  // Free-text labels, descriptions, names and addresses can identify people.
  // Use only predefined descriptions derived from curated icons for the AI request.
  return {month:s.month,currency:'SGD',budget:s.budget,total:s.total,fixed:s.fixed,day_to_day:s.daily,previous:s.previous,
    days_over_daily_budget:s.days_over,unconfirmed:s.unconfirmed,
    categories:s.categories.map(c=>({category:safeCategory(c.icon),amount:c.amount,previous:c.previous,prior_three_month_average:c.prior_average})),
    trip_spending:s.trips.reduce((sum,t)=>sum+Number(t.amount),0),
    largest:s.largest.map(e=>({description:safeCategory(e.icon)+' expense',amount:e.amount,trip:e.trip}))};
}
const instructions='Write a friendly household spending report in plain text, under 250 words. Compare actual SGD spending with the budget, last month and prior three-month category averages. Mention notable changes and give two or three practical suggestions grounded in the numbers. Trips are separate. Unconfirmed charges are estimates. With zero spending, say so. Avoid guessing causes or inventing people.';
interface AIConfig {provider:string;model:string;key:string}
export async function analyze(s:ReportStats,c:AIConfig,send:typeof fetch=fetch){
  if(!c.key || !c.model)throw new Error('Set AI_API_KEY and AI_MODEL in Edge Function secrets.');
  const input=JSON.stringify(aiStats(s));
  let content:string;
  if(c.provider==='openai'){
    const res=await send('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},
      body:JSON.stringify({model:c.model,store:false,instructions,input}),signal:AbortSignal.timeout(55000)});
    if(!res.ok)throw new Error('OpenAI report analysis failed ('+res.status+'). Check the AI secrets and billing.');
    const data=await res.json();
    content=(data.output ?? []).flatMap((m:{content?:{type:string;text?:string}[]})=>m.content ?? [])
      .filter((x:{type:string})=>x.type==='output_text').map((x:{text:string})=>x.text).join('\n');
  }else if(c.provider==='anthropic'){
    const res=await send('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':c.key,'anthropic-version':'2023-06-01','Content-Type':'application/json'},
      body:JSON.stringify({model:c.model,system:instructions,max_tokens:700,messages:[{role:'user',content:input}]}),signal:AbortSignal.timeout(55000)});
    if(!res.ok)throw new Error('Claude report analysis failed ('+res.status+'). Check the AI secrets and billing.');
    content=((await res.json()).content ?? []).filter((x:{type:string})=>x.type==='text').map((x:{text:string})=>x.text).join('\n');
  }else throw new Error('AI_PROVIDER must be openai or anthropic.');
  const text=content.trim();
  if(!text)throw new Error('The AI provider returned an empty report.');
  const words=text.split(/\s+/);
  return words.length<250?text:words.slice(0,248).join(' ')+'…';
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
export function emailPayload(s:ReportStats,analysis:string,from:string,to:string){
  const subject='HHExpense · '+monthName(s.month);
  const rows=[['Household spending',cash(s.total)],['Monthly budget',cash(s.budget)],['Fixed costs',cash(s.fixed)],
    ['Day-to-day',cash(s.daily)],['Previous month',cash(s.previous)],['Trip spending',cash(s.trips.reduce((a,t)=>a+Number(t.amount),0))],
    ['Days over daily budget',String(s.days_over)],['To confirm',String(s.unconfirmed)],...s.categories.map(c=>[c.name,cash(c.amount)])];
  const table=rows.map(([k,v])=>'<tr><td style="padding:6px;border-bottom:1px solid #d5ddd6">'+escape(k)+'</td><td align="right">'+escape(v)+'</td></tr>').join('');
  const html='<div style="max-width:560px;font:16px/1.5 Arial;color:#202d28"><h1>'+escape(subject)+'</h1><p>All amounts in SGD</p><table width="100%">'+table+'</table><p>'+escape(analysis).replace(/\n/g,'<br>')+'</p></div>';
  return {from,to:[to],subject,html,text:subject+'\n\n'+rows.map(([k,v])=>k+': '+v).join('\n')+'\n\n'+analysis};
}
export function canRetry(firstAttempt:string,now=Date.now()){return now-Date.parse(firstAttempt)<23*60*60*1000}

interface Delivery {id:string;payload:unknown;first_attempt:string;provider_id:string|null}
export async function deliverEmail(d:Delivery,key:string,mark:(id:string)=>Promise<void>,send:typeof fetch=fetch){
  if(d.provider_id)return;
  if(!canRetry(d.first_attempt))throw new Error('An earlier delivery needs a Resend dashboard check before retrying. See the setup guide.');
  for(let attempt=0;attempt<2;attempt++){
    const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,
      'Content-Type':'application/json','Idempotency-Key':'hh-report/'+d.id},body:JSON.stringify(d.payload),signal:AbortSignal.timeout(15000)});
    if(response.status===429 && attempt===0){
      const seconds=Math.max(1,Number(response.headers.get('retry-after')) || 1);
      if(seconds<=5){await new Promise(resolve=>setTimeout(resolve,seconds*1000));continue}
    }
    if(!response.ok)throw new Error('Resend rejected the email ('+response.status+'). Check the sender and retry.');
    const id=(await response.json()).id;
    if(typeof id!=='string' || !id)throw new Error('Resend did not confirm acceptance. Retry to check the same request.');
    await mark(id);return;
  }
}
