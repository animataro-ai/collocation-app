export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: "collocation-apps.firebaseapp.com",
    databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: "collocation-apps.firebasestorage.app",
    messagingSenderId: "1064905019273",
    appId: "1:1064905019273:web:87a728657fe1d9f1b65b58"
  });
}
