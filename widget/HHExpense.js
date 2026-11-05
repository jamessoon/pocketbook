// HHExpense for Scriptable. Settings → Copy widget script fills these values.
const SUPABASE_URL = "__SUPABASE_URL__";
const SUPABASE_KEY = "__SUPABASE_KEY__";
const WIDGET_TOKEN = "__WIDGET_TOKEN__";
const APP_URL = "__APP_URL__";

const files = FileManager.local();
const symbols = {
  "shopping-bag":"bag", phone:"phone", "tools-kitchen-2":"fork.knife", book:"book",
  movie:"film", basket:"cart", gift:"gift", home:"house", cat:"pawprint",
  "ball-volleyball":"sportscourt", taxi:"car", plane:"airplane", heartbeat:"heart",
  "users-group":"person.3", coffee:"cup.and.saucer", glass:"wineglass", car:"car",
  train:"tram", "gas-station":"fuelpump", parking:"parkingsign", key:"key",
  armchair:"chair", "building-community":"building.2", bulb:"lightbulb", droplet:"drop",
  wifi:"wifi", "device-tv":"tv", "shield-check":"shield", "receipt-tax":"doc.text",
  pill:"pills", "first-aid-kit":"cross.case", barbell:"dumbbell", "baby-carriage":"figure.child",
  school:"graduationcap", books:"books.vertical", shirt:"tshirt", sparkles:"sparkles",
  "device-gamepad-2":"gamecontroller", bed:"bed.double", "heart-handshake":"heart",
  "building-bank":"building.columns", "credit-card":"creditcard", dots:"ellipsis.circle"
};
const money = n => "S$" + Number(n).toLocaleString("en-SG",{minimumFractionDigits:2,maximumFractionDigits:2});
const ink = Color.dynamic(new Color("#202d28"),new Color("#edf5ee"));
const accent = Color.dynamic(new Color("#245f4e"),new Color("#a0d9ba"));
const muted = Color.dynamic(new Color("#57665f"),new Color("#b3c2b7"));
async function rpc(name, fields = {}) {
  const req = new Request(SUPABASE_URL + "/rest/v1/rpc/" + name);
  req.method = "POST";
  req.timeoutInterval = 10;
  req.headers = {apikey:SUPABASE_KEY,"Content-Type":"application/json"};
  req.body = JSON.stringify({token:WIDGET_TOKEN,...fields});
  const body = await req.loadString();
  if (req.response.statusCode >= 400) {
    const error = new Error(JSON.parse(body).message || "Widget request failed.");
    error.status = req.response.statusCode;
    throw error;
  }
  return JSON.parse(body);
}
async function snapshot(mode) {
  // Partition local caches by installation and token generation.
  const path = files.joinPath(files.documentsDirectory(),"HHExpense-"+WIDGET_TOKEN.slice(-12)+"-"+mode+".json");
  try {
    const data = await rpc(mode==="summary"?"widget_summary":"widget_categories");
    const saved = {data, updated:Date.now()};
    files.writeString(path,JSON.stringify(saved));
    return {...saved, stale:false};
  } catch (error) {
    if (error.status===401 || error.status===403) {
      if(files.fileExists(path)) files.remove(path);
      throw error;
    }
    if (!files.fileExists(path)) throw error;
    const saved = JSON.parse(files.readString(path));
    return saved.updated ? {...saved, stale:true} : {data:saved, updated:null, stale:true};
  }
}
function label(parent,text,size,color=ink,bold=false) {
  const item = parent.addText(String(text));
  item.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  item.textColor = color;
  item.lineLimit = 1;
  item.minimumScaleFactor = 0.65;
  return item;
}
function bar(parent,spent,budget) {
  const drawing = new DrawContext();
  drawing.size = new Size(180,5);
  drawing.opaque = false;
  drawing.setFillColor(new Color("#586b60"));
  drawing.fillRect(new Rect(0,0,180,5));
  drawing.setFillColor(new Color("#75b796"));
  drawing.fillRect(new Rect(0,0,180*Math.min(1,spent/Math.max(0.01,budget)),5));
  parent.addImage(drawing.getImage()).imageSize = new Size(112,5);
}
function summary(w,data) {
  w.url = runLink("open=summary");
  const month = new Date(data.month+"T12:00:00Z").toLocaleDateString("en-SG",{month:"short",year:"numeric"});
  label(w,month,12,muted,true);
  label(w,money(data.spent),22,ink,true);
  label(w,"of "+money(data.monthly_budget)+" budget",11,muted);
  bar(w,data.spent,data.monthly_budget);
  w.addSpacer(3);
  label(w,"Today "+money(data.left_today)+" / "+money(data.daily_budget),11,accent,true);
  if(config.widgetFamily==="medium"){
    for(const row of data.recent){
      const line=w.addStack();
      label(line,row.label,10); line.addSpacer(); label(line,money(row.amount_sgd),10,muted);
    }
  }
}
function categories(w,data) {
  if(config.widgetFamily==="small"){label(w,"Use a medium or large widget for quick add.",13).lineLimit=3;return;}
  label(w,"Add expense",14,accent,true);
  if(!data.length){label(w,"Add a category in Settings.",12);return;}
  const columns = 5;
  const capacity = config.widgetFamily==="large" ? 30 : 15;
  const visible = data.length<=capacity ? data : [...data.slice(0,capacity-1),{name:"All categories",icon:"dots"}];
  for(let start=0;start<visible.length;start+=columns){
    w.addSpacer(4);
    const row=w.addStack();
    for(const category of visible.slice(start,start+columns)){
      const cell=row.addStack(); cell.layoutVertically();
      cell.url=runLink(category.id ? "categoryId="+encodeURIComponent(category.id) : "open=add");
      const symbol=SFSymbol.named(symbols[category.icon] || "circle") || SFSymbol.named("circle");
      const icon=cell.addImage(symbol.image); icon.imageSize=new Size(16,16); icon.tintColor=accent;
      label(cell,category.name,10); row.addSpacer();
    }
  }
}
async function render(mode) {
  const w = new ListWidget();
  w.setPadding(9,11,9,11);
  w.backgroundColor = Color.dynamic(new Color("#f4f6f2"),new Color("#15201b"));
  w.refreshAfterDate = new Date(Date.now()+5*60*1000);
  try {
    if(!["summary","add"].includes(mode)) throw new Error("Set Parameter to summary or add.");
    const {data,stale,updated}=await snapshot(mode);
    if(mode==="summary") summary(w,data); else categories(w,data);
    if(stale) label(w,"Stale · last saved",10,muted);
    else if(mode==="summary") label(w,"Updated "+new Date(updated).toLocaleTimeString("en-SG",{hour:"2-digit",minute:"2-digit"}),9,muted);
  } catch(error){ label(w,error.message,13).lineLimit=4; }
  return w;
}
function runLink(query) {
  return "scriptable:///run?scriptName="+encodeURIComponent(Script.name())+"&"+query;
}
async function openExpenseApp(categoryId, open) {
  const route = categoryId ? "add?category="+encodeURIComponent(categoryId) : open==="add" ? "add" : "";
  const view=new WebView();
  await view.loadURL(APP_URL.replace(/\/$/,"")+"/"+route);
  await view.present(true);
  // Get fresh server totals after the user dismisses the web app.
  Script.setWidget(await render("summary"));
}
try {
  const {categoryId,open}=args.queryParameters;
  if(categoryId || open==="add" || open==="summary") await openExpenseApp(categoryId,open);
  else {
    const widget=await render((args.widgetParameter || "summary").trim().toLowerCase());
    Script.setWidget(widget);
    if(!config.runsInWidget) await widget.presentMedium();
  }
} catch(error){
  const alert=new Alert();alert.title="HHExpense";alert.message=error.message;alert.addAction("OK");await alert.presentAlert();
}
Script.complete();
