/* npm run mailtest -- you@example.com
   Configured EMAIL_MODE (smtp / ses) naal ik test email bhejda hai. "log" mode vich mana.
   Kade koi secret print nahi karda — sirf mode, variable NAMES, te error code. */
require('dotenv').config();
const mailer = require('../src/mailer');
const { EMAIL_RE } = require('../src/utils');

const to = String(process.argv[2] || '').trim();
const fail = (msg) => {
  console.error(`FAILED: ${msg}`);
  mailer.closeMail();
  process.exit(1);
};

if (!EMAIL_RE.test(to)) fail('usage: npm run mailtest -- you@example.com');

const st = mailer.status();
if (st.mode === 'log') fail('EMAIL_MODE is "log" (or unset) — nothing would be sent. Set EMAIL_MODE=smtp or ses.');
if (!st.configured) fail(`email is not configured (EMAIL_MODE=${st.mode || 'unset'}): ${st.reason}`);

console.log(`Sending a test email (EMAIL_MODE=${st.mode})...`);
const started = Date.now();
mailer
  .sendMail({
    to,
    subject: 'Chaupal Te Charcha test email',
    text: 'This is a test email from the Chaupal Te Charcha API. If you got it, email sending works.',
    html:
      '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#222">' +
      '<p>This is a test email from the Chaupal Te Charcha API.</p>' +
      '<p>If you got it, email sending works.</p></div>',
  })
  .then(() => {
    console.log(`OK (accepted in ${Date.now() - started} ms)`);
    mailer.closeMail();
    process.exit(0);
  })
  .catch((e) => fail(mailer.safeDetail(e)));
