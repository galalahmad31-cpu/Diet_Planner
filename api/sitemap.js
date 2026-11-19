const SUPABASE_URL = 'https://zwxnmnfoknfbzvptnpmv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_A6u5kWAdL60bYpz1wRyv6w_J2p896iY';
module.exports = async function handler(req, res) {
  try {
    const response = await fetch(SUPABASE_URL + '/rest/v1/articles?select=id,updated_at&visibility=eq.public&order=updated_at.desc', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
    });
    if (!response.ok) throw new Error('Article sitemap query failed: ' + response.status);
    const articles = await response.json();
    const base = 'https://nutrition-3.vercel.app';
    const urls = [
      base + '/',
      base + '/about.html',
      base + '/article.html',
      ...articles.map(a => base + '/article-view.html?id=' + encodeURIComponent(a.id))
    ];
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls.map(url => '<url><loc>' + url.replace(/&/g, '&amp;') + '</loc></url>').join('') +
      '</urlset>';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).send(xml);
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to generate sitemap');
  }
};