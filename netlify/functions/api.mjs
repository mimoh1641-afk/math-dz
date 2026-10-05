import { getStore } from "@netlify/blobs";

const lessons = () => getStore("mathdz-lessons");
const images = () => getStore("mathdz-images");
const requests = () => getStore("mathdz-requests");

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {
    status, headers: {"content-type":"application/json; charset=utf-8", ...extra}
  });
}
function cookieToken(password){
  const b = btoa(unescape(encodeURIComponent(password)));
  return b;
}
function authorized(req){
  const expected = process.env.ADMIN_PASSWORD;
  if(!expected) return false;
  const c = req.headers.get("cookie") || "";
  const m = c.match(/mathdz_admin=([^;]+)/);
  return m && decodeURIComponent(m[1]) === cookieToken(expected);
}
function safeName(s){ return s.replace(/[^\w\u0600-\u06ff ._-]/g,"").slice(0,80) || "image"; }

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "");

  if(req.method==="POST" && path==="login"){
    const body = await req.json().catch(()=>({}));
    if(!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD)
      return json({error:"كلمة السر غير صحيحة"},401);
    return json({ok:true},{
      "set-cookie": `mathdz_admin=${encodeURIComponent(cookieToken(process.env.ADMIN_PASSWORD))}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`
    });
  }

  if(req.method==="POST" && path==="logout"){
    return json({ok:true},{"set-cookie":"mathdz_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"});
  }

  if(path==="lessons" && req.method==="GET"){
    const {blobs=[]}=await lessons().list();
    const out=[];
    for(const b of blobs){
      const x=await lessons().get(b.key,{type:"json"});
      if(x) out.push({...x,id:b.key});
    }
    out.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
    return json(out);
  }

  if(path==="requests" && req.method==="POST"){
    const body=await req.json().catch(()=>({}));
    const name=String(body.lesson||"").trim().slice(0,120);
    if(!name) return json({error:"اكتب اسم الدرس"},400);
    await requests().setJSON(crypto.randomUUID(),{lesson:name,createdAt:new Date().toISOString()});
    return json({ok:true});
  }

  if(path==="requests" && req.method==="GET"){
    if(!authorized(req)) return json({error:"غير مصرح"},401);
    const {blobs=[]}=await requests().list();
    const counts={};
    for(const b of blobs){
      const x=await requests().get(b.key,{type:"json"});
      if(x?.lesson) counts[x.lesson]=(counts[x.lesson]||0)+1;
    }
    return json(Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([lesson,count])=>({lesson,count})));
  }

  if(path==="lessons" && req.method==="POST"){
    if(!authorized(req)) return json({error:"غير مصرح"},401);
    const form=await req.formData();
    const title=String(form.get("title")||"").trim();
    const level=String(form.get("level")||"").trim();
    const chapter=String(form.get("chapter")||"").trim();

    if(!title) return json({error:"عنوان الدرس مطلوب"},400);

    const files=form.getAll("images").filter(x=>x instanceof File);
    if(!files.length) return json({error:"اختر صورة واحدة على الأقل"},400);

    const imageKeys=[];
    for(const f of files){
      const key=`${crypto.randomUUID()}-${safeName(f.name)}`;
      await images().set(key,f,{metadata:{contentType:f.type||"image/jpeg"}});
      imageKeys.push(key);
    }

    const id=crypto.randomUUID();
    await lessons().setJSON(id,{
      title,level,chapter,images:imageKeys,
      createdAt:new Date().toISOString()
    });

    return json({ok:true,id});
  }

  if(path.startsWith("lessons/") && req.method==="DELETE"){
    if(!authorized(req)) return json({error:"غير مصرح"},401);
    const id=path.split("/")[1];
    const item=await lessons().get(id,{type:"json"});
    if(!item) return json({error:"غير موجود"},404);

    for(const key of item.images||[]) await images().delete(key);
    await lessons().delete(id);

    return json({ok:true});
  }

  if(path.startsWith("image/") && req.method==="GET"){
    const key=decodeURIComponent(path.slice(6));
    const data=await images().get(key,{type:"blob"});
    if(!data) return new Response("Not found",{status:404});

    const meta=await images().getMetadata(key);

    return new Response(data,{
      headers:{
        "content-type":meta?.metadata?.contentType||"image/jpeg",
        "cache-control":"public,max-age=31536000,immutable"
      }
    });
  }

  return json({error:"Not found"},404);
};

export const config = { path: "/api/*" };
