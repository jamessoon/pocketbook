// Run against the local Vite QA server configured for https://hh-test.supabase.co.
import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
const browser=await chromium.launch({channel:process.env.QA_BROWSER || 'msedge'})
const origin=process.env.QA_URL || 'http://127.0.0.1:5178'
const household={id:'h1',name:'Test household',timezone:'Asia/Singapore',monthly_budget:2000,base_currency:'SGD',invite_code:'12345678'}
const member={user_id:'user1',display_name:'Test member',household_id:'h1'}
const category={id:'food',name:'Food & drink',icon:'tools-kitchen-2',color:'#B75B25',archived:false,sort_order:1}
try{
 for(const theme of ['light','dark']){
  for(const width of [375,1200]){
   const page=await browser.newPage({viewport:{width,height:width===375?667:800},colorScheme:theme})
   const errors=[]
   let housePosted=false
   let bill=null
   page.on('pageerror',e=>errors.push(e.message))
   await page.addInitScript(()=>{
    const user={id:'user1',aud:'authenticated',role:'authenticated',email:'test@example.invalid',app_metadata:{},user_metadata:{}}
    localStorage.setItem('sb-hh-test-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}))
   })
   await page.route('https://hh-test.supabase.co/**',async route=>{
    const url=new URL(route.request().url())
    const table=url.pathname.split('/').pop()
    if(table==='delete_recurring_bill'){assert.equal(route.request().postDataJSON().p_id,bill.id);bill=null;return route.fulfill({status:204})}
    if(table==='recurring_items'){
      const method=route.request().method()
      if(method==='POST' || method==='PATCH'){
        bill={...bill,...route.request().postDataJSON(),id:'bill1'}
        return route.fulfill({status:200,json:{id:bill.id}})
      }
      if(url.searchParams.get('select')==='id,category_id')return route.fulfill({json:[{id:'rent',category_id:'house'}]})
      return route.fulfill({status:200,json:bill?[bill]:[]})
    }
    const result=table==='members' ?[member]
      :table==='trips'?[]:table==='households'?household:table==='categories'?[category,{...category,id:'house',name:'House',icon:'home'}]
      :table==='month_summary'?{monthly_budget:2000,fixed_costs:100,day_to_day_spent:12,daily_budget:60,left_today:48,remaining:1888,fixed_items:[{id:"rent",amount:80,posted:housePosted}]}
      :[{id:'expense1',category_id:'food',is_fixed:false,amount_sgd:12},{id:'fixed1',category_id:'food',is_fixed:true,amount_sgd:100},...(housePosted?[{id:'rent-entry',category_id:'house',amount_sgd:80}]:[])]
    await route.fulfill({status:200,headers:{'Content-Range':'0-0/1','Access-Control-Expose-Headers':'Content-Range'},json:result})
   })
   await page.goto(origin)
   await page.getByRole('heading',{name:'Overview'}).waitFor()
   await page.getByText('Remaining this month').waitFor()
   assert.equal(await page.locator('.ring strong').innerText(),'$112.00')
   const house=page.locator('.category-link').filter({hasText:'House'})
   assert.equal(await house.locator('strong').innerText(),'$80.00')
   assert.equal(await house.locator('small').innerText(),'Includes $80.00 scheduled')
   housePosted=true
   await page.reload()
   await page.getByText('Remaining this month').waitFor()
   assert.equal(await house.locator('strong').innerText(),'$80.00')
   assert.equal(await house.locator('small').count(),0)
   assert.equal(await page.locator('.ring strong').innerText(),'$192.00')
   await page.getByLabel('Previous month').click()
   await page.waitForFunction(()=>!document.querySelector('.budget')?.textContent.includes('Daily budget'))
   await page.getByLabel('Next month').click()
   await page.getByText('Daily budget',{exact:true}).waitFor()
   assert.equal(await page.getByLabel('Include fixed').count(),0)
   assert.ok(await page.getByLabel('Add Food & drink expense').getAttribute('href')==='/add?category=food')
   assert.ok(await page.getByRole('link',{name:/expense to confirm/}).isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.getByRole('link',{name:'Settings',exact:true}).filter({visible:true}).click()
   await page.getByRole('button',{name:'New bill'}).click()
   await page.getByLabel('Bill name').fill('Internet')
   await page.getByLabel('Category',{exact:true}).selectOption('food')
   await page.getByLabel('Amount type').selectOption('variable')
   await page.getByLabel('Estimate (SGD)').fill('45')
   await page.getByLabel('Frequency').selectOption('3')
   await page.getByLabel('Day due').fill('31')
   await page.getByRole('button',{name:'Save recurring cost'}).click()
   await page.getByRole('link',{name:/Internet/}).click()
   await page.getByLabel('Active',{exact:true}).uncheck()
   await page.getByRole('button',{name:'Save recurring cost'}).click()
   await page.getByText(/Day 31 · Paused/).waitFor()
   assert.equal(bill.amount,45)
   assert.equal(bill.interval_months,3)
   assert.equal(bill.active,false)
   await page.getByLabel('Delete Internet').click()
   await page.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.equal(bill.id,'bill1')
   await page.getByLabel('Delete Internet').click()
   await page.getByRole('button',{name:'Delete bill',exact:true}).click()
   await page.getByText('Add a bill to reserve it in your monthly budget.').waitFor()
   assert.equal(bill,null)
   await page.goto(origin)
   await page.getByLabel('Quick add: Food & drink').click()
   await page.getByRole('button',{name:'Food & drink',exact:true,pressed:true}).waitFor()
   assert.deepEqual(errors,[])
   await page.close()
   console.log('Overview passed',theme,width)
  }
 }
}finally{await browser.close()}


