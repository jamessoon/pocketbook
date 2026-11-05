import {useState, type FormEvent} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {supabase} from './client'
import {useTrips,type Trip} from './trip-data'
import {today} from './dates'
import {formatMoney,dateLabel} from './entry-helpers'
import type {EntryProps} from './Entries'

const shortDate=(value:string)=>dateLabel(value,{day:'numeric',month:'short',year:'numeric'})
const reason=(e:unknown)=>typeof e==='object' && e && 'message' in e ? String(e.message) : 'Please try again.'

function TripEditor({trip,householdId,day,onClose,onSaved}:{trip?:Trip;householdId:string;day:string;onClose:()=>void;onSaved:(id:string)=>void}){
  const [name,setName]=useState(trip?.name || '')
  const [start,setStart]=useState(trip?.start_date || day)
  const [end,setEnd]=useState(trip?.end_date || day)
  const [budget,setBudget]=useState(String(trip?.budget ?? ''))
  const [archived,setArchived]=useState(trip?.archived || false)
  const cache=useQueryClient()
  const save=useMutation({mutationFn:async()=>{
    const fields={name:name.trim(),start_date:start,end_date:end,budget:budget===''?null:Number(budget),archived}
    if(!fields.name || end<start)throw new Error('Enter a trip name and check the dates.')
    const query=trip ? supabase.from('trips').update(fields).eq('id',trip.id).eq('household_id',householdId)
      : supabase.from('trips').insert({...fields,household_id:householdId})
    const {data,error}=await query.select('id').single()
    if(error)throw error
    return data.id as string
  },onSuccess:async id=>{await cache.invalidateQueries({queryKey:['trips',householdId]});onSaved(id)}})
  function submit(e:FormEvent){e.preventDefault();save.mutate()}
  return <form className="trip-editor card" onSubmit={submit}><h2>{trip?'Edit trip':'New trip'}</h2>
    <label>Trip name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
    <div className="account-columns"><label>Start date<input type="date" required value={start} onChange={e=>{setStart(e.target.value);if(end<e.target.value)setEnd(e.target.value)}}/></label>
    <label>End date<input type="date" required min={start} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
    <label>Trip budget (SGD, optional)<input type="number" min="0" step=".01" value={budget} onChange={e=>setBudget(e.target.value)}/></label>
    {trip&&<label><span><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/> Archive trip</span></label>}
    {save.error&&<p role="alert">{reason(save.error)}</p>}
    <div className="trip-actions"><button className="primary" disabled={save.isPending}>Save trip</button><button type="button" disabled={save.isPending} onClick={onClose}>Cancel</button></div></form>
}

interface TripExpense {id:string;category_id:string;created_by:string|null;description:string;spent_on:string;amount_sgd:number;sgd_confirmed:boolean}
function TripSummary({trip,household,categories,members}:EntryProps & {trip:Trip}){
  const query=useQuery({queryKey:['trip-expenses',household.id,trip.id],queryFn:async()=>{
    const rows:TripExpense[]=[]
    for(let start=0;;start+=500){
      const result=await supabase.from('expenses').select('id,category_id,created_by,description,spent_on,amount_sgd,sgd_confirmed')
        .eq('trip_id',trip.id).eq('household_id',household.id).order('spent_on',{ascending:false}).order('id').range(start,start+499)
      if(result.error)throw result.error
      rows.push(...result.data)
      if(result.data.length<500)return rows
    }
  }})
  if(query.isPending)return <p role="status">Loading trip expenses…</p>
  if(query.error)return <p role="alert">{reason(query.error)}</p>
  const byCategory=new Map<string,number>(), byPerson=new Map<string,number>()
  let total=0
  for(const e of query.data){
    const amount=Number(e.amount_sgd);total+=amount
    byCategory.set(e.category_id,(byCategory.get(e.category_id)||0)+amount)
    const key=e.created_by || '';byPerson.set(key,(byPerson.get(key)||0)+amount)
  }
  const cat=(id:string)=>categories.find(c=>c.id===id)?.name || 'Category'
  const person=(id:string)=>id?(members.find(m=>m.user_id===id)?.display_name || 'Household member'):'Household widget'
  function breakdown(title:string,values:Map<string,number>,label:(id:string)=>string){
    return <section className="card"><h2>{title}</h2><dl>{[...values].sort((a,b)=>b[1]-a[1]).map(([id,n])=><div key={id}><dt>{label(id)}</dt><dd>{formatMoney(n)}</dd></div>)}</dl></section>
  }
  return <><section className="card"><small>Total spent</small><strong className="hero-num">{formatMoney(total)}</strong>
    {trip.budget!==null&&<p>{formatMoney(Math.abs(trip.budget-total))} {total>trip.budget?'over budget':'remaining'} of {formatMoney(trip.budget)}</p>}
    {!trip.archived&&<Link className="primary desktop-add" to={'/add?trip='+trip.id}>Add trip expense</Link>}</section>
    {query.data.length>0&&<div className="cards">{breakdown('By category',byCategory,cat)}{breakdown('By person',byPerson,person)}</div>}
    <section className="card"><h2>Trip expenses</h2>{!query.data.length&&<p>No expenses yet.</p>}
      {query.data.map(e=><Link className="trip-row" key={e.id} to={'/add?edit='+e.id}><span><strong>{e.description || cat(e.category_id)}</strong>
      <small>{shortDate(e.spent_on)} · {person(e.created_by || '')}{e.sgd_confirmed?'':' · To confirm'}</small></span>{formatMoney(e.amount_sgd)}</Link>)}</section></>
}

export function Trips(props:EntryProps){
  const [params,setParams]=useSearchParams()
  const id=params.get('id'), trips=useTrips(props.household.id)
  const editing=params.get('edit')==='1'
  const setEditing=(value:boolean)=>setParams({...(id ? {id} : {}),...(value ? {edit:'1'} : {})})
  const trip=trips.data?.find(t=>t.id===id)
  const select=(id?:string)=>setParams(id?{id}:{})
  if(trips.isPending)return <p>Loading trips…</p>
  if(trips.error)return <p role="alert">{reason(trips.error)}</p>
  return <section className="trip-page">{(id || editing) && <Link to="/trips">‹ All trips</Link>}
    <div className="section-head"><h1>{trip?.name || 'Trips'}</h1>{!editing&&<button onClick={()=>setEditing(true)}>{trip?'Edit trip':'New trip'}</button>}</div>
    {editing?<TripEditor key={trip?.id || 'new'} trip={trip} householdId={props.household.id} day={today(props.household.timezone)} onClose={()=>setEditing(false)} onSaved={select}/>
    :trip?<><small>{shortDate(trip.start_date)} – {shortDate(trip.end_date)}{trip.archived?' · Archived':''}</small><TripSummary {...props} trip={trip}/></>
    :<section className="card trip-list">{!trips.data.length&&<p>Create a trip to track group expenses separately from your household budget.</p>}
    {trips.data.map(t=><Link className="trip-row" key={t.id} to={'/trips?id='+t.id}><span><strong>{t.name}</strong><small>{shortDate(t.start_date)} – {shortDate(t.end_date)}{t.archived?' · Archived':''}</small></span><span className="trip-list-budget">{t.budget!==null && "Budget "+formatMoney(t.budget)} <span aria-hidden="true">›</span></span></Link>)}</section>}</section>
}
