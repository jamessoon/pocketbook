-- Run once in the SQL editor after deploying post-recurring and enabling Cron and pg_net.
-- This URL is the production HHExpense project. Change it for another installation.
select cron.schedule('hhexpense-recurring','5 16 * * *',$job$
  select net.http_post(
    url:='https://cmcsyolrefbyvzqfqjox.supabase.co/functions/v1/post-recurring',
    headers:=jsonb_build_object('Content-Type','application/json','x-hhexpense-job',
      (select secret from hh_private.recurring_job_key where singleton)),
    body:='{}'::jsonb,timeout_milliseconds:=60000
  )
$job$);
