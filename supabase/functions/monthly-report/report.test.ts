import {describe,it,expect,vi} from 'vitest'
import {emailPayload,spendingChange,highlights,canRetry,deliverEmail,type ReportStats} from './report'
const stats:ReportStats={month:'2025-05-01',budget:1000,total:50,fixed:0,daily:50,previous:40,unconfirmed:1,days_over:2,
  categories:[{id:'private-id',name:'House <b>rent</b>',icon:'home',amount:50,previous:40,prior_average:35}],
  trips:[{name:'Alex school trip',amount:20}],largest:[{description:'Alex <b> alex@example.test',icon:'custom-private-name',amount:50,spent_on:'2025-05-01',trip:false}]}
describe('report providers and delivery',()=>{
  it('describes increases, decreases, no change and a zero baseline',()=>{
    expect(spendingChange(50,40)).toBe('Up $10.00 (25%) from $40.00 last month')
    expect(spendingChange(30,40)).toBe('Down $10.00 (25%) from $40.00 last month')
    expect(spendingChange(40,40)).toContain('Unchanged')
    expect(spendingChange(20,0)).toBe('Up $20.00 from $0.00 last month')
  })
  it('ranks the top three categories and identifies the largest individual expense',()=>{
    const s={...stats,categories:[6,15,10,2].map(n=>({...stats.categories[0],name:String(n),amount:n})),
      largest:[{...stats.largest[0],amount:1},stats.largest[0]],new_descriptions:[{description:'Desk <lamp>',amount:10,entries:2}]}
    const {top,highest}=highlights(s)
    expect(top.map(c=>c.amount)).toEqual([15,10,6]);expect(highest?.amount).toBe(50)
    const mail=emailPayload(s,'from','to')
    expect(mail.text).toContain('Up $10.00 (25%)')
    expect(mail.text).toContain('Desk <lamp> · $10.00 across 2 entries')
    expect(mail.html).toContain('Desk &lt;lamp&gt;')
  })
  it('renders one private recipient and escapes dynamic HTML',()=>{
    const html=emailPayload(stats,'reports@example.test','member@example.test')
    expect(html.to).toEqual(['member@example.test'])
    expect(html.html).toContain('House &lt;b&gt;rent&lt;/b&gt;')
    expect(html.text).toContain('Budget remaining: $950.00')
    expect(html.html).toContain('SGD') // currency is labelled in the report email
  })
  it('reuses exactly one delivery payload and key after a lost response, then skips accepted recipients',async()=>{
    const delivery={id:'delivery1',payload:{to:['member@example.test'],text:'report'},first_attempt:new Date().toISOString(),provider_id:null as string|null}
    const requests:RequestInit[]=[]
    const resend=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      requests.push(init!); if(requests.length===1)throw new Error('Disconnected')
      return Response.json({id:'accepted'})
    })
    const mark=async(id:string)=>{delivery.provider_id=id}
    await expect(deliverEmail(delivery,'key',mark,resend)).rejects.toThrow('Disconnected')
    await deliverEmail(delivery,'key',mark,resend)
    await deliverEmail(delivery,'key',mark,resend)
    expect(requests).toHaveLength(2)
    expect(requests[0].headers).toEqual(requests[1].headers)
    expect(requests[0].body).toEqual(requests[1].body)
    expect(delivery.provider_id).toBe('accepted')
  })
  it('stops ambiguous delivery retries before the provider forgets the key',()=>{
    expect(canRetry('2026-10-01T00:00:00Z',Date.parse('2026-10-01T22:59:00Z'))).toBe(true)
    expect(canRetry('2026-10-01T00:00:00Z',Date.parse('2026-10-01T23:00:00Z'))).toBe(false)
  })
})
