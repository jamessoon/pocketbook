import {readdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const root=new URL('../web/dist/',import.meta.url)
const assets=(await readdir(new URL('assets/',root))).map(name=>'/assets/'+name)
const paths=['/index.html','/manifest.webmanifest','/icons/apple.png','/icons/192.png','/icons/512.png','/icons/maskable.png',...assets]
const hash=createHash('sha256')
for(const path of paths)hash.update(await readFile(new URL(path.slice(1),root)))
const key='hhexpense-shell-'+hash.digest('hex').slice(0,16)
await writeFile(new URL('sw.js',root),`
const key=${JSON.stringify(key)}, paths=${JSON.stringify(paths)}
self.addEventListener('install',event=>event.waitUntil(caches.open(key).then(c=>c.addAll(paths))))
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('hhexpense-shell-')&&k!==key).map(k=>caches.delete(k)))).then(()=>self.clients.claim())))
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url)
 if(event.request.method!=='GET'||u.origin!==self.location.origin)return
 if(event.request.mode==='navigate' && ['/','/auth/callback','/expenses','/confirm','/settings','/add','/trips','/recurring','/year','/category','/reports'].includes(u.pathname)){
   event.respondWith(fetch(event.request).catch(()=>caches.open(key).then(c=>c.match('/index.html'))));return
 }
 if(!u.search && paths.includes(u.pathname))event.respondWith(caches.open(key).then(c=>c.match(u.pathname)).then(hit=>hit || fetch(event.request)))
})
`)

