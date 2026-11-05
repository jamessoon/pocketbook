import {useQuery} from '@tanstack/react-query'
import {supabase} from './client'
import {dateLabel} from './entry-helpers'

export type Bill = {
  id:string; name:string;category_id:string;amount:number;amount_type:'fixed'|'variable'
  interval_months:number;due_day:number;start_month:string;ends_on:string|null;stop_from_month:string|null;stop_from_date:string|null;active:boolean;last_posted_month:string|null
}

export function useRecurringBills(householdId:string){
  return useQuery({queryKey:['recurring',householdId],queryFn:async()=>{
    const bills:Bill[]=[]
    for(let offset=0;;offset+=500){
      const {data,error}=await supabase.from('recurring_items').select('*')
        .eq('household_id',householdId).order('active',{ascending:false}).order('name').order('id').range(offset,offset+499)
      if(error)throw error
      bills.push(...data.filter(row=>!row.deleted_at))
      if(data.length<500)return bills
    }
  }})
}

type ScheduleDetails = Pick<Bill,'interval_months'> & Partial<Pick<Bill,'ends_on'|'stop_from_month'|'stop_from_date'>>
export function recurringDetails(series?:ScheduleDetails|null){
  if(!series)return 'Recurring'
  const interval=series.interval_months
  const frequency=interval===0?'Every week':interval===1?'Every month':interval===12?'Every year':'Every '+interval+' months'
  const dates=series.ends_on?[series.ends_on]:[]
  for(const stop of [series.stop_from_month,series.stop_from_date]){
    if(!stop)continue
    const last=new Date(stop+'T12:00:00Z')
    last.setUTCDate(last.getUTCDate()-1)
    dates.push(last.toISOString().slice(0,10))
  }
  const end=dates.sort()[0]
  return frequency+' · '+(end?'Until '+dateLabel(end,{day:'numeric',month:'short',year:'numeric'}):'No end date')
}
