-- Run after deploying monthly-report and setting its server-side secrets.
-- Singapore 08:00 on the 1st is midnight UTC the same day.
select cron.schedule('hhexpense-monthly-report','0 0 1 * *',$job$
 select net.http_post(
   url:='https://cmcsyolrefbyvzqfqjox.supabase.co/functions/v1/monthly-report',
   headers:=jsonb_build_object('Content-Type','application/json','x-hhexpense-job',
     (select secret from hh_private.report_job_key where singleton)),
   body:=jsonb_build_object('household_id',h.id),timeout_milliseconds:=120000
 ) from public.households h
$job$);
