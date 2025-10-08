const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const STORE = path.join(__dirname, 'received_attendance.json');
const STATUS_HTML = path.join(__dirname, 'status.html');

let admin = null;
let db = null;

// try to load service account to enable Firebase forwarding
try {
  const serviceAccount = require('./serviceAccountKey.json');
  const adminPkg = require('firebase-admin');
  adminPkg.initializeApp({
    credential: adminPkg.credential.cert(serviceAccount),
    databaseURL: 'https://blueteamsports-default-rtdb.asia-southeast1.firebasedatabase.app'
  });
  admin = adminPkg;
  db = admin.database();
  console.log('Firebase admin initialized.');
} catch (err) {
  console.log('Firebase admin not initialized (serviceAccountKey.json not found or invalid). Running in file-store mode.');
}

function readStore() {
  try {
    const raw = fs.readFileSync(STORE, 'utf8') || '[]';
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}
function writeStore(arr) {
  fs.writeFileSync(STORE, JSON.stringify(arr, null, 2), 'utf8');
}
function appendEntry(entry) {
  const arr = readStore();
  arr.push({ receivedAt: new Date().toISOString(), entry });
  writeStore(arr);
}

// Public endpoints

// receive attendance from student
app.post('/upload', (req, res) => {
  const entry = req.body;
  console.log('Received upload:', entry);
  appendEntry(entry);

  // if firebase available, try to immediately forward
  (async () => {
    if (db) {
      try {
        await db.ref('attendance').push({ ...entry, receivedAt: new Date().toISOString() });
        console.log('Forwarded to Firebase.');
      } catch (e) {
        console.warn('Forward to Firebase failed:', e.message || e);
      }
    }
  })();

  res.json({ ok: true });
});

// list stored entries
app.get('/list', (req, res) => {
  res.json(readStore());
});

// forward all entries to Firebase (requires service account)
app.post('/forward', async (req, res) => {
  if (!db) return res.status(400).json({ ok: false, error: 'Firebase not configured on this server.' });
  const arr = readStore();
  const results = [];
  for (const item of arr) {
    try {
      await db.ref('attendance').push({ ...item.entry, receivedAt: item.receivedAt });
      results.push({ ok: true });
    } catch (e) {
      results.push({ ok: false, error: e.message || e });
    }
  }
  // clear store only for entries that were successfully forwarded
  // simple approach: if every push ok => clear file
  const allOk = results.every(r => r.ok);
  if (allOk) writeStore([]);
  res.json({ ok: true, forwarded: results.length, results });
});

// serve status UI
app.get('/', (req, res) => {
  res.sendFile(STATUS_HTML);
});

// serve static assets if any
app.use('/static', express.static(path.join(__dirname, 'static')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rep server listening on port ${PORT}`));