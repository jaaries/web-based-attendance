// firebase_config.js
const firebaseConfig = {
  apiKey: "AIzaSyBI8z4HOSphuI-Jy0GppP3Yfk5uOSiTVDU",
  authDomain: "blueteamsports.firebaseapp.com",
  databaseURL: "https://blueteamsports-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "blueteamsports",
  storageBucket: "blueteamsports.appspot.com", // ✅ FIXED
  messagingSenderId: "892636741727",
  appId: "1:892636741727:web:e693829da136b1a2429bea",
  measurementId: "G-V0D2V2L2N8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
console.log("🔥 Firebase initialized!");
