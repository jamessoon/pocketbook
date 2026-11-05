import {describe,it,expect,vi} from 'vitest'
import {analyze,aiStats,emailPayload,canRetry,deliverEmail,type ReportStats} from './report'
const stats:ReportStats={month:'2025-05-01',budget:1000,total:50,fixed:0,daily:50,previous:40,unconfirmed:1,days_over:2,
  categories:[{id:'private-id',name:'Alex Smith',icon:'home',amount:50,previous:40,prior_average:35}],
  trips:[{name:'Alex school trip',amount:20}],largest:[{description:'Alex <b> alex@example.test',icon:'custom-private-name',amount:50,spent_on:'2025-05-01',trip:false}]}
describe('report providers and delivery',()=>{
  it('sends only curated descriptions and aggregate figures to AI',()=>{
    const payload=JSON.stringify(aiStats(stats))
    for(const secret of ['Alex','example.test','private-id','custom-private-name'])expect(payload).not.toContain(secret)
    expect(payload).toContain('housing')
  })
  it.each(['openai','anthropic'])('uses the configured %s provider',async provider=>{
    const fetcher=vi.fn(async()=>Response.json(provider==='openai'?{output:[{content:[{type:'output_text',text:'Monthly insight.'}]}]}:{content:[{type:'text',text:'Monthly insight.'}]}))
    expect(await analyze(stats,{provider,model:'configured-model',key:'fixture'},fetcher)).toBe('Monthly insight.')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('renders one private recipient and escapes dynamic HTML',()=>{
    const html=emailPayload(stats,'Review <script>rent</script>','reports@example.test','member@example.test')
    expect(html.to).toEqual(['member@example.test'])
    expect(html.html).toContain('&lt;script&gt;')
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
