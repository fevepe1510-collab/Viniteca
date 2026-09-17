const BASE='https://viniteca.com.pe/api';

function authHeaders(){
  const key=process.env.gpt_key||process.env.GPT_KEY;
  if(!key) throw new Error('Missing PrestaShop API key');
  return {Authorization:'Basic '+Buffer.from(key+':').toString('base64'),Accept:'application/json'};
}
function text(v){
  if(v==null) return '';
  if(typeof v==='string'||typeof v==='number') return String(v);
  if(Array.isArray(v)){
    const es=v.find(x=>String(x.id)==='1')||v[0];
    return text(es&&('value' in es?es.value:es));
  }
  if(typeof v==='object'){
    if('value' in v) return text(v.value);
    if('#text' in v) return text(v['#text']);
    if('id' in v && Object.keys(v).length===1) return String(v.id);
  }
  return '';
}
function idValue(v){
  if(v==null) return '';
  if(typeof v==='string'||typeof v==='number') return String(v);
  if(typeof v==='object') return String(v.id||v.value||'');
  return '';
}
function stripHtml(s=''){
  return String(s).replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/\s+/g,' ').trim();
}
async function ps(path,params={}){
  const u=new URL(BASE+path);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));});
  const r=await fetch(u,{headers:authHeaders()});
  if(!r.ok){const body=await r.text();throw new Error('PrestaShop '+r.status+': '+body.slice(0,180));}
  return r.json();
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}
async function productDetail(raw,categoryMap){
  const id=idValue(raw.id);
  let p=raw;
  try{
    const data=await ps('/products/'+id,{
      output_format:'JSON',
      display:'full',
      'price[final_price][use_tax]':1,
      'price[final_price][use_reduction]':1,
      'price[final_price][decimals]':2
    });
    p=data.product||raw;
  }catch(e){}
  const name=text(p.name)||text(raw.name)||('Producto '+id);
  const slug=text(p.link_rewrite)||text(raw.link_rewrite)||name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  const imageId=idValue(p.id_default_image)||idValue(raw.id_default_image);
  const categoryId=idValue(p.id_category_default)||idValue(raw.id_category_default);
  const priceNumber=Number(p.final_price||p.price||0);
  return {
    id,
    name,
    reference:text(p.reference)||text(raw.reference),
    slug,
    categoryId,
    category:categoryMap[categoryId]||'',
    price:Number.isFinite(priceNumber)?Number(priceNumber.toFixed(2)):0,
    description:stripHtml(text(p.description_short)||text(raw.description_short)),
    image:imageId?`https://viniteca.com.pe/${imageId}-large_default/${slug}.jpg`:'',
    href:`producto.html?id=${encodeURIComponent(id)}`
  };
}

module.exports=async function handler(req,res){
  try{
    const page=Math.max(1,parseInt(req.query.page||'1',10)||1);
    const limit=Math.min(32,Math.max(8,parseInt(req.query.limit||'24',10)||24));
    const q=String(req.query.q||'').trim().slice(0,80);
    const category=String(req.query.category||'').trim();
    const offset=(page-1)*limit;

    const categoryData=await ps('/categories',{output_format:'JSON',display:'[id,name,id_parent,active]','filter[active]':1,limit:500});
    const categories=(categoryData.categories||[]).map(c=>({id:idValue(c.id),name:text(c.name),parent:idValue(c.id_parent)})).filter(c=>Number(c.id)>2&&c.name);
    const categoryMap=Object.fromEntries(categories.map(c=>[c.id,c.name]));

    const params={
      output_format:'JSON',
      display:'[id,id_category_default,id_default_image,reference,name,link_rewrite,description_short,active]',
      'filter[active]':1,
      limit:`${offset},${limit+1}`,
      sort:'[id_DESC]'
    };
    if(q) params['filter[name]']=`%${q}%`;
    if(category) params['filter[id_category_default]']=category;
    const list=await ps('/products',params);
    const rows=Array.isArray(list.products)?list.products:[];
    const hasMore=rows.length>limit;
    const pageRows=rows.slice(0,limit);
    const products=await mapLimit(pageRows,6,p=>productDetail(p,categoryMap));

    let total=null;
    if(!q&&!category&&page===1){
      try{
        const ids=await ps('/products',{output_format:'JSON',display:'[id]','filter[active]':1,limit:1000});
        total=Array.isArray(ids.products)?ids.products.length:null;
      }catch(e){}
    }

    res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=86400');
    res.status(200).json({ok:true,page,limit,hasMore,total,categories,products});
  }catch(err){
    res.status(500).json({ok:false,error:'No fue posible leer el catálogo de PrestaShop.',detail:process.env.NODE_ENV==='development'?String(err.message||err):undefined});
  }
};
