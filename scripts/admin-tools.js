// Usage (after `cd functions && npm install`):
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json   # Firebase console → Project settings → Service accounts
//   node scripts/admin-tools.js make-admin you@example.com
//   node scripts/admin-tools.js set-config 1600 1 0      # usdNgn swapFeePct giftMarkupPct
// Keep the service-account file OUT of this folder and out of git.
const path = require('path');
const admin = require(require.resolve('firebase-admin', { paths: [path.join(__dirname, '../functions')] }));

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'usdt-invest-2209' });
const [cmd, ...args] = process.argv.slice(2);

(async () => {
  if (cmd === 'make-admin') {
    const user = await admin.auth().getUserByEmail(args[0]);
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log(`${args[0]} is now an admin. They must sign out and back in for it to take effect.`);
  } else if (cmd === 'set-config') {
    const [usdNgn, swapFeePct = 1, giftMarkupPct = 0] = args.map(Number);
    if (!(usdNgn > 0)) throw new Error('usdNgn must be a positive number');
    await admin.firestore().doc('config/app').set({ usdNgn, swapFeePct, giftMarkupPct, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log('Saved config/app', { usdNgn, swapFeePct, giftMarkupPct });
  } else {
    console.log('Commands: make-admin <email> | set-config <usdNgn> [swapFeePct] [giftMarkupPct]');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
