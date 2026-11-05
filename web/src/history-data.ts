import {shiftMonth} from './dates'
export type Occurrence={id:string;name:string;due_on:string;amount:number}
export type HistoryRow={month:string;category_id:string;daily:number;fixed:number;trips:number;scheduled:number;occurrences:Occurrence[]}
export const shortMonth=(month:string)=>new Intl.DateTimeFormat('en-SG',{month:'short',timeZone:'UTC'}).format(new Date(month))
const cents=(amount:number)=>Math.round(Number(amount)*100)
export function summarize(rows:HistoryRow[],start:string,includeFixed:boolean,includeTrips:boolean){
  const months=Array.from({length:12},(_,i)=>({month:shiftMonth(start,i),posted:0,scheduled:0,total:0,byCategory:{} as Record<string,number>}))
  const index=new Map(months.map(m=>[m.month,m]))
  const categoryTotals=new Map<string,number>()
  let daily=0,fixed=0,trips=0,scheduled=0
  for(const row of rows){
    const m=index.get(row.month)
    if(!m)continue
    const day=cents(row.daily),bill=includeFixed?cents(row.fixed):0,trip=includeTrips?cents(row.trips):0,due=includeFixed?cents(row.scheduled):0
    const amount=day+bill+trip+due
    m.posted+=(day+bill+trip)/100
    m.scheduled+=due/100
    m.total+=amount/100
    m.byCategory[row.category_id]=(m.byCategory[row.category_id]||0)+amount/100
    categoryTotals.set(row.category_id,(categoryTotals.get(row.category_id)||0)+amount)
    daily+=day;fixed+=bill;trips+=trip;scheduled+=due
  }
  const total=(daily+fixed+trips+scheduled)/100
  const ranked=[...categoryTotals].filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).map(([id,amount])=>({id,amount:amount/100}))
  return {months,total,average:total/12,ranked,daily:daily/100,fixed:fixed/100,trips:trips/100,scheduled:scheduled/100}
}
