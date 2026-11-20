const SUPABASE_URL = 'https://zwxnmnfoknfbzvptnpmv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_A6u5kWAdL60bYpz1wRyv6w_J2p896iY';
const BASE_URL = 'https://nutrition-3.vercel.app';

const SPECIALTIES = {
  medicine: 'الطب', pharmacy: 'الصيدلة', nursing: 'التمريض',
  clinical_nutrition: 'التغذية العلاجية', laboratory: 'المعامل والتحاليل',
  radiology: 'الأشعة', dentistry: 'طب الأسنان',
  physiotherapy: 'العلاج الطبيعي', healthcare_management: 'الإدارة الصحية',
  other: 'تخصصات صحية أخرى'
};
const EMPLOYMENT = {
  full_time: 'دوام كامل', part_time: 'دوام جزئي', contract: 'تعاقد',
  temporary: 'مؤقت', internship: 'تدريب', freelance: 'عمل حر'
};
const SCHEMA_EMPLOYMENT = {
  full_time: 'FULL_TIME', part_time: 'PART_TIME', contract: 'CONTRACTOR',
  temporary: 'TEMPORARY', internship: 'INTERN', freelance: 'CONTRACTOR'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
function plainText(value) {
  return String(value ?? '').replace(/\r/g, '').trim();
}
function paragraphs(value) {
  return escapeHtml(plainText(value)).split(/\n{2,}/).map((part) =>
    '<p>' + part.replace(/\n/g, '<br>') + '</p>'
  ).join('');
}
function notFound(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(404).send('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>الوظيفة غير متاحة</title><h1>الوظيفة غير متاحة</h1><p><a href="/jobs.html">العودة إلى الوظائف</a></p></html>');
}
module.exports = async function handler(req, res) {
  const id = String(req.query?.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return notFound(res);
  }
  try {
    const endpoint = new URL(SUPABASE_URL + '/rest/v1/job_posts');
    endpoint.searchParams.set('select', '*');
    endpoint.searchParams.set('id', 'eq.' + id);
    endpoint.searchParams.set('status', 'eq.published');
    endpoint.searchParams.set('published_at', 'lte.' + new Date().toISOString());
    endpoint.searchParams.set('or', '(expires_at.is.null,expires_at.gte.' + new Date().toISOString().slice(0, 10) + ')');
    endpoint.searchParams.set('limit', '1');
    const response = await fetch(endpoint.toString(), { headers: { apikey: SUPABASE_KEY, Accept: 'application/json' } });
    if (!response.ok) throw new Error('Job lookup failed: ' + response.status);
    const rows = await response.json();
    const job = rows[0];
    if (!job) return notFound(res);

    const title = plainText(job.title);
    const company = plainText(job.organization_name);
    const description = plainText(job.description);
    const requirements = plainText(job.requirements);
    const city = plainText(job.location_city);
    const locationLabel = [city, job.workplace_type === 'remote' ? 'عن بُعد' : ''].filter(Boolean).join(' · ');
    const canonical = BASE_URL + '/jobs/' + encodeURIComponent(job.id);
    const metaDescription = (description || title).replace(/\s+/g, ' ').slice(0, 155);
    const published = job.published_at || job.created_at;
    const salary = job.salary_min != null || job.salary_max != null ? {
      '@type': 'MonetaryAmount',
      currency: job.salary_currency || 'EGP',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salary_min != null ? { minValue: Number(job.salary_min) } : {}),
        ...(job.salary_max != null ? { maxValue: Number(job.salary_max) } : {}),
        ...(job.salary_period ? { unitText: job.salary_period.toUpperCase() } : {})
      }
    } : undefined;
    const structured = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title,
      description: description + (requirements ? '\n\nالمتطلبات:\n' + requirements : ''),
      datePosted: published,
      ...(job.expires_at ? { validThrough: job.expires_at } : {}),
      employmentType: SCHEMA_EMPLOYMENT[job.employment_type] || 'OTHER',
      hiringOrganization: { '@type': 'Organization', name: company },
      ...(job.workplace_type === 'remote' ? {
        jobLocationType: 'TELECOMMUTE',
        applicantLocationRequirements: { '@type': 'Country', name: job.country_code === 'EG' ? 'Egypt' : job.country_code }
      } : city ? {
        jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: job.country_code || 'EG' } }
      } : {}),
      ...(salary ? { baseSalary: salary } : {}),
      directApply: Boolean(job.application_url)
    };
    const applicationUrl = /^https?:\/\//i.test(job.application_url || '') ? job.application_url : '';
    const contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.contact_email || '') ? job.contact_email : '';
    const contactPhone = String(job.contact_phone || '').replace(/[^+\d]/g, '');
    const applyLink = applicationUrl
      ? '<a class="job-apply" href="' + escapeHtml(applicationUrl) + '" target="_blank" rel="noopener noreferrer">التقديم على الوظيفة <span aria-hidden="true">←</span></a>'
      : contactEmail
        ? '<a class="job-apply" href="mailto:' + escapeHtml(contactEmail) + '">إرسال السيرة الذاتية بالبريد</a>'
        : contactPhone
          ? '<a class="job-apply" href="tel:' + escapeHtml(contactPhone) + '">التواصل للتقديم</a>'
          : '<p class="job-contact-note">يرجى مراجعة تفاصيل الإعلان للتواصل مع جهة العمل.</p>';
    const jsonLd = JSON.stringify(structured).replace(/</g, '\\u003c');

    const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | وظائف طبية وصحية - Diet Planner</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Diet Planner">
<meta property="og:title" content="${escapeHtml(title)} | Diet Planner"><meta property="og:description" content="${escapeHtml(metaDescription)}"><meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${jsonLd}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/css/design-tokens.css"><link rel="stylesheet" href="/css/light-theme.css"><link rel="stylesheet" href="/css/dark-theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/app-header.css"><link rel="stylesheet" href="/css/jobs.css">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><script src="/js/auth-access.js" defer></script><script src="/js/theme.js" defer></script><script src="/js/app-header.js" defer></script>
</head>
<body><main class="jobs-page">
<div data-dp-app-header data-page-title="تفاصيل الوظيفة"></div>
<nav class="job-detail-back"><a href="/jobs.html"><i class="fa-solid fa-arrow-right"></i> جميع الوظائف</a></nav>
<article class="job-detail-card">
<div class="job-detail-kicker"><i class="fa-solid fa-briefcase"></i> فرصة عمل في القطاع الصحي</div>
<h1>${escapeHtml(title)}</h1>
<div class="job-detail-company">${escapeHtml(company)}</div>
<div class="job-detail-meta">
<span><i class="fa-solid fa-stethoscope"></i>${escapeHtml(SPECIALTIES[job.specialty] || 'تخصص صحي')}</span>
<span><i class="fa-solid fa-location-dot"></i>${escapeHtml(locationLabel || 'الموقع يحدد عند التواصل')}</span>
<span><i class="fa-regular fa-clock"></i>${escapeHtml(EMPLOYMENT[job.employment_type] || '')}</span>
<span><i class="fa-solid fa-building"></i>${escapeHtml(({on_site:'من مقر العمل',hybrid:'هجين',remote:'عن بُعد'})[job.workplace_type] || '')}</span>
</div>
${job.salary_min != null || job.salary_max != null ? '<div class="job-detail-salary">الراتب: ' + escapeHtml([job.salary_min,job.salary_max].filter(v=>v!=null).map(v=>Number(v).toLocaleString('ar-EG')).join(' – ')) + ' ' + escapeHtml(job.salary_currency || 'EGP') + (job.salary_period ? ' / ' + escapeHtml(job.salary_period) : '') + '</div>' : ''}
<section class="job-detail-section"><h2>وصف الوظيفة</h2><div class="job-detail-copy">${paragraphs(description)}</div></section>
${requirements ? '<section class="job-detail-section"><h2>المتطلبات</h2><div class="job-detail-copy">' + paragraphs(requirements) + '</div></section>' : ''}
<div class="job-detail-apply">${applyLink}</div>
<div class="job-detail-date">تاريخ النشر: ${escapeHtml(new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(new Date(published)))}
${job.expires_at ? ' · آخر موعد للتقديم: ' + escapeHtml(new Intl.DateTimeFormat('ar-EG',{dateStyle:'long'}).format(new Date(job.expires_at + 'T00:00:00'))) : ''}</div>
</article>
<footer class="jobs-footer">Diet Planner <span>•</span> فرص العمل في القطاع الطبي والصحي</footer>
</main></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).send(html);
  } catch (error) {
    console.error('Job detail render failed:', error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).send('Unable to load this job posting');
  }
};
