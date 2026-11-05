export interface ReportStats {
  month:string; budget:number; total:number; daily:number; fixed:number; previous:number;
  unconfirmed:number; days_over:number;
  categories:{id:string;name:string;icon:string;amount:number;previous:number;prior_average:number}[];
  new_descriptions?:{description:string;amount:number;entries:number}[];
  trips:{name:string;amount:number}[];
  largest:{description:string;icon:string;amount:number;spent_on:string;trip:boolean}[];
}
export const cash=(n:number)=>new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD',currencyDisplay:'narrowSymbol'}).format(Number(n));
export const monthName=(m:string)=>new Intl.DateTimeFormat('en-SG',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'T12:00:00Z'));
export function spendingChange(current:number,previous:number){
  const delta=Math.round(current*100)-Math.round(previous*100);
  if(!delta)return 'Unchanged from last month ('+cash(previous)+')';
  const percentage=previous>0?' ('+new Intl.NumberFormat('en-SG',{maximumFractionDigits:1}).format(Math.abs(delta)/previous)+'%)':'';
  return (delta>0?'Up ':'Down ')+cash(Math.abs(delta)/100)+percentage+' from '+cash(previous)+' last month';
}
export function highlights(s:ReportStats){
  const top=[...s.categories].filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount || a.name.localeCompare(b.name)).slice(0,3);
  const highest=s.largest.reduce<ReportStats['largest'][number]|undefined>((best,e)=>!best || e.amount>best.amount?e:best,undefined);
  return {change:spendingChange(s.total,s.previous),top,highest};
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
export function emailPayload(s:ReportStats,from:string,to:string){
  const subject='HHExpense · '+monthName(s.month);
  const rows=[['Household spending',cash(s.total)],['Monthly budget',cash(s.budget)],[s.total>s.budget?'Over budget':'Budget remaining',cash(Math.abs(s.budget-s.total))],['Fixed costs',cash(s.fixed)],
    ['Day-to-day',cash(s.daily)],['Previous month',cash(s.previous)],['Trip spending',cash(s.trips.reduce((a,t)=>a+Number(t.amount),0))],
    ['Days over daily budget',String(s.days_over)],['To confirm',String(s.unconfirmed)],...s.categories.map(c=>[c.name,cash(c.amount)])];
  const {change,top,highest}=highlights(s);
  const sections:[string,string[]][]=[
    ['Compared with last month',[change]],
    ['Highest expense',[highest ? highest.description+' · '+cash(highest.amount)+' · '+highest.spent_on+(highest.trip?' · Trip':'') : 'No expenses this month.']],
    ['Highest-spending categories',top.length?top.map((c,i)=>(i+1)+'. '+c.name+' · '+cash(c.amount)+' · '+spendingChange(c.amount,c.previous)):['No household spending.']],
    ['New descriptions vs last month',s.new_descriptions?.length?s.new_descriptions.map(d=>d.description+' · '+cash(d.amount)+' across '+d.entries+(d.entries===1?' entry':' entries')):
      [s.new_descriptions?'No new descriptions.':'Description comparison unavailable for this snapshot.']],
  ];
  const summaryHtml=sections.map(([title,lines])=>'<h2>'+escape(title)+'</h2><p>'+lines.map(escape).join('<br>')+'</p>').join('');
  const summaryText=sections.map(([title,lines])=>title+'\n'+lines.join('\n')).join('\n\n');
  const table=rows.map(([k,v])=>'<tr><td style="padding:6px;border-bottom:1px solid #d5ddd6">'+escape(k)+'</td><td align="right">'+escape(v)+'</td></tr>').join('');
  const html='<div style="max-width:560px;font:16px/1.5 Arial;color:#202d28"><h1>'+escape(subject)+'</h1>'+summaryHtml+'<p>All amounts in SGD</p><table width="100%">'+table+'</table></div>';
  return {from,to:[to],subject,html,text:subject+'\n\n'+summaryText+'\n\n'+rows.map(([k,v])=>k+': '+v).join('\n')};
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
