export default async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const body = { context: { client: { clientName:'WEB', clientVersion:'2.20250713.00.00', hl:'en', gl:'IN' } }, query:q };
    const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if (!r.ok) return res.status(r.status).json({error:`Search failed (${r.status})`});
    const data = await r.json(), items=[];
    function walk(x){ if(!x||items.length>=24)return; if(Array.isArray(x)){x.forEach(walk);return;} if(typeof x!=='object')return; const v=x.videoRenderer; if(v?.videoId){const t=v.thumbnail?.thumbnails||[];items.push({id:v.videoId,title:(v.title?.runs||[]).map(a=>a.text).join('')||v.title?.simpleText||'',channel:(v.ownerText?.runs||v.longBylineText?.runs||[]).map(a=>a.text).join(''),duration:v.lengthText?.simpleText||'',views:v.viewCountText?.simpleText||'',published:v.publishedTimeText?.simpleText||'',thumbnail:t.at(-1)?.url||`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`});} Object.entries(x).forEach(([k,v])=>k!=='videoRenderer'&&walk(v));}
    walk(data); const seen=new Set(); const unique=items.filter(x=>!seen.has(x.id)&&seen.add(x.id));
    res.setHeader('Cache-Control','s-maxage=30, stale-while-revalidate=120'); return res.status(200).json({items:unique});
  } catch(e){ return res.status(500).json({error:'Search service unavailable'}); }
}
