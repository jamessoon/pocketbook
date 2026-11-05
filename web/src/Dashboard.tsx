import {Link} from 'react-router-dom'
import {useQuery} from '@tanstack/react-query'
import {IconChevronLeft,IconChevronRight,IconPlus,IconCalendarMonth,IconChevronRight as Arrow,IconCircleCheck,IconAlertCircle} from '@tabler/icons-react'
import {supabase} from './client'
import {CategoryIcon} from './icons'
import {shiftMonth,today} from './dates'
import type {Category,Household} from './types'
const cash=(n:number)=>new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD',currencyDisplay:'narrowSymbol'}).format(n)
type FixedItem={name:string;due_on:string;amount:number;posted:boolean;confirmed:boolean}
type Summary={monthly_budget:number;fixed_costs:number;day_to_day_spent:number;daily_budget:number;left_today:number;remaining:number;fixed_items:FixedItem[]}
export function Dashboard({household,categories,month,onMonth}:{household:Household;categories:Category[];month:string;onMonth:(m:string)=>void}){
  const current=month.slice(0,7)===today(household.timezone).slice(0,7)
  const period=new Intl.DateTimeFormat('en-SG',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month))
  const query=useQuery({queryKey:['overview',household.id,month],queryFn:async()=>{
    const [summary,confirm]=await Promise.all([supabase.rpc('month_summary',{p_month:month}),supabase.from('expenses').select('id',{head:true,count:'exact'}).eq('household_id',household.id).eq('sgd_confirmed',false)])
    if(summary.error)throw summary.error
    if(confirm.error)throw confirm.error
    const totals=new Map<string,number>()
    for(let start=0;;start+=500){
      const {data,error}=await supabase.from('expenses').select('id,category_id,amount_sgd').eq('household_id',household.id).is('trip_id',null).gte('spent_on',month).lt('spent_on',shiftMonth(month,1)).order('id').range(start,start+499)
      if(error)throw error
      for(const row of data) totals.set(row.category_id,(totals.get(row.category_id) || 0)+Number(row.amount_sgd))
      if(data.length<500)break
    }
    return {summary:summary.data as Summary,count:confirm.count || 0,totals}
  }})
  const q=query.data,s=q?.summary
  const rows=categories.map(c=>({...c,value:q?.totals.get(c.id) || 0})).filter(c=>!c.archived || c.value>0)
  const total=rows.reduce((n,c)=>n+c.value,0)
  const shortcuts = rows.filter(c=>!c.archived)
  const sideRows = Math.max(2,Math.ceil((shortcuts.length-10)/2))
  const bottomRow = sideRows+2
  const positions = [
    ...Array.from({length:5},(_,i)=>[1,i+1]),
    ...Array.from({length:sideRows},(_,i)=>[[i+2,1],[i+2,5]]).flat(),
    ...Array.from({length:5},(_,i)=>[bottomRow,i+1]),
  ]
  let angle=0
  const slices=rows.filter(c=>c.value>0).map(c=>{const start=angle;const length=c.value/total*100;angle+=length;return <circle key={c.id} cx="72" cy="72" r="58" pathLength="100" fill="none" stroke={c.color} strokeWidth="14" strokeDasharray={length+' '+(100-length)} strokeDashoffset={-start} transform="rotate(-90 72 72)"/>})
  return <><header className="page-head"><div><small>{household.name}</small><h1>Overview</h1></div><Link className="primary desktop-add" to="/add"><IconPlus size={18}/>Add expense</Link></header>
   <div className="month-nav"><button aria-label="Previous month" onClick={()=>onMonth(shiftMonth(month,-1))}><IconChevronLeft/></button><span><IconCalendarMonth size={17}/>{period}</span><button aria-label="Next month" onClick={()=>onMonth(shiftMonth(month,1))}><IconChevronRight/></button></div>
   {query.isError?<p role="alert">Couldn’t load spending. <button onClick={()=>query.refetch()}>Retry</button></p>:!s?<p role="status">Loading spending…</p>:<>
   {!!q?.count && <Link className="banner" to="/confirm"><IconAlertCircle size={19}/>{q.count} {q.count===1?'expense':'expenses'} to confirm <Arrow size={17}/></Link>}
   <div className="cards"><section className="card spending"><div className="section-head"><h2>Monthly spending</h2></div>
   <div className="chart-shortcuts" style={{gridTemplateRows:'auto repeat('+sideRows+', minmax(44px,1fr)) auto'}}>
   {shortcuts.map((c,i)=><Link key={c.id} className="chart-shortcut" title={c.name}
     aria-label={'Quick add: '+c.name} to={'/add?category='+c.id}
     style={{gridRow:positions[i][0],gridColumn:positions[i][1],color:c.color}}>
     <CategoryIcon name={c.icon} size={25}/>{c.value>0 && <small>{Math.round(c.value/total*100)}%</small>}
   </Link>)}
   <div className="ring" style={{gridRow:'2 / '+bottomRow,gridColumn:'2 / 5'}}><svg viewBox="0 0 144 144" aria-label="Spending by category"><circle cx="72" cy="72" r="58" stroke="var(--line)" fill="none" strokeWidth="14"/>{slices}</svg><div><small>Total spent</small><strong>{cash(total)}</strong></div></div></div>
   <p className="muted centered">of {cash(s.monthly_budget)} budget{current?' · '+cash(s.daily_budget)+'/day left':''}</p></section>
   <section className="card budget"><h2>Household budget</h2><small>Remaining this month</small><strong className="hero-num">{cash(s.remaining)}</strong><div className="budget-bar" aria-label="Fixed costs and day-to-day spending as shares of budget">{[s.fixed_costs,s.day_to_day_spent].map((x,i)=><i key={i} style={{width:Math.min(100,100*x/Math.max(1,s.monthly_budget))+'%'}}/>)}</div>
   <dl><div><dt>Fixed costs</dt><dd>{cash(s.fixed_costs)}</dd></div><div><dt>Day-to-day spending</dt><dd>{cash(s.day_to_day_spent)}</dd></div>{current&&<><div><dt>Daily budget</dt><dd>{cash(s.daily_budget)}</dd></div><div><dt>Left today</dt><dd className={s.left_today<0?'negative':''}>{cash(s.left_today)}</dd></div></>}</dl>
   {s.fixed_items?.map((f,i)=><div key={i} className="fixed-line">{f.posted&&<IconCircleCheck size={16}/>} {f.name} · {f.posted?'Paid':f.due_on} · {f.confirmed?'':'~'}{cash(f.amount)}</div>)}</section></div>
   <section className="category-section"><div className="section-head"><h2>Categories</h2><Link to="/settings">Manage categories</Link></div><div className="category-grid">{rows.map(c=><div key={c.id} className="category-card"><Link className="category-link" to={'/expenses?category='+c.id}><span className="glyph" style={{color:c.color}}><CategoryIcon name={c.icon} size={21}/></span><span>{c.name}<strong>{cash(c.value)}</strong></span></Link>{!c.archived&&<Link className="category-add" aria-label={'Add '+c.name+' expense'} to={'/add?category='+c.id}><IconPlus size={18}/></Link>}</div>)}</div></section></>}
   </>
}
