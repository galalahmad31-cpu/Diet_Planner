(() => {
'use strict';
const client=window.DietPlannerAccess?.supabaseClient;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cleanArticle(html){
 const doc=new DOMParser().parseFromString(String(html||''),'text/html');
 const allowed=new Set(['A','B','BLOCKQUOTE','BR','DIV','EM','H1','H2','H3','H4','H5','H6','I','LI','OL','P','SPAN','STRONG','SUB','SUP','TABLE','TBODY','TD','TFOOT','TH','THEAD','TR','U','UL']);
 const drop=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','OPTION','SVG','MATH','TEMPLATE','LINK','META','BASE','VIDEO','AUDIO','SOURCE','IMG','NOSCRIPT']);
 const walk=parent=>Array.from(parent.childNodes).forEach(node=>{
  if(node.nodeType===8){node.remove();return}
  if(node.nodeType!==1){if(node.nodeType!==3)node.remove();return}
  if(drop.has(node.tagName)){node.remove();return}
  if(!allowed.has(node.tagName)){while(node.firstChild)parent.insertBefore(node.firstChild,node);node.remove();return}
  Array.from(node.attributes).forEach(attr=>{
   const n=attr.name.toLowerCase(),v=attr.value.trim();
   if(n==='dir'&&/^(ltr|rtl|auto)$/i.test(v))return;
   if(n==='style'){const safe=v.split(';').filter(x=>/^(color|background-color|font-size|text-align|direction|font-weight|font-style|text-decoration):\s*(#[\da-f]{3,8}|[a-z]+|[\w.%(), -]+)$/i.test(x.trim())).join(';');if(safe)node.setAttribute('style',safe);else node.removeAttribute('style');return}
   if(node.tagName==='A'&&n==='href'&&/^(https?:|mailto:|#|\/(?!\/))/i.test(v))return;
   if((node.tagName==='TD'||node.tagName==='TH')&&(n==='colspan'||n==='rowspan')&&/^[1-9]\d{0,2}$/.test(v))return;
   node.removeAttribute(attr.name);
  });
  if(node.tagName==='A'&&node.hasAttribute('href')){node.target='_blank';node.rel='noopener noreferrer'}
  walk(node);
 });
 walk(doc.body);return doc.body.innerHTML;
}
function setMeta(name,content,property=false){let el=document.head.querySelector(property?'meta[property="'+name+'"]':'meta[name="'+name+'"]');if(!el){el=document.createElement('meta');el.setAttribute(property?'property':'name',name);document.head.appendChild(el)}el.content=content}
function setCanonical(url){let el=document.head.querySelector('link[rel="canonical"]');if(!el){el=document.createElement('link');el.rel='canonical';document.head.appendChild(el)}el.href=url}
function setArticleSchema(a,url){
 const old=document.getElementById('articleJsonLd');if(old)old.remove();
 const script=document.createElement('script');script.id='articleJsonLd';script.type='application/ld+json';
 script.textContent=JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:a.title,author:{'@type':'Person',name:a.author_name},datePublished:a.published_at||a.created_at,dateModified:a.updated_at||a.published_at,mainEntityOfPage:url,publisher:{'@type':'Organization',name:'Diet Planner'},articleBody:$('articleBody').textContent.slice(0,5000)});
 document.head.appendChild(script);
}
(async()=>{
 const accessStatus=await window.DietPlannerAccess?.getAccessStatus?.();
 const isAuthenticated=accessStatus?.authenticated===true && !!accessStatus?.user;
 if(isAuthenticated){
  $('guestStartLink')?.remove();
  $('articleGuestCta')?.remove();
 }
 const id=new URLSearchParams(location.search).get('id');
 if(!client||!id||!/^[0-9a-f-]{36}$/i.test(id)){ $('articleLoading').hidden=true;$('articleError').hidden=false;setMeta('robots','noindex,follow');return}
 try{
  const {data,error}=await client.from('articles').select('id,title,author_name,content,published_at,created_at,updated_at,visibility').eq('id',id).eq('visibility','public').maybeSingle();
  if(error)throw error;if(!data)throw new Error('not found');
  const url=location.origin+'/article-view.html?id='+encodeURIComponent(id);
  $('articleTitle').textContent=data.title;$('articleAuthor').textContent='بقلم: '+data.author_name;
  const date=data.published_at||data.created_at;$('articleDate').dateTime=date;$('articleDate').textContent='تاريخ النشر: '+new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(new Date(date));
  $('articleBody').innerHTML=cleanArticle(data.content);$('articleLoading').hidden=true;$('articleContent').hidden=false;
  document.title=data.title+' | مقالات التغذية العلاجية - Diet Planner';
  const description=$('articleBody').textContent.trim().replace(/\s+/g,' ').slice(0,155)||data.title;
  setMeta('description',description);setMeta('og:title',document.title,true);setMeta('og:description',description,true);setMeta('og:url',url,true);setCanonical(url);
  setArticleSchema(data,url);
 }catch(e){console.error('Article load failed:',e);$('articleLoading').hidden=true;$('articleError').hidden=false;setMeta('robots','noindex,follow')}
})();
})();