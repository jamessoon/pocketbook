export function today(timezone:string) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
}
export function shiftMonth(month:string,offset:number) {
  const date = new Date(month+'T12:00:00Z')
  date.setUTCMonth(date.getUTCMonth()+offset,1)
  return date.toISOString().slice(0,10)
}
