const express = require('express');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // put downloaded service account JSON here

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://blueteamsports-default-rtdb.asia-southeast1.firebasedatabase.app' // update if needed
});

const db = admin.database();
const app = express();
app.use(express.json());

app.post('/upload', async (req, res) => {
  try {
    const entry = req.body;
    console.log('Received attendance:', entry);
    const ref = db.ref('attendance').push();
    await ref.set({ ...entry, receivedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    console.error('Upload failed', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Firebase forwarder listening on ${PORT}`));