import {createClient} from "https://esm.sh/@supabase/supabase-js@2.49.8";

Deno.serve(async request => {
  if(request.method!=="POST") return new Response(null,{status:405});
  const secret=request.headers.get("x-hhexpense-job");
  if(!secret || !/^[0-9a-f]{64}$/.test(secret)) return new Response(null,{status:401});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data,error}=await admin.rpc("post_due_recurring",{job_secret:secret});
  if(error) return Response.json({error:"Posting failed"},{status:error.code==="42501"?403:500});
  return Response.json({posted:data});
});
