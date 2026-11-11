# 1BOX Zakelijke opslag – mockup review

Two design variations of the business page (business.1box.nl) in the style of the new 1box.nl home,
served with a comment layer so reviewers can pin feedback anywhere on the page.

- `/` overview, `/a` variation A, `/b` variation B
- Comments: `GET /api/state`, live stream `GET /api/events`, `POST /api/comment`,
  `POST /api/comment/:id/resolve`, `DELETE /api/comment/:id` (author token only)
- Data: `$DATA_DIR/comments.json` (volume in production)
- The quote form is a mockup and sends nothing.

Run locally: `DATA_DIR=./data node server.js`

Test: `node test/e2e.js https://<site>` (live, cleans up after itself) or `node test/e2e.js http://localhost:4611 --local /tmp/e2e-data` (also tests restart and rate limit). Needs puppeteer from the dashboard repo.
