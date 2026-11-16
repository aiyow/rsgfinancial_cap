# Google Search setup for The ResiDens

Public site: https://residens-condo.onrender.com
Canonical search page: https://residens-condo.onrender.com/login

The frontend build now emits `/robots.txt` and `/sitemap.xml`, includes canonical
and social metadata, and provides public introductory HTML before JavaScript
loads. The sitemap contains only `/login`. Private records still require sign-in.

## Deploy the frontend

Deploy the updated frontend code to the Render static site. `VITE_SITE_URL`
defaults to `https://residens-condo.onrender.com`; change it only if the public
frontend domain changes. The Render Blueprint contains the same setting.

After deploying, confirm that these return actual text/XML, rather than the SPA:

- https://residens-condo.onrender.com/robots.txt
- https://residens-condo.onrender.com/sitemap.xml

These files are generated during `npm run build`. To inspect them locally, use
`npm run preview` after building; the development server does not emit them.

The Blueprint also adds `X-Robots-Tag: noindex, nofollow` headers to private and
account-management paths. If the site is managed manually rather than through
the Blueprint, copy those header rules from `render.yaml` into the static site's
Headers settings. Public `/login`, JavaScript, CSS and icons must remain crawlable.
These headers are search controls, not access controls; existing authentication
and role checks continue to protect records.

## Verify ownership and request indexing

1. In Google Search Console, add a **URL-prefix** property for
   `https://residens-condo.onrender.com/`.
2. Select **HTML tag** verification. Google provides a tag such as
   `<meta name="google-site-verification" content="YOUR_CODE" />`.
3. On the **frontend static site**, set the Render environment variable
   `VITE_GOOGLE_SITE_VERIFICATION` to **only the content value** (`YOUR_CODE`).
   Do not use the backend service. Redeploy the frontend, then click **Verify**.
4. In Search Console's Sitemaps section, submit `sitemap.xml`.
5. Inspect `https://residens-condo.onrender.com/login`, use **Test live URL**, and
   choose **Request indexing** when the test succeeds.

Google verification is site/account-specific; the build does not invent a token
or submit requests on your behalf. Indexing and ranking are controlled by Google
and are not immediate or guaranteed. Keep the verification variable after the
site is verified.

Official guidance:

- https://support.google.com/webmasters/answer/9008080
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://render.com/docs/static-site-headers
