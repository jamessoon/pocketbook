"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Currency = "SGD" | "USD" | "VND" | "EUR";
type Category = { id: string; name: string; shortcut: string; color: string; icon: string };
type Expense = { id: string; description: string; categoryId: string; amount: number; currency: Currency; date: string; note: string; unnecessary: boolean; bookId: string; sourceBookId?: string };
type Book = { id: string; name: string; icon: string; addedToMonthly: boolean };

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const NOW = new Date(`${TODAY}T00:00:00`);
const MONTH_KEY = TODAY.slice(0, 7);
const MONTH_NAME = NOW.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
const DAYS_LEFT = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate() - NOW.getDate();
const COLORS = ["#d77742", "#315e4b", "#775589", "#46739a", "#b48a35", "#8e5550"];
const ICONS = ["☕", "↗", "⌂", "✦", "+", "🛒", "🍽", "🚕", "✈", "🏥", "💊", "🎁", "🎓", "🐾", "⚡", "📱", "🎬", "🏋", "👕", "🧾"];
const historicalByCategory: Record<string, number[]> = {
  food: [480, 620, 510, 720, 610, 780, 690, 0, 0, 0, 0, 0],
  transport: [220, 310, 260, 340, 290, 390, 350, 0, 0, 0, 0, 0],
  home: [510, 840, 660, 920, 810, 1120, 980, 0, 0, 0, 0, 0],
  fun: [140, 270, 190, 410, 320, 480, 560, 0, 0, 0, 0, 0],
  health: [90, 240, 240, 330, 380, 480, 380, 0, 0, 0, 0, 0],
};
const seedCategories: Category[] = [
  { id: "food", name: "Food & dining", shortcut: "FD", color: "#d77742", icon: "☕" },
  { id: "transport", name: "Transport", shortcut: "TR", color: "#315e4b", icon: "↗" },
  { id: "home", name: "Household", shortcut: "HH", color: "#775589", icon: "⌂" },
  { id: "fun", name: "Fun & treats", shortcut: "FN", color: "#b48a35", icon: "✦" },
  { id: "health", name: "Health", shortcut: "HL", color: "#46739a", icon: "+" },
];
const seedBooks: Book[] = [{ id: "monthly", name: "Monthly expenses", icon: "⌂", addedToMonthly: false }, { id: "japan", name: "Japan trip", icon: "✈", addedToMonthly: false }];
const seedExpenses: Expense[] = [
  { id: "e1", description: "Breakfast at Ya Kun", categoryId: "food", amount: 8.4, currency: "SGD", date: "2026-08-14", note: "Kaya toast set", unnecessary: false, bookId: "monthly" },
  { id: "e2", description: "Grab to the office", categoryId: "transport", amount: 18.6, currency: "SGD", date: "2026-08-13", note: "Rainy morning", unnecessary: false, bookId: "monthly" },
  { id: "e3", description: "FairPrice groceries", categoryId: "home", amount: 126.35, currency: "SGD", date: "2026-08-12", note: "Weekly groceries", unnecessary: false, bookId: "monthly" },
  { id: "e4", description: "New headphones", categoryId: "fun", amount: 189, currency: "SGD", date: "2026-08-09", note: "Impulse buy", unnecessary: true, bookId: "monthly" },
  { id: "e5", description: "Hotel in Osaka", categoryId: "fun", amount: 742, currency: "SGD", date: "2026-07-21", note: "4 nights", unnecessary: false, bookId: "japan" },
  { id: "e6", description: "Rail pass", categoryId: "transport", amount: 218, currency: "USD", date: "2026-07-19", note: "Needs SGD conversion", unnecessary: false, bookId: "japan" },
];

const money = (amount: number, currency: Currency = "SGD") => new Intl.NumberFormat("en-SG", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(amount);
const storageKey = "pocketbook-family-v1";

export default function ExpenseTracker() {
  const [categories, setCategories] = useState(seedCategories);
  const [books, setBooks] = useState(seedBooks);
  const [expenses, setExpenses] = useState(seedExpenses);
  const [activeBook, setActiveBook] = useState("monthly");
  const [quick, setQuick] = useState("");
  const [modal, setModal] = useState<"expense" | "categories" | "book" | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [chartVisibility, setChartVisibility] = useState<Record<string, boolean>>(() => Object.fromEntries(seedCategories.map(c => [c.id, true])));

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) { try { const data = JSON.parse(saved); setCategories(data.categories); setBooks(data.books); setExpenses(data.expenses); } catch {} }
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(storageKey, JSON.stringify({ categories, books, expenses })); }, [categories, books, expenses, hydrated]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { setChartVisibility(previous => Object.fromEntries(categories.map(c => [c.id, c.id in previous ? previous[c.id] : true]))); }, [categories]);
  useEffect(() => {
    setExpenses(current => {
      let changed = false;
      const next = current.map(expense => {
        let sourceBookId = expense.sourceBookId;
        if (!sourceBookId && expense.bookId === "monthly") {
          sourceBookId = books.find(book => book.id !== "monthly" && book.addedToMonthly && expense.note === `Total from ${book.name}`)?.id;
        }
        if (!sourceBookId) return expense;
        const total = current.filter(item => item.bookId === sourceBookId && item.currency === "SGD").reduce((sum, item) => sum + item.amount, 0);
        if (expense.amount === total && expense.sourceBookId === sourceBookId) return expense;
        changed = true;
        return { ...expense, amount: total, sourceBookId };
      });
      return changed ? next : current;
    });
  }, [books, expenses]);

  const currentBook = books.find(b => b.id === activeBook) ?? books[0];
  const visible = useMemo(() => expenses.filter(e => e.bookId === activeBook).sort((a,b) => b.date.localeCompare(a.date)), [expenses, activeBook]);
  const monthly = expenses.filter(e => e.bookId === "monthly" && e.date.startsWith(MONTH_KEY));
  const monthlyTotal = monthly.filter(e => e.currency === "SGD").reduce((s,e) => s + e.amount, 0);
  const unnecessary = monthly.filter(e => e.unnecessary && e.currency === "SGD").reduce((s,e) => s + e.amount, 0);
  const unnecessaryPct = monthlyTotal ? Math.round(unnecessary / monthlyTotal * 100) : 0;
  const bookTotal = visible.filter(e => e.currency === "SGD").reduce((s,e) => s + e.amount, 0);
  const chartSeries = categories.map(category => ({
    category,
    values: Array.from({ length: 12 }, (_, month) => month === NOW.getMonth()
      ? monthly.filter(e => e.currency === "SGD" && e.categoryId === category.id).reduce((sum, e) => sum + e.amount, 0)
      : historicalByCategory[category.id]?.[month] ?? 0),
  }));
  const chartMonths = Array.from({ length: 12 }, (_, month) => chartSeries.reduce((sum, series) => sum + (chartVisibility[series.category.id] ? series.values[month] : 0), 0));
  const maxYear = Math.max(...chartMonths, 1);
  const selectedYearTotal = chartMonths.reduce((sum, value) => sum + value, 0);

  function notify(message: string) { setToast(message); }
  function parseQuick() {
    const parts = quick.split(",").map(v => v.trim());
    if (parts.length < 3) return notify("Use: shortcut, description, amount, date (optional)");
    const shortcut = parts[0].replace(/[\[\]]/g, "").toUpperCase();
    const category = categories.find(c => c.shortcut.toUpperCase() === shortcut);
    if (!category) return notify(`Shortcut “${shortcut}” is not assigned yet`);
    const amountText = parts[2].toUpperCase().replace(/,/g, "");
    const currency = (["USD","VND","EUR","SGD"].find(c => amountText.includes(c)) || (amountText.includes("$") ? "USD" : "SGD")) as Currency;
    const amount = Number(amountText.replace(/[^0-9.]/g, ""));
    if (!parts[1] || !amount) return notify("Add a description and a valid amount");
    const date = parts[3] && !["TODAY","T"].includes(parts[3].toUpperCase()) ? parts[3] : TODAY;
    const entry: Expense = { id: crypto.randomUUID(), description: parts[1], categoryId: category.id, amount, currency, date, note: "", unnecessary: false, bookId: activeBook };
    setExpenses(v => [entry, ...v]); setQuick("");
    notify(currency === "SGD" ? "Expense added" : `${currency} entry added — remember to convert it to SGD`);
  }
  function openExpense(expense?: Expense) { setEditing(expense ?? null); setModal("expense"); }
  function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const next: Expense = { id: editing?.id ?? crypto.randomUUID(), description: String(data.get("description")), categoryId: String(data.get("categoryId")), amount: Number(String(data.get("amount")).replace(/,/g,"")), currency: String(data.get("currency")) as Currency, date: String(data.get("date")), note: String(data.get("note")), unnecessary: data.get("unnecessary") === "on", bookId: editing?.bookId ?? activeBook, sourceBookId: editing?.sourceBookId };
    setExpenses(v => editing ? v.map(e => e.id === editing.id ? next : e) : [next, ...v]); setModal(null); setEditing(null); notify(editing ? "Expense updated" : "Expense added");
  }
  function removeExpense(id: string) { if (confirm("Remove this expense?")) { const linkedBook = expenses.find(e => e.id === id)?.sourceBookId; setExpenses(v => v.filter(e => e.id !== id)); if(linkedBook) setBooks(v => v.map(book => book.id === linkedBook ? {...book,addedToMonthly:false} : book)); notify("Expense removed"); } }
  function addBook(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get("name")).trim(); if (!name) return; const id = crypto.randomUUID(); setBooks(v => [...v, { id, name, icon: "◇", addedToMonthly: false }]); setActiveBook(id); setModal(null); notify("New expense book ready"); }
  function deleteBook(id: string) { if (!confirm("Remove this book and all of its entries?")) return; setBooks(v => v.filter(b => b.id !== id)); setExpenses(v => v.filter(e => e.bookId !== id && e.sourceBookId !== id)); setActiveBook("monthly"); notify("Expense book and its monthly total removed"); }
  function addBookToMonthly(book: Book) {
    if (book.addedToMonthly) return notify("This book is already in monthly expenses");
    const total = expenses.filter(e => e.bookId === book.id && e.currency === "SGD").reduce((s,e) => s + e.amount, 0);
    setExpenses(v => [{ id: crypto.randomUUID(), description: book.name, categoryId: "fun", amount: total, currency: "SGD", date: TODAY, note: `Linked total from ${book.name}`, unnecessary: false, bookId: "monthly", sourceBookId: book.id }, ...v]);
    setBooks(v => v.map(b => b.id === book.id ? { ...b, addedToMonthly: true } : b)); notify(`${book.name} added as one monthly entry`);
  }

  return <main className="notebook-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">P</span><div><strong>Pocketbook</strong><small>Family ledger</small></div></div>
      <nav aria-label="Expense books">
        <button className={`nav-item ${activeBook === "monthly" ? "active" : ""}`} onClick={() => setActiveBook("monthly")}><span>⌂</span> Monthly expenses</button>
        <p className="nav-label">SPECIAL BOOKS</p>
        {books.filter(b => b.id !== "monthly").map(book => <button key={book.id} className={`nav-item ${activeBook === book.id ? "active" : ""}`} onClick={() => setActiveBook(book.id)}><span>{book.icon}</span><span className="nav-name">{book.name}</span><b>{money(expenses.filter(e => e.bookId === book.id && e.currency === "SGD").reduce((s,e)=>s+e.amount,0))}</b></button>)}
        <button className="nav-item add-book" onClick={() => setModal("book")}><span>＋</span> New expense book</button>
      </nav>
      <button className="manage-cats" onClick={() => setModal("categories")}><span>⌘</span><div><strong>Category shortcuts</strong><small>{categories.length} shortcuts assigned</small></div></button>
      <div className="sidebar-foot"><span className="avatar">JF</span><div><strong>James & family</strong><small>SGD · Singapore</small></div></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">{activeBook === "monthly" ? MONTH_NAME.toUpperCase() : "SPECIAL BOOK"}</p><h1>{currentBook.name}</h1></div><div className="header-actions">{activeBook !== "monthly" && <><button className="outline-button" onClick={() => addBookToMonthly(currentBook)}>{currentBook.addedToMonthly ? "✓ Added to monthly" : "＋ Add total to monthly"}</button><button className="icon-button danger" onClick={() => deleteBook(activeBook)} aria-label="Delete expense book">×</button></>}<button className="icon-button" onClick={() => setModal("categories")} aria-label="Manage category shortcuts">⚙</button></div></header>
      <form className="quick-entry" onSubmit={e => { e.preventDefault(); parseQuick(); }}><span>＋</span><input value={quick} onChange={e => setQuick(e.target.value)} aria-label="Quick expense entry" placeholder="Try: FD, Lunch at Toast Box, 12.50, today"/><button type="submit">Add expense <kbd>↵</kbd></button></form>
      <p className="entry-hint">Shortcut, description, amount, date (optional) · Other currencies: “USD 25”, “EUR 40”</p>
      <div className={`summary-grid ${activeBook !== "monthly" ? "single" : ""}`}>
        <article className="month-total"><p>{activeBook === "monthly" ? "SPENT THIS MONTH" : "BOOK TOTAL · SGD ENTRIES"}</p><h2><sup>S$</sup> {(activeBook === "monthly" ? monthlyTotal : bookTotal).toLocaleString("en-SG", { minimumFractionDigits: 2 })}</h2><span>{activeBook === "monthly" ? `${DAYS_LEFT} days left in ${NOW.toLocaleDateString("en-SG",{month:"long"})}` : `${visible.length} recorded expenses`}</span></article>
        {activeBook === "monthly" && <article className="watch-card"><div><p>UNNECESSARY SPEND</p><strong>{money(unnecessary)}</strong></div><span>{unnecessaryPct}% of total</span><div className="watch-track"><i style={{width:`${Math.min(unnecessaryPct / 15 * 100,100)}%`}} /></div><small>{unnecessaryPct <= 15 ? "Keep it below 15% — you’re doing well." : "Over your 15% watch limit — take a closer look."}</small></article>}
      </div>
      <div className={`content-grid ${activeBook !== "monthly" ? "single" : ""}`}>
        <section className="ledger-card"><div className="section-head"><div><p className="eyebrow">{activeBook === "monthly" ? MONTH_NAME.toUpperCase() : currentBook.name.toUpperCase()}</p><h3>Recent entries</h3></div><button className="outline-button" onClick={() => openExpense()}>＋ Add manually</button></div>
          {visible.length === 0 && <div className="empty"><span>✎</span><b>This page is ready for its first entry.</b><small>Use quick entry above or add one manually.</small></div>}
          {visible.map(expense => { const category = categories.find(c => c.id === expense.categoryId) ?? categories[0]; const d = new Date(`${expense.date}T00:00:00`); return <div className="ledger-row" key={expense.id}><span className="date-block"><b>{d.getDate()}</b><small>{d.toLocaleDateString("en",{weekday:"short"}).toUpperCase()}</small></span><span className="cat-icon" style={{background:`${category.color}22`,color:category.color}}>{category.icon}</span><span className="entry-copy"><b>{expense.description} {expense.currency !== "SGD" && <span className="warning" title="Needs SGD conversion">!</span>}</b><small>{category.name} · {category.shortcut}{expense.note ? ` · ${expense.note}` : ""}</small></span><strong>{money(expense.amount, expense.currency)}</strong><div className="row-actions"><button onClick={() => openExpense(expense)} aria-label={`Edit ${expense.description}`}>✎</button><button onClick={() => removeExpense(expense.id)} aria-label={`Remove ${expense.description}`}>×</button></div></div>})}
        </section>
        {activeBook === "monthly" && <aside className="chart-card"><div className="section-head"><div><p className="eyebrow">{NOW.getFullYear()}</p><h3>Year at a glance</h3></div><span className="chart-note">SGD only</span></div><div className="chart-total"><strong>{money(selectedYearTotal)}</strong><span>selected categories</span></div><div className="stacked-bars" aria-label="Monthly expenses stacked by category">{chartMonths.map((total,month)=><div className={`bar-month ${month===NOW.getMonth()?"current":""}`} key={month}><div className="stack-column" title={`${new Date(NOW.getFullYear(),month,1).toLocaleDateString("en-SG",{month:"long"})}: ${money(total)}`}>{chartSeries.map(series => chartVisibility[series.category.id] && series.values[month] > 0 ? <i key={series.category.id} style={{height:`${series.values[month]/maxYear*100}%`,background:series.category.color}} title={`${series.category.name}: ${money(series.values[month])}`} /> : null)}</div><span>{['J','F','M','A','M','J','J','A','S','O','N','D'][month]}</span></div>)}</div><div className="category-toggles" aria-label="Choose categories to compare">{categories.map(category=><button key={category.id} className={chartVisibility[category.id] ? "on" : ""} onClick={() => setChartVisibility(v => ({...v,[category.id]:!v[category.id]}))} aria-pressed={!!chartVisibility[category.id]}><i style={{background:category.color}} />{category.name}</button>)}</div><div className="chart-foot"><button onClick={() => setChartVisibility(Object.fromEntries(categories.map(c=>[c.id,true])))}>Show all</button><b>{NOW.toLocaleDateString("en-SG",{month:"long"})} {money(chartMonths[NOW.getMonth()])}</b></div></aside>}
      </div>
    </section>
    {modal === "expense" && <Modal title={editing ? "Edit expense" : "New expense"} close={() => { setModal(null); setEditing(null); }}><form className="form-grid" onSubmit={saveExpense}><label className="wide">Description<input name="description" defaultValue={editing?.description} required autoFocus /></label><label>Category<select name="categoryId" defaultValue={editing?.categoryId ?? categories[0]?.id}>{categories.map(c=><option value={c.id} key={c.id}>{c.name} · {c.shortcut}</option>)}</select></label><label>Amount<input name="amount" inputMode="decimal" defaultValue={editing?.amount.toLocaleString("en-SG")} onBlur={e => { const n=Number(e.target.value.replace(/,/g,"")); if(n) e.target.value=n.toLocaleString("en-SG",{maximumFractionDigits:2}); }} required /></label><label>Currency<select name="currency" defaultValue={editing?.currency ?? "SGD"}>{(["SGD","VND","USD","EUR"] as Currency[]).map(c=><option key={c}>{c}</option>)}</select></label><label>Date<input name="date" type="date" defaultValue={editing?.date ?? TODAY} required /></label><label className="wide">Note<textarea name="note" defaultValue={editing?.note} rows={3} placeholder="Optional details…" /></label><label className="check wide"><input type="checkbox" name="unnecessary" defaultChecked={editing?.unnecessary} /> Count this as unnecessary spending</label><div className="form-actions wide"><button type="button" className="text-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button">{editing ? "Save changes" : "Add expense"}</button></div></form></Modal>}
    {modal === "book" && <Modal title="New expense book" close={() => setModal(null)}><form className="form-grid" onSubmit={addBook}><p className="modal-copy wide">Create a separate page for a trip, hospital stay, renovation, or anything you want to track on its own.</p><label className="wide">Book name<input name="name" placeholder="e.g. Bali family trip" autoFocus required /></label><div className="form-actions wide"><button type="button" className="text-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button">Create book</button></div></form></Modal>}
    {modal === "categories" && <Modal title="Category shortcuts" close={() => setModal(null)}><CategoryManager categories={categories} setCategories={setCategories} expenses={expenses} notify={notify} /></Modal>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={e => { if(e.target===e.currentTarget) close(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><div><p className="eyebrow">POCKETBOOK</p><h2>{title}</h2></div><button onClick={close} aria-label="Close">×</button></header>{children}</section></div>; }

function CategoryManager({ categories, setCategories, expenses, notify }: { categories: Category[]; setCategories: React.Dispatch<React.SetStateAction<Category[]>>; expenses: Expense[]; notify: (s:string)=>void }) {
  const [selectedIcon, setSelectedIcon] = useState(ICONS[0]);
  function add(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const shortcut = String(data.get("shortcut")).replace(/[^a-z0-9]/gi,"").toUpperCase().slice(0,3); if(!shortcut) return notify("Add a shortcut key"); if(categories.some(c=>c.shortcut===shortcut)) return notify("That shortcut is already in use"); setCategories(v=>[...v,{id:crypto.randomUUID(),name:String(data.get("name")),shortcut,color:COLORS[v.length%COLORS.length],icon:selectedIcon}]); event.currentTarget.reset(); setSelectedIcon(ICONS[0]); notify("Category and shortcut added"); }
  function remove(id:string){ if(expenses.some(e=>e.categoryId===id)) return notify("Reassign this category’s expenses before removing it"); setCategories(v=>v.filter(c=>c.id!==id)); }
  function updateShortcut(category: Category, shortcut: string) { const next = shortcut.replace(/[^a-z0-9]/gi,"").toUpperCase().slice(0,3); if(!next) return notify("Shortcut must contain 1–3 letters or numbers"); if(next===category.shortcut) return; if(categories.some(c=>c.id!==category.id && c.shortcut===next)) return notify("That shortcut is already in use"); setCategories(v=>v.map(c=>c.id===category.id?{...c,shortcut:next}:c)); notify(`${category.name} now uses ${next}`); }
  function updateIcon(category: Category, icon: string) { setCategories(v=>v.map(c=>c.id===category.id?{...c,icon}:c)); notify(`${category.name} icon updated`); }
  return <><div className="category-list">{categories.map(c=><CategoryRow key={c.id} category={c} onShortcut={value=>updateShortcut(c,value)} onIcon={icon=>updateIcon(c,icon)} onRemove={()=>remove(c.id)} />)}</div><form className="category-add" onSubmit={add}><div className="icon-choice"><span>Choose an icon</span><IconPicker selected={selectedIcon} onSelect={setSelectedIcon} /></div><div className="category-fields"><input name="name" placeholder="New category" required /><input name="shortcut" placeholder="Key" maxLength={3} required aria-label="Shortcut key" /><button className="primary-button">Add</button></div></form></>;
}

function CategoryRow({ category, onShortcut, onIcon, onRemove }: { category: Category; onShortcut:(value:string)=>void; onIcon:(icon:string)=>void; onRemove:()=>void }) {
  const [shortcut, setShortcut] = useState(category.shortcut);
  const [choosingIcon, setChoosingIcon] = useState(false);
  useEffect(() => setShortcut(category.shortcut), [category.shortcut]);
  function save() { onShortcut(shortcut); setShortcut(category.shortcut); }
  return <div className="category-row"><div className="category-main"><button className="cat-icon icon-edit" style={{background:`${category.color}22`,color:category.color}} onClick={()=>setChoosingIcon(v=>!v)} aria-label={`Change icon for ${category.name}`}>{category.icon}<small>⌄</small></button><span className="category-name"><b>{category.name}</b><small>Shortcut</small></span><input className="shortcut-edit" value={shortcut} onChange={e=>setShortcut(e.target.value.toUpperCase())} onBlur={save} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}}} maxLength={3} aria-label={`Shortcut for ${category.name}`} /><button className="remove-category" onClick={onRemove} aria-label={`Remove ${category.name}`}>×</button></div>{choosingIcon && <IconPicker selected={category.icon} onSelect={icon=>{onIcon(icon);setChoosingIcon(false);}} />}</div>;
}

function IconPicker({ selected, onSelect }: { selected:string; onSelect:(icon:string)=>void }) { return <div className="icon-picker" role="listbox" aria-label="Category icons">{ICONS.map(icon=><button type="button" key={icon} className={icon===selected?"selected":""} onClick={()=>onSelect(icon)} role="option" aria-selected={icon===selected}>{icon}</button>)}</div>; }
