const SUPABASE_URL = 'https://zwxnmnfoknfbzvptnpmv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_A6u5kWAdL60bYpz1wRyv6w_J2p896iY';
const BASE_URL = 'https://nutrition-3.vercel.app';

module.exports = async function handler(req, res) {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const articlesUrl = new URL(SUPABASE_URL + '/rest/v1/articles');
    articlesUrl.searchParams.set('select', 'id,updated_at');
    articlesUrl.searchParams.set('visibility', 'eq.public');
    articlesUrl.searchParams.set('order', 'updated_at.desc');

    const jobsUrl = new URL(SUPABASE_URL + '/rest/v1/job_posts');
    jobsUrl.searchParams.set('select', 'id,updated_at,published_at');
    jobsUrl.searchParams.set('status', 'eq.published');
    jobsUrl.searchParams.set('published_at', 'lte.' + now.toISOString());
    jobsUrl.searchParams.set('or', '(expires_at.is.null,expires_at.gte.' + today + ')');
    jobsUrl.searchParams.set('order', 'published_at.desc');

    const headers = { apikey: SUPABASE_KEY, Accept: 'application/json' };
    const [articlesResponse, jobsResponse] = await Promise.all([
      fetch(articlesUrl.toString(), { headers }),
      fetch(jobsUrl.toString(), { headers })
    ]);
    if (!articlesResponse.ok) throw new Error('Article sitemap query failed: ' + articlesResponse.status);
    if (!jobsResponse.ok) throw new Error('Job sitemap query failed: ' + jobsResponse.status);
    const [articles, jobs] = await Promise.all([articlesResponse.json(), jobsResponse.json()]);

    const urls = [
      BASE_URL + '/',
      BASE_URL + '/about.html',
      BASE_URL + '/article.html',
      BASE_URL + '/jobs.html',
      ...articles.map((article) => BASE_URL + '/article.html?id=' + encodeURIComponent(article.id)),
      ...jobs.map((job) => BASE_URL + '/jobs/' + encodeURIComponent(job.id))
    ];
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls.map((url) => '<url><loc>' + url.replace(/&/g, '&amp;') + '</loc></url>').join('') +
      '</urlset>';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).send(xml);
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to generate sitemap');
  }
};
