import React, {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate, Navigate} from 'react-router-dom'
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query'
import type {Session} from '@supabase/supabase-js'
import {IconHome,IconListDetails,IconSettings,IconPlus,IconWallet} from '@tabler/icons-react'
import {configured,supabase} from './client'
import {Auth,Settings} from './Account'
import {QuickAdd,ExpenseList,Confirm,ExpenseDeletionProvider} from './Entries'
import {Dashboard} from './Dashboard'
import {today} from './dates'
import type {Household,Category,Member} from './types'
import './style.css'
const cache = new QueryClient({defaultOptions:{queries:{refetchOnWindowFocus:true,retry:1}}})
document.documentElement.dataset.theme = localStorage.getItem('theme') || 'system'
function App() {
  const [session,setSession] = useState<Session|null|undefined>()
  const [authError,setAuthError] = useState('')
  const [selectedMonth,setMonth] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(()=>{
    const update=()=>{
      const surface=location.pathname==='/add'?'--surface':'--bg'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(document.documentElement).getPropertyValue(surface).trim())
    }
    update()
    const observer=new MutationObserver(update)
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})
    const scheme=matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change',update)
    return ()=>{observer.disconnect();scheme.removeEventListener('change',update)}
  },[location.pathname])
  useEffect(()=>{
    if(!configured) return
    const {data} = supabase.auth.onAuthStateChange((_event,s)=>setSession(s))
    supabase.auth.getSession().then(({data,error})=>{if(error)setAuthError(error.message);setSession(data.session)})
    return ()=>data.subscription.unsubscribe()
  },[])
  const user = session?.user.id
  useEffect(()=>{setMonth(''); if(!user) cache.clear()},[user])
  useEffect(()=>{if(user && location.pathname==='/auth/callback') navigate('/',{replace:true})},[user,location.pathname,navigate])
  const householdQuery = useQuery({queryKey:['membership',user],enabled:!!user,queryFn:async()=>{
    const {data:member,error}=await supabase.from('members').select('household_id').eq('user_id',user!).maybeSingle()
    if(error)throw error
    if(!member)return null
    const results=await Promise.all([
      supabase.from('households').select('id,name,timezone,base_currency,invite_code,monthly_budget').eq('id',member.household_id).single(),
      supabase.from('categories').select('*').eq('household_id',member.household_id).order('sort_order').order('id'),
      supabase.from('members').select('*').eq('household_id',member.household_id).order('joined_at')])
    for(const result of results)if(result.error)throw result.error
    return {household:results[0].data as Household,categories:results[1].data as Category[],members:(results[2].data as Member[]).filter(m=>!m.profile_user_id)}
  }})
  if(!configured)return <main className="setup"><Brand/><h1>Connect your household</h1><p>Add your Supabase URL and publishable key to the web environment, then restart HHExpense.</p><code>web/.env.local</code><p>Follow the Supabase setup in the project README.</p></main>
  if(authError || householdQuery.isError)return <main className="setup" role="alert"><Brand/><h1>Couldn’t load your household</h1><p>{authError || householdQuery.error?.message}</p><button onClick={()=>window.location.reload()}>Try again</button></main>
  if(session===undefined)return <main className="setup"><Brand/><p role="status">Loading household…</p></main>
  if(!session || !householdQuery.data)return <Auth loading={!!user && householdQuery.isPending}/>
  const data=householdQuery.data
  const month=selectedMonth || today(data.household.timezone).slice(0,7)+'-01'
  const props={...data,month}
  const nav=[{to:'/',name:'Overview',Icon:IconHome},{to:'/expenses',name:'Expenses',Icon:IconListDetails},{to:'/settings',name:'Settings',Icon:IconSettings}]
  return <ExpenseDeletionProvider key={user+data.household.id}><div className="layout"><aside className="sidebar"><Brand/><nav>{nav.map(({to,name,Icon})=><NavLink key={to} to={to} end><Icon size={19}/>{name}</NavLink>)}</nav><div className="household-name"><IconHome size={20}/><span>{data.household.name}</span></div></aside>
    {location.pathname!=='/add' && <header className="phone-header"><nav aria-label="Main navigation">{nav.map(({to,name})=><NavLink to={to} end key={to}>{name}</NavLink>)}</nav></header>}
    <main className="content"><Routes>
    <Route path="/" element={<Dashboard {...props} onMonth={setMonth}/>}/>
    <Route path="/expenses" element={<ExpenseList {...props}/>}/><Route path="/confirm" element={<Confirm {...props}/>}/>
    <Route path="/add" element={<QuickAdd {...props}/>}/><Route path="/settings" element={<Settings {...props}/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/></Routes></main>
    {location.pathname!=='/add' && <footer className="phone-action"><LinkToAdd category={location.pathname==='/expenses' ? new URLSearchParams(location.search).get('category') : null}/></footer>}</div></ExpenseDeletionProvider>
}
function LinkToAdd({category}:{category:string|null}){
  return <NavLink className="primary" to={category ? '/add?category='+encodeURIComponent(category) : '/add'}><IconPlus size={19}/>Add expense</NavLink>
}
function Brand(){return <div className="brand"><span><IconWallet size={23} stroke={1.8}/></span>HHExpense</div>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={cache}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></React.StrictMode>)
if(import.meta.env.PROD && 'serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(console.error)})


