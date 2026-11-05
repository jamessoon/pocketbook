import {createClient} from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured = Boolean(url && key)
export const supabase = createClient(url || 'https://unconfigured.invalid', key || 'unconfigured', {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true }
})
