/**
 * NovaPay — Firebase Spark (Auth + Firestore + Hosting only)
 * Real payments via public keys; deposits stay pending until admin credits balance.
 * No Cloud Functions. For automatic credit, use Blaze + Functions or an external webhook.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged,
  signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, updateDoc, getDoc, collection, query, where,
  orderBy, limit, getDocs, onSnapshot, serverTimestamp, addDoc, increment
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// ------------------------------------------------------------------ CONFIG — edit these
const firebaseConfig = {
  apiKey: 'AIzaSyC1TfGUijMt5udy44nfaufnHrtnv-oLdz8',
  authDomain: 'usdt-invest-2209.firebaseapp.com',
  projectId: 'usdt-invest-2209',
  storageBucket: 'usdt-invest-2209.firebasestorage.app',
  messagingSenderId: '168346609720',
  appId: '1:168346609720:web:7e135d2ecf104fe539decd'
};

// Public keys only (never put secret keys in the browser)
const PAYSTACK_PUBLIC_KEY = 'pk_live_725e9c0357625ec847ec27b37e4d1033ac90a718';
const FLW_PUBLIC_KEY = 'FLWPUBK_TEST_REPLACE_ME';
const KORA_PUBLIC_KEY = 'pk_test_kora_REPLACE_ME';
const MOONPAY_API_KEY = 'pk_test_moonpay_REPLACE_ME';
const SUPPORT = { telegram: '', x: '', tiktok: '' };

const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
const BINANCE_WS = 'wss://data-stream.binance.vision/ws';
const DEFAULT_USD_NGN = 16,345.18;
const PLATFORM_FEE_PCT = 0.8;
const COMPANY_DEPOSIT_ADDRESS = '0xYourCompanyWalletAddressHere';

const CRYPTO_BY_COUNTRY = {
  NG: ['moonpay', 'trust', 'manual'],
  GH: ['moonpay', 'trust', 'manual'],
  KE: ['moonpay', 'trust', 'manual'],
  ZA: ['moonpay', 'googlepay', 'trust', 'manual'],
  US: ['moonpay', 'googlepay', 'trust', 'manual'],
  GB: ['moonpay', 'googlepay', 'trust', 'manual'],
  CA: ['moonpay', 'googlepay', 'trust', 'manual'],
  AE: ['moonpay', 'trust', 'manual'],
  IN: ['moonpay', 'trust', 'manual'],
  OTHER: ['moonpay', 'trust', 'manual']
};

const FIAT_GATEWAYS = {
  NG: ['paystack', 'flutterwave', 'kora'],
  GH: ['flutterwave', 'paystack'],
  KE: ['flutterwave', 'paystack'],
  ZA: ['flutterwave', 'paystack'],
  US: ['paystack'],
  GB: ['paystack', 'flutterwave'],
  CA: ['paystack'],
  AE: ['flutterwave'],
  IN: ['paystack'],
  OTHER: ['paystack', 'flutterwave']
};

const GIFT_CARDS = [
  { id: 1, brand: 'Amazon', region: 'US', emoji: '🛒' },
  { id: 2, brand: 'Apple', region: 'US', emoji: '🍎' },
  { id: 3, brand: 'Google Play', region: 'GLOBAL', emoji: '▶️' },
  { id: 4, brand: 'Steam', region: 'GLOBAL', emoji: '🎮' },
  { id: 5, brand: 'PlayStation', region: 'US', emoji: '🕹️' },
  { id: 6, brand: 'Xbox', region: 'US', emoji: '🟩' },
  { id: 7, brand: 'Netflix', region: 'GLOBAL', emoji: '🎬' },
  { id: 8, brand: 'Spotify', region: 'GLOBAL', emoji: '🎧' },
  { id: 9, brand: 'Uber', region: 'US', emoji: '🚗' },
  { id: 10, brand: 'Nike', region: 'US', emoji: '👟' },
  { id: 11, brand: 'Walmart', region: 'US', emoji: '🏪' },
  { id: 12, brand: 'Starbucks', region: 'US', emoji: '☕' },
  { id: 13, brand: 'Amazon', region: 'UK', emoji: '🛒' },
  { id: 14, brand: 'Apple', region: 'UK', emoji: '🍎' },
  { id: 15, brand: 'Jumia', region: 'NG', emoji: '🛍️' },
  { id: 16, brand: 'MTN', region: 'NG', emoji: '📱' },
  { id: 17, brand: 'Airbnb', region: 'GLOBAL', emoji: '🏠' },
  { id: 18, brand: 'Disney+', region: 'US', emoji: '✨' }
];
const DENOMS = [10, 25, 50, 100, 200];
const PRODUCTS = [
  { id: 1, name: 'Classic Tee', priceUSD: 29, emoji: '👕' },
  { id: 2, name: 'Gold Watch', priceUSD: 249, emoji: '⌚' },
  { id: 3, name: 'Gold Chain', priceUSD: 189, emoji: '📿' },
  { id: 4, name: 'Sneakers Pro', priceUSD: 119, emoji: '👟' },
  { id: 5, name: 'Leather Bag', priceUSD: 159, emoji: '👜' },
  { id: 6, name: 'Sunglasses', priceUSD: 79, emoji: '🕶️' }
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const google = new GoogleAuthProvider();

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moneyUSD = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
const moneyNGN = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(n || 0));
const err = e => String(e?.message || e || 'Request failed').replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim();
const msg = (el, text, cls = '') => { if (!el) return; el.textContent = text; el.className = 'status show ' + cls; };

let toastTimer;
function toast(t) {
  const e = $('toast');
  e.textContent = t;
  e.className = 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { e.className = 'toast'; }, 3200);
}

let me = null, data = null, unsub = null, signupMeta = {}, usdNgn = DEFAULT_USD_NGN;
try {
  const r = new URLSearchParams(location.search).get('ref');
  if (r) localStorage.setItem('np_ref', r.slice(0, 16));
} catch (_) {}

const balanceOf = a => {
  if (!data) return 0;
  if (a === 'USD') return Number(data.balanceUSD || 0);
  if (a === 'NGN') return Number(data.balanceNGN || 0);
  return Number(data.assets?.[a] || 0);
};

function page(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === p));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === p));
  if (p !== 'trade') stopFeed();
  if (p === 'trade') startTrade();
  if (p === 'giftcards') renderGifts();
  if (p === 'market') renderMarket();
  if (p === 'home') loadPendingDeposits();
  if (p === 'historyPage') loadHistory();
  if (p === 'deposit') renderCryptoMethods();
  if (p === 'withdraw') fillNetworks();
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-tab]').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('login').classList.toggle('hidden', b.dataset.tab !== 'login');
    $('signup').classList.toggle('hidden', b.dataset.tab !== 'signup');
  };
});

$('scountry')?.addEventListener('change', () => {
  const map = { NG: '+234', GH: '+233', KE: '+254', ZA: '+27', US: '+1', GB: '+44', CA: '+1', AE: '+971', IN: '+91' };
  const c = $('scountry').value;
  if (map[c]) $('scode').value = map[c];
});

$('showTerms')?.addEventListener('click', e => {
  e.preventDefault();
  modal(`<div class="modalhead"><h2>Terms &amp; Conditions</h2><button class="close">×</button></div>
    <div style="font-size:13px;line-height:1.55;color:#4b4560;max-height:60vh;overflow:auto">
      <p><b>1. Acceptance</b><br>By creating a NovaPay account you agree to these terms and our Privacy Policy.</p>
      <p><b>2. Eligibility</b><br>You must be at least 18 years old and provide accurate information (name, country, phone, gender, date of birth).</p>
      <p><b>3. Wallet &amp; Balances</b><br>Balances are denominated in USD by default. Crypto and NGN balances are also available. NovaPay is not a bank.</p>
      <p><b>4. Deposits</b><br>Fiat deposits via Paystack, Flutterwave or Kora. Crypto via MoonPay, Google Pay (where available), Trust Wallet, or on-chain transfer. Availability depends on your country.</p>
      <p><b>5. Trading</b><br>Market orders execute at live exchange prices plus a platform fee. Crypto is volatile.</p>
      <p><b>6. Gift Cards</b><br>Gift cards are fulfilled via Tremendous or partner suppliers. Codes are delivered after successful fulfilment.</p>
      <p><b>7. Withdrawals</b><br>Minimum $10 equivalent. Subject to review. Wrong network / address transfers cannot be recovered.</p>
      <p><b>8. Prohibited use</b><br>No money laundering, fraud, or illegal activity.</p>
      <p><b>9. Liability</b><br>Service is provided "as is". We are not liable for exchange-rate losses, third-party outages, or user error.</p>
      <p><b>10. Contact</b><br>Use in-app Support for help.</p>
    </div>
    <button class="primary full close" style="margin-top:12px">I understand</button>`);
});

$('login').onsubmit = async e => {
  e.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, $('le').value.trim(), $('lp').value);
  } catch (x) { msg($('authmsg'), err(x), 'error'); }
};

$('signup').onsubmit = async e => {
  e.preventDefault();
  const name = $('sn').value.trim();
  const email = $('se').value.trim();
  const pass = $('sp').value;
  const country = $('scountry').value;
  const phone = ($('scode').value + ' ' + $('sphone').value.replace(/\s/g, '')).trim();
  const gender = $('sgender').value;
  const dob = $('sdob').value;
  if (!$('sterms').checked) return msg($('authmsg'), 'Please accept the Terms & Conditions', 'error');
  if (!country || !phone || !gender || !dob) return msg($('authmsg'), 'Please fill all required fields', 'error');
  const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 18) return msg($('authmsg'), 'You must be 18 or older to open an account', 'error');

  signupMeta = { name, country, phone, gender, dob };
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
  } catch (x) { msg($('authmsg'), err(x), 'error'); }
};

async function googleLogin() {
  try { await signInWithPopup(auth, google); }
  catch (x) { msg($('authmsg'), err(x), 'error'); }
}
$('google').onclick = googleLogin;
$('googles').onclick = googleLogin;

$('forgot').onclick = async () => {
  if (!$('le').value) return msg($('authmsg'), 'Enter your email first', 'error');
  try {
    await sendPasswordResetEmail(auth, $('le').value.trim());
    msg($('authmsg'), 'Password reset email sent', 'success');
  } catch (x) { msg($('authmsg'), err(x), 'error'); }
};

async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const refCode = user.uid.slice(0, 8);
  const profile = {
    uid: user.uid,
    email: user.email || '',
    displayName: signupMeta.name || user.displayName || 'User',
    country: signupMeta.country || '',
    phone: signupMeta.phone || '',
    gender: signupMeta.gender || '',
    dob: signupMeta.dob || '',
    balanceUSD: 0,
    balanceNGN: 0,
    assets: { USDT: 0, BTC: 0, ETH: 0, BNB: 0, SOL: 0 },
    bonusLockedUSD: 0,
    referralRewardUSD: 0,
    refCode,
    referredBy: localStorage.getItem('np_ref') || '',
    status: 'active',
    warning: '',
    hasPasscode: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, profile);
  signupMeta = {};
  return profile;
}

onAuthStateChanged(auth, async u => {
  me = u;
  if (unsub) { unsub(); unsub = null; }
  if (!u) {
    data = null;
    stopFeed();
    $('auth').classList.remove('hidden');
    $('app').classList.add('hidden');
    return;
  }
  try {
    await ensureProfile(u);
  } catch (x) {
    toast(err(x));
  }
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  page('home');
  unsub = onSnapshot(doc(db, 'users', u.uid), s => {
    if (s.exists()) { data = s.data(); render(); }
  }, x => toast(err(x)));

  getDoc(doc(db, 'config', 'app')).then(s => {
    if (s.exists() && Number(s.data().usdNgn) > 0) usdNgn = Number(s.data().usdNgn);
  }).catch(() => {});
});

function render() {
  if (!data || !me) return;
  const n = data.displayName || 'User';
  $('name').textContent = n;
  $('pname').textContent = n;
  $('pemail').textContent = me.email || '';
  if (document.activeElement !== $('pn')) $('pn').value = n;
  $('pc').value = data.country || '';
  $('pphone').value = data.phone || '';
  $('pgender').value = data.gender || '';
  $('pdob').value = data.dob || '';
  $('avatar').textContent = (n[0] || 'N').toUpperCase();
  $('pavatar').textContent = (n[0] || 'N').toUpperCase();

  const usd = balanceOf('USD');
  $('bal').textContent = moneyUSD(usd);
  $('balSub').textContent = '≈ ' + moneyNGN(usd * usdNgn) + ' · USD default';
  $('bonus').textContent = '$' + Number(data.bonusLockedUSD || 0).toFixed(2) + ' / $5.00';
  $('rb').textContent = '$' + Number(data.bonusLockedUSD || 0).toFixed(2);
  $('rr').textContent = '$' + Number(data.referralRewardUSD || 0).toFixed(2);
  $('statusText').textContent = data.status || 'active';

  const w = $('warning');
  const banned = data.status === 'banned';
  w.classList.toggle('hidden', !data.warning && !banned);
  w.textContent = banned
    ? '⚠️ Your account is banned. Transactions are disabled.'
    : '⚠️ ' + (data.warning || '');

  const a = data.assets || {};
  $('assets').innerHTML = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL'].map(x =>
    '<div class="asset row"><span><b>' + x + '</b><small>Crypto</small></span><b>' + Number(a[x] || 0).toFixed(x === 'USDT' ? 2 : 8) + ' ' + x + '</b></div>'
  ).join('');

  $('ref').textContent = location.origin + location.pathname + '?ref=' + (data.refCode || me.uid.slice(0, 8));
  updateWithdrawBalance();
  loadPendingDeposits();
}

function modal(html) {
  $('modal').innerHTML = '<div class="backdrop"><div class="modal">' + html + '</div></div>';
}
const closeModal = () => { $('modal').innerHTML = ''; };
let pendingAction = null;

document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-page]');
  if (nav) return page(nav.dataset.page);
  if (e.target.closest('.close')) return closeModal();

  const gift = e.target.closest('[data-gift]');
  if (gift) return giftModal(Number(gift.dataset.gift));
  const prod = e.target.closest('[data-prod]');
  if (prod) return productModal(Number(prod.dataset.prod));

  const pct = e.target.closest('[data-pct]');
  if (pct && $('trade').classList.contains('active')) {
    const p = Number(pct.dataset.pct) / 100;
    const have = side === 'buy' ? balanceOf('USDT') : balanceOf($('pair').value);
    $('tradeamt').value = (have * p).toFixed(side === 'buy' ? 2 : 8);
    tradeEstimate();
    return;
  }

  const id = e.target.closest('button')?.id;
  if (id === 'confirmBtn' && pendingAction) {
    const btn = e.target.closest('button');
    btn.disabled = true;
    try { await pendingAction(); } catch (x) { msg($('cm'), err(x), 'error'); btn.disabled = false; }
  }
});

$('fund').onclick = $('fund2').onclick = () => openFundModal();
if ($('refreshPending')) $('refreshPending').onclick = () => loadPendingDeposits();

function openFundModal() {
  const country = (data?.country || 'OTHER').toUpperCase();
  const gateways = FIAT_GATEWAYS[country] || FIAT_GATEWAYS.OTHER;
  const labels = {
    paystack: 'Pay with Paystack',
    flutterwave: 'Pay with Flutterwave',
    kora: 'Pay with Kora'
  };
  const btns = gateways.map(g =>
    '<button class="primary full fund-gw" data-gw="' + g + '" style="margin-top:8px">' + labels[g] + '</button>'
  ).join('');

  modal(
    '<div class="modalhead"><h2>Add money</h2><button class="close">×</button></div>' +
    '<p class="hint">Available in your country (' + esc(country) + '). Amount is in <b>USD</b>.</p>' +
    '<label>Amount (USD)</label>' +
    '<input id="fa" type="number" inputmode="decimal" min="1" step="0.01" placeholder="10.00">' +
    '<div id="fm" class="status"></div>' +
    btns +
    '<small style="display:block;margin-top:12px">After you pay, your deposit is marked <b>pending</b>. An admin credits your balance after confirming the payment in Paystack / Flutterwave / Kora.</small>'
  );

  document.querySelectorAll('.fund-gw').forEach(b => {
    b.onclick = () => startFiatPayment(b.dataset.gw);
  });
}

/** Create a pending fiat deposit — balance is NOT credited until admin confirms in Firebase Console. */
async function createPendingDeposit(opts) {
  const { amountUSD, provider, reference, status = 'pending_review', note = '' } = opts;
  const depRef = await addDoc(collection(db, 'deposits'), {
    uid: me.uid,
    email: me.email || '',
    displayName: data?.displayName || '',
    amountUSD: Number(amountUSD),
    amountNGN: Math.round(Number(amountUSD) * usdNgn * 100) / 100,
    provider,
    reference: reference || '',
    status,
    note,
    createdAt: serverTimestamp()
  });
  await addDoc(collection(db, 'transactions'), {
    uid: me.uid,
    type: 'deposit_' + provider,
    status,
    amountUSD: Number(amountUSD),
    amountDisplay: moneyUSD(amountUSD) + ' (pending)',
    reference: reference || '',
    depositId: depRef.id,
    createdAt: serverTimestamp()
  });
  return depRef.id;
}

async function startFiatPayment(provider) {
  const amountUSD = Number($('fa').value);
  if (!(amountUSD >= 1)) return msg($('fm'), 'Minimum $1', 'error');
  if (data?.status === 'banned') return msg($('fm'), 'Account banned', 'error');

  const email = me.email || '';
  const amountNGN = Math.round(amountUSD * usdNgn * 100) / 100;
  const ref = 'NP_' + me.uid.slice(0, 6) + '_' + Date.now();

  try {
    if (provider === 'paystack') {
      if (PAYSTACK_PUBLIC_KEY.includes('REPLACE')) {
        await createPendingDeposit({
          amountUSD, provider: 'paystack', reference: ref,
          status: 'pending_review',
          note: 'Demo / test key — verify in Paystack dashboard then credit in Firebase'
        });
        msg($('fm'), 'Deposit recorded as pending $' + amountUSD.toFixed(2) + '. Add your Paystack public key for live checkout. Admin must credit after payment is confirmed.', 'success');
        setTimeout(closeModal, 2200);
        return;
      }
      const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email,
        amount: Math.round(amountNGN * 100),
        currency: 'NGN',
        ref,
        metadata: { uid: me.uid, amountUSD: String(amountUSD) },
        callback: async (response) => {
          try {
            await createPendingDeposit({
              amountUSD,
              provider: 'paystack',
              reference: response?.reference || ref,
              status: 'pending_review',
              note: 'User completed Paystack checkout — verify in Paystack dashboard then credit balanceUSD'
            });
            msg($('fm'), 'Payment submitted. Balance will update after admin confirmation.', 'success');
            setTimeout(closeModal, 1800);
          } catch (x) {
            msg($('fm'), err(x), 'error');
          }
        },
        onClose: () => msg($('fm'), 'Payment window closed — if you paid, contact support with your reference: ' + ref, 'error')
      });
      handler.openIframe();
    } else if (provider === 'flutterwave') {
      if (FLW_PUBLIC_KEY.includes('REPLACE')) {
        await createPendingDeposit({
          amountUSD, provider: 'flutterwave', reference: ref,
          status: 'pending_review',
          note: 'Demo / test key — verify in Flutterwave dashboard then credit in Firebase'
        });
        msg($('fm'), 'Deposit recorded as pending $' + amountUSD.toFixed(2) + '. Add your Flutterwave public key for live checkout. Admin must credit after confirmation.', 'success');
        setTimeout(closeModal, 2200);
        return;
      }
      FlutterwaveCheckout({
        public_key: FLW_PUBLIC_KEY,
        tx_ref: ref,
        amount: amountNGN,
        currency: 'NGN',
        customer: { email, name: data.displayName || '' },
        meta: { uid: me.uid, amountUSD: String(amountUSD) },
        customizations: { title: 'NovaPay', description: 'Wallet funding' },
        callback: async (response) => {
          try {
            await createPendingDeposit({
              amountUSD,
              provider: 'flutterwave',
              reference: response?.tx_ref || response?.transaction_id || ref,
              status: 'pending_review',
              note: 'User completed Flutterwave checkout — verify in dashboard then credit balanceUSD'
            });
            msg($('fm'), 'Payment submitted. Balance will update after admin confirmation.', 'success');
            setTimeout(closeModal, 1800);
          } catch (x) {
            msg($('fm'), err(x), 'error');
          }
        },
        onclose: () => {}
      });
    } else if (provider === 'kora') {
      // Kora: open their hosted page if you have a public key; otherwise record pending for manual bank match
      if (KORA_PUBLIC_KEY.includes('REPLACE')) {
        await createPendingDeposit({
          amountUSD, provider: 'kora', reference: ref,
          status: 'pending_review',
          note: 'Kora demo — set KORA_PUBLIC_KEY or match bank transfer manually, then credit'
        });
        msg($('fm'), 'Kora deposit recorded as pending $' + amountUSD.toFixed(2) + '. Admin credits after confirming payment.', 'success');
        setTimeout(closeModal, 2200);
        return;
      }
      // Placeholder: many Kora integrations use redirect; record intent first
      await createPendingDeposit({
        amountUSD, provider: 'kora', reference: ref,
        status: 'pending_review',
        note: 'Kora checkout started — verify payment then credit'
      });
      msg($('fm'), 'Deposit recorded. Complete Kora payment if prompted; balance updates after admin confirmation.', 'success');
      // If you have Kora inline JS, call it here with KORA_PUBLIC_KEY
      setTimeout(closeModal, 2000);
    }
  } catch (x) {
    msg($('fm'), err(x), 'error');
  }
}

function renderCryptoMethods() {
  $('depaddr').textContent = COMPANY_DEPOSIT_ADDRESS;
  const country = (data?.country || 'OTHER').toUpperCase();
  const methods = CRYPTO_BY_COUNTRY[country] || CRYPTO_BY_COUNTRY.OTHER;
  const all = [
    { id: 'moonpay', icon: '🌙', title: 'MoonPay', desc: 'Buy crypto with card / bank · available in most countries' },
    { id: 'googlepay', icon: 'G', title: 'Google Pay', desc: 'Quick pay where Google Pay is supported' },
    { id: 'trust', icon: '🛡️', title: 'Trust Wallet', desc: 'Open Trust Wallet and send to your NovaPay address' },
    { id: 'manual', icon: '⛓️', title: 'Manual on-chain', desc: 'Send from any wallet and submit the TX hash below' }
  ];
  $('cryptoAvailHint').textContent = 'Methods available in ' + country + ': ' + methods.join(', ') + '.';
  $('cryptoMethods').innerHTML = all.map(m => {
    const ok = methods.includes(m.id);
    return '<button class="dep-method" data-crypto="' + m.id + '" ' + (ok ? '' : 'disabled') + '>' +
      '<span class="icon">' + m.icon + '</span>' +
      '<span><b>' + m.title + '</b><small>' + m.desc + (ok ? '' : ' · not available in your country') + '</small></span>' +
      '</button>';
  }).join('');

  document.querySelectorAll('[data-crypto]').forEach(b => {
    b.onclick = () => openCryptoFlow(b.dataset.crypto);
  });
}

function openCryptoFlow(id) {
  if (id === 'moonpay') {
    const url = 'https://buy.moonpay.com?apiKey=' + encodeURIComponent(MOONPAY_API_KEY) +
      '&currencyCode=usdt&walletAddress=' + encodeURIComponent(COMPANY_DEPOSIT_ADDRESS) +
      '&email=' + encodeURIComponent(me.email || '');
    modal('<div class="modalhead"><h2>MoonPay</h2><button class="close">×</button></div>' +
      '<p>Buy USDT / crypto with card or bank transfer. Funds arrive to the NovaPay deposit address.</p>' +
      '<a class="primary full" href="' + esc(url) + '" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-top:12px">Open MoonPay</a>' +
      '<small style="display:block;margin-top:12px">After purchase, submit the transaction hash below. An admin credits your balance after confirming the deposit.</small>');
  } else if (id === 'googlepay') {
    modal('<div class="modalhead"><h2>Google Pay</h2><button class="close">×</button></div>' +
      '<p>Google Pay is available via MoonPay or partner on-ramps in supported countries (US, UK, CA, ZA, etc.).</p>' +
      '<a class="primary full" href="https://buy.moonpay.com?apiKey=' + encodeURIComponent(MOONPAY_API_KEY) + '&paymentMethod=google_pay" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-top:12px">Continue with Google Pay</a>');
  } else if (id === 'trust') {
    modal('<div class="modalhead"><h2>Trust Wallet</h2><button class="close">×</button></div>' +
      '<p>1. Open Trust Wallet<br>2. Send USDT / ETH / BNB / SOL to:</p>' +
      '<div class="ref"><span>' + esc(COMPANY_DEPOSIT_ADDRESS) + '</span><button class="secondary" id="copyTrust">Copy</button></div>' +
      '<p style="margin-top:12px">3. Come back and submit the transaction hash in the form below.</p>' +
      '<button class="primary full close">Got it</button>');
    setTimeout(() => {
      const b = document.getElementById('copyTrust');
      if (b) b.onclick = () => { navigator.clipboard.writeText(COMPANY_DEPOSIT_ADDRESS); toast('Copied'); };
    }, 50);
  } else {
    toast('Scroll down to submit your on-chain deposit');
  }
}

$('copyaddr').onclick = () => {
  navigator.clipboard.writeText($('depaddr').textContent);
  toast('Address copied');
};

$('verify').onclick = async () => {
  const network = $('network').value;
  const address = $('pub').value.trim();
  const txHash = $('tx').value.trim();
  if (!address || !txHash) return msg($('dmsg'), 'Enter sending address and TX hash', 'error');
  try {
    await addDoc(collection(db, 'blockchainDeposits'), {
      uid: me.uid,
      network,
      fromAddress: address,
      txHash,
      status: 'pending_review',
      createdAt: serverTimestamp()
    });
    await addDoc(collection(db, 'transactions'), {
      uid: me.uid,
      type: 'blockchain_deposit',
      status: 'pending_review',
      amountDisplay: 'Pending review',
      network,
      txHash,
      createdAt: serverTimestamp()
    });
    msg($('dmsg'), 'Deposit submitted. It will be credited after review.', 'success');
  } catch (x) { msg($('dmsg'), err(x), 'error'); }
};

function renderGifts() {
  const q = ($('giftsearch').value || '').toLowerCase();
  const r = $('giftregion').value;
  const list = GIFT_CARDS.filter(x =>
    (!q || x.brand.toLowerCase().includes(q)) && (!r || x.region === r)
  );
  $('gifts').innerHTML = list.map(x =>
    '<article class="card">' +
      '<div class="art">' + x.emoji + '</div>' +
      '<h4>' + esc(x.brand) + '</h4>' +
      '<small>' + esc(x.region) + '</small>' +
      '<div class="price">$' + DENOMS[0] + '–$' + DENOMS[DENOMS.length - 1] + '</div>' +
      '<button class="primary full" data-gift="' + x.id + '">Buy</button>' +
    '</article>'
  ).join('') || '<p style="padding:0 20px">No matches.</p>';
}
$('giftsearch').oninput = renderGifts;
$('giftregion').onchange = renderGifts;

function giftModal(id) {
  const g = GIFT_CARDS.find(x => x.id === id);
  if (!g) return;
  modal('<div class="modalhead"><h2>' + esc(g.brand) + ' (' + esc(g.region) + ')</h2><button class="close">×</button></div>' +
    '<p class="hint">Fulfilled via Tremendous. Paid from your USD balance.</p>' +
    '<label>Denomination (USD)</label>' +
    '<select id="gd">' + DENOMS.map(d => '<option value="' + d + '">$' + d + '</option>').join('') + '</select>' +
    '<label>Quantity</label>' +
    '<input id="gq" type="number" min="1" max="10" value="1">' +
    '<div id="ordertotal" class="quote"></div>' +
    '<div id="cm" class="status"></div>' +
    '<button id="confirmBtn" class="primary full">Pay from wallet</button>' +
    '<small>Codes are emailed / shown after fulfilment. Refunded if we cannot fulfil.</small>');
  const refresh = () => {
    const den = Number($('gd').value);
    const qty = Math.max(1, Math.floor(Number($('gq').value) || 1));
    const total = den * qty;
    $('ordertotal').textContent = 'Total: ' + moneyUSD(total) + ' · Wallet: ' + moneyUSD(balanceOf('USD'));
  };
  $('gd').onchange = refresh;
  $('gq').oninput = refresh;
  refresh();
  pendingAction = async () => {
    const den = Number($('gd').value);
    const qty = Math.max(1, Math.floor(Number($('gq').value) || 1));
    const total = den * qty;
    if (balanceOf('USD') < total) throw new Error('Insufficient USD balance');
    if (data.status === 'banned') throw new Error('Account banned');

    await updateDoc(doc(db, 'users', me.uid), {
      balanceUSD: increment(-total),
      updatedAt: serverTimestamp()
    });
    const orderRef = await addDoc(collection(db, 'orders'), {
      uid: me.uid,
      type: 'gift_card',
      brand: g.brand,
      region: g.region,
      denomination: den,
      quantity: qty,
      totalUSD: total,
      status: 'pending_fulfilment',
      provider: 'tremendous',
      createdAt: serverTimestamp()
    });
    await addDoc(collection(db, 'transactions'), {
      uid: me.uid,
      type: 'gift_card_purchase',
      status: 'pending_fulfilment',
      amountUSD: -total,
      amountDisplay: '-' + moneyUSD(total),
      orderId: orderRef.id,
      createdAt: serverTimestamp()
    });
    closeModal();
    toast('Order placed — ' + moneyUSD(total) + '. Code after fulfilment.');
  };
}

function renderMarket() {
  $('products').innerHTML = PRODUCTS.map(p =>
    '<article class="card">' +
      '<div class="art">' + p.emoji + '</div>' +
      '<h4>' + esc(p.name) + '</h4>' +
      '<div class="price">' + moneyUSD(p.priceUSD) + '</div>' +
      '<button class="primary full" data-prod="' + p.id + '">Order</button>' +
    '</article>'
  ).join('');
}

function productModal(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  modal('<div class="modalhead"><h2>' + esc(p.name) + '</h2><button class="close">×</button></div>' +
    '<label>Quantity</label>' +
    '<input id="sh_qty" type="number" min="1" max="5" value="1">' +
    '<label>Delivery name</label>' +
    '<input id="sh_name" maxlength="80" value="' + esc(data.displayName || '') + '">' +
    '<label>Phone</label>' +
    '<input id="sh_phone" type="tel" maxlength="30" value="' + esc(data.phone || '') + '">' +
    '<label>Delivery address</label>' +
    '<input id="sh_addr" maxlength="300" placeholder="Street, city, country">' +
    '<div id="ordertotal" class="quote"></div>' +
    '<div id="cm" class="status"></div>' +
    '<button id="confirmBtn" class="primary full">Pay from wallet</button>');
  const refresh = () => {
    const qty = Math.max(1, Math.floor(Number($('sh_qty').value) || 1));
    const total = p.priceUSD * qty;
    $('ordertotal').textContent = 'Total: ' + moneyUSD(total) + ' · Wallet: ' + moneyUSD(balanceOf('USD'));
  };
  $('sh_qty').oninput = refresh;
  refresh();
  pendingAction = async () => {
    const qty = Math.max(1, Math.floor(Number($('sh_qty').value) || 1));
    const total = p.priceUSD * qty;
    if (balanceOf('USD') < total) throw new Error('Insufficient USD balance');
    await updateDoc(doc(db, 'users', me.uid), {
      balanceUSD: increment(-total),
      updatedAt: serverTimestamp()
    });
    await addDoc(collection(db, 'orders'), {
      uid: me.uid,
      type: 'marketplace',
      productId: p.id,
      productName: p.name,
      quantity: qty,
      totalUSD: total,
      shipping: {
        name: $('sh_name').value.trim(),
        phone: $('sh_phone').value.trim(),
        address: $('sh_addr').value.trim()
      },
      status: 'pending_fulfilment',
      createdAt: serverTimestamp()
    });
    await addDoc(collection(db, 'transactions'), {
      uid: me.uid,
      type: 'marketplace_order',
      status: 'pending_fulfilment',
      amountUSD: -total,
      amountDisplay: '-' + moneyUSD(total),
      createdAt: serverTimestamp()
    });
    closeModal();
    toast('Order placed — ' + moneyUSD(total));
  };
}

let ws = null, series = [], feedId = 0, side = 'buy', lastPrice = 0;

function stopFeed() {
  feedId++;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

async function startTrade() {
  stopFeed();
  const myId = feedId;
  const sym = $('pair').value + 'USDT';
  const iv = $('interval').value;
  $('price').textContent = '…';
  $('priceChange').textContent = '';
  $('trademsg').className = 'status';
  loadOrders();

  try {
    const [klinesRes, tickerRes] = await Promise.all([
      fetch(BINANCE_REST + '/klines?symbol=' + sym + '&interval=' + iv + '&limit=100'),
      fetch(BINANCE_REST + '/ticker/24hr?symbol=' + sym)
    ]);
    if (!klinesRes.ok) throw new Error('Price feed unavailable');
    const klines = await klinesRes.json();
    series = klines.map(k => Number(k[4]));
    if (tickerRes.ok) {
      const t = await tickerRes.json();
      const pct = Number(t.priceChangePercent);
      const el = $('priceChange');
      el.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '% 24h';
      el.className = 'change ' + (pct >= 0 ? 'up' : 'down');
    }
  } catch (x) {
    return msg($('trademsg'), 'Live price feed is unavailable right now', 'error');
  }
  if (myId !== feedId) return;
  draw();
  renderOrderBook(sym);

  const socket = new WebSocket(BINANCE_WS + '/' + sym.toLowerCase() + '@kline_' + iv);
  ws = socket;
  socket.onmessage = e => {
    if (ws !== socket) return;
    const k = JSON.parse(e.data).k;
    const c = Number(k.c);
    series[series.length - 1] = c;
    if (k.x) {
      series.push(c);
      series = series.slice(-100);
    }
    draw();
  };
  socket.onclose = () => {
    if (ws === socket) {
      ws = null;
      setTimeout(() => {
        if ($('trade').classList.contains('active')) startTrade();
      }, 3000);
    }
  };
}

function draw() {
  const c = $('chart');
  if (!c || !c.clientWidth || !series.length) return;
  const ctx = c.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const w = c.clientWidth * dpr;
  const h = 280 * dpr;
  c.width = w;
  c.height = h;
  ctx.clearRect(0, 0, w, h);

  const mi = Math.min(...series);
  const ma = Math.max(...series);
  const range = ma - mi || 1;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(104,53,237,0.25)');
  grad.addColorStop(1, 'rgba(104,53,237,0)');

  ctx.beginPath();
  series.forEach((v, i) => {
    const x = i * w / (series.length - 1 || 1);
    const y = h - 24 - ((v - mi) / range) * (h - 48);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = '#6835ed';
  ctx.lineWidth = 2.2 * dpr;
  ctx.stroke();

  const lastX = (series.length - 1) * w / (series.length - 1 || 1);
  ctx.lineTo(lastX, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  lastPrice = series[series.length - 1];
  $('price').textContent = '$' + lastPrice.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: lastPrice < 10 ? 4 : 2
  });
  $('obMid').textContent = '$' + lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
  tradeEstimate();
}

async function renderOrderBook(sym) {
  try {
    const r = await fetch(BINANCE_REST + '/depth?symbol=' + sym + '&limit=5');
    if (!r.ok) return;
    const d = await r.json();
    $('asks').innerHTML = (d.asks || []).slice(0, 5).reverse().map(function(row) {
      return '<div>' + Number(row[0]).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
        ' <span style="opacity:.6">' + Number(row[1]).toFixed(4) + '</span></div>';
    }).join('');
    $('bids').innerHTML = (d.bids || []).slice(0, 5).map(function(row) {
      return '<div>' + Number(row[0]).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
        ' <span style="opacity:.6">' + Number(row[1]).toFixed(4) + '</span></div>';
    }).join('');
  } catch (_) {}
}

$('pair').onchange = startTrade;
$('interval').onchange = startTrade;

function setSide(s) {
  side = s;
  $('buy').classList.toggle('active', s === 'buy');
  $('sell').classList.toggle('active', s === 'sell');
  $('tradelabel').textContent = s === 'buy' ? 'USDT to spend' : $('pair').value + ' to sell';
  tradeEstimate();
}
$('buy').onclick = () => setSide('buy');
$('sell').onclick = () => setSide('sell');

function estimate() {
  const amt = Number($('tradeamt').value);
  if (!(amt > 0) || !lastPrice) return 0;
  const k = 1 - PLATFORM_FEE_PCT / 100;
  return side === 'buy' ? (amt * k) / lastPrice : amt * lastPrice * k;
}

function tradeEstimate() {
  const est = estimate();
  const sym = $('pair').value;
  const have = side === 'buy' ? balanceOf('USDT') : balanceOf(sym);
  let t = 'Available: ' + have.toFixed(side === 'buy' ? 2 : 8) + ' ' + (side === 'buy' ? 'USDT' : sym);
  if (est) t += ' · You get ≈ ' + est.toFixed(side === 'buy' ? 8 : 2) + ' ' + (side === 'buy' ? sym : 'USDT');
  if (lastPrice) t += ' · Fee ' + PLATFORM_FEE_PCT + '%';
  $('tradeinfo').textContent = t;
}
$('tradeamt').oninput = tradeEstimate;

$('tradebtn').onclick = async () => {
  try {
    if (data?.status === 'banned') throw new Error('Account banned');
    const amt = Number($('tradeamt').value);
    if (!(amt > 0)) throw new Error('Enter a valid amount');
    if (!lastPrice) throw new Error('Waiting for live price…');

    const sym = $('pair').value;
    const receive = estimate();

    if (side === 'buy') {
      if (balanceOf('USDT') < amt) throw new Error('Insufficient USDT');
      await updateDoc(doc(db, 'users', me.uid), {
        'assets.USDT': increment(-amt),
        ['assets.' + sym]: increment(receive),
        updatedAt: serverTimestamp()
      });
    } else {
      if (balanceOf(sym) < amt) throw new Error('Insufficient ' + sym);
      await updateDoc(doc(db, 'users', me.uid), {
        ['assets.' + sym]: increment(-amt),
        'assets.USDT': increment(receive),
        updatedAt: serverTimestamp()
      });
    }

    await addDoc(collection(db, 'transactions'), {
      uid: me.uid,
      type: side === 'buy' ? 'trade_buy' : 'trade_sell',
      status: 'filled',
      symbol: sym,
      side,
      amount: amt,
      price: lastPrice,
      receive,
      feePct: PLATFORM_FEE_PCT,
      amountDisplay: side === 'buy'
        ? '+' + receive.toFixed(8) + ' ' + sym
        : '+' + receive.toFixed(2) + ' USDT',
      createdAt: serverTimestamp()
    });

    msg($('trademsg'), 'Filled @ $' + lastPrice.toLocaleString() + '. You received ' + receive.toFixed(side === 'buy' ? 8 : 2) + ' ' + (side === 'buy' ? sym : 'USDT'), 'success');
    $('tradeamt').value = '';
    tradeEstimate();
    loadOrders();
  } catch (x) {
    msg($('trademsg'), err(x), 'error');
  }
};

async function loadOrders() {
  if (!me) return;
  try {
    const s = await getDocs(query(
      collection(db, 'transactions'),
      where('uid', '==', me.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    ));
    const rows = s.docs.map(d => d.data()).filter(x => String(x.type).startsWith('trade_')).slice(0, 12);
    $('orders').innerHTML = rows.map(x =>
      '<div class="row"><span><b>' + esc(String(x.type).replace('trade_', '').toUpperCase()) + ' ' + esc(x.symbol || '') +
      '</b><small> ' + esc(x.status) + '</small></span><b>' + esc(x.amountDisplay) + '</b></div>'
    ).join('') || '<p style="color:var(--muted)">No orders yet. Place your first market order above.</p>';
  } catch (x) {
    $('orders').innerHTML = '<p style="color:var(--muted)">Orders will appear here after you trade.</p>';
  }
}

let lastQuote = null;

$('quoteBtn').onclick = async () => {
  try {
    const from = $('from').value;
    const to = $('to').value;
    const amount = Number($('swapamt').value);
    if (from === to) throw new Error('Choose different assets');
    if (!(amount > 0)) throw new Error('Enter amount');

    const fromUSD = await assetToUSD(from, amount);
    const fee = fromUSD * (PLATFORM_FEE_PCT / 100);
    const netUSD = fromUSD - fee;
    const receive = await usdToAsset(to, netUSD);
    lastQuote = { from, to, amount, receive };
    $('quote').textContent = amount + ' ' + from + ' → ' + formatAmt(receive, to) + ' ' + to + ' (fee ' + PLATFORM_FEE_PCT + '%)';
    msg($('swapmsg'), '', '');
  } catch (x) {
    lastQuote = null;
    msg($('swapmsg'), err(x), 'error');
  }
};

$('swapBtn').onclick = async () => {
  const from = $('from').value;
  const to = $('to').value;
  const amount = Number($('swapamt').value);
  if (!lastQuote || lastQuote.from !== from || lastQuote.to !== to || lastQuote.amount !== amount) {
    return msg($('swapmsg'), 'Tap “Get quote” first', 'error');
  }
  try {
    if (data.status === 'banned') throw new Error('Account banned');
    if (balanceOf(from) < amount) throw new Error('Insufficient ' + from);

    const receive = lastQuote.receive;
    const updates = { updatedAt: serverTimestamp() };
    if (from === 'USD') updates.balanceUSD = increment(-amount);
    else if (from === 'NGN') updates.balanceNGN = increment(-amount);
    else updates['assets.' + from] = increment(-amount);

    if (to === 'USD') updates.balanceUSD = increment(receive);
    else if (to === 'NGN') updates.balanceNGN = increment(receive);
    else updates['assets.' + to] = increment(receive);

    await updateDoc(doc(db, 'users', me.uid), updates);
    await addDoc(collection(db, 'transactions'), {
      uid: me.uid,
      type: 'swap',
      status: 'completed',
      from, to, amount, receive,
      amountDisplay: amount + ' ' + from + ' → ' + formatAmt(receive, to) + ' ' + to,
      createdAt: serverTimestamp()
    });
    msg($('swapmsg'), 'Done: received ' + formatAmt(receive, to) + ' ' + to, 'success');
    lastQuote = null;
  } catch (x) {
    msg($('swapmsg'), err(x), 'error');
  }
};

async function assetToUSD(asset, amount) {
  if (asset === 'USD' || asset === 'USDT') return amount;
  if (asset === 'NGN') return amount / usdNgn;
  const price = await livePrice(asset);
  return amount * price;
}

async function usdToAsset(asset, usd) {
  if (asset === 'USD' || asset === 'USDT') return usd;
  if (asset === 'NGN') return usd * usdNgn;
  const price = await livePrice(asset);
  return usd / price;
}

async function livePrice(asset) {
  if (asset === 'USDT' || asset === 'USD') return 1;
  const r = await fetch(BINANCE_REST + '/ticker/price?symbol=' + asset + 'USDT');
  if (!r.ok) throw new Error('Price unavailable');
  const p = Number((await r.json()).price);
  if (!(p > 0)) throw new Error('Price unavailable');
  return p;
}

function formatAmt(n, asset) {
  if (asset === 'USD' || asset === 'USDT' || asset === 'NGN') return Number(n).toFixed(2);
  return Number(n).toFixed(8);
}

const WD_NETS = {
  USD: ['Bank transfer (USD)', 'PayPal'],
  NGN: ['Bank transfer (NGN)'],
  USDT: ['ERC20', 'BEP20', 'Polygon', 'TRC20'],
  BTC: ['Bitcoin'],
  ETH: ['Ethereum'],
  BNB: ['BNB Smart Chain'],
  SOL: ['Solana']
};

function fillNetworks() {
  const a = $('wa').value;
  $('wn').innerHTML = (WD_NETS[a] || ['Other']).map(n => '<option>' + n + '</option>').join('');
  $('wdlabel').textContent = (a === 'USD' || a === 'NGN')
    ? 'Bank / account details'
    : 'Wallet address';
  updateWithdrawBalance();
}
function updateWithdrawBalance() {
  if (data) $('wbal').textContent = '(available ' + formatAmt(balanceOf($('wa').value), $('wa').value) + ' ' + $('wa').value + ')';
}
$('wa').onchange = fillNetworks;

$('withdrawBtn').onclick = async () => {
  try {
    const asset = $('wa').value;
    const amount = Number($('wam').value);
    const dest = $('wd').value.trim();
    if (!(amount > 0)) throw new Error('Enter amount');
    if (!dest) throw new Error('Enter destination');
    if (balanceOf(asset) < amount) throw new Error('Insufficient ' + asset);
    const usdVal = await assetToUSD(asset, amount);
    if (usdVal < 10) throw new Error('Minimum withdrawal is $10 equivalent');

    const updates = { updatedAt: serverTimestamp() };
    if (asset === 'USD') updates.balanceUSD = increment(-amount);
    else if (asset === 'NGN') updates.balanceNGN = increment(-amount);
    else updates['assets.' + asset] = increment(-amount);

    await updateDoc(doc(db, 'users', me.uid), updates);
    const wRef = await addDoc(collection(db, 'withdrawals'), {
      uid: me.uid,
      asset,
      network: $('wn').value,
      amount,
      destination: dest,
      status: 'pending_review',
      createdAt: serverTimestamp()
    });
    await addDoc(collection(db, 'transactions'), {
      uid: me.uid,
      type: 'withdrawal',
      status: 'pending_review',
      amount,
      asset,
      amountDisplay: '-' + formatAmt(amount, asset) + ' ' + asset,
      withdrawalId: wRef.id,
      createdAt: serverTimestamp()
    });
    $('wp').value = '';
    msg($('wmsg'), 'Withdrawal submitted (ref ' + wRef.id.slice(0, 8) + '…). Amount on hold until processed.', 'success');
  } catch (x) {
    msg($('wmsg'), err(x), 'error');
  }
};

$('save').onclick = async () => {
  try {
    const name = $('pn').value.trim();
    if (!name) throw new Error('Name is required');
    await updateDoc(doc(db, 'users', me.uid), {
      displayName: name,
      updatedAt: serverTimestamp()
    });
    await updateProfile(me, { displayName: name });
    toast('Profile saved');
  } catch (x) { toast(err(x)); }
};

$('logout').onclick = () => signOut(auth);

$('pass').onclick = () => {
  modal('<div class="modalhead"><h2>Transaction passcode</h2><button class="close">×</button></div>' +
    '<label>New passcode (4–8 digits)</label>' +
    '<input id="newpass" type="password" inputmode="numeric" maxlength="8" placeholder="••••">' +
    '<button id="savepass" class="primary full">Save</button>' +
    '<div id="passmsg" class="status"></div>' +
    '<small>Used when requesting withdrawals. Stored on this device for the Spark build.</small>');
  $('savepass').onclick = () => {
    const p = $('newpass').value;
    if (!/^\d{4,8}$/.test(p)) return msg($('passmsg'), 'Use 4–8 digits', 'error');
    localStorage.setItem('np_pass_' + me.uid, p);
    updateDoc(doc(db, 'users', me.uid), { hasPasscode: true }).catch(() => {});
    msg($('passmsg'), 'Passcode saved on this device', 'success');
  };
};

$('copy').onclick = () => {
  navigator.clipboard.writeText($('ref').textContent);
  toast('Invitation link copied');
};

$('history').onclick = () => page('historyPage');


async function loadPendingDeposits() {
  const panel = $('pendingPanel');
  const list = $('pendingList');
  if (!panel || !list || !me) return;
  try {
    const s = await getDocs(query(
      collection(db, 'deposits'),
      where('uid', '==', me.uid),
      where('status', '==', 'pending_review'),
      orderBy('createdAt', 'desc'),
      limit(20)
    ));
    if (s.empty) {
      panel.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    panel.classList.remove('hidden');
    list.innerHTML = s.docs.map(d => {
      const x = d.data();
      const when = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toLocaleString() : '';
      return '<div class="pending-row">' +
        '<div><b>' + esc((x.provider || 'deposit').toUpperCase()) + '</b>' +
        '<span class="badge badge-pending">pending</span>' +
        '<small>Ref: ' + esc(x.reference || d.id.slice(0, 10)) + ' · ' + esc(when) + '</small></div>' +
        '<div class="amt">' + moneyUSD(x.amountUSD) + '</div></div>';
    }).join('');
  } catch (e) {
    // Missing composite index — show friendly fallback
    try {
      const s2 = await getDocs(query(
        collection(db, 'deposits'),
        where('uid', '==', me.uid),
        limit(30)
      ));
      const pending = s2.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(x => x.status === 'pending_review')
        .slice(0, 20);
      if (!pending.length) {
        panel.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      panel.classList.remove('hidden');
      list.innerHTML = pending.map(x => {
        const when = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toLocaleString() : '';
        return '<div class="pending-row">' +
          '<div><b>' + esc((x.provider || 'deposit').toUpperCase()) + '</b>' +
          '<span class="badge badge-pending">pending</span>' +
          '<small>Ref: ' + esc(x.reference || x.id.slice(0, 10)) + ' · ' + esc(when) + '</small></div>' +
          '<div class="amt">' + moneyUSD(x.amountUSD) + '</div></div>';
      }).join('');
    } catch (e2) {
      panel.classList.add('hidden');
    }
  }
}

async function loadHistory() {
  try {
    const s = await getDocs(query(
      collection(db, 'transactions'),
      where('uid', '==', me.uid),
      orderBy('createdAt', 'desc'),
      limit(80)
    ));
    $('historyList').innerHTML = s.docs.map(d => {
      const x = d.data();
      const when = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toLocaleString() : '';
      const st = String(x.status || '');
      let badge = '';
      if (st === 'pending_review' || st === 'pending_fulfilment') badge = '<span class="badge badge-pending">' + esc(st.replace(/_/g, ' ')) + '</span>';
      else if (st === 'completed' || st === 'filled') badge = '<span class="badge badge-completed">' + esc(st) + '</span>';
      else if (st === 'failed' || st === 'rejected') badge = '<span class="badge badge-failed">' + esc(st) + '</span>';
      else if (st) badge = '<span class="badge">' + esc(st) + '</span>';
      return '<div class="row"><span><b>' + esc(String(x.type).replace(/_/g, ' ')) +
        '</b>' + badge + '<small> ' + esc(when) + '</small></span><b>' +
        esc(x.amountDisplay || '') + '</b></div>';
    }).join('') || '<p>No transactions yet.</p>';
  } catch (x) {
    $('historyList').innerHTML = '<p>No transactions yet. (Create a Firestore composite index on transactions: uid ASC, createdAt DESC if prompted.)</p>';
  }
}

$('bell').onclick = async () => {
  modal('<div class="modalhead"><h2>Notifications</h2><button class="close">×</button></div><div id="notes">Loading…</div>');
  try {
    const s = await getDocs(query(
      collection(db, 'notifications'),
      where('uid', '==', me.uid),
      orderBy('createdAt', 'desc'),
      limit(30)
    ));
    $('notes').innerHTML = s.docs.map(d => {
      const x = d.data();
      const when = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toLocaleDateString() : '';
      return '<div class="row"><span>' + esc(x.message) + '</span><small>' + esc(when) + '</small></div>';
    }).join('') || '<p>Nothing yet.</p>';
  } catch (_) {
    $('notes').innerHTML = '<p>No notifications yet.</p>';
  }
};

$('care').onclick = () => {
  const links = [['Telegram', SUPPORT.telegram], ['Twitter / X', SUPPORT.x], ['TikTok', SUPPORT.tiktok]]
    .filter(l => /^https:\/\//.test(l[1]))
    .map(l => '<a class="secondary full" href="' + esc(l[1]) + '" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-top:8px">' + l[0] + '</a>')
    .join('');
  modal('<div class="modalhead"><h2>NovaPay Support</h2><button class="close">×</button></div>' +
    '<div class="chat">' +
      '<div id="messages" class="messages"><div class="bubble bot">Hi! Ask about funding, withdrawals, trading, gift cards or security.</div></div>' +
      '<div class="chatinput"><input id="cq" placeholder="Type a question"><button id="send" class="primary">Send</button></div>' +
    '</div>' + links);
  $('send').onclick = sendChat;
  $('cq').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
};

function addBubble(cls, text) {
  const d = document.createElement('div');
  d.className = 'bubble ' + cls;
  d.textContent = text;
  $('messages').appendChild(d);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function sendChat() {
  const q = $('cq') && $('cq').value.trim();
  if (!q) return;
  addBubble('me', q);
  $('cq').value = '';
  setTimeout(() => addBubble('bot', careReply(q)), 280);
}

function careReply(q) {
  q = q.toLowerCase();
  if (q.includes('withdraw')) return 'Withdrawals need a destination and are at least $10 equivalent. They are reviewed before payout; funds are held while pending.';
  if (q.includes('gift') || q.includes('tremendous')) return 'Open Gift Cards, pick a brand and denomination, and pay from your USD wallet. Codes are delivered after Tremendous fulfilment.';
  if (q.includes('trade') || q.includes('swap')) return 'Trading uses live Binance prices. Market orders fill instantly against your wallet balances plus a small fee.';
  if (q.includes('deposit') || q.includes('fund') || q.includes('moonpay')) return 'Fiat: Paystack, Flutterwave or Kora. After you pay, the deposit is pending until an admin confirms it and credits your USD balance. Crypto: MoonPay, Google Pay, Trust Wallet, or on-chain (also reviewed).';
  if (q.includes('password')) return 'Use “Forgot password?” on the login page.';
  if (q.includes('currency') || q.includes('usd') || q.includes('balance')) return 'Your main balance is in USD by default. You can also hold NGN and crypto (USDT, BTC, ETH, BNB, SOL).';
  return 'For account-specific help, use the support links below. Never share your password, seed phrase or private key.';
}
