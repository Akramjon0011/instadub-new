import { doc, getDoc, setDoc, updateDoc, collection, serverTimestamp, getDocs, query, orderBy } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';

export const initializeUser = async () => {
  if (!auth.currentUser) return;
  const userRef = doc(db, 'users', auth.currentUser.uid);
  const isAdmin = auth.currentUser.email === 'optimbazar@gmail.com';
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        email: auth.currentUser.email || '',
        credits: isAdmin ? 9999 : 3, // Freemium starting credits
        role: isAdmin ? 'admin' : 'user',
        plan: 'free',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else if (isAdmin) {
      // Ensure admin has credits explicitly setup if needed
      if (snap.data().role !== 'admin' || snap.data().credits < 9000 || !snap.data().plan) {
        await updateDoc(userRef, {
          role: 'admin',
          credits: 9999,
          plan: 'creator',
          updatedAt: serverTimestamp()
        });
      }
    } else if (!snap.data().plan) {
       await updateDoc(userRef, {
          plan: 'free',
          updatedAt: serverTimestamp()
        });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'users/{userId}');
  }
};

export const getUserPlanData = async (): Promise<{credits: number, plan: string}> => {
  if (!auth.currentUser) return {credits: 0, plan: 'free'};
  const userRef = doc(db, 'users', auth.currentUser.uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      return { credits: data.credits || 0, plan: data.plan || 'free' };
    }
    return {credits: 0, plan: 'free'};
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'users/{userId}');
    return {credits: 0, plan: 'free'};
  }
};

export const upgradePlan = async (newPlan: 'pro' | 'creator') => {
  if (!auth.currentUser) throw new Error("Sahifaga kiring");
  const userRef = doc(db, 'users', auth.currentUser.uid);
  try {
      const creditsToAdd = newPlan === 'pro' ? 50 : 200;
      await updateDoc(userRef, {
          plan: newPlan,
          credits: creditsToAdd,
          updatedAt: serverTimestamp()
      });
  } catch(err) {
     handleFirestoreError(err, OperationType.UPDATE, 'users/{userId}');
  }
};
export const consumeCredit = async () => {
  if (!auth.currentUser) throw new Error("Sahifaga kiring");
  const userRef = doc(db, 'users', auth.currentUser.uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const credits = snap.data().credits;
      if (credits <= 0) {
        throw new Error("Sizda bepul urinishlar qolmadi. Iltimos, obunani yangilang.");
      }
      await updateDoc(userRef, {
        credits: credits - 1,
        updatedAt: serverTimestamp()
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'users/{userId}');
  }
};

export const logDubbingHistory = async (originalText: string, translatedText: string, targetLanguage: string) => {
  if (!auth.currentUser) return;
  const historyRef = doc(collection(db, `users/${auth.currentUser.uid}/history`));
  try {
    await setDoc(historyRef, {
      originalText,
      translatedText,
      targetLanguage,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${auth.currentUser.uid}/history/{historyId}`);
  }
};

export const getDubbingHistory = async () => {
  if (!auth.currentUser) return [];
  try {
    const q = query(collection(db, `users/${auth.currentUser.uid}/history`), orderBy('createdAt', 'desc'));
    const snaps = await getDocs(q);
    return snaps.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${auth.currentUser.uid}/history`);
    return [];
  }
};
