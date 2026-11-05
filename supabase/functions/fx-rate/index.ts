import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function reply(status: number, body: unknown) {
  return Response.json(body, { status, headers: cors });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return reply(405, { error: "POST required" });
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "Sign in to request a rate." });
  const payload = await request.json().catch(() => null);
  const currency = payload?.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    return reply(400, { error: "Choose a valid currency." });
  }
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authOptions = { persistSession: false, autoRefreshToken: false };
    const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: authOptions, global: { headers: { Authorization: "Bearer " + token } },
    });
    const { data: auth, error: authError } = await userDb.auth.getUser(token);
    if (authError || !auth.user) return reply(401, { error: "Sign in to request a rate." });
    const member = await userDb.from("members").select("household_id").eq("user_id", auth.user.id).maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) return reply(403, { error: "Join a household to request a rate." });
    const household = await userDb.from("households").select("timezone").eq("id", member.data.household_id).single();
    if (household.error) throw household.error;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: household.data.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: authOptions });
    const cached = await db.from("fx_rates").select("rates").eq("date", date).eq("base", "SGD").maybeSingle();
    if (cached.error) throw cached.error;
    let rates = cached.data?.rates;
    if (!rates) {
      const response = await fetch("https://open.er-api.com/v6/latest/SGD", { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Provider unavailable");
      const data = await response.json();
      if (data.result !== "success" || data.base_code !== "SGD" || data.rates?.SGD !== 1) {
        throw new Error("Invalid provider response");
      }
      rates = data.rates;
      const saved = await db.from("fx_rates").upsert({ date, base: "SGD", rates }, { onConflict: "date,base" });
      if (saved.error) throw saved.error;
    }
    const perSgd = rates[currency];
    if (typeof perSgd !== "number" || !Number.isFinite(perSgd) || perSgd <= 0) {
      return reply(422, { error: "This currency is unavailable today." });
    }
    return reply(200, { currency, date, rate: 1 / perSgd });
  } catch {
    return reply(503, { error: "Today's rate is unavailable. Please try again." });
  }
});
