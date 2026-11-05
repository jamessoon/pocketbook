import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {deliverEmail,emailPayload,type ReportStats} from './report.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Cache-Control':'no-store'};
const reply=(status:number,data:unknown)=>Response.json(data,{status,headers:cors});
const env=(key:string)=>Deno.env.get(key) || '';
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  if(req.method!=='POST')return reply(405,{error:'POST required'});
  const url=env('SUPABASE_URL');
  const db=createClient(url,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const lease=crypto.randomUUID();
  let reportId:string|null=null;
  try{
    let household:string;
    const secret=req.headers.get('x-hhexpense-job');
    if(secret!==null){
      if(!/^[a-f0-9]{64}$/.test(secret))return reply(401,{error:'Invalid scheduler credential'});
      household=(await req.json()).household_id;
      if(typeof household!=='string')return reply(400,{error:'Household required'});
    }else{
      const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
      if(!token)return reply(401,{error:'Sign in to run a report.'});
      const userDb=createClient(url,env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}});
      const user=await userDb.auth.getUser(token);
      if(user.error || !user.data.user)return reply(401,{error:'Sign in again.'});
      const member=await userDb.from('members').select('household_id').eq('user_id',user.data.user.id).maybeSingle();
      if(member.error || !member.data)return reply(403,{error:'Join a household before running a report.'});
      household=member.data.household_id;
    }
    const claim=await db.rpc('claim_monthly_report',{p_household:household,p_lease:lease,p_job_secret:secret});
    if(claim.error)return reply(claim.error.code==='42501'?403:500,{error:'Could not claim report. Check the report migration and scheduler credential.'});
    const work=claim.data;
    if(work.status!=='claimed')return reply(200,{status:work.status==='sent'?'already_sent':work.status});
    reportId=work.id;
    const stats:ReportStats=work.stats;
    async function ownedUpdate(fields:Record<string,unknown>){
      const result=await db.from('reports').update(fields).eq('id',work.id).eq('lease',lease).select('id').maybeSingle();
      if(result.error || !result.data)throw new Error('Report lease expired; retry from Reports.');
    }
    const recipients=await db.from('report_recipients').select('email').eq('household_id',household);
    if(recipients.error)throw new Error('Could not read report recipients.');
    if(!recipients.data.length)return reply(200,{status:'saved'});
    const from=env('REPORT_FROM_EMAIL'),resend=env('RESEND_API_KEY');
    if(!from || !resend)throw new Error('Report saved. Set RESEND_API_KEY and REPORT_FROM_EMAIL to send it.');
    const failures:string[]=[];
    let newlyAccepted=0, previouslyAccepted=0;
    for(const {email} of recipients.data){
      await ownedUpdate({lease_until:new Date(Date.now()+600000).toISOString()});
      try {
        // Check the latest subscription and retain exactly the same payload and key across retries.
        const current=await db.from('report_recipients').select('email').eq('household_id',household).eq('email',email).maybeSingle();
        if(current.error)throw new Error('Could not check the email subscription.');
        if(!current.data)continue;
        const saved=await db.from('report_deliveries').upsert({report_id:reportId,email,payload:emailPayload(stats,from,email)},
          {onConflict:'report_id,email',ignoreDuplicates:true});
        if(saved.error)throw new Error('Could not prepare email delivery.');
        const lookup=await db.from('report_deliveries').select('id,payload,first_attempt,provider_id').eq('report_id',reportId).eq('email',email).single();
        if(lookup.error)throw new Error('Could not read delivery status.');
        const delivery=lookup.data;
        if(!delivery.provider_id && work.ai_text && delivery.payload.text.endsWith('\n\n'+work.ai_text)){
          throw new Error('A pending email from the earlier report format needs a Resend dashboard check before retrying.');
        }
        if(delivery.provider_id){previouslyAccepted++;continue;}
        await deliverEmail(delivery,resend,async providerId=>{
          const mark=await db.from('report_deliveries').update({provider_id:providerId}).eq('id',delivery.id);
          if(mark.error)throw new Error('Could not record the accepted delivery. Retry from Reports.');
        });
        newlyAccepted++;
      }catch(error){failures.push(error instanceof Error?error.message:'Email delivery failed.');}
    }
    if(failures.length)throw new Error(failures.length+' delivery attempt(s) pending. '+failures[0]);
    if(!newlyAccepted && !previouslyAccepted)return reply(200,{status:'saved'});
    await ownedUpdate({sent_at:new Date().toISOString()});
    return reply(200,{status:newlyAccepted?'accepted':'already_sent',newlyAccepted});
  }catch(error){
    return reply(502,{error:error instanceof Error?error.message:'Report failed. Check the function logs.'});
  }finally{
    if(reportId)await db.from('reports').update({lease:null,lease_until:null}).eq('id',reportId).eq('lease',lease);
  }
});
