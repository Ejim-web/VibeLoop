importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyCr1IkJ6_SMhTJvY3K3GG6SoIRe1LOZ0nQ",
  authDomain: "vibeloop-44c45.firebaseapp.com",
  projectId: "vibeloop-44c45",
  storageBucket: "vibeloop-44c45.appspot.com",
  messagingSenderId: "776248914692",
  appId: "1:776248914692:web:b883192e8498e5a5351651"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  self.registration.showNotification(payload.notification.title, { body: payload.notification.body, icon: '/icon.png' });
});
