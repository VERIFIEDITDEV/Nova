const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { DENOMS, GIFT_CARDS, PRODUCTS, GIFT_BY_ID, PRODUCT_BY_ID } = require('./catalog');

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ---- Secrets / params (set with `firebase functions:secrets:set NAME`) ----
const PAYSTACK_SECRET = defineSecret('PAYSTACK_SECRET');
const FLW_SECRET = defineSecret('FLW_SECRET');
const FLW_WEBHOOK_HASH = defineSecret('FLW_WEBHOOK_HASH'); // the "secret hash" you set in the Flutterwave dashboard
const DEPOSIT_ADDRESS = defineString('DEPOSIT_ADDRESS');   // your company EVM wallet that receives on-chain deposits

const REGION = 'us-central1';
const opts = (extra = {}) => ({ region: REGION, ...extra });

// ---------------------------------------------------------------- helpers
// NOTE: plain `throw new Error()` in a callable reaches the browser as "internal".
// HttpsError is what makes the message visible to the user.
const fail = (code, message) => { throw new HttpsError(code, message); };
const round = (n, d) => Number(Number(n).toFixed(d));
const ngn = n => '₦' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 });

function needAuth(req) {
  if (!req.auth) fail('unauthenticated', 'Please log in');
  return req.auth.uid;
}
function needAdmin(req) {
  if (!req.auth || req.auth.token.admin !== true) fail('permission-denied', 'Admin access required');
  return req.auth.uid;
}
function positive(n, max = 1e12) {
  n = Number(n);
  if (!Number.isFinite(n) || n <= 0 || n > max) fail('invalid-argument', 'Invalid amount');
  return n;
}

async function getConfig() {
  const s = await db.doc('config/app').get();
  const c = s.data();
  if (!c || !(Number(c.usdNgn) > 0)) fail('failed-precondition', 'Platform rates are not configured yet');
  return {
    usdNgn: Number(c.usdNgn),
    swapFeePct: Number(c.swapFeePct ?? 1),
    giftMarkupPct: Number(c.giftMarkupPct ?? 0)
  };
}

// Public market data mirror; api.binance.com itself answers HTTP 451 to US-hosted servers.
const BINANCE = 'https://data-api.binance.vision/api/v3';
const SYMBOLS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', BNB: 'BNBUSDT' };
const ASSETS = ['NGN', 'USDT', 'BTC', 'ETH', 'BNB'];

async function usdPrice(asset, cfg) {
  if (asset === 'USDT') return 1;
  if (asset === 'NGN') return 1 / cfg.usdNgn;
  const symbol = SYMBOLS[asset];
  if (!symbol) fail('invalid-argument', 'Unsupported asset');
  let p = 0;
  try {
    const res = await fetch(`${BINANCE}/ticker/price?symbol=${symbol}`);
    p = Number((await res.json()).price);
  } catch (e) { /* handled below */ }
  if (!(p > 0)) fail('unavailable', 'Price feed unavailable, please try again');
  return p;
}

const balanceOf = (d, a) => (a === 'NGN' ? Number(d.balanceNGN || 0) : Number((d.assets || {})[a] || 0));
function deltaUpdate(d, deltas) {
  const u = {};
  for (const [a, v] of Object.entries(deltas)) {
    const next = balanceOf(d, a) + v;
    if (next < -1e-9) fail('failed-precondition', `Insufficient ${a} balance`);
    if (a === 'NGN') u.balanceNGN = round(Math.max(next, 0), 2);
    else u[`assets.${a}`] = round(Math.max(next, 0), 8);
  }
  return u;
}

async function loadUser(t, uid) {
  const ref = db.doc('users/' + uid);
  const s = await t.get(ref);
  if (!s.exists) fail('not-found', 'Profile not found');
  const d = s.data();
  if (d.status === 'banned') fail('permission-denied', 'Account is banned');
  return { ref, d };
}

function addLedger(t, uid, fields, id) {
  const ref = id ? db.doc('transactions/' + id) : db.collection('transactions').doc();
  t.set(ref, { uid, ...fields, createdAt: FieldValue.serverTimestamp() });
  return ref;
}

// ---------------------------------------------------------------- passcode (salted scrypt + lockout)
function hashPass(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(p, salt, 32).toString('hex');
}
function samePass(p, stored) {
  const [salt, h] = String(stored).split(':');
  const a = crypto.scryptSync(p, salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function verifyPasscode(uid, passcode) {
  const ref = db.doc('userSecrets/' + uid);
  const result = await db.runTransaction(async t => {
    const d = (await t.get(ref)).data();
    if (!d || !d.passcodeHash) return 'none';
    if (d.lockedUntil && d.lockedUntil.toMillis() > Date.now()) return 'locked';
    if (samePass(String(passcode || ''), d.passcodeHash)) {
      if (d.attempts) t.update(ref, { attempts: 0 });
      return 'ok';
    }
    const n = (d.attempts || 0) + 1;
    t.update(ref, n >= 5
      ? { attempts: 0, lockedUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000) }
      : { attempts: n });
    return 'bad'; // returned (not thrown) so the attempt counter is actually committed
  });
  if (result === 'none') fail('failed-precondition', 'Set a transaction passcode first (Profile → Transaction passcode)');
  if (result === 'locked') fail('resource-exhausted', 'Too many wrong attempts. Try again in 30 minutes');
  if (result === 'bad') fail('permission-denied', 'Invalid passcode');
}

exports.setTransactionPasscode = onCall(opts(), async req => {
  const uid = needAuth(req);
  const p = String(req.data?.passcode || '');
  if (!/^\d{4,8}$/.test(p)) fail('invalid-argument', 'Passcode must be 4–8 digits');
  const secretRef = db.doc('userSecrets/' + uid);
  const existing = (await secretRef.get()).data();
  if (existing?.passcodeHash) await verifyPasscode(uid, req.data?.currentPasscode); // must know the old one to change it
  await db.runTransaction(async t => {
    await loadUser(t, uid);
    t.set(secretRef, { passcodeHash: hashPass(p), attempts: 0, lockedUntil: null }, { merge: true });
    t.update(db.doc('users/' + uid), { hasPasscode: true });
  });
  return { saved: true };
});

// ---------------------------------------------------------------- profile
exports.ensureProfile = onCall(opts(), async req => {
  const uid = needAuth(req);
  const ref = db.doc('users/' + uid);
  const name = String(req.data?.displayName || req.auth.token.name || 'User').trim().slice(0, 60) || 'User';
  const refCode = String(req.data?.ref || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  await db.runTransaction(async t => {
    if ((await t.get(ref)).exists) return;
    let referredBy = '';
    if (refCode) {
      const q = await t.get(db.collection('users').where('refCode', '==', refCode).limit(1));
      if (!q.empty && q.docs[0].id !== uid) referredBy = q.docs[0].id;
    }
    t.set(ref, {
      uid, email: req.auth.token.email || '', displayName: name, country: '',
      balanceNGN: 0, assets: { USDT: 0, BTC: 0, ETH: 0, BNB: 0 },
      bonusLockedUSD: 0, bonusUnlockedUSD: 0, status: 'active', warning: '',
      hasPasscode: false, refCode: uid.slice(0, 8), referredBy,
      createdAt: FieldValue.serverTimestamp()
    });
    t.set(db.collection('notifications').doc(), { uid, message: 'Welcome to NovaPay', createdAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

exports.getCatalog = onCall(opts(), async () => {
  const cfg = await getConfig();
  return {
    usdNgn: cfg.usdNgn, swapFeePct: cfg.swapFeePct, giftMarkupPct: cfg.giftMarkupPct,
    denoms: DENOMS, giftCards: GIFT_CARDS, products: PRODUCTS
  };
});

// ---------------------------------------------------------------- deposits: shared crediting (idempotent)
async function creditDeposit(docId) {
  const cfg = await getConfig();
  await db.runTransaction(async t => {
    const txRef = db.doc('transactions/' + docId);
    const ts = await t.get(txRef);
    if (!ts.exists) fail('not-found', 'Unknown payment reference');
    const p = ts.data();
    if (p.status === 'verified') return; // already credited -> replay is a no-op
    const uref = db.doc('users/' + p.uid);
    const d = (await t.get(uref)).data();
    const room = Math.max(0, 5 - Number(d.bonusLockedUSD || 0));
    const bonus = Math.min(room, p.amountNGN / cfg.usdNgn);
    t.update(uref, {
      balanceNGN: round(Number(d.balanceNGN || 0) + p.amountNGN, 2),
      bonusLockedUSD: round(Number(d.bonusLockedUSD || 0) + bonus, 2)
    });
    t.update(txRef, { status: 'verified', verifiedAt: FieldValue.serverTimestamp() });
  });
}

// ---- Paystack
async function settlePaystack(reference, expectUid) {
  const ref = db.doc('transactions/paystack_' + reference);
  const s = await ref.get();
  if (!s.exists) fail('not-found', 'Unknown payment reference');
  const p = s.data();
  if (expectUid && p.uid !== expectUid) fail('permission-denied', 'Not your payment');
  if (p.status === 'verified') return;
  const res = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET.value() }
  });
  const j = await res.json();
  if (!j.status || j.data?.status !== 'success') fail('failed-precondition', 'Payment not completed yet');
  if (j.data.currency !== 'NGN' || Number(j.data.amount) !== Math.round(p.amountNGN * 100)) {
    await ref.update({ status: 'amount_mismatch' });
    fail('failed-precondition', 'Payment amount mismatch. Please contact support');
  }
  await creditDeposit('paystack_' + reference);
}

exports.initializePaystackPayment = onCall(opts({ secrets: [PAYSTACK_SECRET] }), async req => {
  const uid = needAuth(req);
  const amount = positive(req.data?.amount, 5e6);
  if (amount < 100) fail('invalid-argument', 'Minimum deposit is ₦100');
  const email = req.auth.token.email;
  if (!email) fail('failed-precondition', 'Your account needs an email address');
  await db.runTransaction(async t => { await loadUser(t, uid); });
  const reference = 'NP-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET.value(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: Math.round(amount * 100), currency: 'NGN', reference, metadata: { uid } })
  });
  const j = await res.json();
  if (!j.status) fail('unavailable', j.message || 'Paystack initialization failed');
  await db.doc('transactions/paystack_' + reference).set({
    uid, type: 'paystack_deposit', reference, amountNGN: round(amount, 2), amountDisplay: ngn(amount),
    status: 'pending', createdAt: FieldValue.serverTimestamp()
  });
  return { reference, access_code: j.data.access_code };
});

exports.verifyPaystackPayment = onCall(opts({ secrets: [PAYSTACK_SECRET] }), async req => {
  const uid = needAuth(req);
  await settlePaystack(String(req.data?.reference || ''), uid);
  return { verified: true };
});

// Webhook: credits the wallet even if the customer closes the browser before verification.
exports.paystackWebhook = onRequest(opts({ secrets: [PAYSTACK_SECRET] }), async (req, res) => {
  const sig = crypto.createHmac('sha512', PAYSTACK_SECRET.value()).update(req.rawBody).digest('hex');
  if (sig !== req.get('x-paystack-signature')) { res.status(401).send('bad signature'); return; }
  try {
    if (req.body?.event === 'charge.success') await settlePaystack(String(req.body.data.reference));
  } catch (e) { console.error('paystack webhook', e.message); }
  res.sendStatus(200);
});

// ---- Flutterwave
async function settleFlutterwave(transactionId, txRef, expectUid) {
  const ref = db.doc('transactions/flutterwave_' + txRef);
  const s = await ref.get();
  if (!s.exists) fail('not-found', 'Unknown payment reference');
  const p = s.data();
  if (expectUid && p.uid !== expectUid) fail('permission-denied', 'Not your payment');
  if (p.status === 'verified') return;
  const res = await fetch('https://api.flutterwave.com/v3/transactions/' + encodeURIComponent(transactionId) + '/verify', {
    headers: { Authorization: 'Bearer ' + FLW_SECRET.value() }
  });
  const j = await res.json();
  if (j.status !== 'success' || j.data?.status !== 'successful') fail('failed-precondition', 'Payment not completed yet');
  if (j.data.tx_ref !== txRef || j.data.currency !== 'NGN' || Math.abs(Number(j.data.amount) - p.amountNGN) > 0.01) {
    await ref.update({ status: 'amount_mismatch' });
    fail('failed-precondition', 'Payment details mismatch. Please contact support');
  }
  await creditDeposit('flutterwave_' + txRef);
}

exports.initializeFlutterwavePayment = onCall(opts(), async req => {
  const uid = needAuth(req);
  const amount = positive(req.data?.amount, 5e6);
  if (amount < 100) fail('invalid-argument', 'Minimum deposit is ₦100');
  await db.runTransaction(async t => { await loadUser(t, uid); });
  const tx_ref = 'NP-FLW-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  await db.doc('transactions/flutterwave_' + tx_ref).set({
    uid, type: 'flutterwave_deposit', reference: tx_ref, amountNGN: round(amount, 2), amountDisplay: ngn(amount),
    status: 'pending', createdAt: FieldValue.serverTimestamp()
  });
  return { tx_ref, amount: round(amount, 2), email: req.auth.token.email || '' };
});

exports.verifyFlutterwavePayment = onCall(opts({ secrets: [FLW_SECRET] }), async req => {
  const uid = needAuth(req);
  await settleFlutterwave(req.data?.transactionId, String(req.data?.tx_ref || ''), uid);
  return { verified: true };
});

exports.flutterwaveWebhook = onRequest(opts({ secrets: [FLW_SECRET, FLW_WEBHOOK_HASH] }), async (req, res) => {
  if (req.get('verif-hash') !== FLW_WEBHOOK_HASH.value()) { res.status(401).send('bad hash'); return; }
  try {
    const d = req.body?.data;
    if (req.body?.event === 'charge.completed' && d) await settleFlutterwave(d.id, String(d.tx_ref));
  } catch (e) { console.error('flutterwave webhook', e.message); }
  res.sendStatus(200);
});

// ---------------------------------------------------------------- on-chain deposits (reviewed by an admin before crediting)
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CHAINS = {
  ethereum: { rpc: 'https://ethereum-rpc.publicnode.com', native: 'ETH', conf: 12, usdt: { addr: '0xdac17f958d2ee523a2206206994597c13d831ec7', dec: 6 } },
  bsc: { rpc: 'https://bsc-rpc.publicnode.com', native: 'BNB', conf: 15, usdt: { addr: '0x55d398326f99059ff775485246999027b3197955', dec: 18 } },
  polygon: { rpc: 'https://polygon-bor-rpc.publicnode.com', native: null, conf: 64, usdt: { addr: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', dec: 6 } }
};

async function rpc(chain, method, params) {
  const res = await fetch(chain.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) fail('unavailable', 'Blockchain node error: ' + j.error.message);
  return j.result;
}

exports.getDepositAddress = onCall(opts(), async req => {
  needAuth(req);
  const a = DEPOSIT_ADDRESS.value();
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) fail('failed-precondition', 'On-chain deposits are not enabled yet');
  return { address: a };
});

exports.verifyBlockchainDeposit = onCall(opts(), async req => {
  const uid = needAuth(req);
  const network = String(req.data?.network || '');
  const chain = CHAINS[network];
  if (!chain) fail('invalid-argument', 'Unsupported network');
  const from = String(req.data?.address || '').toLowerCase();
  const hash = String(req.data?.txHash || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(from) || !/^0x[a-f0-9]{64}$/.test(hash)) fail('invalid-argument', 'Invalid address or transaction hash');
  const platform = DEPOSIT_ADDRESS.value().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(platform)) fail('failed-precondition', 'On-chain deposits are not enabled yet');

  const [tx, receipt] = await Promise.all([rpc(chain, 'eth_getTransactionByHash', [hash]), rpc(chain, 'eth_getTransactionReceipt', [hash])]);
  if (!tx || !receipt || !tx.blockNumber) fail('not-found', 'Transaction not found or not mined yet');
  if (receipt.status !== '0x1') fail('failed-precondition', 'That transaction failed on-chain');
  if (String(tx.from).toLowerCase() !== from) fail('failed-precondition', 'Transaction was not sent from the address you entered');
  const latest = parseInt(await rpc(chain, 'eth_blockNumber', []), 16);
  const confirmations = latest - parseInt(tx.blockNumber, 16) + 1;
  if (confirmations < chain.conf) fail('failed-precondition', `Wait for ${chain.conf} confirmations (currently ${confirmations})`);

  let asset = null, amount = 0;
  if (chain.native && String(tx.to || '').toLowerCase() === platform && BigInt(tx.value || '0x0') > 0n) {
    asset = chain.native; amount = Number(BigInt(tx.value)) / 1e18;
  } else {
    const log = (receipt.logs || []).find(l =>
      l.address.toLowerCase() === chain.usdt.addr && l.topics?.[0] === TRANSFER_TOPIC &&
      l.topics.length === 3 && ('0x' + l.topics[2].slice(26)).toLowerCase() === platform &&
      ('0x' + l.topics[1].slice(26)).toLowerCase() === from);
    if (log) { asset = 'USDT'; amount = Number(BigInt(log.data)) / 10 ** chain.usdt.dec; }
  }
  if (!asset || !(amount > 0)) fail('failed-precondition', 'No supported deposit to the NovaPay address found in that transaction (supported: native ETH/BNB and USDT)');

  const depRef = db.doc(`blockchainDeposits/${network}_${hash}`);
  await db.runTransaction(async t => {
    await loadUser(t, uid);
    if ((await t.get(depRef)).exists) fail('already-exists', 'This transaction was already submitted');
    const led = addLedger(t, uid, { type: 'blockchain_deposit', reference: hash, amountDisplay: `${amount} ${asset}`, status: 'pending_review' });
    t.create(depRef, { uid, network, address: from, txHash: hash, asset, amount, confirmations, ledgerId: led.id, status: 'pending_review', createdAt: FieldValue.serverTimestamp() });
  });
  return { submitted: true, asset, amount, confirmations };
});

exports.resolveBlockchainDeposit = onCall(opts(), async req => {
  needAdmin(req);
  const ref = db.doc('blockchainDeposits/' + String(req.data?.id || ''));
  const approve = req.data?.action === 'approve';
  await db.runTransaction(async t => {
    const s = await t.get(ref);
    if (!s.exists || s.data().status !== 'pending_review') fail('failed-precondition', 'Deposit is not pending review');
    const dep = s.data();
    const uref = db.doc('users/' + dep.uid);
    const u = (await t.get(uref)).data();
    if (approve) t.update(uref, deltaUpdate(u, { [dep.asset]: dep.amount }));
    t.update(ref, { status: approve ? 'verified' : 'rejected', resolvedAt: FieldValue.serverTimestamp() });
    t.update(db.doc('transactions/' + dep.ledgerId), { status: approve ? 'verified' : 'rejected' });
  });
  return { ok: true };
});

// ---------------------------------------------------------------- swap + spot trade (executed against the wallet ledger)
async function swapQuote(from, to, amount, cfg) {
  if (!ASSETS.includes(from) || !ASSETS.includes(to) || from === to) fail('invalid-argument', 'Choose two different supported assets');
  const [pf, pt] = await Promise.all([usdPrice(from, cfg), usdPrice(to, cfg)]);
  const usdValue = amount * pf;
  if (usdValue < 1) fail('invalid-argument', 'Minimum is about $1');
  const fee = usdValue * cfg.swapFeePct / 100;
  return { receive: round((usdValue - fee) / pt, to === 'NGN' ? 2 : 8), feeUSD: round(fee, 4), usdValue };
}

exports.quoteSwap = onCall(opts(), async req => {
  needAuth(req);
  const cfg = await getConfig();
  const amount = positive(req.data?.amount);
  const q = await swapQuote(String(req.data?.from), String(req.data?.to), amount, cfg);
  return { receive: q.receive, feeUSD: q.feeUSD, feePct: cfg.swapFeePct };
});

async function executeSwapCore(uid, from, to, amount, quotedReceive, collection, ledgerType, extra = {}) {
  const cfg = await getConfig();
  amount = round(positive(amount), from === 'NGN' ? 2 : 8);
  const q = await swapQuote(from, to, amount, cfg);
  if (quotedReceive && q.receive < Number(quotedReceive) * 0.99) fail('aborted', 'Price moved more than 1%. Please get a new quote');
  const orderRef = db.collection(collection).doc();
  await db.runTransaction(async t => {
    const { ref, d } = await loadUser(t, uid);
    t.update(ref, deltaUpdate(d, { [from]: -amount, [to]: q.receive }));
    const led = addLedger(t, uid, { type: ledgerType, reference: orderRef.id, amountDisplay: `${amount} ${from} → ${q.receive} ${to}`, status: 'completed' });
    t.set(orderRef, { uid, from, to, amount, receive: q.receive, feeUSD: q.feeUSD, ledgerId: led.id, status: 'filled', ...extra, createdAt: FieldValue.serverTimestamp() });
  });
  return { orderId: orderRef.id, receive: q.receive };
}

exports.executeSwap = onCall(opts(), async req => {
  const uid = needAuth(req);
  const r = await executeSwapCore(uid, String(req.data?.from), String(req.data?.to), req.data?.amount, req.data?.quotedReceive, 'swapOrders', 'swap');
  return r;
});

// Market orders only: BUY spends USDT to get `symbol`; SELL sells `symbol` for USDT.
exports.placeTrade = onCall(opts(), async req => {
  const uid = needAuth(req);
  const symbol = String(req.data?.symbol || '');
  const side = req.data?.side === 'sell' ? 'sell' : 'buy';
  if (!SYMBOLS[symbol]) fail('invalid-argument', 'Unsupported market');
  const [from, to] = side === 'buy' ? ['USDT', symbol] : [symbol, 'USDT'];
  return executeSwapCore(uid, from, to, req.data?.amount, req.data?.quotedReceive, 'tradeOrders', 'trade_' + side, { pair: symbol + '/USDT', side, type: 'market' });
});

// ---------------------------------------------------------------- store orders (gift cards + marketplace)
exports.createOrder = onCall(opts(), async req => {
  const uid = needAuth(req);
  const d = req.data || {};
  const cfg = await getConfig();
  let item, usd;
  if (d.type === 'gift_card') {
    const g = GIFT_BY_ID[Number(d.productId)];
    const den = Number(d.denomination), q = Math.floor(Number(d.quantity));
    if (!g || !DENOMS.includes(den) || !(q >= 1 && q <= 10)) fail('invalid-argument', 'Invalid gift card order');
    usd = den * q * (1 + cfg.giftMarkupPct / 100);
    item = { type: 'gift_card', productId: g.id, brand: g.brand, region: g.region, denomination: den, quantity: q };
  } else if (d.type === 'marketplace') {
    const p = PRODUCT_BY_ID[Number(d.productId)];
    const q = Math.floor(Number(d.quantity));
    const s = d.shipping || {};
    const shipping = { name: String(s.name || '').trim().slice(0, 80), phone: String(s.phone || '').trim().slice(0, 30), address: String(s.address || '').trim().slice(0, 300) };
    if (!p || !(q >= 1 && q <= 5)) fail('invalid-argument', 'Invalid product order');
    if (shipping.name.length < 2 || shipping.phone.length < 7 || shipping.address.length < 10) fail('invalid-argument', 'Enter your full delivery name, phone and address');
    usd = p.priceUSD * q;
    item = { type: 'marketplace', productId: p.id, name: p.name, quantity: q, shipping };
  } else fail('invalid-argument', 'Unknown order type');

  const totalNGN = round(usd * cfg.usdNgn, 2);
  const orderRef = db.collection('orders').doc();
  await db.runTransaction(async t => {
    const { ref, d: u } = await loadUser(t, uid);
    t.update(ref, deltaUpdate(u, { NGN: -totalNGN }));
    const led = addLedger(t, uid, { type: 'order', reference: orderRef.id, amountDisplay: '-' + ngn(totalNGN), status: 'pending' });
    t.set(orderRef, { uid, ...item, totalUSD: round(usd, 2), totalNGN, ledgerId: led.id, status: 'pending_fulfilment', createdAt: FieldValue.serverTimestamp() });
  });
  return { orderId: orderRef.id, totalNGN };
});

exports.resolveOrder = onCall(opts(), async req => {
  needAdmin(req);
  const ref = db.doc('orders/' + String(req.data?.id || ''));
  const action = req.data?.action;
  if (!['fulfill', 'refund'].includes(action)) fail('invalid-argument', 'action must be fulfill or refund');
  await db.runTransaction(async t => {
    const s = await t.get(ref);
    if (!s.exists || s.data().status !== 'pending_fulfilment') fail('failed-precondition', 'Order is not pending');
    const o = s.data();
    if (action === 'refund') {
      const uref = db.doc('users/' + o.uid);
      t.update(uref, deltaUpdate((await t.get(uref)).data(), { NGN: o.totalNGN }));
    }
    t.update(ref, { status: action === 'fulfill' ? 'fulfilled' : 'refunded', delivery: String(req.data?.note || '').slice(0, 2000), resolvedAt: FieldValue.serverTimestamp() });
    t.update(db.doc('transactions/' + o.ledgerId), { status: action === 'fulfill' ? 'completed' : 'refunded' });
    t.set(db.collection('notifications').doc(), { uid: o.uid, message: action === 'fulfill' ? 'Your order was fulfilled' : 'Your order was refunded', createdAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

// ---------------------------------------------------------------- withdrawals (funds are held immediately, released or refunded by an admin)
const NETWORKS = {
  NGN: { 'Bank transfer': /^.{10,200}$/s },
  USDT: { ERC20: /^0x[a-fA-F0-9]{40}$/, BEP20: /^0x[a-fA-F0-9]{40}$/, Polygon: /^0x[a-fA-F0-9]{40}$/, TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
  BTC: { Bitcoin: /^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
  ETH: { Ethereum: /^0x[a-fA-F0-9]{40}$/ },
  BNB: { 'BNB Smart Chain': /^0x[a-fA-F0-9]{40}$/ }
};

exports.requestWithdrawal = onCall(opts(), async req => {
  const uid = needAuth(req);
  const asset = String(req.data?.asset || ''), network = String(req.data?.network || '');
  const destination = String(req.data?.destination || '').trim();
  const rule = NETWORKS[asset]?.[network];
  if (!rule) fail('invalid-argument', 'Unsupported asset or network');
  if (!rule.test(destination)) fail('invalid-argument', 'Destination does not look valid for ' + network);
  const amount = round(positive(req.data?.amount), asset === 'NGN' ? 2 : 8);
  const cfg = await getConfig();
  const usd = amount * await usdPrice(asset, cfg);
  if (usd < 10) fail('invalid-argument', 'Minimum withdrawal is $10 equivalent');
  await verifyPasscode(uid, req.data?.passcode);

  const wRef = db.collection('withdrawals').doc();
  await db.runTransaction(async t => {
    const { ref, d } = await loadUser(t, uid);
    t.update(ref, deltaUpdate(d, { [asset]: -amount }));
    const led = addLedger(t, uid, { type: 'withdrawal', reference: wRef.id, amountDisplay: `-${amount} ${asset}`, status: 'pending_review' });
    t.set(wRef, { uid, asset, network, amount, usdValue: round(usd, 2), destination, ledgerId: led.id, status: 'pending_review', createdAt: FieldValue.serverTimestamp() });
  });
  return { withdrawalId: wRef.id };
});

exports.resolveWithdrawal = onCall(opts(), async req => {
  needAdmin(req);
  const ref = db.doc('withdrawals/' + String(req.data?.id || ''));
  const action = req.data?.action;
  if (!['complete', 'reject'].includes(action)) fail('invalid-argument', 'action must be complete or reject');
  await db.runTransaction(async t => {
    const s = await t.get(ref);
    if (!s.exists || s.data().status !== 'pending_review') fail('failed-precondition', 'Withdrawal is not pending');
    const w = s.data();
    if (action === 'reject') {
      const uref = db.doc('users/' + w.uid);
      t.update(uref, deltaUpdate((await t.get(uref)).data(), { [w.asset]: w.amount }));
    }
    t.update(ref, { status: action === 'complete' ? 'completed' : 'rejected', payoutReference: String(req.data?.note || '').slice(0, 300), resolvedAt: FieldValue.serverTimestamp() });
    t.update(db.doc('transactions/' + w.ledgerId), { status: action === 'complete' ? 'completed' : 'rejected' });
    t.set(db.collection('notifications').doc(), { uid: w.uid, message: action === 'complete' ? 'Your withdrawal was sent' : 'Your withdrawal was rejected and refunded', createdAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

// ---------------------------------------------------------------- admin
exports.setUserStatus = onCall(opts(), async req => {
  needAdmin(req);
  if (!['active', 'banned'].includes(req.data?.status)) fail('invalid-argument', 'status must be active or banned');
  await db.doc('users/' + String(req.data.uid)).update({ status: req.data.status, warning: String(req.data.warning || '').slice(0, 300) });
  return { updated: true };
});

exports.setUserWarning = onCall(opts(), async req => {
  needAdmin(req);
  await db.doc('users/' + String(req.data?.uid)).update({ warning: String(req.data?.warning || '').slice(0, 300) });
  return { updated: true };
});

exports.setConfig = onCall(opts(), async req => {
  needAdmin(req);
  const usdNgn = positive(req.data?.usdNgn, 1e5);
  const swapFeePct = Number(req.data?.swapFeePct ?? 1), giftMarkupPct = Number(req.data?.giftMarkupPct ?? 0);
  if (!(swapFeePct >= 0 && swapFeePct <= 10 && giftMarkupPct >= 0 && giftMarkupPct <= 50)) fail('invalid-argument', 'Fee out of range');
  await db.doc('config/app').set({ usdNgn, swapFeePct, giftMarkupPct, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
