// Run against the isolated QA Vite server. Only the reserved test backend is intercepted.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const baseURL = process.env.HH_QA_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({ executablePath: process.env.HH_BROWSER || undefined, headless: true });
const household = { id: "10000000-0000-4000-8000-000000000001", timezone: "Asia/Singapore", name: "UI test household", monthly_budget: 1200, base_currency: "SGD", invite_code: "TESTCODE" };
const member = { household_id: household.id, user_id: "50000000-0000-4000-8000-000000000001", display_name: "Test member", email: "qa@example.test" };
const catalog = ["Shopping","Communication","Food & drink","Education","Entertainment","Grocery","Occasional (gift)","House","Pet","Sport","Transport","Travel","Health","Family"];
const icons = ["shopping-bag","phone","tools-kitchen-2","book","movie","basket","gift","home","cat","ball-volleyball","taxi","plane","heartbeat","users-group"];
const categories = catalog.map((name, i) => ({ id: "20000000-0000-4000-8000-" + String(i+1).padStart(12, "0"), name, icon: icons[i], color: "#267566", sort_order: i, archived: false, household_id: household.id }));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: household.timezone, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
const user = { id: member.user_id, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, email: member.email };
const now = Math.floor(Date.now() / 1000);
const jwt = [ { alg: "HS256", typ: "JWT" }, { sub: member.user_id, exp: now+3600, iat: now, role: "authenticated" } ].map(v => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".") + ".eA";
const session = { access_token: jwt, token_type: "bearer", refresh_token: "local-test-only", expires_in: 3600, expires_at: now + 3600, user };
function expense(id, category, description) {
  return { id, category_id: category.id, household_id: household.id, description, spent_on: today, amount_sgd: 8, original_amount: 8, original_currency: "SGD", sgd_confirmed: true, is_fixed: false, trip_id: null, fx_rate_estimate: null, updated_at: new Date().toISOString(), created_at: new Date().toISOString(), created_by: member.user_id };
}
try {
  for (const theme of ["light","dark"]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const rows = [expense("30000000-0000-4000-8000-000000000001", categories[0], "Shopping only"),
      expense("30000000-0000-4000-8000-000000000002", categories[1], "Phone credit")];
    const trips = [];
    const queries = [];
    let allowRate = true;
    await page.addInitScript(({ session, theme }) => {
      localStorage.setItem("sb-hh-test-auth-token", JSON.stringify(session));
      localStorage.setItem("theme", theme);
    }, { session, theme });
    await page.route("https://hh-test.supabase.co/**", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname, params = url.searchParams;
      const json = (data, status = 200, headers = {}) => route.fulfill({ status, json: data, headers: { "Access-Control-Allow-Origin":"*", ...headers } });
      if (path === "/auth/v1/user") return json(user);
      if (path.endsWith("/members")) return json([member]);
      if (path.endsWith("/households")) return json(household);
      if (path.endsWith("/trips")) {
        if (req.method()==="POST") {
          const trip={...req.postDataJSON(),id:"41000000-0000-4000-8000-000000000001"};
          trips.push(trip);return json({id:trip.id},201);
        }
        return json(trips);
      }
      if (path.endsWith("/categories")) return json(categories);
      if (path.endsWith("/category_usage")) return json(categories.map(c => ({ category_id: c.id, uses: 0 })));
      if (path.endsWith("/category_suggestions")) return json(["Lunch set","Coffee with family","Dinner at home"].map(description => ({ description })));
      if (path.endsWith("/fx-rate")) return allowRate ? json({ rate: 0.3, currency: "MYR", date: today }) : json({ error: "unavailable" }, 503);
      if (path.endsWith("/month_summary")) return json({ monthly_budget:1200, remaining:1184, fixed_items:[], fixed_costs:0, day_to_day_spent:16, daily_budget:30, left_today:14 });
      if (path.endsWith("/expenses")) {
        const id = params.get("id")?.slice(3);
        const matches = rows.filter(e => (!params.get("trip_id") || (params.get("trip_id")==="is.null" ? !e.trip_id : e.trip_id===params.get("trip_id").slice(3))) && (!id || e.id === id) && (!params.has("category_id") || e.category_id === params.get("category_id").slice(3)) && (!params.has("sgd_confirmed") || e.sgd_confirmed === (params.get("sgd_confirmed") === "eq.true")));
        if (req.method() === "POST") {
          const values = req.postDataJSON();
          rows.push({ ...expense(values.id, categories[0], ""), ...values });
          return json(null, 201);
        }
        if (req.method() === "PATCH") {
          assert.equal(matches.length, 1);
          Object.assign(matches[0], req.postDataJSON(), { updated_at: new Date().toISOString() });
          return json({ id: matches[0].id });
        }
        if (req.method() === "DELETE") {
          assert.equal(matches.length, 1);
          rows.splice(rows.indexOf(matches[0]), 1);
          return json({ id: matches[0].id });
        }
        queries.push(url.search);
        if (id && req.headers().accept?.includes("object+json")) return json(matches[0]);
        return json(matches, 200, { "content-range": "0-" + Math.max(0,matches.length-1) + "/" + matches.length });
      }
      return json({ error: "Unhandled UI test route: " + path }, 500);
    });
    await page.goto(baseURL + "/add?category=" + categories[2].id);
    await expect(page.getByRole("button", { name:"Food & drink", exact:true })).toHaveAttribute("aria-pressed","true");
    await page.getByRole("button", { name:"SGD", exact:true }).click();
    await page.getByRole("button", { name:"MYR", exact:true }).click();
    await page.getByRole("button", { name:"3", exact:true }).click();
    await page.getByRole("button", { name:"0", exact:true }).click();
    await page.getByRole("button", { name:"Lunch set", exact:true }).click();
    await expect(page.getByText(/at today’s rate/)).toBeVisible();
    await expect(page.getByRole("textbox", { name:"Description" })).toHaveValue("Lunch set");
    await expect(page.getByText(/Estimate only/)).toBeVisible();
    const rect = await page.getByRole("button", { name:"Save expense" }).boundingBox();
    const overflow = await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth]);
    assert.ok(rect && rect.y + rect.height <= 667, "Save below viewport");
    assert.deepEqual(overflow, [667,375], "Quick add overflow");
    await page.setViewportSize({width:393,height:852});
    const tallSave = await page.getByRole("button", {name:"Save expense"}).boundingBox();
    assert.ok(tallSave && tallSave.y+tallSave.height >= 830 && tallSave.y+tallSave.height <= 852, "Keypad and Save should sit at the bottom");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),852);
    await expect(page.locator(".ee-slots button")).toHaveCount(categories.length);
    await page.getByRole("button", { name:"Transport", exact:true }).click();
    await page.getByRole("button", { name:"Save expense" }).click();
    await expect(page.getByRole("heading", { name:"Overview", exact:true })).toBeVisible();
    const saved = rows.at(-1);
    assert.equal(saved.original_currency, "MYR");
    assert.equal(saved.amount_sgd, 9);
    assert.equal(saved.sgd_confirmed, false);
    assert.equal(saved.category_id, categories[10].id);
    await page.goto(baseURL + "/confirm");
    await expect(page.getByText("Lunch set", { exact:true })).toBeVisible();
    await page.getByLabel("Charged SGD amount").fill("9.40");
    await page.getByRole("button",{name:"Confirm",exact:true}).click();
    await expect(page.getByText("All caught up")).toBeVisible();
    assert.equal(saved.amount_sgd, 9.4);
    assert.equal(saved.sgd_confirmed, true);
    await page.goto(baseURL + "/expenses?category=" + categories[0].id);
    await expect(page.getByText("Shopping only", {exact:true})).toBeVisible();
    await expect(page.getByText("Phone credit", {exact:true})).toHaveCount(0);
    assert.ok(queries.some(q => q.includes("category_id=eq." + categories[0].id)));
    await page.getByRole("button", { name: /Shopping only.*Test member/ }).click();
    await page.getByRole("textbox", { name:"Description" }).fill("Updated shopping");
    await page.getByRole("button", { name:"Save changes" }).click();
    await expect(page.getByText("Updated shopping", {exact:true})).toBeVisible();
    await page.getByRole("button", {name:"Delete Updated shopping"}).click();
    await page.getByRole("dialog").getByRole("button", {name:"Delete expense"}).click();
    await page.getByRole("navigation",{name:"Main navigation"}).getByText("Overview").click();
    await page.getByRole("button", {name:"Undo"}).click();
    await page.getByRole("navigation",{name:"Main navigation"}).getByText("Expenses").click();
    await expect(page.getByText("Updated shopping", {exact:true})).toBeVisible();
    await page.getByRole("button", {name:"Delete Updated shopping"}).click();
    await page.getByRole("dialog").getByRole("button", {name:"Delete expense"}).click();
    await page.getByRole("navigation",{name:"Main navigation"}).getByText("Settings").click();
    await expect.poll(() => rows.some(e=>e.description==="Updated shopping"), {timeout:10000}).toBe(false);
    allowRate = false;
    await page.goto(baseURL + "/add?category=" + categories[0].id);
    await page.getByRole("button", {name:"SGD",exact:true}).click();
    await page.getByRole("button", {name:"MYR",exact:true}).click();
    await page.getByRole("button", {name:"1",exact:true}).click();
    await expect(page.getByRole("button", {name:/Rate unavailable/})).toBeVisible({timeout:15000});
    await expect(page.getByRole("button", {name:"Save expense"})).toBeDisabled();
    await page.goto(baseURL+"/");
    await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Trips",exact:true}).click();
    await page.getByRole("button",{name:"New trip"}).click();
    await page.getByLabel("Trip name").fill("Family holiday");
    await page.getByLabel("Trip budget").fill("200");
    await page.getByRole("button",{name:"Save trip"}).click();
    await expect(page.getByRole("heading",{name:"Family holiday"})).toBeVisible();
    await page.getByRole("link",{name:"Add expense",exact:true}).click();
    await expect(page.getByLabel("Select trip")).toHaveText("Family holiday");
    await page.getByRole("button",{name:"Food & drink",exact:true}).click();
    await page.getByRole("button",{name:"5",exact:true}).click();
    await page.getByRole("textbox",{name:"Description",exact:true}).fill("Trip snack");
    await page.getByRole("button",{name:"Save expense"}).click();
    await expect(page.getByRole("link",{name:/Trip snack/})).toBeVisible();
    assert.equal(rows.at(-1).trip_id,trips[0].id);
    await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Trips",exact:true}).click();
    await expect(page.getByRole("link",{name:/Family holiday/})).toBeVisible();
    await page.goto(baseURL+"/add");
    await expect(page.getByLabel("Select trip")).toHaveText("Family holiday");
    await page.getByLabel("Select trip").click();
    await page.getByRole("button",{name:"No trip",exact:true}).click();
    await expect(page.getByLabel("Select trip")).toHaveText("No trip");
    assert.deepEqual(errors, []);
    console.log(theme + ": entry screens and CRUD passed; quick add " + overflow + ", Save bottom " + Math.round(rect.y + rect.height) + "px.");
    await context.close();
  }
} finally { await browser.close(); }

