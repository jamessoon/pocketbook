import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateBudget, type BudgetInput } from '../../web/src/budget/summary';

interface Fixture extends BudgetInput {
  name: string;
  expected: Record<string, number>;
  dueDate?: string;
}
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL('./budget-fixtures.json', import.meta.url), 'utf8'));
const migrationDir = new URL('../migrations/', import.meta.url);
const database = new PGlite();

beforeAll(async () => {
  // Only the Auth contract is emulated. Migrations, roles, RLS, triggers and
  // SECURITY DEFINER functions execute inside a real PostgreSQL engine.
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
  `);
  for (const migration of readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort()) {
    await database.exec(readFileSync(new URL(migration, migrationDir), 'utf8'));
  }
}, 30_000);
afterAll(async () => { await database.close(); });

describe('household security', () => {
  it('honors exact From and To dates for monthly posting and reservations',async()=>{
    await database.exec(readFileSync(new URL('./recurring_ranges.sql',import.meta.url),'utf8'));
  });
  it('posts recurring bills on Singapore dates, catches up and avoids duplicates', async () => {
    await database.exec(readFileSync(new URL('./recurring.sql', import.meta.url), 'utf8'));
  });
  it('scopes trip edits, protects history and excludes trips from household spending', async () => {
    await database.exec(readFileSync(new URL('./trips.sql', import.meta.url), 'utf8'));
  });
  it('scopes widget reads and writes and revokes rotated tokens', async () => {
    await database.exec(readFileSync(new URL('./widget.sql', import.meta.url), 'utf8'));
  });
  it('isolates two households and permits audited shared editing', async () => {
    await database.exec(readFileSync(new URL('./household_isolation.sql', import.meta.url), 'utf8'));
  });
  it('ranks descriptions, archives and reorders categories, and uses local dates', async () => {
    await database.exec(readFileSync(new URL('./category_queries.sql', import.meta.url), 'utf8'));
  });
});

describe.each(fixtures)('$name', fixture => {
  it('conforms to the shared budget fixture in TypeScript', () => {
    const result = calculateBudget(fixture);
    expect(result).toMatchObject(fixture.expected);
    if (fixture.dueDate) expect(result.fixed_items[0].due_on).toBe(fixture.dueDate);
  });

  it('agrees with PostgreSQL, including posting and confirmation status', async () => {
    const household = randomUUID(), category = randomUUID(), trip = randomUUID();
    const recurringKeys = new Map<string,string>();
    const result = await database.transaction(async tx => {
      await tx.query('insert into public.households(id,name,monthly_budget) values($1,$2,$3)',
        [household,fixture.name,fixture.budget]);
      await tx.query("insert into public.categories(id,household_id,name,color,icon) values($1,$2,'Food','#123456','basket')",
        [category,household]);
      await tx.query('insert into public.trips(id,household_id,name,start_date,end_date) values($1,$2,$3,$4,$4)',
        [trip,household,'Test trip',fixture.month]);
      for (const item of fixture.recurring) {
        const id = randomUUID();
        recurringKeys.set(item.id,id);
        await tx.query(`insert into public.recurring_items
          (id,household_id,name,category_id,amount,amount_type,interval_months,due_day,start_month,active,ends_on)
          values($1,$2,$3,$4,$5,'variable',$6,$7,$8,$9,$10)`,
          [id,household,item.id,category,item.amount,item.interval,item.day,item.start,item.active !== false,item.end ?? null]);
      }
      for (const entry of fixture.expenses) {
        await tx.query(`insert into public.expenses
          (household_id,category_id,spent_on,amount_sgd,original_amount,trip_id,recurring_item_id,is_fixed,sgd_confirmed)
          values($1,$2,$3,$4,$4,$5,$6,$7,$8)`,[household,category,entry.date,entry.amount,entry.trip ? trip : null,
            entry.recurringId ? recurringKeys.get(entry.recurringId) : null, Boolean(entry.fixed),entry.confirmed !== false]);
      }
      const response = await tx.query<{ summary: ReturnType<typeof calculateBudget> }>(
        'select hh_private.month_summary_at($1,$2,$3) as summary',[household,fixture.month,fixture.today]);
      return response.rows[0].summary;
    });
    expect(result).toMatchObject(fixture.expected);
    const expectedItems = calculateBudget(fixture).fixed_items.map(item => ({ ...item,id:recurringKeys.get(item.id) }));
    expect(result.fixed_items).toMatchObject(expectedItems);
  });
});
