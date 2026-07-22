export const CONFIG = {
  CLOUDINARY: {
    cloudName: 'qgbhjuse',          // Replace with your Cloudinary cloud name
    uploadPreset: 'vibeloop_uploads' // Replace with your unsigned preset
  },
  FIREBASE: {
    apiKey: 'AIzaSyCr1IkJ6_SMhTJvY3K3GG6SoIRe1LOZ0nQ',
    authDomain: 'vibeloop-44c45.firebaseapp.com',
    projectId: 'vibeloop-44c45',
    storageBucket: 'vibeloop-44c45.appspot.com',
    messagingSenderId: '776248914692',
    appId: '1:776248914692:web:b883192e8498e5a5351651'
  },
  APP: {
    maxUploadSize: 200 * 1024 * 1024,
    storyDuration: 24 * 60 * 60 * 1000,
    maxStoriesPerDay: 20,
    maxUploadsPerHour: 10,
    maxCommentsPerMinute: 30,
    feedPageSize: 15
  },
  NOTIFICATIONS: {
    vapidKey: 'YOUR_VAPID_KEY' // Replace with your Firebase Cloud Messaging VAPID key
  }
};
