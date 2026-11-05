# HHExpense

Phase 1 delivers the shared Singapore household tracker. Use the web app for day-to-day spending, category management, budgets and statement confirmation. Create one household, then share its six-digit ID from Settings. Each device selects a member name once. A household member can edit or delete another member’s expense.

## 1. Windows and Supabase

1. Install Node.js 22 LTS or newer, Git and the Supabase CLI. Open PowerShell in this repository. Run `node --version`, `npm.cmd ci`, `npm.cmd test` and `npm.cmd run build`.
2. Create a free Supabase project. Keep the database password private. Under the project’s Connect or API settings, copy the project URL and publishable key. The legacy anon key also works.
3. From the repository root, run the following, replacing YOUR_PROJECT_REF with the identifier shown in the project URL. Use a fresh project for the first migration.

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Alternatively paste each file from `supabase/migrations` into the project's SQL Editor in filename order and run it once. Choose either the CLI or SQL Editor path. When using the editor, keep a record of applied versions before switching to CLI migration management. Run `supabase/tests/household_isolation.sql` in the fresh project's SQL Editor as the project administrator. The script creates temporary test households in a transaction and rolls it back.

## 2. Deploy the currency function

From the linked checkout run:

```powershell
supabase functions deploy fx-rate --no-verify-jwt
```

The function verifies the bearer token with Supabase Auth and checks household membership before fetching a rate. Hosted Supabase provides its URL and service-role secret to the function. Only the publishable key goes into the web environment. Phase 1 requires no scheduled jobs. For the later recurring and report phases, enable **Cron (pg_cron)** and **pg_net** from Database → Extensions when those phases are installed. [Supabase Edge Function deployment](https://supabase.com/docs/guides/functions/deploy)

Rates are cached by Singapore date. For example, VND expenses retain their original VND amount, are estimated in SGD, then appear under **To confirm** until a member enters the actual SGD charge. [ExchangeRate-API](https://www.exchangerate-api.com/docs/free)

## 3. Configure sign-in and run locally

1. Enable **Allow anonymous sign-ins** in your Supabase Auth settings. This creates an authenticated session for each device. Keep the anonymous signup rate limit enabled. HHExpense also limits household ID guesses to five per device per 15 minutes. [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
2. Apply all migrations, including the household sign-in migration. Existing households receive six-digit IDs and existing signed-in devices keep their memberships. Read the new ID in Settings or, as project administrator, from the household row in the Supabase dashboard.
3. Copy the sample environment and enter your project's URL and publishable key.

```powershell
Copy-Item web/.env.example web/.env.local
notepad web/.env.local
npm.cmd run dev
```

Choose **Create a household** on the first device. On another device enter the six-digit ID, including any leading zero, then select your existing name or add a name. Anyone with the ID can join and select a household member. Keep it within your household. Reopening the same browser or Home Screen installation restores its session. Signing out applies to that device. Clearing site data or an expired/revoked session requires entering the ID again.

## 4. GitHub and Vercel

Review `git status` and check the environment files are ignored. Commit the Phase 1 source to the existing repository and push to your GitHub repository. Import the repository from Vercel’s New Project screen using a free Hobby account for personal use. Select the repository root as Root Directory. The checked-in Vercel configuration builds with `npm run build` and serves `web/dist`. Select Node 22 or newer. Add the two public web environment variables from step 3 to the intended Vercel environments, deploy, and open the resulting HTTPS URL. Test the deployed URL with a separate browser session for the second household member.

## 5. Install and check the iPhone app

Open the deployed HTTPS URL in Safari, tap **Share → Add to Home Screen**, enable **Open as Web App** if offered, then tap **Add**. Open HHExpense from its Home Screen icon and sign in there. In Settings try System, Light and Dark. Quick add opens from a category’s plus button or **Add expense**. Tap keypad digits, pick a suggestion, and save. Check both members see the entry. Test a foreign-currency expense, edit it, confirm its statement amount and try deletion with Undo.

The service worker caches the versioned app shell. Household records and API responses require a connection. Trips are covered in step 7. Recurring bills are covered in step 8. Monthly reports are covered in step 10.

## Repeat the Phase 1 checks

Run `npm.cmd test` to apply the migrations to a fresh embedded PostgreSQL instance and check SQL/TypeScript budget parity and household isolation. To repeat the browser checks with fixture data, open a separate PowerShell in the repository and run:

```powershell
$env:VITE_SUPABASE_URL='https://hh-test.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='test-public-key'
npm.cmd run dev -- --host 127.0.0.1 --port 5178 --strictPort
```

In a second PowerShell window run:

```powershell
$env:HH_BROWSER='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node scripts/check-overview.mjs
node scripts/verify-account.mjs
node scripts/verify-entry-ui.mjs
```

These browser scripts intercept backend traffic and exercise light and dark modes. Use your real project for the two-member sign-in, exchange-rate and iPhone installation checks.

## 6. Install the Scriptable widgets on iPhone

1. Apply any outstanding widget migrations in filename order. If the widgets are already installed, apply only `supabase/migrations/202611050005_widget_categories.sql` to enable all active categories.
2. Install Scriptable. In HHExpense open **Settings → iPhone widget → Set up Scriptable → Copy widget script**. Paste into the Scriptable script named **HHExpense** (replace the entire old script when updating). Keep the configured script private.
3. Add a **Scriptable** widget, choose **HHExpense**, and use Parameter **summary** for a small or medium budget view. Use Parameter **add** on a medium or large widget for category shortcuts. Existing widget placements can be reused after replacing the script.
4. Widget taps open the deployed HHExpense site in Scriptable’s full-screen web view. A category opens the normal Add expense keypad with that category selected. If prompted, enter your household ID and choose your name in this view. The Home Screen installation and Scriptable can have separate sessions.
5. Summary displays its last successful update time and requests a fresh server total approximately every five minutes; iOS controls the actual schedule. App-created entries are included the next time the widget runs. Tap Summary to see current Overview figures; dismissing the view also fetches the summary again. Offline reads show the cached view marked **Stale**.
6. To revoke access choose **Settings → iPhone widget → Rotate token → Replace token**. Copy the new script to each iPhone. Old tokens immediately lose server access; cached views can remain until refreshed.

## 7. Trips and group expenses

Apply `supabase/migrations/202611050006_trips.sql` once to enable trip creation and editing. From **Trips**, create a trip with dates and an optional SGD budget. Open it and use **Add expense**. You can also select a trip in the regular keypad, or edit an existing expense to move it into or out of a trip.

If exactly one unarchived trip covers today, quick add selects it by default. Choose **No trip** for everyday purchases. Overlapping trips require a choice. Trip totals include estimates until confirmed. Monthly and daily household budgets exclude trip spending. Archiving a trip preserves its expense history.
## 8. Recurring bills and daily posting

1. Apply `supabase/migrations/202611050007_recurring.sql` in your hosted Supabase SQL Editor.
2. Deploy `supabase/functions/post-recurring/index.ts` as an Edge Function named **post-recurring**. Turn **Verify JWT with legacy secret** off, or use `supabase functions deploy post-recurring --no-verify-jwt`. The function verifies a dedicated scheduler secret through the database; this secret is generated privately by the migration.
3. In Supabase enable **Cron (pg_cron)** and **pg_net**. Run `supabase/jobs/schedule-recurring.sql` as project administrator. It targets the production HHExpense project and registers one named job at **16:05 UTC**, which is **00:05 Singapore time** the next day. Re-running the script updates the named schedule. Check Cron run history and the post-recurring Function logs after its first run.
4. In HHExpense choose **Settings → Recurring costs → New bill**. Select category, schedule, start month and amount. For a variable bill enter an estimate; when it posts, **To confirm** lets you enter the actual SGD charge. A due day of 31 falls on the last day of shorter months.
5. New or reactivated schedules start posting from the current month at the earliest, even if an earlier start month sets their cadence. Bills already due are posted on the next job run. Active schedules catch up missed runs, and retries skip already processed months. Pause a schedule by editing it and clearing **Active**. The posted expense history is retained.

### Date ranges in quick add

Apply `supabase/migrations/202611050008_recurring_ranges.sql` after the recurring migration. In **Add expense → Today**, choose **One time** to set a date, or **Recurring** to select **From** and **To** for a recurring SGD household bill. Save once on the keypad. Apply the weekly-frequency migration below to choose Weekly, Monthly or Yearly. The scheduler posts each due date within the inclusive range, including missed dates if you choose a past start. A day such as the 31st falls on the last day of shorter months. After the end date the bill stops posting and reserving budget. Existing open-ended schedules continue as before.

### Delete a recurring expense

Apply `supabase/migrations/202611050009_recurring_deletion.sql` after the date-range migration. In **Expenses**, open a row marked with the repeat icon and choose **Delete**, or use the row’s trash button. **Only this entry** skips that occurrence and keeps later bills. **Only future entries** keeps the selected occurrence and removes later ones. **This and future entries** removes the selected occurrence and later ones. The cutoff is relative to the selected entry, including later entries already posted. Undo is available for six seconds before the change is applied.

### Weekly, monthly and yearly quick add

After migrations 008 and 009, apply `supabase/migrations/202611050010_weekly_recurrence.sql`. In **Today → Recurring**, choose **Weekly**, **Monthly** (default) or **Yearly** plus From and To. Weekly repeats every seven days starting on From, including across month boundaries. Monthly and yearly repeats use the original calendar day, clamped to month end when necessary. Each due occurrence within the inclusive range is reserved in that month's budget and posted by the existing scheduler. Weekly deletion choices operate on individual occurrences.

In **Expenses**, scheduled occurrences for the selected month appear separately from posted expenses. Both display the recurring description, frequency and end date (or **No end date**).

To remove an entire schedule, apply `supabase/migrations/202611050011_delete_recurring_bill.sql` and go to **Settings → Recurring costs**. Tap the trash icon beside a bill and confirm **Delete bill**. This cancels unposted occurrences and keeps previously posted expenses and their budget history.

## 9. Spending history

Apply `supabase/migrations/202611050012_spending_history.sql` after migration 011. Tap a category card in Overview for its selected month, posted entries, scheduled bills and trailing 12-month chart. Category shortcuts around the donut still open the keypad. **Yearly overview** next to the Overview month selector shows twelve months stacked by category, top categories and a spending breakdown. Recurring costs include posted bills plus still-scheduled occurrences; trips are separately selectable. Both averages divide by twelve, including empty months.

## 10. Monthly reports and email

1. Apply `supabase/migrations/202611050013_monthly_reports.sql` in your Supabase SQL Editor after 012. This adds report snapshots, household recipient preferences, a worker lease and a per-recipient delivery record. Canonical members with an existing email address are seeded once. Shared-ID households can add or remove addresses under **Settings → Monthly report emails**.
2. Create a Resend account and verify a sender/domain you control (including its DNS records) before sending to family addresses. Resend’s test sender has recipient restrictions. Use a verified sender such as `HHExpense <reports@your-domain>`. Use the free plan within its sending limits. [Resend sender setup](https://resend.com/docs/dashboard/domains/introduction)
3. For email delivery, set `RESEND_API_KEY` and `REPORT_FROM_EMAIL` (a verified sender) under **Supabase → Edge Functions → Secrets**. For an in-app report only, leave the recipient list empty. The function saves the numbers without sending email or contacting an AI provider.
4. Deploy from a Windows PowerShell at the repo root using `supabase functions deploy monthly-report --no-verify-jwt`. The function contains **both** `index.ts` and `report.ts`. If using the dashboard editor, include both files and switch off **Verify JWT with legacy secret**. Manual requests validate the user's Supabase access token and derive their household; scheduled requests use a separate secret generated privately by the migration.
5. Open **Overview → Reports**, select a report month, and press **Send report**. Each deliberate press emails that month to your current recipients. Verify the numbers in Reports and check the recipient inbox. With no recipients, use **Recipients** to configure delivery later and repeat the manual action. Transport retries of one request reuse its delivery keys. A second button press starts a separate send. The automatic job still sends the previous month once.
6. With Cron (pg_cron) and pg_net enabled, run `supabase/jobs/schedule-monthly-report.sql`. It targets the HHExpense production Supabase URL; replace it if deploying to another project. The job queues a separate invocation for each household at **08:00 Singapore time on the 1st**. Check Cron history, Function invocations and Resend acceptance after the first scheduled run.

The report compares posted SGD spending with the household budget as configured when the snapshot is generated. It keeps trip totals separate and includes unconfirmed estimates. Three-month averages use the three preceding calendar months, including zero-spend months. HTML email escapes dynamic content and sends each address separately.

**Recover a partial send:** Scheduled retries resume their existing automatic deliveries. A manual button press starts a fresh send and can email recipients who already received an earlier attempt. Each recipient uses a stored payload and a stable Resend idempotency key. Accepted deliveries are skipped. After 23 hours an ambiguous attempt stops for manual reconciliation before Resend’s 24-hour idempotency window expires. As project administrator inspect `report_deliveries` and match its report/month/address with the Resend dashboard. For a verified accepted message, record its provider ID in that row. Only after confirming no message was accepted, delete that one pending row so the next manual attempt can create a fresh delivery. Never reset a whole report to retry an email. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

### Report highlights

Apply `supabase/migrations/202611050014_report_highlights.sql` after migration 013 and redeploy the updated `monthly-report` function (both source files). The report and email show the change in household spending vs the prior month, the largest single expense including trips, and the top three non-trip categories. New descriptions are the top five by SGD amount among descriptions used this month but absent the previous month; comparisons ignore case and surrounding whitespace. Existing reports gain this field from current expense history without changing their saved totals or re-sending mail. Previously attempted deliveries retain their original payload for safe retries.

### Manual sends for a selected month

Apply `supabase/migrations/202611050015_manual_report_sends.sql` after 014 and redeploy both files of the `monthly-report` Edge Function. **Send report** uses the month picker (current or past months). Each click starts a fresh delivery, including when that month was already emailed. Retrying the exact request ID preserves its snapshot, recipients and per-recipient delivery keys. The monthly cron job and its delivery history are separate. A current-month manual report is a snapshot of available entries; the automatic job finalizes the previous month when it runs.
