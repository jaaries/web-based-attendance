// Load students list from Realtime DB and wire autocomplete + QR scan/upload logic

const studentNames = [];
const input = document.getElementById('studentName');
const suggestionsEl = document.getElementById('nameSuggestions');
const submitBtn = document.querySelector('#attendanceForm button[type="submit"]');
const video = document.getElementById('cameraStream');
const canvas = document.getElementById('qrCanvas');
const ctx = canvas.getContext ? canvas.getContext('2d') : null;

let currentStream = null;
let scanning = false;
const PENDING_KEY = 'pendingAttendance';

// disable submit until names load
if (submitBtn) submitBtn.disabled = true;

function normalizeName(s) { return (s||'').toString().replace(/\s+/g,' ').trim().toLowerCase(); }
function clearSuggestions(){ suggestionsEl.innerHTML=''; suggestionsEl.style.display='none'; }
function loadPending(){ try { return JSON.parse(localStorage.getItem(PENDING_KEY)||'[]'); } catch(e){ return []; } }
function savePending(arr){ localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); }

function addPending(entry){
  const a = loadPending();
  a.push(entry);
  savePending(a);
  console.log('Saved pending entry', entry);
}

// attempt to sync pending entries (to repUrl if given in entry, otherwise Firebase if online)
async function syncPending(){
  const pending = loadPending();
  if (!pending.length) return;
  console.log('Attempting to sync', pending.length, 'pending entries');
  const remaining = [];
  for (const entry of pending){
    let ok = false;
    // if repUrl present try POST to representative device
    if (entry.repUrl) {
      try {
        const res = await fetch(entry.repUrl, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(entry)
        });
        if (res.ok) ok = true;
        else console.warn('repUrl responded not ok', res.status);
      } catch (err) {
        console.warn('Failed to POST to repUrl', err);
      }
    }
    // fallback: upload directly to Firebase if online and firebase initialized
    if (!ok && navigator.onLine && window.firebase && firebase.database) {
      try {
        const ref = firebase.database().ref('attendance').push();
        await ref.set(entry);
        ok = true;
      } catch (err) {
        console.warn('Firebase upload failed', err);
      }
    }
    if (!ok) remaining.push(entry);
  }
  savePending(remaining);
  console.log('Sync complete. remaining', remaining.length);
}

// Stop video tracks
function stopStream(){
  scanning = false;
  if (currentStream){
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  try { video.srcObject = null; } catch(e){}
  document.getElementById('cameraContainer').style.display = 'none';
}

// start camera for scanning and return when QR decoded (returns decoded text)
async function startScan(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia not supported');
  document.getElementById('cameraContainer').style.display = 'block';
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' }});
  currentStream = stream;
  video.srcObject = stream;
  await video.play();
  scanning = true;

  return await new Promise((resolve, reject) => {
    const tick = () => {
      if (!scanning) return reject(new Error('scan stopped'));
      if (!ctx) return reject(new Error('no canvas context'));
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (canvas.width === 0 || canvas.height === 0) {
        requestAnimationFrame(tick); return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          stopStream();
          return resolve(code.data);
        }
      } catch (err) {
        console.warn('scan frame error', err);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // timeout after 30s
    setTimeout(()=> {
      if (scanning) {
        stopStream();
        reject(new Error('QR scan timeout'));
      }
    }, 30000);
  });
}

// submit handler: validate name then start scan and save/upload attendance
document.getElementById('attendanceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = input.value.trim();
  if (!name) { alert('Please enter your name.'); return; }
  const found = studentNames.some(n => normalizeName(n) === normalizeName(name));
  if (!found) { alert('Name not found in the students list. Please select a suggested name.'); return; }

  try {
    const qrText = await startScan();
    console.log('QR decoded:', qrText);
    let qrJson = null;
    try { qrJson = JSON.parse(qrText); } catch(e){ /* not JSON */ }

    // Build attendance entry
    const entry = {
      name,
      time: (qrJson && qrJson.timestamp) ? qrJson.timestamp : new Date().toISOString(),
      repId: (qrJson && qrJson.repId) ? qrJson.repId : null,
      sessionId: (qrJson && qrJson.sessionId) ? qrJson.sessionId : null,
      repUrl: (qrJson && qrJson.repUrl) ? qrJson.repUrl : null,
      rawQr: qrText
    };

    // If QR contains wifi info show it so user can connect manually (browsers cannot auto-join)
    if (qrJson && qrJson.wifi) {
      const s = qrJson.wifi;
      alert('Representative hotspot info:\nSSID: ' + (s.ssid||'') + '\nPassword: ' + (s.password||'') + '\n\nPlease connect to this hotspot then the app will attempt to send your attendance automatically.');
    }

    // Try immediate upload to repUrl if present
    let uploaded = false;
    if (entry.repUrl) {
      try {
        const res = await fetch(entry.repUrl, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(entry)
        });
        if (res.ok) {
          uploaded = true;
          alert('Attendance sent to representative successfully.');
        } else {
          console.warn('rep returned', res.status);
        }
      } catch (err) {
        console.warn('Failed to send to rep', err);
      }
    }

    // Fallback: if online, try write directly to Firebase
    if (!uploaded && navigator.onLine && window.firebase && firebase.database) {
      try {
        await firebase.database().ref('attendance').push(entry);
        uploaded = true;
        alert('Attendance uploaded to server.');
      } catch (err) {
        console.warn('Firebase direct upload failed', err);
      }
    }

    if (!uploaded) {
      addPending(entry);
      alert('Attendance saved locally and will be retried automatically.');
    }

    // attempt to sync any pending items now (best-effort)
    await syncPending();

  } catch (err) {
    console.error('Scan/upload error:', err);
    alert('Failed to scan QR or send attendance: ' + (err && err.message ? err.message : err));
  }
});

// fetch students once and wire autocomplete
firebase.database().ref('students').once('value')
  .then(snapshot => {
    snapshot.forEach(child => {
      const v = child.val() || {};
      const name = (v.name || v.fullName || v.studentName || '').toString().trim();
      if (name) studentNames.push(name);
    });
  })
  .catch(err => console.error('Failed to load students:', err))
  .finally(() => {
    if (submitBtn) submitBtn.disabled = false;
    console.log('students loaded:', studentNames.length);
  });

input.addEventListener('input', () => {
  const q = input.value.trim();
  if (!q) { clearSuggestions(); return; }
  const matches = studentNames.filter(n => normalizeName(n).includes(normalizeName(q))).slice(0,10);
  suggestionsEl.innerHTML = '';
  if (!matches.length) { suggestionsEl.style.display='none'; return; }
  matches.forEach(m => {
    const li = document.createElement('li');
    li.className='list-group-item list-group-item-action';
    li.textContent = m;
    li.style.cursor='pointer';
    li.addEventListener('click', ()=> { input.value = m; clearSuggestions(); input.focus(); });
    suggestionsEl.appendChild(li);
  });
  suggestionsEl.style.display='block';
});

document.addEventListener('click', e => { if (e.target !== input) clearSuggestions(); });

// try to sync pending when page loads and when network returns
window.addEventListener('load', () => { syncPending(); });
window.addEventListener('online', () => { syncPending(); });
window.addEventListener('beforeunload', () => stopStream());