import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Link,useLocation} from 'react-router-dom'
import {supabase} from './client'
import {cash,monthName,type ReportStats} from '../../supabase/functions/monthly-report/report'
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
interface Report {id:string;month:string;stats:ReportStats;ai_text:string|null;sent_at:string|null}
function ReportDetail({report}:{report:Report}){
  const s=report.stats
  return <><section className="card"><small>Household spending</small><strong className="hero-num">{cash(s.total)}</strong>
    <dl>{[['Monthly budget',cash(s.budget)],['Fixed costs',cash(s.fixed)],['Day-to-day',cash(s.daily)],['Previous month',cash(s.previous)],
      ['Days over daily budget',s.days_over],['Unconfirmed entries',s.unconfirmed]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section className="card"><h2>Monthly analysis</h2><p className="report-prose">{report.ai_text || 'Analysis is pending. Retry the report to finish it.'}</p></section>
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
    const {data,error}=await supabase.from('reports').select('id,month,stats,ai_text,sent_at').eq('household_id',household.id).order('month',{ascending:false})
    if(error)throw error
    return data as Report[]
  }})
  const send=useMutation({mutationFn:async()=>{
    setNotice('')
    const result=await supabase.functions.invoke('monthly-report',{body:{}})
    if(result.error){
      const detail=await result.error.context?.json?.().catch(()=>null)
      throw new Error(detail?.error || result.error.message)
    }
    return result.data.status
  },onSuccess:status=>{
    setSelected('')
    setNotice(status==='busy'?'This report is being prepared. Refresh shortly.':status==='sent'?'Report sent. Each recipient receives one copy.':'Report saved. Add recipients in Settings to send it.')
  },onSettled:()=>client.invalidateQueries({queryKey:key})})
  const report=query.data?.find(r=>r.month===selected) || query.data?.[0]
  return <section className="history-page"><Link to="/">‹ Overview</Link><div className="section-head"><h1>Reports</h1><Link to="/settings#report-recipients">Recipients</Link></div>
    <div><button className="primary" disabled={send.isPending} onClick={()=>send.mutate()}>{send.isPending?'Preparing report…':"Send last month’s report now"}</button></div>
    {notice&&<p role="status">{notice}</p>}{(query.error || send.error)&&<p role="alert">{problem(send.error || query.error)}</p>}
    {query.isPending?<p>Loading reports…</p>:report?<><div className="section-head"><label>Report month <select aria-label="Report month" value={report.month} onChange={e=>setSelected(e.target.value)}>
      {query.data?.map(r=><option key={r.id} value={r.month}>{monthName(r.month)}</option>)}</select></label>
      <small>{report.sent_at?'Email sent':report.ai_text?'Saved':'Preparing'}</small></div><ReportDetail report={report}/></>:
      !query.error&&<section className="card"><h2>No reports yet</h2><p>Prepare last month’s report above, or wait for the monthly schedule.</p></section>}
  </section>
}
