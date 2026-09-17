const BASE='https://viniteca.com.pe/api';

const COMMERCIAL_ROOTS=[
  {id:'10',key:'vinos',label:'Vinos y espumosos'},
  {id:'182',key:'licores',label:'Licores'},
  {id:'203',key:'gourmet',label:'Gourmet'},
  {id:'234',key:'accesorios',label:'Accesorios'},
  {id:'230',key:'regalos',label:'Regalos'},
  {id:'226',key:'ofertas',label:'Ofertas'}
];

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
  return String(s)
    .replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#039;/g,"'")
    .replace(/\s+/g,' ')
    .trim();
}
async function ps(path,params={}){
  const u=new URL(BASE+path);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));});
  const r=await fetch(u,{headers:authHeaders()});
  if(!r.ok){const body=await r.text();throw new Error('PrestaShop '+r.status+': '+body.slice(0,180));}
  return r.json();
}
function categoryIdsFromProduct(p){
  const raw=p&&p.associations&&p.associations.categories;
  if(!raw) return [idValue(p&&p.id_category_default)].filter(Boolean);
  const arr=Array.isArray(raw)?raw:(Array.isArray(raw.category)?raw.category:[raw]);
  const ids=arr.map(x=>idValue(x)).filter(Boolean);
  const def=idValue(p&&p.id_category_default);
  if(def&&!ids.includes(def)) ids.push(def);
  return [...new Set(ids)];
}
function slugify(s=''){
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
function norm(s=''){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'y').replace(/[^a-z0-9]+/g,' ').trim();
}

module.exports=async function handler(req,res){
  try{
    const categoryData=await ps('/categories',{
      output_format:'JSON',
      display:'[id,name,id_parent,active]',
      'filter[active]':1,
      limit:1000
    });
    const categories=(categoryData.categories||[])
      .map(c=>({id:idValue(c.id),name:text(c.name),parent:idValue(c.id_parent)}))
      .filter(c=>c.id&&c.name);
    const categoryMap=Object.fromEntries(categories.map(c=>[c.id,c]));

    function ancestors(id){
      const out=[];let cur=String(id||'');let guard=0;
      while(cur&&categoryMap[cur]&&guard++<20){
        if(!out.includes(cur)) out.push(cur);
        const parent=String(categoryMap[cur].parent||'');
        if(!parent||parent===cur) break;
        cur=parent;
      }
      return out;
    }

    const productData=await ps('/products',{
      output_format:'JSON',
      display:'full',
      'filter[active]':1,
      limit:1000,
      sort:'[id_DESC]',
      'price[final_price][use_tax]':1,
      'price[final_price][use_reduction]':1,
      'price[final_price][decimals]':2
    });

    const rows=Array.isArray(productData.products)?productData.products:[];
    const unique=new Map();

    for(const p of rows){
      const id=idValue(p.id);
      if(!id||unique.has(id)) continue;
      const visibility=text(p.visibility).toLowerCase();
      if(visibility==='none') continue;

      const directCategoryIds=categoryIdsFromProduct(p);
      const trailIds=[...new Set(directCategoryIds.flatMap(ancestors))];
      const roots=COMMERCIAL_ROOTS.filter(root=>trailIds.includes(root.id));
      if(!roots.length) continue;

      const name=text(p.name)||('Producto '+id);
      const slug=text(p.link_rewrite)||slugify(name);
      const imageId=idValue(p.id_default_image);
      const priceRaw=p.final_price??p.price??0;
      const price=Number(priceRaw);
      const primaryRoot=roots.find(r=>r.key!=='ofertas')||roots[0];
      const directCategoryNames=directCategoryIds.map(cid=>categoryMap[cid]&&categoryMap[cid].name).filter(Boolean);

      unique.set(id,{
        id,
        name,
        reference:text(p.reference),
        slug,
        price:Number.isFinite(price)?Number(price.toFixed(2)):0,
        description:stripHtml(text(p.description_short)),
        image:imageId?`https://viniteca.com.pe/${imageId}-large_default/${slug}.jpg`:'',
        href:`producto.html?id=${encodeURIComponent(id)}`,
        category:primaryRoot.label,
        root:primaryRoot.key,
        roots:roots.map(r=>r.key),
        isOffer:roots.some(r=>r.key==='ofertas'),
        categoryIds:directCategoryIds,
        categoryTrailIds:trailIds,
        categories:directCategoryNames
      });
    }

    const products=[...unique.values()];
    const counts=Object.fromEntries(COMMERCIAL_ROOTS.map(root=>[
      root.key,
      products.filter(p=>p.roots.includes(root.key)).length
    ]));

    const requestedCategory=String(req.query.category||'').trim();
    const requestedQ=norm(req.query.q||'');
    const filtered=products.filter(p=>{
      if(requestedCategory && !p.categoryTrailIds.map(String).includes(requestedCategory)) return false;
      if(requestedQ){
        const haystack=norm([p.name,p.reference,p.description,p.category,...p.categories].filter(Boolean).join(' '));
        if(!haystack.includes(requestedQ)) return false;
      }
      return true;
    });

    res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=86400');
    res.status(200).json({
      ok:true,
      total:filtered.length,
      catalogTotal:products.length,
      hasMore:false,
      page:1,
      limit:filtered.length,
      products:filtered,
      categories,
      counts,
      note:'Todos los productos activos y visibles asociados a las categorías comerciales principales se devuelven en una sola respuesta. Los duplicados entre categorías se eliminan por ID.'
    });
  }catch(err){
    res.status(500).json({
      ok:false,
      error:'No fue posible leer el catálogo completo de PrestaShop.',
      detail:process.env.NODE_ENV==='development'?String(err.message||err):undefined
    });
  }
};
