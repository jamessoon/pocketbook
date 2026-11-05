import {useState,type FormEvent} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query'
import {supabase} from './client'
import {today} from './dates'
import {formatMoney} from './entry-helpers'
import {CategoryIcon} from './icons'
import type {Household,Category} from './types'

type Bill = {
  id:string; name:string;category_id:string;amount:number;amount_type:'fixed'|'variable'
  interval_months:number;due_day:number;start_month:string;active:boolean;last_posted_month:string|null
}
const periods:Record<number,string>={1:'Monthly',3:'Every 3 months',6:'Every 6 months',12:'Yearly'}
const message=(error:unknown)=>error && typeof error==='object' && 'message' in error ? String(error.message) : 'Please try again.'

function BillForm({bill,categories,household,close}:{bill?:Bill;categories:Category[];household:Household;close:()=>void}){
  const day=today(household.timezone)
  const [name,setName]=useState(bill?.name || '')
  const [category,setCategory]=useState(bill?.category_id || '')
  const [amount,setAmount]=useState(String(bill?.amount ?? ''))
  const [type,setType]=useState<Bill['amount_type']>(bill?.amount_type || 'fixed')
  const [interval,setIntervalMonths]=useState(bill?.interval_months || 1)
  const [due,setDue]=useState(String(bill?.due_day ?? Number(day.slice(-2))))
  const [start,setStart]=useState((bill?.start_month || day).slice(0,7))
  const [active,setActive]=useState(bill?.active ?? true)
  const cache=useQueryClient()
  const save=useMutation({mutationFn:async()=>{
    if(!name.trim())throw new Error('Enter a bill name.')
    const fields={name:name.trim(),category_id:category,amount:Number(amount),amount_type:type,
      interval_months:interval,due_day:Number(due),start_month:start+'-01',active}
    const query=bill ? supabase.from('recurring_items').update(fields).eq('id',bill.id).eq('household_id',household.id)
      : supabase.from('recurring_items').insert({...fields,household_id:household.id})
    const {error}=await query.select('id').single()
    if(error)throw error
  },onSuccess:async()=>{await cache.invalidateQueries();close()}})
  function submit(e:FormEvent){e.preventDefault();save.mutate()}
  return <form onSubmit={submit} className="trip-editor recurring-editor card"><h2>{bill?'Edit recurring cost':'New recurring cost'}</h2>
    <label>Bill name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Category<select aria-label="Category" required value={category} onChange={e=>setCategory(e.target.value)}><option value="">Choose category</option>
      {categories.filter(c=>!c.archived || c.id===bill?.category_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="account-columns"><label>Amount type<select aria-label="Amount type" value={type} onChange={e=>setType(e.target.value as Bill['amount_type'])}><option value="fixed">Fixed amount</option><option value="variable">Variable estimate</option></select></label>
    <label>{type==='fixed'?'Amount':'Estimate'} (SGD)<input type="number" required min="0.01" step=".01" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div>
    <label>Frequency<select aria-label="Frequency" value={interval} onChange={e=>setIntervalMonths(Number(e.target.value))}>{Object.entries(periods).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
    <div className="account-columns"><label>Start month<input required type="month" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>Day due<input type="number" required min={1} max={31} step={1} value={due} onChange={e=>setDue(e.target.value)}/></label></div>
    {type==='variable' && <small>When the bill posts, confirm the actual SGD amount in To confirm.</small>}
    {bill && <label><span><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Active</span></label>}
    {save.error && <p role="alert">{message(save.error)}</p>}
    <div className="trip-actions"><button className="primary" disabled={save.isPending}>Save recurring cost</button><button type="button" onClick={close}>Cancel</button></div>
  </form>
}

export function Recurring({household,categories}:{household:Household;categories:Category[]}){
  const [params,setParams]=useSearchParams()
  const edit=params.get('edit')
  const query=useQuery({queryKey:['recurring',household.id],queryFn:async()=>{
    const bills:Bill[]=[]
    for(let offset=0;;offset+=500){
      const {data,error}=await supabase.from('recurring_items').select('id,name,category_id,amount,amount_type,interval_months,due_day,start_month,active,last_posted_month')
        .eq('household_id',household.id).order('active',{ascending:false}).order('name').order('id').range(offset,offset+499)
      if(error)throw error
      bills.push(...data)
      if(data.length<500)return bills
    }
  }})
  if(query.isPending)return <p>Loading recurring costs…</p>
  if(query.error)return <p role="alert">{message(query.error)}</p>
  const bill=query.data.find(b=>b.id===edit)
  return <section className="trip-page"><Link to="/">‹ Overview</Link><div className="section-head"><h1>Recurring costs</h1>
    {!edit && <button onClick={()=>setParams({edit:'new'})}>New bill</button>}</div>
    {edit && (edit==='new' || bill) ? <BillForm key={edit} bill={bill} household={household} categories={categories} close={()=>setParams({})}/> :
    <section className="card trip-list">{!query.data.length&&<p>Add a bill to reserve it in your monthly budget.</p>}
      {query.data.map(item=>{const c=categories.find(category=>category.id===item.category_id)
        return <Link key={item.id} className="trip-row" to={'/recurring?edit='+item.id}><span><strong>{item.name}</strong>
          <small>{periods[item.interval_months]} · Day {item.due_day} · {item.active?'Active':'Paused'}</small></span>
          <span>{c&&<CategoryIcon name={c.icon} size={16}/>} {item.amount_type==='variable'?'~':''}{formatMoney(item.amount)}</span></Link>
      })}</section>}
  </section>
}
