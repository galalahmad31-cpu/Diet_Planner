(() => {
'use strict';
const client=window.DietPlannerAccess?.supabaseClient;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setMeta(name,content,property=false){let el=document.head.querySelector(property?'meta[property="'+name+'"]':'meta[name="'+name+'"]');if(!el){el=document.createElement('meta');el.setAttribute(property?'property':'name',name);document.head.appendChild(el)}el.content=content}
function setCanonical(url){let el=document.head.querySelector('link[rel="canonical"]');if(!el){el=document.createElement('link');el.rel='canonical';document.head.appendChild(el)}el.href=url}
function setArticleSchema(a,url){
 const old=document.getElementById('articleJsonLd');if(old)old.remove();
 const script=document.createElement('script');script.id='articleJsonLd';script.type='application/ld+json';
 script.textContent=JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:a.title,author:{'@type':'Person',name:a.author_name},datePublished:a.published_at||a.created_at,dateModified:a.updated_at||a.published_at,mainEntityOfPage:url,publisher:{'@type':'Organization',name:'Diet Planner'},articleBody:$('articleBody').textContent.slice(0,5000)});
 document.head.appendChild(script);
}
(async()=>{
 let isAuthenticated=false;
 try{
  const accessStatus=await window.DietPlannerAccess?.getAccessStatus?.();
  isAuthenticated=accessStatus?.authenticated===true && !!accessStatus?.user;
 }catch(authError){
  console.warn('Could not verify article-page session:',authError);
 }
 if(isAuthenticated){
  $('guestStartLink')?.remove();
  $('articleGuestCta')?.remove();
 }
 const id=new URLSearchParams(location.search).get('id');
 if(id&&/^[0-9a-f-]{36}$/i.test(id)){
  const target=new URL('article.html',location.href);
  target.searchParams.set('id',id);
  location.replace(target.pathname+target.search);
  return;
 }
 if(!client||!id||!/^[0-9a-f-]{36}$/i.test(id)){ $('articleLoading').hidden=true;$('articleError').hidden=false;setMeta('robots','noindex,follow');return}
 try{
  const {data,error}=await client.from('articles').select('id,title,author_name,content,published_at,created_at,updated_at,visibility').eq('id',id).eq('visibility','public').maybeSingle();
  if(error)throw error;if(!data)throw new Error('not found');
  const url=location.origin+'/article-view.html?id='+encodeURIComponent(id);
  $('articleTitle').textContent=data.title;$('articleAuthor').textContent='بقلم: '+data.author_name;
  const date=data.published_at||data.created_at;$('articleDate').dateTime=date;$('articleDate').textContent='تاريخ النشر: '+new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(new Date(date));
  $('articleBody').innerHTML=window.DietPlannerArticleContent.sanitize(data.content);$('articleLoading').hidden=true;$('articleContent').hidden=false;
  document.title=data.title+' | مقالات التغذية العلاجية - Diet Planner';
  const description=$('articleBody').textContent.trim().replace(/\s+/g,' ').slice(0,155)||data.title;
  setMeta('description',description);setMeta('og:title',document.title,true);setMeta('og:description',description,true);setMeta('og:url',url,true);setCanonical(url);
  setArticleSchema(data,url);
 }catch(e){console.error('Article load failed:',e);$('articleLoading').hidden=true;$('articleError').hidden=false;setMeta('robots','noindex,follow')}
})();
})();