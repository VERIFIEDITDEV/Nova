/**
 * NovaPay Admin — Spark plan (client-side, same Firebase project)
 * Put your admin Auth UID(s) in ADMIN_UIDS below AND in firestore.rules isAdmin().
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, updateDoc, collection, query, where, orderBy, limit, getDocs,
  addDoc, serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC1TfGUijMt5udy44nfaufnHrtnv-oLdz8',
  authDomain: 'usdt-invest-2209.firebaseapp.com',
  projectId: 'usdt-invest-2209',
  storageBucket: 'usdt-invest-2209.firebasestorage.app',
  messagingSenderId: '168346609720',
  appId: '1:168346609720:web:7e135d2ecf104fe539decd'
};

// *** ADD YOUR ADMIN UID(S) HERE (Authentication → Users → User UID) ***
const ADMIN_UIDS = [
  // 'PASTE_YOUR_UID_HERE'
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

function isAdmin(u) {
  if (!u) return false;
  if (!ADMIN_UIDS.length) {
    console.warn('ADMIN_UIDS is empty — add your UID in admin.js');
    return false;
  }
  return ADMIN_UIDS.includes(u.uid);
}

onAuthStateChanged(auth, async u => {
  if (!u) {
    $('loginBox').classList.remove('hidden');
    $('adminApp').classList.add('hidden');
    return;
  }
  if (ADMIN_UIDS.length && !ADMIN_UIDS.includes(u.uid)) {
    $('loginMsg').textContent = 'Signed in but not an admin UID. Add your UID to ADMIN_UIDS in admin.js and firestore.rules.';
    await signOut(auth);
    return;
  }
  $('loginBox').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  loadPending();
  loadWithdrawals();
  loadUsers();
});

$('loginBtn').onclick = async () => {
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value);
  } catch (e) {
    $('loginMsg').textContent = e.message || 'Login failed';
  }
};
$('logoutBtn').onclick = () => signOut(auth);

document.querySelectorAll('.tabs button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ['pending','withdrawals','users','credit'].forEach(t => {
      const el = $('tab-' + t);
      if (el) el.classList.toggle('hidden', t !== b.dataset.tab);
    });
  };
});

async function loadPending() {
  const el = $('pendingList');
  try {
    const s = await getDocs(query(collection(db, 'deposits'), where('status', '==', 'pending_review'), limit(50)));
    const s2 = await getDocs(query(collection(db, 'blockchainDeposits'), where('status', '==', 'pending_review'), limit(50)));
    const rows = [];
    s.forEach(d => rows.push({ id: d.id, col: 'deposits', ...d.data() }));
    s2.forEach(d => rows.push({ id: d.id, col: 'blockchainDeposits', ...d.data() }));
    if (!rows.length) { el.innerHTML = '<p class="muted">No pending deposits.</p>'; return; }
    el.innerHTML = '<table><tr><th>User</th><th>Amount</th><th>Type</th><th></th></tr>' +
      rows.map(r => '<tr><td>' + (r.uid || '').slice(0, 10) + '…</td><td>$' + Number(r.amountUSD || 0).toFixed(2) +
        '</td><td>' + (r.provider || r.network || r.col) + '</td><td class="row-actions">' +
        '<button data-approve="' + r.col + '/' + r.id + '" data-uid="' + r.uid + '" data-amt="' + (r.amountUSD || 0) + '">Approve + credit</button>' +
        '<button data-reject="' + r.col + '/' + r.id + '">Reject</button></td></tr>').join('') + '</table>';
  } catch (e) {
    el.innerHTML = '<p class="muted">Need admin read rules / index. ' + e.message + '</p>';
  }
}

async function loadWithdrawals() {
  const el = $('wdList');
  try {
    const s = await getDocs(query(collection(db, 'withdrawals'), where('status', '==', 'pending_review'), limit(50)));
    if (s.empty) { el.innerHTML = '<p class="muted">No pending withdrawals.</p>'; return; }
    el.innerHTML = '<table><tr><th>User</th><th>Amount</th><th>Dest</th><th></th></tr>' +
      s.docs.map(d => {
        const r = d.data();
        return '<tr><td>' + (r.uid || '').slice(0, 10) + '…</td><td>$' + Number(r.amountUSD || 0).toFixed(2) +
          ' ' + (r.asset || '') + '</td><td>' + (r.destination || r.email || '').toString().slice(0, 16) +
          '</td><td class="row-actions"><button data-wd-done="' + d.id + '">Mark paid</button>' +
          '<button data-wd-reject="' + d.id + '" data-uid="' + r.uid + '" data-amt="' + (r.amountUSD || 0) + '" data-asset="' + (r.asset || 'USDT') + '">Reject + refund</button></td></tr>';
      }).join('') + '</table>';
  } catch (e) {
    el.innerHTML = '<p class="muted">' + e.message + '</p>';
  }
}

async function loadUsers() {
  const el = $('userList');
  try {
    const s = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(30)));
    el.innerHTML = '<table><tr><th>Name</th><th>Email</th><th>Status</th><th>Cash</th><th>Refs</th></tr>' +
      s.docs.map(d => {
        const r = d.data();
        const cash = Number(r.balanceUSD || 0) + Number(r.assets?.USDT || 0);
        return '<tr><td>' + (r.displayName || '') + '</td><td>' + (r.email || '') + '</td><td>' +
          (r.status || '') + '</td><td>$' + cash.toFixed(2) + '</td><td>' + (r.referralCount || 0) + '</td></tr>';
      }).join('') + '</table>';
  } catch (e) {
    el.innerHTML = '<p class="muted">List users needs admin rule. ' + e.message + '</p>';
  }
}

document.addEventListener('click', async e => {
  const ap = e.target.closest('[data-approve]');
  if (ap) {
    const [col, id] = ap.dataset.approve.split('/');
    const uid = ap.dataset.uid;
    const amt = Number(ap.dataset.amt || 0);
    if (!uid || !(amt > 0)) return alert('Missing uid/amount — credit manually');
    if (!confirm('Credit $' + amt + ' to user and mark completed?')) return;
    await updateDoc(doc(db, 'users', uid), {
      balanceUSD: increment(amt),
      updatedAt: serverTimestamp()
    });
    await updateDoc(doc(db, col, id), { status: 'completed', completedAt: serverTimestamp() });
    await addDoc(collection(db, 'transactions'), {
      uid,
      type: 'deposit_admin_credit',
      status: 'completed',
      amountUSD: amt,
      amountDisplay: '+$' + amt.toFixed(2),
      receiptId: 'AD_' + Date.now().toString(36).toUpperCase(),
      createdAt: serverTimestamp()
    });
    alert('Credited');
    loadPending();
  }
  const rj = e.target.closest('[data-reject]');
  if (rj) {
    const [col, id] = rj.dataset.reject.split('/');
    await updateDoc(doc(db, col, id), { status: 'rejected', updatedAt: serverTimestamp() });
    loadPending();
  }
  const wd = e.target.closest('[data-wd-done]');
  if (wd) {
    await updateDoc(doc(db, 'withdrawals', wd.dataset.wdDone), { status: 'completed', completedAt: serverTimestamp() });
    loadWithdrawals();
  }
  const wr = e.target.closest('[data-wd-reject]');
  if (wr) {
    const uid = wr.dataset.uid;
    const amt = Number(wr.dataset.amt || 0);
    if (uid && amt > 0) {
      await updateDoc(doc(db, 'users', uid), { balanceUSD: increment(amt), updatedAt: serverTimestamp() });
    }
    await updateDoc(doc(db, 'withdrawals', wr.dataset.wdReject), { status: 'rejected', updatedAt: serverTimestamp() });
    loadWithdrawals();
  }
});

$('creditBtn').onclick = async () => {
  const uid = $('cUid').value.trim();
  const amt = Number($('cAmt').value);
  if (!uid || !(amt > 0)) return $('creditMsg').textContent = 'UID and amount required';
  try {
    await updateDoc(doc(db, 'users', uid), { balanceUSD: increment(amt), updatedAt: serverTimestamp() });
    await addDoc(collection(db, 'transactions'), {
      uid,
      type: 'admin_manual_credit',
      status: 'completed',
      amountUSD: amt,
      amountDisplay: '+$' + amt.toFixed(2),
      note: $('cNote').value.trim(),
      receiptId: 'MC_' + Date.now().toString(36).toUpperCase(),
      createdAt: serverTimestamp()
    });
    $('creditMsg').textContent = 'Credited $' + amt.toFixed(2);
  } catch (e) {
    $('creditMsg').textContent = e.message;
  }
};

$('creditCryptoBtn').onclick = async () => {
  const uid = $('cUid').value.trim();
  const asset = $('cAsset').value;
  const amt = Number($('cCryptoAmt').value);
  if (!uid || !asset || !(amt > 0)) return $('creditMsg').textContent = 'UID, asset, amount required';
  try {
    await updateDoc(doc(db, 'users', uid), {
      ['assets.' + asset]: increment(amt),
      updatedAt: serverTimestamp()
    });
    await addDoc(collection(db, 'transactions'), {
      uid,
      type: 'admin_crypto_credit',
      status: 'completed',
      amountDisplay: '+' + amt + ' ' + asset,
      receiptId: 'MC_' + Date.now().toString(36).toUpperCase(),
      createdAt: serverTimestamp()
    });
    $('creditMsg').textContent = 'Credited ' + amt + ' ' + asset;
  } catch (e) {
    $('creditMsg').textContent = e.message;
  }
};
