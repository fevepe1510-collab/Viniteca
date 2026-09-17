const BASE='https://viniteca.com.pe/api';
function authHeaders(){const key=process.env.gpt_key||process.env.GPT_KEY;if(!key)throw new Error('Missing PrestaShop API key');return{Authorization:'Basic '+Buffer.from(key+':').toString('base64'),Accept:'application/json'}}
function text(v){if(v==null)return'';if(typeof v==='string'||typeof v==='number')return String(v);if(Array.isArray(v)){const es=v.find(x=>String(x.id)==='1')||v[0];return text(es&&('value'in es?es.value:es))}if(typeof v==='object'){if('value'in v)return text(v.value);if('#text'in v)return text(v['#text'])}return''}
function idValue(v){if(v==null)return'';if(typeof v==='string'||typeof v==='number')return String(v);if(typeof v==='object')return String(v.id||v.value||'');return''}
function stripHtml(s=''){return String(s).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').trim()}
async function ps(path,params={}){const u=new URL(BASE+path);Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v))});const r=await fetch(u,{headers:authHeaders()});if(!r.ok)throw new Error('PrestaShop '+r.status);return r.json()}
module.exports=async function handler(req,res){
  try{
    const id=String(req.query.id||'').replace(/[^0-9]/g,'');
    if(!id)return res.status(400).json({ok:false,error:'Producto no especificado.'});
    const data=await ps('/products/'+id,{output_format:'JSON',display:'full','price[final_price][use_tax]':1,'price[final_price][use_reduction]':1,'price[final_price][decimals]':2});
    const p=data.product;if(!p)throw new Error('Missing product');
    const name=text(p.name);const slug=text(p.link_rewrite)||name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    const imageId=idValue(p.id_default_image);const categoryId=idValue(p.id_category_default);let category='';
    try{const c=await ps('/categories/'+categoryId,{output_format:'JSON',display:'[id,name]'});category=text(c.category&&c.category.name)}catch(e){}
    const price=Number(p.final_price||p.price||0);
    const features=[];
    const assoc=p.associations||{};
    if(Array.isArray(assoc.product_features)&&assoc.product_features.length){
      for(const f of assoc.product_features.slice(0,20)){
        try{const fd=await ps('/product_feature_values/'+idValue(f.id_feature_value),{output_format:'JSON',display:'full'});const fv=fd.product_feature_value;if(fv)features.push({id:idValue(f.id),value:text(fv.value)})}catch(e){}
      }
    }
    const product={id,name,slug,reference:text(p.reference),category,categoryId,price:Number.isFinite(price)?Number(price.toFixed(2)):0,descriptionShort:stripHtml(text(p.description_short)),description:stripHtml(text(p.description)),image:imageId?`https://viniteca.com.pe/${imageId}-large_default/${slug}.jpg`:'',availableForOrder:String(p.available_for_order)==='1',showPrice:String(p.show_price)!=='0',features};
    res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=86400');res.status(200).json({ok:true,product});
  }catch(err){res.status(500).json({ok:false,error:'No fue posible leer este producto desde PrestaShop.'})}
};
