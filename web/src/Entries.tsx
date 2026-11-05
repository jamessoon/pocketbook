import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconArrowLeft, IconBackspace, IconCalendar, IconCheck, IconChevronRight, IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { supabase } from "./client";
import { CategoryIcon } from "./icons";
import { useTrips,defaultTrip } from "./trip-data";
import { today, shiftMonth } from "./dates";
import type { Category, Household, Member } from "./types";
import { asCents, currencyOrder, dateLabel, formatMoney, keypadDisplay, keypadInput, pressKey, rememberCurrency } from "./entry-helpers";
import "./entries.css";

export interface EntryProps {
  household: Household;
  categories: Category[];
  members: Member[];
  month: string;
}
interface Expense {
  id: string;
  household_id: string;
  category_id: string;
  description: string;
  spent_on: string;
  amount_sgd: number;
  original_currency: string;
  original_amount: number;
  fx_rate_estimate: number | null;
  sgd_confirmed: boolean;
  created_by: string | null;
  updated_at: string;
  trip_id: string | null;
  is_fixed: boolean;
}

function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error ? String(error.message) : "Please try again.";
}

function Problem({ error }: { error: unknown }) {
  return <p className="ee-error" role="alert">{errorMessage(error)}</p>;
}

function CategoryGlyph({ category }: { category: Category | undefined }) {
  return <span className="ee-glyph" style={{ "--entry-color": category?.color || "currentColor" } as CSSProperties}>
    <CategoryIcon name={category?.icon || "dots"} size={19}/>
  </span>;
}

function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => { el?.close(); };
  }, []);
  return <dialog ref={ref} className="ee-sheet" aria-label={title} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div><header><h2>{title}</h2><button type="button" className="ee-icon-btn" aria-label="Close" onClick={close}><IconX size={20}/></button></header>{children}</div>
  </dialog>;
}

type ExpenseTiming = {date:string; end:string|null};

function DateChoice({timing,day,allowRecurring,apply}: {
  timing:ExpenseTiming; day:string; allowRecurring:boolean; apply:(value:ExpenseTiming)=>void
}) {
  const [repeat,setRepeat]=useState(timing.end!==null);
  const [from,setFrom]=useState(timing.date || day);
  const [to,setTo]=useState(timing.end || '');
  return <form className="date-choice" onSubmit={event=>{
    event.preventDefault(); apply({date:from,end:repeat ? to : null});
  }}>
    {allowRecurring && <div className="date-modes">
      <button type="button" aria-pressed={!repeat} onClick={()=>setRepeat(false)}>One time</button>
      <button type="button" aria-pressed={repeat} onClick={()=>setRepeat(true)}>Recurring</button>
    </div>}
    <label>{repeat?'From':'Date'}<input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
    {repeat && <><label>To<input type="date" required min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>
      <small>Repeats monthly as a household bill, including both dates when due.</small></>}
    <button type="submit" className="ee-action">Done</button>
  </form>;
}

async function getExpense(household: string, id: string) {
  const result = await supabase.from("expenses").select("*").eq("household_id", household).eq("id", id).single();
  if (result.error) throw result.error;
  return result.data as Expense;
}

export function QuickAdd(props: EntryProps) {
  const [params] = useSearchParams();
  const editId = params.get("edit");
  const original = useQuery({
    queryKey: ["expense", props.household.id, editId],
    queryFn: () => getExpense(props.household.id, editId!),
    enabled: !!editId,
  });
  if (editId && original.isPending) return <p role="status">Loading expense…</p>;
  if (editId && original.error) return <Problem error={original.error}/>;
  return <ExpenseForm key={editId || "new"} {...props} original={editId ? original.data : undefined} requestedTrip={params.get("trip")} preselected={params.get("category")}/>;
}

function ExpenseForm({ household, categories, original, preselected, requestedTrip }: EntryProps & { requestedTrip:string|null; original?: Expense; preselected: string | null }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const day = today(household.timezone);
  const [categoryId, setCategory] = useState(original?.category_id || categories.find(c => !c.archived && c.id === preselected)?.id || "");
  const [amount, setAmount] = useState(() => keypadInput(Number(original?.original_amount || 0), original?.original_currency || "SGD"));
  const [currency, setCurrency] = useState(original?.original_currency || "SGD");
  const [description, setDescription] = useState(original?.description || "");
  const [timing,setTiming] = useState<ExpenseTiming>({date:original?.spent_on || day,end:null});
  const {date,end} = timing;
  const repeat = end !== null;
  const trips = useTrips(household.id);
  const [selectedTrip,setTrip] = useState<string | undefined>(original ? original.trip_id || "" : undefined);
  const availableTrips = (trips.data || []).filter(t=>!t.archived || t.id===original?.trip_id);
  const tripId = selectedTrip ?? (requestedTrip ? availableTrips.find(t=>t.id===requestedTrip)?.id || "" : defaultTrip(availableTrips,day));
  const pickedTrip = availableTrips.find(t=>t.id===tripId);
  const [sheet, setSheet] = useState<"currency" | "date" | "trip" | null>(null);
  const [filter, setFilter] = useState("");
  const requestId = useRef<string>();
  const displayedAmount = keypadDisplay(amount, currency);
  const amountValue = Number(displayedAmount);
  const foreign = currency !== "SGD";
  const sameMoney = !!original && currency === original.original_currency && amountValue === Number(original.original_amount);
  const active = categories.filter(c => !c.archived || c.id === original?.category_id);
  const picked = active.find(c => c.id === categoryId);
  const suggestions = useQuery({
    queryKey: ["suggestions", household.id, categoryId, day],
    enabled: !!categoryId,
    queryFn: async () => {
      const result = await supabase.rpc("category_suggestions", { p_category_id: categoryId });
      if (result.error) throw result.error;
      return (result.data as { description: string }[]).map(row => row.description);
    },
  });
  const rateQuery = useQuery({
    queryKey: ["fx-rate", household.id, currency, day],
    enabled: foreign && !sameMoney,
    staleTime: 20 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const result = await supabase.functions.invoke("fx-rate", { body: { currency } });
      if (result.error || result.data?.date !== day || result.data?.currency !== currency ||
          !Number.isFinite(result.data?.rate) || result.data.rate <= 0) throw new Error("Today's rate is unavailable.");
      return result.data.rate as number;
    },
  });
  const rate = sameMoney ? Number(original.fx_rate_estimate) : rateQuery.data;
  const sgdAmount = sameMoney ? Number(original.amount_sgd) : asCents(foreign ? amountValue * Number(rate) : amountValue);
  const tripUnavailable = !trips.isPending && ((!!tripId && !pickedTrip) || (!!requestedTrip && selectedTrip === undefined && !pickedTrip));
  const canSave = !tripUnavailable && !trips.isPending && !trips.error && !!picked && amountValue > 0 && Number.isFinite(sgdAmount) && sgdAmount > 0 && !!date && (!foreign || sameMoney || !!rate);
  const scheduleRequest = useRef<string>();
  const save = useMutation({
    mutationFn: async () => {
      if (!canSave) throw new Error("Choose a category and a valid amount.");
      if(repeat){
        if(original || foreign || tripId || end < date) throw new Error("Choose a valid recurring SGD date range.");
        scheduleRequest.current ??= crypto.randomUUID();
        const fields={household_id:household.id,category_id:categoryId,name:(description.trim() || picked!.name).slice(0,120),
          amount:sgdAmount,amount_type:"fixed",interval_months:1,start_month:date.slice(0,7)+"-01",
          due_day:Number(date.slice(-2)),ends_on:end};
        const result=await supabase.from("recurring_items").insert({...fields,id:scheduleRequest.current});
        if(result.error){
          if(result.error.code!=="23505") throw result.error;
          const previous=await supabase.from("recurring_items").select("*").eq("household_id",household.id).eq("id",scheduleRequest.current).single();
          if(previous.error || Object.entries(fields).some(([key,value])=>String(previous.data[key])!==String(value)))
            throw new Error("Your earlier save may have reached the household. Check Recurring costs before retrying.");
        }
        return;
      }
      const fields = {
        trip_id: tripId || null, category_id: categoryId, description: description.trim(), spent_on: date, original_amount: amountValue,
        original_currency: currency, amount_sgd: sgdAmount, fx_rate_estimate: foreign ? rate || null : null,
        sgd_confirmed: original && (sameMoney || original.is_fixed) ? original.sgd_confirmed : !foreign,
      };
      if (original) {
        const result = await supabase.from("expenses").update(fields).eq("household_id", household.id).eq("id", original.id)
          .eq("updated_at", original.updated_at).select("id").maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("This entry changed. Reopen it to edit its latest version.");
      } else {
        requestId.current ??= crypto.randomUUID();
        const result = await supabase.from("expenses").insert({ ...fields, id: requestId.current, household_id: household.id });
        if (result.error) {
          if (result.error.code !== "23505") throw result.error;
          // A dropped connection may hide a successful first insert.
          const previous = await getExpense(household.id, requestId.current);
          if (previous.trip_id !== fields.trip_id || previous.category_id !== fields.category_id || previous.description !== fields.description ||
              previous.spent_on !== fields.spent_on || previous.original_currency !== fields.original_currency ||
              Number(previous.original_amount) !== fields.original_amount) {
            throw new Error("Your earlier save reached the household. Open Expenses to edit that entry.");
          }
        }
      }
    },
    onSuccess: async () => {
      rememberCurrency(household.id, currency);
      await client.invalidateQueries();
      navigate(repeat ? "/recurring" : tripId ? "/trips?id="+tripId : original ? "/expenses" : "/", { replace: true });
    },
  });
  function openSheet(next: typeof sheet) { setFilter(""); setSheet(next); }
  return <section className="ee-quick" aria-label={original ? "Edit expense" : "Add expense"}>
    <div className="ee-form">
      <header className="ee-heading"><button className="ee-icon-btn" aria-label="Close expense form" onClick={() => navigate(original ? "/expenses" : "/")}><IconX size={20}/></button>
        <h1>{original ? "Edit expense" : "Add expense"}</h1><span/></header>
      <div className="ee-amount"><output aria-label="Amount">{displayedAmount}</output><button className="ee-currency" disabled={repeat} onClick={() => openSheet("currency")}>{currency}<IconChevronRight size={14}/></button></div>
      <div className="ee-slots" aria-label="Categories">
        {active.map(c => <button key={c.id} aria-pressed={c.id === categoryId} title={c.name} onClick={() => setCategory(c.id)}>
          <CategoryGlyph category={c}/><span>{c.name}</span></button>)}
      </div>
      <div className="ee-description"><input aria-label="Description" placeholder="Description (optional)" maxLength={500} value={description} onChange={e => setDescription(e.target.value)}/>
        {!!suggestions.data?.length && <div className="ee-suggestions" aria-label="Suggested descriptions">{suggestions.data.slice(0, 3).map(value =>
          <button key={value} title={value} onClick={() => setDescription(value)}>{value}</button>)}</div>}
      </div>
      <div className="ee-details"><button onClick={() => openSheet("date")}><IconCalendar size={16}/>{repeat ? "Monthly" : date === day ? "Today" : dateLabel(date, { day: "numeric", month: "short", year: "numeric" })}</button>
        {!repeat && !original?.is_fixed && <button aria-label="Select trip" onClick={()=>openSheet("trip")}>{pickedTrip?.name || "No trip"}</button>}
        {pickedTrip && <small>Trip spending is outside the monthly budget.</small>}
      </div>
      {tripUnavailable && <p role="alert">This trip is unavailable. Choose another trip or select No trip.</p>}
      {trips.error && <button onClick={()=>trips.refetch()}>Couldn’t load trips. Retry</button>}
      {foreign && <div className="ee-fx">
        <div>{sameMoney && original.sgd_confirmed ? "Confirmed " + formatMoney(sgdAmount) : rate ? "≈ " + formatMoney(sgdAmount) + (sameMoney ? " • saved estimate" : " at today’s rate") :
          rateQuery.isError ? <button onClick={() => rateQuery.refetch()}>Rate unavailable · Retry</button> : "Getting today’s rate…"}
          <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">ExchangeRate-API</a></div>
        <small>Estimate only. Your card’s rate and fees may differ. Check your statement and update the SGD amount.</small>
      </div>}
      {save.error && <Problem error={save.error}/>}
      <div className="ee-pad" aria-label="Numeric keypad">
        {["1","2","3","4","5","6","7","8","9",".","0","delete"].map(key =>
          <button key={key} aria-label={key === "delete" ? "Backspace" : key} onClick={() => setAmount(value => pressKey(value, key, currency))}>{key === "delete" ? <IconBackspace size={23}/> : key}</button>)}
      </div>
      <button className="ee-save" disabled={!canSave || save.isPending} onClick={() => save.mutate()}><IconCheck size={18}/>{save.isPending ? "Saving…" : repeat ? "Save recurring expense" : original ? "Save changes" : "Save expense"}</button>
    </div>
    {sheet && <Sheet close={() => setSheet(null)} title={sheet === "currency" ? "Choose currency" : sheet === "trip" ? "Choose trip" : "Expense date"}>
      {sheet === "trip" ? <div className="ee-options"><button onClick={()=>{setTrip("");setSheet(null)}}>No trip</button>
        {availableTrips.map(t=><button key={t.id} onClick={()=>{setTrip(t.id);setSheet(null)}}>{t.name}{t.id===tripId&&<IconCheck size={16}/>}</button>)}
      </div> : sheet === "date" ? <DateChoice timing={timing} day={day} allowRecurring={!original && !foreign}
        apply={value=>{if(value.end!==null)setTrip("");setTiming(value);setSheet(null)}}/> : <>
        <label className="ee-filter"><IconSearch size={18}/><input placeholder="Search" aria-label="Search options" value={filter} onChange={e => setFilter(e.target.value)}/></label>
        <div className="ee-options">
          {currencyOrder(household.id).filter(c => c.includes(filter.trim().toUpperCase())).map(c =>
              <button key={c} onClick={() => { if (c !== currency) { setAmount(keypadInput(amountValue, c)); setCurrency(c); } setSheet(null); }}>{c}{c === currency && <IconCheck size={16}/>}</button>)}
        </div>
      </>}
    </Sheet>}
  </section>;
}

const PAGE_SIZE = 50;
function useExpenses(household: string, month: string, page: number, pending: boolean, category?: string | null) {
  return useQuery({
    queryKey: ["expenses", household, month, page, pending, category],
    queryFn: async () => {
      let query = supabase.from("expenses").select("*", { count: "exact" }).eq("household_id", household);
      if (pending) query = query.eq("sgd_confirmed", false);
      else query = query.gte("spent_on", month).lt("spent_on", shiftMonth(month, 1));
      if (category) query = query.eq("category_id", category);
      const result = await query.order("spent_on", { ascending: false }).order("created_at", { ascending: false })
        .order("id").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (result.error) throw result.error;
      return { rows: result.data as Expense[], total: result.count || 0 };
    },
  });
}

function Pagination({ page, total, update }: { page: number; total: number; update: (n: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return <nav className="ee-pages" aria-label="Expense pages">
    <button disabled={page === 0} onClick={() => update(page - 1)}>Previous</button>
    <span>{page + 1} of {pages}</span><button disabled={page >= pages - 1} onClick={() => update(page + 1)}>Next</button>
  </nav>;
}

const DeletionContext = createContext<{
  pendingDeletion: Expense | null;
  schedule: (expense: Expense) => void;
} | null>(null);

// The undo window belongs to the household session, not the current route.
export function ExpenseDeletionProvider({children}: {children: ReactNode}) {
  const [pendingDeletion, setPending] = useState<Expense | null>(null);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const client = useQueryClient();
  const inFlight = useRef(false);
  useEffect(() => {
    if (!pendingDeletion) return;
    const timer = window.setTimeout(async () => {
      inFlight.current = true;
      setCommitting(true);
      try {
        const result = await supabase.from("expenses").delete()
          .eq("household_id", pendingDeletion.household_id).eq("id", pendingDeletion.id)
          .eq("updated_at", pendingDeletion.updated_at).select("id").maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("This entry changed. Refresh and try again.");
      } catch (failure) {
        setError(failure);
      } finally {
        await client.invalidateQueries();
        inFlight.current = false;
        setCommitting(false);
        setPending(null);
      }
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [pendingDeletion, client]);
  return <DeletionContext.Provider value={{pendingDeletion, schedule: expense => {
    setError(null);
    setPending(current => current ?? expense);
  }}}>
    {children}
    {pendingDeletion && <div role="status" className="ee-toast">
      {committing ? "Deleting expense…" : "Expense marked for deletion"}
      <button disabled={committing} onClick={() => { if (!inFlight.current) setPending(null); }}>Undo</button>
    </div>}
    {!!error && <div className="ee-toast"><Problem error={error}/><button onClick={()=>setError(null)}>Dismiss</button></div>}
  </DeletionContext.Provider>;
}

export function ExpenseList(props: EntryProps) {
  const [params] = useSearchParams();
  const category = params.get("category");
  return <ListBody key={props.household.id + props.month + category} {...props} category={category}/>;
}

function ListBody({ household, month, members, categories, category }: EntryProps & { category: string | null }) {
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const {pendingDeletion, schedule} = useContext(DeletionContext)!;
  const navigate = useNavigate();
  const query = useExpenses(household.id, month, page, false, category);
  useEffect(() => {
    if (query.data && page > 0 && !query.data.rows.length) setPage(page - 1);
  }, [page, query.data]);
  const rows = (query.data?.rows || []).filter(e => e.id !== pendingDeletion?.id);
  const groups = new Map<string, Expense[]>();
  for (const e of rows) {
    const previous = groups.get(e.spent_on) || [];
    previous.push(e);
    groups.set(e.spent_on, previous);
  }
  const categoryName = categories.find(c => c.id === category)?.name;
  return <section className="ee-page">
    <div className="ee-title"><div><p>{dateLabel(month, { month: "long", year: "numeric" })}</p><h1 className={categoryName ? undefined : "phone-tab-title"}>{categoryName || "Expenses"}</h1></div>
      <button className="ee-action" onClick={() => navigate(category ? "/add?category=" + category : "/add")}><IconPlus size={17}/>Add expense</button></div>
    {query.isPending && <p role="status">Loading expenses…</p>}
    {query.error && <Problem error={query.error}/>}
    {!query.isPending && !query.error && !rows.length && <div className="ee-empty"><h2>No entries</h2><p>Your expenses for this month appear here.</p></div>}
    {[...groups].map(([date, expenses]) => <section className="ee-day" key={date}><header>
      <h2>{dateLabel(date, { weekday: "short", day: "numeric", month: "short" })}</h2>
      <span>{formatMoney(expenses.reduce((total, e) => total + Number(e.amount_sgd), 0))} on this page</span></header>
      <div className="ee-list">{expenses.map(e => {
        const cat = categories.find(c => c.id === e.category_id);
        const person = !e.created_by && e.is_fixed ? "Recurring bill" : e.created_by ? members.find(m => m.user_id === e.created_by)?.display_name || "Household member" : "Household widget";
        return <div className="ee-row" key={e.id}>
          <button className="ee-row-main" onClick={() => navigate("/add?edit=" + e.id)}><CategoryGlyph category={cat}/>
            <span><strong>{e.description || cat?.name}</strong><small>{cat?.name} · {person}</small>
              {(e.trip_id || e.is_fixed || !e.sgd_confirmed) && <span className="ee-badges">{e.trip_id && <i>Trip</i>}{e.is_fixed && <i>Fixed</i>}{!e.sgd_confirmed && <i>To confirm</i>}</span>}
            </span><b>{formatMoney(e.amount_sgd)}</b></button>
          <button className="ee-icon-btn" aria-label={"Delete " + (e.description || cat?.name)} disabled={!!pendingDeletion} onClick={() => setDeleting(e)}><IconTrash size={17}/></button>
        </div>;
      })}</div></section>)}
    <Pagination page={page} total={query.data?.total || 0} update={setPage}/>
    {deleting && <Sheet title="Delete expense?" close={() => setDeleting(null)}>
      <p>{deleting.description || "Expense"} · {formatMoney(deleting.amount_sgd)}</p>
      <button className="ee-remove" onClick={() => { schedule(deleting); setDeleting(null); }}>Delete expense</button>
    </Sheet>}

  </section>;
}

export function Confirm({ household, month, categories }: EntryProps) {
  const [page, setPage] = useState(0);
  const query = useExpenses(household.id, month, page, true);
  const navigate = useNavigate();
  useEffect(() => {
    if (query.data && page > 0 && !query.data.rows.length) setPage(page - 1);
  }, [page, query.data]);
  return <section className="ee-page"><div className="ee-title">
    <div><button className="ee-back" onClick={() => navigate("/")}><IconArrowLeft size={16}/>Overview</button><h1>To confirm</h1></div>
  </div>
  {query.isPending && <p role="status">Loading estimates…</p>}
  {query.error && <Problem error={query.error}/>}
  {query.data && !query.data.rows.length && <div className="ee-empty"><IconCheck size={24}/><h2>All caught up</h2><p>Estimates awaiting their final SGD amount appear here.</p></div>}
  <div className="ee-confirm-list">{query.data?.rows.map(e =>
    <ConfirmItem key={e.id + e.updated_at} expense={e} category={categories.find(c => c.id === e.category_id)}/>)}</div>
  <Pagination page={page} total={query.data?.total || 0} update={setPage}/>
  </section>;
}

function ConfirmItem({ expense, category }: { expense: Expense; category?: Category }) {
  const [charged, setCharged] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await supabase.from("expenses").update({ amount_sgd: Number(charged), sgd_confirmed: true })
        .eq("household_id", expense.household_id).eq("id", expense.id).eq("sgd_confirmed", false)
        .eq("updated_at", expense.updated_at).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("This entry changed. Refresh to see its latest amount.");
    },
    onSuccess: () => client.invalidateQueries(),
  });
  return <article className="ee-confirm">
    <div><CategoryGlyph category={category}/><span><strong>{expense.description || category?.name}</strong>
      <small>{category?.name} · {dateLabel(expense.spent_on, { day: "numeric", month: "short", year: "numeric" })}</small></span></div>
    <p>{expense.original_currency} {Number(expense.original_amount).toLocaleString("en-SG")} · Estimated {formatMoney(expense.amount_sgd)}</p>
    <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }}><label>Charged SGD amount<input required value={charged} onChange={e => setCharged(e.target.value)}
      inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="0.00"/></label>
      <button className="ee-action" disabled={mutation.isPending || !/^\d+(\.\d{1,2})?$/.test(charged) || Number(charged) <= 0}>Confirm</button></form>
    {mutation.error && <Problem error={mutation.error}/>}
  </article>;
}


