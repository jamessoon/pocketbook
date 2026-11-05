import {useState} from 'react'
import {Link,useLocation,useSearchParams} from 'react-router-dom'
import {useQuery} from '@tanstack/react-query'
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import {IconChevronLeft,IconChevronRight} from '@tabler/icons-react'
import {supabase} from './client'
import {today,shiftMonth} from './dates'
import {formatMoney,dateLabel} from './entry-helpers'
import {CategoryIcon} from './icons'
import {shortMonth,summarize,type HistoryRow,type Occurrence} from './history-data'
import type {EntryProps} from './Entries'
import type {Category} from './types'

const fullMonth=(month:string)=>dateLabel(month,{month:'long',year:'numeric'})
const dayLabel=(date:string)=>dateLabel(date,{day:'numeric',month:'short',year:'numeric'})
const firstOfMonth=(input:string|null,fallback:string)=>input && /^(19|20)\d\d-(0[1-9]|1[0-2])-01$/.test(input)?input:fallback
const errorText=(error:unknown)=>error && typeof error==='object' && 'message' in error?String(error.message):'Please try again.'
function useHistory(household:string,start:string,category:string|null){
  return useQuery({queryKey:['spending-history',household,start,category],queryFn:async()=>{
    const {data,error}=await supabase.rpc('spending_history',{p_start:start,p_category:category})
    if(error)throw error
    return data as HistoryRow[]
  }})
}
type Totals=ReturnType<typeof summarize>
function HistoryChart({totals,categories,byCategory=false}:{totals:Totals;categories:Category[];byCategory?:boolean}){
  const chartRows=totals.months.map(m=>({...m,label:shortMonth(m.month),...m.byCategory}))
  const legend=categories.filter(c=>totals.ranked.some(r=>r.id===c.id))
  return <div className="history-chart"><ResponsiveContainer width="100%" height={226}>
    <BarChart data={chartRows} margin={{top:8,right:6,left:0,bottom:2}} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="var(--line)"/>
      <XAxis dataKey="label" stroke="var(--muted)" tick={{fontSize:11}} minTickGap={12} axisLine={false} tickLine={false}/>
      <YAxis width={52} stroke="var(--muted)" tick={{fontSize:10}} axisLine={false} tickLine={false}
        tickFormatter={v=>new Intl.NumberFormat('en-SG',{notation:'compact'}).format(Number(v))}/>
      <Tooltip formatter={value=>formatMoney(Number(value))} labelFormatter={(_,items)=>items[0]?.payload?.month ? fullMonth(items[0].payload.month) : ''}
        contentStyle={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:8}} cursor={{fill:'var(--tint)'}}/>
      {byCategory ? legend.map(c=><Bar key={c.id} name={c.name} dataKey={c.id} stackId="month" fill={c.color} isAnimationActive={false}/>)
        : <><Bar name="Posted" dataKey="posted" stackId="month" fill={categories[0]?.color || 'var(--accent)'} isAnimationActive={false}/>
          <Bar name="Scheduled" dataKey="scheduled" stackId="month" fill="var(--warm)" isAnimationActive={false}/></>}
    </BarChart></ResponsiveContainer>
    <details><summary>Monthly figures</summary><dl>{totals.months.map(m=><div key={m.month}><dt>{fullMonth(m.month)}</dt><dd>{formatMoney(m.total)}{m.scheduled>0 && <small> · {formatMoney(m.scheduled)} scheduled</small>}</dd></div>)}</dl></details>
  </div>
}
function HistoryError({error,retry}:{error:unknown;retry:()=>void}){
  return <p role="alert">{errorText(error)} <button onClick={retry}>Retry</button></p>
}
function PostedEntries({household,category,month,members,scheduled}:{household:string;category:string;month:string;members:EntryProps['members'];scheduled:Occurrence[]}){
  const [page,setPage]=useState(0)
  const query=useQuery({queryKey:['category-entries',household,category,month,page],queryFn:async()=>{
    const {data,error,count}=await supabase.from('expenses').select('id,spent_on,description,amount_sgd,is_fixed,sgd_confirmed,created_by',{count:'exact'})
      .eq('household_id',household).eq('category_id',category).is('trip_id',null).gte('spent_on',month).lt('spent_on',shiftMonth(month,1))
      .order('spent_on',{ascending:false}).order('created_at',{ascending:false}).order('id').range(page*30,page*30+29)
    if(error)throw error
    return {rows:data,count:count || 0}
  }})
  return <>
    {scheduled.length>0 && <section className="card"><h2>Scheduled this month</h2>{scheduled.map(s=><div key={s.id+s.due_on} className="trip-row"><span>{s.name}<small>Due {dayLabel(s.due_on)}</small></span>{formatMoney(s.amount)}</div>)}</section>}
    <section className="card"><h2>Posted expenses</h2>{query.isPending?<p>Loading expenses…</p>:query.error?<HistoryError error={query.error} retry={()=>query.refetch()}/>:<>
      {!query.data.rows.length && <p>No posted expenses this month.</p>}
      {query.data.rows.map(e=><Link className="trip-row" key={e.id} to={'/add?edit='+e.id}><span><strong>{e.description || 'Expense'}</strong>
        <small>{dayLabel(e.spent_on)} · {e.created_by ? members.find(m=>m.user_id===e.created_by)?.display_name || 'Household member' : e.is_fixed?'Recurring bill':'Household widget'}{e.sgd_confirmed?'':' · To confirm'}</small></span>{formatMoney(e.amount_sgd)}</Link>)}
      {(page>0 || query.data.count>(page+1)*30) && <nav className="ee-pages"><button disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><button disabled={query.data.count<=(page+1)*30} onClick={()=>setPage(page+1)}>Next</button></nav>}
    </>}</section></>
}
function CategoryHistory({props,category,month,change}:{props:EntryProps;category:Category;month:string;change:(m:string)=>void}){
  const query=useHistory(props.household.id,shiftMonth(month,-11),category.id)
  const totals=summarize(query.data || [],shiftMonth(month,-11),true,false)
  const selected=totals.months[11]
  const scheduled=query.data?.find(r=>r.month===month)?.occurrences || []
  return <section className="history-page"><Link to="/">‹ Overview</Link><div className="section-head"><h1><CategoryIcon name={category.icon} size={27}/> {category.name}</h1>
    {!category.archived&&<Link className="primary desktop-add" to={'/add?category='+category.id}>Add expense</Link>}</div>
    <div className="month-nav"><button aria-label="Previous month" onClick={()=>change(shiftMonth(month,-1))}><IconChevronLeft/></button><span>{fullMonth(month)}</span><button aria-label="Next month" onClick={()=>change(shiftMonth(month,1))}><IconChevronRight/></button></div>
    {query.isPending?<p>Loading history…</p>:query.error?<HistoryError error={query.error} retry={()=>query.refetch()}/>:<>
      <section className="card"><small>Monthly total</small><strong className="hero-num">{formatMoney(selected.total)}</strong><dl>
        <div><dt>Posted</dt><dd>{formatMoney(selected.posted)}</dd></div><div><dt>Scheduled</dt><dd>{formatMoney(selected.scheduled)}</dd></div></dl></section>
      <section className="card"><h2>Last 12 months</h2><p className="muted">{formatMoney(totals.average)} monthly average</p>
        <HistoryChart totals={totals} categories={[category]}/></section>
      <PostedEntries key={category.id+month} household={props.household.id} category={category.id} month={month} members={props.members} scheduled={scheduled}/>
    </>}
  </section>
}

function YearHistory({props,year,change}:{props:EntryProps;year:number;change:(n:number)=>void}){
  const [fixed,setFixed]=useState(true),[trips,setTrips]=useState(false)
  const start=year+'-01-01'
  const query=useHistory(props.household.id,start,null)
  const totals=summarize(query.data || [],start,fixed,trips)
  return <section className="history-page"><Link to="/">‹ Overview</Link><h1>Yearly overview</h1>
    <div className="month-nav"><button aria-label="Previous year" disabled={year<=1900} onClick={()=>change(year-1)}><IconChevronLeft/></button><span>{year}</span><button aria-label="Next year" disabled={year>=2099} onClick={()=>change(year+1)}><IconChevronRight/></button></div>
    <div className="history-controls"><label><input type="checkbox" checked={fixed} onChange={e=>setFixed(e.target.checked)}/>Include recurring costs</label>
      <label><input type="checkbox" checked={trips} onChange={e=>setTrips(e.target.checked)}/>Include trips</label></div>
    {query.isPending?<p>Loading year…</p>:query.error?<HistoryError error={query.error} retry={()=>query.refetch()}/>:<>
      <section className="card"><small>Year total</small><strong className="hero-num">{formatMoney(totals.total)}</strong>
        <p className="muted">{formatMoney(totals.average)} monthly average across 12 months</p><dl>
        <div><dt>Day-to-day</dt><dd>{formatMoney(totals.daily)}</dd></div>
        {fixed&&<><div><dt>Recurring · posted</dt><dd>{formatMoney(totals.fixed)}</dd></div><div><dt>Recurring · scheduled</dt><dd>{formatMoney(totals.scheduled)}</dd></div></>}
        {trips&&<div><dt>Trips</dt><dd>{formatMoney(totals.trips)}</dd></div>}</dl></section>
      <section className="card"><h2>Monthly spending by category</h2><HistoryChart totals={totals} categories={props.categories} byCategory/></section>
      <section className="card"><h2>Top categories</h2>{!totals.ranked.length&&<p>No spending for this selection.</p>}
        {totals.ranked.map(({id,amount})=>{const cat=props.categories.find(c=>c.id===id)
          return <div key={id} className="trip-row"><span style={{color:cat?.color}}><CategoryIcon name={cat?.icon || 'dots'} size={17}/></span><span className="history-category">{cat?.name || 'Category'}</span><strong>{formatMoney(amount)}</strong></div>})}</section>
    </>}
  </section>
}
export default function History(props:EntryProps){
  const {pathname}=useLocation()
  const [params,setParams]=useSearchParams()
  if(pathname==='/year'){
    const input=params.get('year')
    const year=input && /^(19|20)\d\d$/.test(input)?Number(input):Number(today(props.household.timezone).slice(0,4))
    return <YearHistory props={props} year={year} change={n=>setParams({year:String(n)})}/>
  }
  const category=props.categories.find(c=>c.id===params.get('id'))
  if(!category)return <section><Link to="/">‹ Overview</Link><p>This category is unavailable.</p></section>
  const month=firstOfMonth(params.get('month'),props.month)
  return <CategoryHistory props={props} category={category} month={month} change={m=>setParams({id:category.id,month:m})}/>
}
