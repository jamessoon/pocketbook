/** Dates are household-local ISO calendar dates. UTC arithmetic avoids host DST. */
export interface BudgetExpense {
  date: string;
  amount: number;
  trip?: boolean;
  fixed?: boolean;
  recurringId?: string;
  confirmed?: boolean;
}
export interface RecurringCost {
  id: string;
  amount: number;
  start: string;
  interval: number;
  day: number;
  active?: boolean;
}
export interface BudgetInput {
  today: string;
  month: string;
  budget: number;
  expenses: BudgetExpense[];
  recurring: RecurringCost[];
}

function monthIndex(date: string) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/** Keep currency sums in cents until deriving the unrounded daily allowance. */
const cents = (amount: number) => Math.round(amount * 100);

export function calculateBudget(input: BudgetInput) {
  const month = input.month.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const monthLength = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const last = month + '-' + monthLength;
  const first = month + '-01';
  const anchor = input.today < first ? first : input.today > last ? last : input.today;
  const daysLeft = monthLength - Number(anchor.slice(-2)) + 1;
  const entries = input.expenses.filter(entry => !entry.trip && entry.date.startsWith(month));
  const dailyEntries = entries.filter(entry => !entry.fixed);

  const fixedItems = input.recurring.flatMap(item => {
    const elapsed = monthIndex(first) - monthIndex(item.start);
    if (item.active === false || elapsed < 0 || elapsed % item.interval !== 0) return [];
    const posted = entries.find(entry => entry.fixed && entry.recurringId === item.id);
    return [{
      id: item.id,
      due_on: month + '-' + String(Math.min(item.day, monthLength)).padStart(2, '0'),
      amount: posted?.amount ?? item.amount,
      posted: Boolean(posted),
      confirmed: posted ? posted.confirmed !== false : false,
    }];
  });
  const fixed = fixedItems.reduce((sum, item) => sum + cents(item.amount), 0);
  const prior = dailyEntries.filter(entry => entry.date < anchor)
    .reduce((sum, entry) => sum + cents(entry.amount), 0);
  const today = dailyEntries.filter(entry => entry.date === anchor)
    .reduce((sum, entry) => sum + cents(entry.amount), 0);
  const total = dailyEntries.reduce((sum, entry) => sum + cents(entry.amount), 0);
  const dailyBudget = Math.max(cents(input.budget) - fixed - prior, 0) / 100 / daysLeft;
  return {
    days_left: daysLeft, fixed_costs: fixed / 100, fixed_items: fixedItems,
    day_to_day_spent: total / 100, spent_today: today / 100,
    remaining: (cents(input.budget) - fixed - total) / 100,
    daily_budget: dailyBudget, left_today: dailyBudget - today / 100,
  };
}
