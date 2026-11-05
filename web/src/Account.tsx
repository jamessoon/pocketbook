import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  IconArrowDown, IconArrowUp, IconCheck, IconCopy,
  IconDeviceDesktop, IconEdit, IconLogout, IconMoon, IconPlus, IconSun,
  IconWallet, IconX,
} from '@tabler/icons-react'
import {ReportSettings} from './Reports'
import {Recurring} from './Recurring'
import { supabase } from './client'
import { CategoryIcon, iconChoices, palette } from './icons'
import type { Category, Household, Member } from './types'
import widgetTemplate from '../../widget/HHExpense.js?raw'
import './account.css'

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message) : 'Something went wrong. Please try again.'
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const running = useRef(false)
  async function run(action: () => Promise<void>, success = '') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
    } catch (error) {
      setError(message(error))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { busy, notice, error, run, reset: () => { setError(''); setNotice('') } }
}

function Status({ error, notice }: { error: string; notice: string }) {
  return <>{error && <p className="account-error" role="alert">{error}</p>}
    {notice && <p className="account-notice" role="status">{notice}</p>}</>
}

function AccountFrame({ title, children }: { title: string; children: ReactNode }) {
  return <main className="account-gate">
    <section className="account-card">
      <div className="account-brand"><span><IconWallet size={23} stroke={1.8} /></span> HHExpense</div>
      <h1>{title}</h1>
      {children}
    </section>
  </main>
}

export function Auth({loading = false}: {loading?: boolean}) {
  const [create, setCreate] = useState(false)
  const [code, setCode] = useState('')
  const [people, setPeople] = useState<{id:string; name:string}[] | null>(null)
  const [person, setPerson] = useState('')
  const [name, setName] = useState('')
  const [household, setHousehold] = useState('')
  const [budget, setBudget] = useState('')
  const action = useAction()
  const cache = useQueryClient()
  async function submit(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      const session = await supabase.auth.getSession()
      if (session.error) throw session.error
      if (!session.data.session) {
        const {error} = await supabase.auth.signInAnonymously()
        if (error) throw error
      }
      if (!create && people === null) {
        const {data,error} = await supabase.rpc('check_household_id',{p_code:code})
        if (error || data?.error) throw error || new Error(data.error)
        setPeople(data.members)
        setCode('')
        return
      }
      const {error} = create
        ? await supabase.rpc('create_household',{p_name:household.trim(),p_display_name:name.trim(),p_monthly_budget:Number(budget)})
        : await supabase.rpc('link_household_device',{p_member:person === 'new' ? null : person,p_name:person === 'new' ? name.trim() : null})
      if (error) throw error
      await cache.invalidateQueries({queryKey:['membership']})
    })
  }
  if (loading && !action.busy) return <AccountFrame title="Loading household"><p role="status">Opening your household…</p></AccountFrame>
  const title = create ? 'Create household' : people ? 'Choose your name' : 'Enter household ID'
  return <AccountFrame title={title}>
    <form className="account-form" onSubmit={submit}>
      {create ? <><label>Household name<input required maxLength={100} value={household} onChange={e=>setHousehold(e.target.value)}/></label>
        <label>Monthly budget (SGD)<input required type="number" min="0" step=".01" value={budget} onChange={e=>setBudget(e.target.value)}/></label></> :
        people ? <label>Household member<select required value={person} onChange={e=>setPerson(e.target.value)}>
          <option value="" disabled>Choose your name</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value="new">Add my name</option>
        </select></label> : <label>Six-digit household ID<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
          autoComplete="off" value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,''))}/></label>}
      {(create || (people && person === 'new')) && <label>Your name<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>}
      <Status {...action}/><button className="account-primary" disabled={action.busy}>{create ? 'Create household' : people ? 'Open household' : 'Continue'}</button>
    </form>
    <button className="account-link" disabled={action.busy} onClick={()=>{
      setCreate(!people && !create); setPeople(null); setPerson(''); action.reset()
    }}>{people || create ? 'Back to household ID' : 'Create a household'}</button>
  </AccountFrame>
}

function CategoryEditor({ category, household, categories, close }: {
  category: Category | null; household: Household; categories: Category[]; close: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon ?? 'dots')
  const [color, setColor] = useState(category?.color ?? palette[0][1])
  const [search, setSearch] = useState('')
  const action = useAction()
  const cache = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    return () => node.close()
  }, [])
  async function save(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      const patch = { name: name.trim(), color, icon }
      if (!patch.name) throw new Error('Enter a category name.')
      const query = category
        ? supabase.from('categories').update(patch).eq('id', category.id)
        : supabase.from('categories').insert({ ...patch, household_id: household.id, sort_order: Math.max(0, ...categories.map(row => row.sort_order)) + 1 })
      const { error } = await query.select('id').single()
      if (error) throw error
      await cache.invalidateQueries()
      close()
    })
  }
  const matches = iconChoices.filter(item => (item.label + item.name).toLowerCase().includes(search.toLowerCase().trim()))
  return <dialog ref={dialog} className="account-dialog" aria-labelledby="category-title" onCancel={e => { e.preventDefault(); if (!action.busy) close() }}>
    <form onSubmit={save}>
      <div className="account-row"><h2 id="category-title">{category ? 'Edit category' : 'Add category'}</h2>
        <button type="button" className="account-icon" aria-label="Close category editor" disabled={action.busy} onClick={close}><IconX /></button></div>
      <label>Category name<input required maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
      <fieldset><legend>Colour</legend><div className="account-colors">{palette.map(([label, value]) =>
        <button key={value} type="button" aria-label={label} title={label} aria-pressed={color.toUpperCase() === value} onClick={() => setColor(value)}>
          <span style={{ background: value }}>{color.toUpperCase() === value && <IconCheck size={15} />}</span>
        </button>)}</div></fieldset>
      <label>Icon<input type="search" placeholder="Search icons" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="account-icons">{matches.map(item =>
        <button key={item.name} type="button" title={item.label} aria-label={item.label} aria-pressed={icon === item.name}
          onClick={() => { setIcon(item.name); setColor(item.color) }}><CategoryIcon name={item.name} /></button>)}
        {!matches.length && <span>No matching icons.</span>}
      </div>
      <Status {...action} /><button className="account-primary" disabled={action.busy}>Save category</button>
    </form>
  </dialog>
}

function WidgetSettings() {
  const [token,setToken] = useState('')
  const [confirmRotate,setConfirmRotate] = useState(false)
  const action = useAction()
  function load(rotate = false) {
    void action.run(async () => {
      const {data,error} = await supabase.rpc(rotate ? 'rotate_widget_token' : 'get_widget_token')
      if(error) throw error
      setToken(data)
      setConfirmRotate(false)
    }, rotate ? 'Token replaced. Copy the updated script to each iPhone.' : '')
  }
  function copyScript() {
    const config: Record<string,string> = {
      SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
      SUPABASE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
      WIDGET_TOKEN: token,
      APP_URL: location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'https://hhexpense.vercel.app/' : location.origin + '/',
    }
    const script = widgetTemplate.replace(/"__(SUPABASE_URL|SUPABASE_KEY|WIDGET_TOKEN|APP_URL)__"/g,
      (_,key: string)=>JSON.stringify(config[key]))
    return navigator.clipboard.writeText(script)
  }
  return <section className="account-section"><h2>iPhone widget</h2>
    {!token ? <button onClick={()=>load()} disabled={action.busy}>Set up Scriptable</button> : <>
      <p>Paste this household’s script into Scriptable and name it HHExpense. Keep it private.</p>
      <div className="account-row"><button onClick={()=>action.run(copyScript,'Widget script copied.')}>Copy widget script</button>
        <button onClick={()=>action.run(()=>navigator.clipboard.writeText(token),'Widget token copied.')}>Copy token</button></div>
      {confirmRotate ? <div><p>Replace the token for all household widgets? Each iPhone will need a fresh copy of the script.</p>
        <button disabled={action.busy} onClick={()=>load(true)}>Replace token</button>
        <button onClick={()=>setConfirmRotate(false)}>Cancel</button></div>
        : <button className="account-text" onClick={()=>setConfirmRotate(true)}>Rotate token</button>}
    </>}
    <Status {...action}/>
  </section>
}

export function Settings({ household, members, categories }: { household: Household; members: Member[]; categories: Category[] }) {
  const [name, setName] = useState(household.name)
  const [budget, setBudget] = useState(String(household.monthly_budget))
  const [theme, setTheme] = useState(localStorage.getItem('theme') ?? 'system')
  const [edit, setEdit] = useState<Category | null | undefined>(undefined)
  const action = useAction()
  const cache = useQueryClient()
  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  const active = sorted.filter(row => !row.archived)
  const archived = sorted.filter(row => row.archived)
  function setMode(value: string) {
    setTheme(value); localStorage.setItem('theme', value); document.documentElement.dataset.theme = value
  }
  function move(index: number, by: number) {
    const ids = active.map(row => row.id)
    const target = index + by
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    void action.run(async () => {
      const { error } = await supabase.rpc('reorder_categories', { p_ids: ids })
      if (error) throw error
      await cache.invalidateQueries()
    })
  }
  function archive(row: Category) {
    void action.run(async () => {
      const { error } = await supabase.from('categories').update({ archived: !row.archived }).eq('id', row.id).select('id').single()
      if (error) throw error
      await cache.invalidateQueries()
    }, row.archived ? 'Category restored.' : 'Category archived. Its expenses are still in your history.')
  }
  return <section className="account-settings">
    <h1>Settings</h1>
    <div className="account-section">
      <h2>Household</h2>
      <form className="account-form" onSubmit={e => {
        e.preventDefault()
        void action.run(async () => {
          if (!name.trim()) throw new Error('Enter a household name.')
          const { error } = await supabase.from('households').update({ name: name.trim(), monthly_budget: Number(budget) }).eq('id', household.id).select('id').single()
          if (error) throw error
          await cache.invalidateQueries()
        }, 'Household saved.')
      }}>
        <div className="account-columns"><label>Household name<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Monthly budget (SGD)<input required type="number" min="0" step="0.01" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label></div>
        <button className="account-primary" disabled={action.busy}>Save household</button>
      </form>
      <div className="account-detail"><div><small>Household ID</small><strong className="account-code">{household.invite_code}</strong></div>
        <button className="account-icon" aria-label="Copy household ID" onClick={() => action.run(() => navigator.clipboard.writeText(household.invite_code), 'Household ID copied.')}><IconCopy size={18} /></button></div>
      <h3>Members</h3>{members.map(row => <div className="account-member" key={row.user_id}><strong>{row.display_name}</strong><small>{row.email}</small></div>)}
    </div>
    <Status {...action} />
    <Recurring household={household} categories={categories}/>
    <div className="account-section">
      <h2>Appearance</h2><div className="account-switch">{([
        ['system', IconDeviceDesktop], ['light', IconSun], ['dark', IconMoon],
      ] as const).map(([value, Symbol]) =>
        <button key={value} type="button" aria-pressed={theme === value} onClick={() => setMode(value)}><Symbol size={17} />{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    </div>
    <div className="account-section">
      <div className="account-row"><h2>Categories</h2><button className="account-icon" aria-label="Add category" onClick={() => setEdit(null)}><IconPlus /></button></div>
      {active.map((row, i) => <div className="account-category" key={row.id}>
        <span className="account-chip" style={{ color: row.color }}><CategoryIcon name={row.icon} /></span>
        <button className="account-cat-name" onClick={() => setEdit(row)}>{row.name}</button>
        <button className="account-icon" disabled={action.busy || i === 0} aria-label={`Move ${row.name} up`} onClick={() => move(i, -1)}><IconArrowUp size={16} /></button>
        <button className="account-icon" disabled={action.busy || i === active.length - 1} aria-label={`Move ${row.name} down`} onClick={() => move(i, 1)}><IconArrowDown size={16} /></button>
        <button className="account-text" disabled={action.busy} onClick={() => archive(row)} aria-label={`Archive ${row.name}`}>Archive</button>
      </div>)}
      {archived.length > 0 && <details><summary>Archived categories ({archived.length})</summary>{archived.map(row =>
        <div className="account-category" key={row.id}><CategoryIcon name={row.icon} /><span className="account-cat-name">{row.name}</span>
          <button className="account-icon" aria-label={`Edit ${row.name}`} onClick={() => setEdit(row)}><IconEdit size={17} /></button>
          <button className="account-text" disabled={action.busy} onClick={() => archive(row)}>Restore</button></div>
      )}</details>}
    </div>
    <ReportSettings key={'report-'+household.id} household={household}/>
    <WidgetSettings key={household.id}/>
    <div className="account-section"><h2>Account</h2>

      <button className="account-text" disabled={action.busy} onClick={() => action.run(async () => {
        const { error } = await supabase.auth.signOut({scope:'local'}); if (error) throw error

      })}><IconLogout size={18} />Sign out</button>
    </div>
    {edit !== undefined && <CategoryEditor category={edit} categories={categories} household={household} close={() => setEdit(undefined)} />}
  </section>
}
