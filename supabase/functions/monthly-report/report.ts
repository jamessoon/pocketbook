export interface ReportStats {
  month:string; budget:number; total:number; daily:number; fixed:number; previous:number;
  unconfirmed:number; days_over:number;
  categories:{id:string;name:string;icon:string;amount:number;previous:number;prior_average:number}[];
  trips:{name:string;amount:number}[];
  largest:{description:string;icon:string;amount:number;spent_on:string;trip:boolean}[];
}
export const cash=(n:number)=>new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD',currencyDisplay:'narrowSymbol'}).format(Number(n));
export const monthName=(m:string)=>new Intl.DateTimeFormat('en-SG',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'T12:00:00Z'));
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
export function emailPayload(s:ReportStats,from:string,to:string){
  const subject='HHExpense · '+monthName(s.month);
  const rows=[['Household spending',cash(s.total)],['Monthly budget',cash(s.budget)],[s.total>s.budget?'Over budget':'Budget remaining',cash(Math.abs(s.budget-s.total))],['Fixed costs',cash(s.fixed)],
    ['Day-to-day',cash(s.daily)],['Previous month',cash(s.previous)],['Trip spending',cash(s.trips.reduce((a,t)=>a+Number(t.amount),0))],
    ['Days over daily budget',String(s.days_over)],['To confirm',String(s.unconfirmed)],...s.categories.map(c=>[c.name,cash(c.amount)])];
  const table=rows.map(([k,v])=>'<tr><td style="padding:6px;border-bottom:1px solid #d5ddd6">'+escape(k)+'</td><td align="right">'+escape(v)+'</td></tr>').join('');
  const html='<div style="max-width:560px;font:16px/1.5 Arial;color:#202d28"><h1>'+escape(subject)+'</h1><p>All amounts in SGD</p><table width="100%">'+table+'</table></div>';
  return {from,to:[to],subject,html,text:subject+'\n\n'+rows.map(([k,v])=>k+': '+v).join('\n')};
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
