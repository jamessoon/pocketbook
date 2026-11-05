import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Link,useLocation} from 'react-router-dom'
import {today,shiftMonth} from './dates'
import {supabase} from './client'
import {cash,monthName,highlights,spendingChange,type ReportStats} from '../../supabase/functions/monthly-report/report'
import type {Household} from './types'

const problem=(e:unknown)=>e && typeof e==='object' && 'message' in e ? String(e.message) : 'Please try again.'
export function ReportSettings({household}:{household:Household}){
  const [email,setEmail]=useState('')
  const {hash}=useLocation()
  useEffect(()=>{if(hash==='#report-recipients') document.getElementById('report-recipients')?.scrollIntoView({block:'start'})},[hash])
  const client=useQueryClient()
  const key=['report-recipients',household.id]
  const query=useQuery({queryKey:key,queryFn:async()=>{
    const {data,error}=await supabase.from('report_recipients').select('email').eq('household_id',household.id).order('email')
    if(error)throw error
    return data
  }})
  const save=useMutation({mutationFn:async({address,remove}:{address:string;remove:boolean})=>{
    const result=remove?await supabase.from('report_recipients').delete().eq('household_id',household.id).eq('email',address):
      await supabase.from('report_recipients').insert({household_id:household.id,email:address})
    if(result.error)throw result.error.code==='23505'?new Error('This recipient is already on the list.'):result.error
  },onSuccess:async(_,v)=>{if(!v.remove)setEmail('');await client.invalidateQueries({queryKey:key})}})
  return <section id="report-recipients" className="account-section"><div className="account-row"><h2>Monthly report emails</h2><Link to="/reports">Reports</Link></div>
    <p>These recipients receive your household’s spending report each month.</p>
    <form className="account-form" onSubmit={e=>{e.preventDefault();save.mutate({address:email.trim().toLowerCase(),remove:false})}}>
      <label>Recipient email<input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <button className="account-secondary" disabled={save.isPending}>Add recipient</button></form>
    {query.data?.map(r=><div className="account-row report-recipient" key={r.email}><span>{r.email}</span>
      <button aria-label={'Remove '+r.email} onClick={()=>save.mutate({address:r.email,remove:true})} disabled={save.isPending}>Remove</button></div>)}
    {(save.error || query.error) && <p role="alert">{problem(save.error || query.error)}</p>}
  </section>
}
interface Report {id:string;month:string;stats:ReportStats;sent_at:string|null;last_manual_sent_at?:string|null}
function ReportDetail({report}:{report:Report}){
  const s=report.stats
  const {change,highest,top}=highlights(s)
  return <><section className="card"><small>Household spending</small><strong className="hero-num">{cash(s.total)}</strong><p>{change}</p>
    <dl>{[['Monthly budget',cash(s.budget)],[s.total>s.budget?'Over budget':'Budget remaining',cash(Math.abs(s.budget-s.total))],['Fixed costs',cash(s.fixed)],['Day-to-day',cash(s.daily)],['Previous month',cash(s.previous)],
      ['Days over daily budget',s.days_over],['Unconfirmed entries',s.unconfirmed]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section className="card"><h2>Highest expense</h2>{highest?<p>{highest.description} · <strong>{cash(highest.amount)}</strong><br/><small>{highest.spent_on}{highest.trip?' · Trip':''}</small></p>:<p>No expenses this month.</p>}
      <h2>Highest-spending categories</h2>{!top.length&&<p>No household spending.</p>}{top.map((c,i)=><div className="trip-row" key={c.id}><span>{i+1}. {c.name}<small>{spendingChange(c.amount,c.previous)}</small></span><strong>{cash(c.amount)}</strong></div>)}</section>
    <section className="card"><h2>New descriptions vs last month</h2>{s.new_descriptions?.length?s.new_descriptions.map(d=><div className="trip-row" key={d.description}><span>{d.description}<small>{d.entries} {d.entries===1?'entry':'entries'}</small></span><strong>{cash(d.amount)}</strong></div>):<p>{s.new_descriptions?'No new descriptions.':'Description comparison unavailable for this snapshot.'}</p>}</section>
    <section className="card"><h2>By category</h2>{!s.categories.length&&<p>No household spending.</p>}{s.categories.map(c=><div className="trip-row" key={c.id}><span>{c.name}<small>Previous {cash(c.previous)} · Prior 3-month average {cash(c.prior_average)}</small></span><strong>{cash(c.amount)}</strong></div>)}</section>
    {!!s.largest.length&&<section className="card"><h2>Largest expenses</h2>{s.largest.map((e,i)=><div className="trip-row" key={i}><span>{e.description}<small>{e.spent_on}{e.trip?' · Trip':''}</small></span><strong>{cash(e.amount)}</strong></div>)}</section>}
    {!!s.trips.length&&<section className="card"><h2>Trip spending</h2>{s.trips.map((t,i)=><div className="trip-row" key={i}>{t.name}<strong>{cash(t.amount)}</strong></div>)}</section>}
  </>
}
export function Reports({household}:{household:Household}){
  const client=useQueryClient()
  const [selected,setSelected]=useState(''),[notice,setNotice]=useState('')
  const key=['reports',household.id]
  const query=useQuery({queryKey:key,queryFn:async()=>{
    const {data,error}=await supabase.from('reports').select('id,month,stats,sent_at,last_manual_sent_at').eq('household_id',household.id).order('month',{ascending:false})
    if(error)throw error
    return data as Report[]
  }})
  const current=today(household.timezone).slice(0,7)+'-01'
  const month=selected || query.data?.[0]?.month || shiftMonth(current,-1)
  const report=query.data?.find(r=>r.month===month)
  const lastSent=[report?.sent_at,report?.last_manual_sent_at].filter((v):v is string=>!!v).sort().at(-1)
  const send=useMutation({mutationFn:async(input:{month:string;request_id:string})=>{
    setNotice('')
    const result=await supabase.functions.invoke('monthly-report',{body:input})
    if(result.error){
      const detail=await result.error.context?.json?.().catch(()=>null)
      throw new Error(detail?.error || result.error.message)
    }
    return result.data as {status:string;newlyAccepted?:number}
  },onSuccess:({status,newlyAccepted})=>{

    const messages:Record<string,string>={
      busy:'This report is being prepared. Refresh shortly.',
      already_sent:'This send request has already been processed.',
      accepted:'Resend accepted '+newlyAccepted+' new email'+(newlyAccepted===1?'':'s')+' for delivery.',
      sent:'The server is using the old report function. Deploy the updated monthly-report function to send the selected month.',
      saved:'Report saved. Add recipients in Settings to send it.',
    }
    setNotice(messages[status] || 'Check the saved report for its latest status.')
  },onSettled:()=>client.invalidateQueries({queryKey:key})})
  return <section className="history-page"><Link to="/">‹ Overview</Link><div className="section-head"><h1>Reports</h1><Link to="/settings#report-recipients">Recipients</Link></div>
    <div className="trip-actions"><label>Report month <input type="month" aria-label="Report month" min="1900-01" max={current.slice(0,7)} value={month.slice(0,7)}
      disabled={send.isPending} onChange={e=>{if(e.target.validity.valid && e.target.value){setSelected(e.target.value+'-01');setNotice('');send.reset()}}}/></label>
      <button className="primary" disabled={send.isPending || query.isPending} onClick={()=>send.mutate({month,request_id:crypto.randomUUID()})}>{send.isPending?'Sending…':'Send report'}</button></div>
    {notice&&<p role="status">{notice}</p>}{(query.error || send.error)&&<p role="alert">{problem(send.error || query.error)}</p>}
    {query.isPending?<p>Loading reports…</p>:report?<><div className="section-head"><h2>{monthName(report.month)}</h2>
      <small>{lastSent?'Last emailed '+new Intl.DateTimeFormat('en-SG',{timeZone:household.timezone,day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(lastSent)):'Saved'}</small></div><ReportDetail report={report}/></>:
      !query.error&&<section className="card"><h2>No saved report for {monthName(month)}</h2><p>Send report prepares this month’s figures and emails your listed recipients.</p></section>}
  </section>
}
