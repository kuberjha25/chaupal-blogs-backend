/* npm run vapid — naya VAPID key pair (web push). Har environment layi IK VAAR. */
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
WARNING:
  - VAPID_PRIVATE_KEY is a secret. Put it only in the server's .env. Never commit it or paste it in chat.
  - Generate ONCE per environment. Changing the keys later breaks every existing browser subscription
    (readers must subscribe again).
  - VAPID_SUBJECT must be a contact: mailto:you@example.com or an https:// URL.

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:CHANGE_ME@example.com
`);
