import { doc, getDoc, setDoc, updateDoc, collection, serverTimestamp, getDocs, query, orderBy, runTransaction } from 'firebase/firestore';
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
       // Eski foydalanuvchida 'plan' maydoni yo'q — admin orqali tuzatish kerak.
       // Yangi Firestore rules bo'yicha oddiy foydalanuvchi plan ni o'zgartira olmaydi.
       console.warn(`Foydalanuvchi ${auth.currentUser.uid} da 'plan' maydoni yo'q. Admin orqali tuzating.`);
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

// DIQQAT: upgradePlan faqat admin tomonidan chaqirilishi mumkin.
// Oddiy foydalanuvchi o'z planini o'zgartira olmaydi (Firestore rules bilan himoyalangan).
export const upgradePlan = async (newPlan: 'pro' | 'creator') => {
  if (!auth.currentUser) throw new Error("Sahifaga kiring");
  // Faqat admin uchun ishlaydi
  if (auth.currentUser.email !== 'optimbazar@gmail.com') {
    throw new Error("Plan o'zgartirish faqat admin tomonidan amalga oshiriladi. Iltimos, admin bilan bog'laning.");
  }
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

// Transaction orqali kredit kamaytirish — race condition oldini oladi.
// Bir vaqtda 2 ta so'rov kelsa ham, faqat bitta muvaffaqiyatli bo'ladi.
export const consumeCredit = async () => {
  if (!auth.currentUser) throw new Error("Sahifaga kiring");
  const userRef = doc(db, 'users', auth.currentUser.uid);
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) {
        throw new Error("Foydalanuvchi topilmadi.");
      }
      const currentCredits = snap.data().credits;
      if (currentCredits <= 0) {
        throw new Error("Sizda bepul urinishlar qolmadi. Iltimos, obunani yangilang.");
      }
      transaction.update(userRef, {
        credits: currentCredits - 1,
        updatedAt: serverTimestamp()
      });
    });
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

export const getAllUsers = async () => {
  if (!auth.currentUser || auth.currentUser.email !== 'optimbazar@gmail.com') return [];
  try {
    const snaps = await getDocs(collection(db, 'users'));
    return snaps.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
    return [];
  }
};

export const updateUserAdmin = async (uid: string, data: any) => {
  if (!auth.currentUser || auth.currentUser.email !== 'optimbazar@gmail.com') throw new Error("Not authorized");
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
};
