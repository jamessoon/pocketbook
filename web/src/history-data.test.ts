import {describe,it,expect} from 'vitest'
import {summarize,type HistoryRow} from './history-data'
const rows:HistoryRow[]=[
  {month:'2026-01-01',category_id:'house',daily:2.25,fixed:10,trips:5,scheduled:40,occurrences:[]},
  {month:'2026-01-01',category_id:'food',daily:8.5,fixed:0,trips:0,scheduled:0,occurrences:[]},
  {month:'2026-12-01',category_id:'house',daily:0,fixed:0,trips:0,scheduled:10,occurrences:[]},
]
describe('history totals',()=>{
  it('shows the full 12-month window and distinguishes scheduled bills from posted spending',()=>{
    const data=summarize(rows,'2026-01-01',true,false)
    expect(data.months).toHaveLength(12)
    expect(data.months[0]).toMatchObject({posted:20.75,scheduled:40,total:60.75})
    expect(data.months[1].total).toBe(0)
    expect(data.total).toBe(70.75)
    expect(data.average).toBe(70.75/12)
    expect(data.ranked[0]).toEqual({id:'house',amount:62.25})
  })
  it('toggles trips and recurring independently and includes empty months in the average',()=>{
    expect(summarize(rows,'2026-01-01',false,true).total).toBe(15.75)
    expect(summarize(rows,'2026-01-01',true,true).total).toBe(75.75)
    expect(summarize(rows,'2026-01-01',false,false).total).toBe(10.75)
    expect(summarize([],'2026-01-01',true,true).average).toBe(0)
  })
})
