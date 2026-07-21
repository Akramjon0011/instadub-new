import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';

// Ensure initialized
const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'ornate-loader-471914-h0';
if (!getApps().length) {
  initializeApp({
    projectId: projectId,
  });
}

// Limits per day
const LIMITS = {
  analyze: 20,
  tts: 50
};

export async function enforceRateLimit(uid: string, type: 'analyze' | 'tts'): Promise<void> {
  const db = getFirestore();
  const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const limitRef = db.collection('apiUsage').doc(`${uid}_${dateStr}`);

  await db.runTransaction(async (t) => {
    const doc = await t.get(limitRef);
    let count = 0;
    if (doc.exists) {
      const data = doc.data();
      count = data?.[type] || 0;
    }

    if (count >= LIMITS[type]) {
      throw new Error(`Kunlik limit tugadi. Siz bugun ${LIMITS[type]} marta ${type} xizmatidan foydalandingiz.`);
    }

    t.set(limitRef, {
      [type]: count + 1,
      lastUpdated: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}
