import {useQuery} from '@tanstack/react-query'
import {supabase} from './client'

export interface Trip {
  id:string; name:string; start_date:string; end_date:string; budget:number|null; archived:boolean
}
export function useTrips(householdId:string) {
  return useQuery({queryKey:['trips',householdId],queryFn:async()=>{
    const trips:Trip[]=[]
    for(let start=0;;start+=500){
      const {data,error}=await supabase.from('trips').select('id,name,start_date,end_date,budget,archived')
        .eq('household_id',householdId).order('start_date',{ascending:false}).order('id').range(start,start+499)
      if(error)throw error
      trips.push(...data)
      if(data.length<500)return trips
    }
  }})
}
export function defaultTrip(trips:Trip[], day:string){
  const matches=trips.filter(t=>!t.archived && t.start_date<=day && t.end_date>=day)
  return matches.length===1 ? matches[0].id : ''
}
