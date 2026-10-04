/* CLI reset (destructive — DROP + fresh seed):
     npm run seed        → demo:      essential + poora dummy data (dev/UAT)
     npm run seed:prod   → essential: sirf admin + taxonomy + settings + WP 301s
   Normal flow me iski LOD NAHI — `npm run dev` te server pehli vaar khud
   DB + tables + data bana dinda hai (database/bootstrap.js). Eh sirf
   "sab uda ke fresh start" waste hai. */

require('dotenv').config();

/* Production guard — eh script DATABASE DROP karda hai */
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
      console.log('Logins (password sab da: Chaupal@123):');
      console.log('  admin@chaupal.com      → Admin');
      console.log('  desk@chaupal.com       → Publisher (Author)');
      console.log('  seo@chaupal.com        → SEO Manager');
      console.log('  marketing@chaupal.com  → Marketing Agent');
    } else {
      console.log(`Admin login: ${process.env.ADMIN_EMAIL || 'admin@chaupal.com'} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD env wala)' : 'Chaupal@123 — PROD te .env vich ADMIN_PASSWORD zaroor set karo!'}`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error('Seed fail:', e.message);
    process.exit(1);
  });
