/* CLI reset (destructive — DROP + fresh seed):
     npm run seed        → demo:      essential + full dummy data (dev/UAT)
     npm run seed:prod   → essential: only admin + taxonomy + settings + WP 301s
   NOT NEEDED in the normal flow — on the first `npm run dev` the server creates
   the DB + tables + data by itself (database/bootstrap.js). This is only for
   "wipe everything and start fresh". */

require('dotenv').config();

/* Production guard — this script DROPs the DATABASE */
if (process.env.NODE_ENV === 'production' && process.env.I_UNDERSTAND_THIS_DROPS_THE_DATABASE !== 'yes') {
  console.error(
    '\nRefusing to run: NODE_ENV=production and this script DROPs the database.\n' +
      'If you really mean it, set I_UNDERSTAND_THIS_DROPS_THE_DATABASE=yes and run again.\n'
  );
  process.exit(1);
}

const { resetDatabase } = require('./bootstrap');

const mode = process.argv.includes('--prod') ? 'essential' : 'demo';

resetDatabase(mode)
  .then(() => {
    console.log('');
    if (mode === 'demo') {
      console.log('Demo logins (password: the demo default in database/data.js):');
      console.log('  admin@chaupal.com      → Admin');
      console.log('  desk@chaupal.com       → Publisher (Author)');
      console.log('  seo@chaupal.com        → SEO Manager');
      console.log('  marketing@chaupal.com  → Marketing Agent');
    } else {
      console.log(`Admin login: ${process.env.ADMIN_EMAIL || 'admin@chaupal.com'} / ${process.env.ADMIN_PASSWORD ? '(the ADMIN_PASSWORD from env)' : '(demo default — in PROD you must set ADMIN_PASSWORD in .env!)'}`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exit(1);
  });
