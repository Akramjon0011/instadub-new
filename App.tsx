import React, { useState, useEffect } from 'react';
import VideoUploader from './components/VideoUploader';
import DubbingStudio from './components/DubbingStudio';
import { analyzeAndTranslateVideo, generateSpeech } from './services/geminiService';
import { ProcessStatus, DubbingResult, ProcessingError, UserData } from './types';
import { auth, storage } from './services/firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { initializeUser, getUserPlanData, consumeCredit, logDubbingHistory, upgradePlan, getAllUsers, updateUserAdmin } from './services/userService';
import { LogIn, LogOut, Video, Coins, History, CreditCard, Users, ShieldAlert } from 'lucide-react';
import { getDubbingHistory } from './services/userService';
import { AdminAnalytics } from './components/AdminAnalytics';
import { fileToGenerativePart } from './utils/audioUtils';

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [result, setResult] = useState<DubbingResult | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Authentication State
  const [user, setUser] = useState<User | null>(null);
  const [credits, setCredits] = useState<number>(0);
  const [userPlan, setUserPlan] = useState<string>('free');
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showBillingModal, setShowBillingModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false);
  const [adminUsers, setAdminUsers] = useState<UserData[]>([]);
  const [selectedPlanToBuy, setSelectedPlanToBuy] = useState<string | null>(null);
  const isAdmin = user?.email === 'optimbazar@gmail.com';

  const loadHistory = async () => {
    if (user) {
      const logs = await getDubbingHistory();
      setHistoryLogs(logs);
      setShowHistoryModal(true);
    }
  };

  const loadAdminData = async () => {
    if (user && user.email === 'optimbazar@gmail.com') {
      const users = await getAllUsers();
      setAdminUsers(users as UserData[]);
      setShowAdminModal(true);
    }
  };


  // Temporary state for the Review Step
  const [tempData, setTempData] = useState<{
    originalTranscription: string;
    translatedText: string;
    topicSlug: string;
    recommendedVoice: string;
  } | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string>('Fenrir');
  const [editableText, setEditableText] = useState<string>('');
  const [targetLanguage, setTargetLanguage] = useState<string>("O'zbek"); // Added target language

  const handlePreviewVoice = (e: React.MouseEvent, voiceName: string, genderStr: string) => {
    e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const isFemale = genderStr.includes('Ayol');
      const text = `Salom, bu ${voiceName} ovoz namunasi.`;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "uz-UZ";
      utterance.pitch = isFemale ? 1.25 : 0.85;
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  const copyHistoryText = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Tarjima matni nusxalandi!");
  };

  const downloadHistorySRT = (translatedText: string) => {
    const srtContent = `1\n00:00:00,000 --> 00:00:15,000\n${translatedText}\n`;
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subtitr_${Date.now()}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Helper to get video duration before processing
  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.onerror = () => {
        resolve(0); // Fallback if duration fails
      };
      video.src = URL.createObjectURL(file);
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await initializeUser();
        const data = await getUserPlanData();
        setCredits(data.credits);
        setUserPlan(data.plan);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (popupErr: any) {
        if (popupErr?.code === 'auth/popup-blocked' || popupErr?.code === 'auth/popup-closed-by-user') {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw popupErr;
      }
      setShowAuthModal(false);
    } catch (err: any) {
      console.error("Login failed", err);
      if (err?.code === 'auth/unauthorized-domain') {
        setError({ message: "Firebase xatosi: Sizning Vercel domeningiz Firebase 'Authorized domains' ro'yxatida yo'q. Iltimos 1 daqiqa kuting yoki sahifani yangilang (Ctrl+F5)." });
      } else {
        setError({ message: "Tizimga kirishda xatolik: " + (err?.message || err?.code) });
      }
      setStatus(ProcessStatus.ERROR);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setCredits(0);
  };

  const handleFileSelect = async (file: File) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    setVideoFile(file);
    setStatus(ProcessStatus.ANALYZING);
    setError(null);
    setUploadProgress(5);

    let storageRefStr = '';

    try {
      // Step 0: Get Video Duration
      const duration = await getVideoDuration(file);
      console.log(`Video duration detected: ${duration} seconds`);
      setUploadProgress(10);

      const MAX_BASE64_SIZE = 4 * 1024 * 1024; // 4MB limit for direct Base64 payload
      let videoInput: { videoUrl?: string; videoBase64?: string } = {};

      if (file.size <= MAX_BASE64_SIZE) {
        console.log("File is <= 4MB. Sending direct base64 payload...");
        setUploadProgress(50);
        const generativePart = await fileToGenerativePart(file);
        videoInput = { videoBase64: generativePart.inlineData.data };
        setUploadProgress(100);
      } else {
        console.log("File is > 4MB. Attempting upload to Firebase Storage...");
        try {
          const timestamp = Date.now();
          const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
          storageRefStr = `uploads/${user.uid}/${timestamp}_${cleanFileName}`;
          const storageRef = ref(storage, storageRefStr);
          const uploadTask = uploadBytesResumable(storageRef, file);

          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              uploadTask.cancel();
              reject(new Error("Firebase Storage yuklash vaqti tugadi (Timeout). Direct Base64 rejimiga o'tilmoqda."));
            }, 15000); // 15 seconds timeout

            uploadTask.on('state_changed',
              (snapshot) => {
                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                setUploadProgress(progress);
              },
              (err) => {
                clearTimeout(timeoutId);
                reject(err);
              },
              async () => {
                clearTimeout(timeoutId);
                try {
                  const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                  videoInput = { videoUrl: downloadUrl };
                  resolve();
                } catch (err) {
                  reject(err);
                }
              }
            );
          });
        } catch (storageErr) {
          console.warn("Firebase Storage upload failed or timed out. Falling back to direct Base64...", storageErr);
          setUploadProgress(50);
          const generativePart = await fileToGenerativePart(file);
          videoInput = { videoBase64: generativePart.inlineData.data };
          setUploadProgress(100);
        }
      }

      setUploadProgress(null);

      // Step 1: Analyze and Translate via serverless API
      const analysis = await analyzeAndTranslateVideo(
        videoInput,
        duration,
        targetLanguage,
        file.type
      );

      // Clean up Firebase Storage file if uploaded
      if (storageRefStr) {
        try {
          await deleteObject(ref(storage, storageRefStr));
        } catch (cleanupErr) {
          console.warn("Failed to delete temporary file from Firebase Storage:", cleanupErr);
        }
      }

      // Save data and move to Review step
      setTempData(analysis);
      setEditableText(analysis.translatedText);
      setSelectedVoice(analysis.recommendedVoice);
      setStatus(ProcessStatus.REVIEWING);
    } catch (err: any) {
      if (storageRefStr) {
        try {
          await deleteObject(ref(storage, storageRefStr));
        } catch (cleanupErr) {
          console.warn("Failed to clean up Firebase Storage file after error:", cleanupErr);
        }
      }
      setUploadProgress(null);
      handleError(err);
    }
  };

  const handleGenerateAudio = async () => {
    if (!tempData) return;

    if (!user) {
      setShowAuthModal(true);
      return;
    }

    try {
      // Consume credit first
      await consumeCredit();
      setCredits(prev => Math.max(0, prev - 1));

      setStatus(ProcessStatus.GENERATING_AUDIO);
      
      // Step 2: Generate Speech
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = await generateSpeech(editableText, audioCtx, selectedVoice);
      await audioCtx.close(); 

      // Log history
      await logDubbingHistory(tempData.originalTranscription, editableText, targetLanguage);

      setResult({
        originalText: tempData.originalTranscription,
        translatedText: editableText, // Use the edited text
        audioBuffer: audioBuffer,
        fileName: tempData.topicSlug
      });
      setStatus(ProcessStatus.COMPLETED);
    } catch (err: any) {
      handleError(err);
    }
  }

  const handleError = (err: any) => {
    console.error(err);
    let friendlyMessage = err.message || "Kutilmagan xatolik yuz berdi.";
    
    // Check for common error patterns
    if (friendlyMessage.includes('Failed to fetch')) {
      friendlyMessage = "Internetga ulanishda xatolik yuz berdi. Ehtimol fayl hajmi katta (50MB+) yoki internet tezligi past.";
    } else if (friendlyMessage.includes('API Key')) {
      friendlyMessage = "API Kaliti topilmadi. Tizim sozlamalarini tekshiring.";
    } else if (friendlyMessage.includes('Sahifaga kiring')) {
      friendlyMessage = "Siz akkauntga kirmagansiz. Iltimos tizimga kiring.";
    } else if (friendlyMessage.includes('bepul urinishlar')) {
      friendlyMessage = "Sizda bepul urinishlar qolmadi. Kunlik limit yoki hisobni to'ldirishingiz kerak.";
    } else if (friendlyMessage.includes('400')) {
        friendlyMessage = "Noto'g'ri so'rov. Ehtimol fayl formati xato yoki hajmi (max 50MB) to'g'ri kelmadi.";
    } else if (friendlyMessage.includes('403') || friendlyMessage.includes('PERMISSION_DENIED')) {
        friendlyMessage = `API kaliti ruxsatiga ega emas (403). Real xato: ${err.message}`;
    } else if (friendlyMessage.includes('429')) {
        friendlyMessage = "API so'rovlar limiti tugadi. Birozdan so'ng urinib ko'ring.";
    } else if (friendlyMessage.includes('503')) {
        friendlyMessage = "Gemini serveri band. Iltimos qaytadan urinib ko'ring.";
    }

    setError({ message: friendlyMessage });
    setStatus(ProcessStatus.ERROR);
  }

  const handleReset = () => {
    setVideoFile(null);
    setResult(null);
    setTempData(null);
    setStatus(ProcessStatus.IDLE);
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="glass-panel sticky top-0 z-50 backdrop-blur-md border-b border-white/5 transition-all">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Video className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              InstaDub.uz
            </h1>
          </div>
          
          <div className="flex items-center gap-3 sm:gap-4">
            {user ? (
              <div className="flex items-center gap-3 sm:gap-4">
                <button 
                  onClick={() => setShowBillingModal(true)} 
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 transition-all text-xs sm:text-sm font-semibold text-blue-400 capitalize"
                >
                  {userPlan}
                </button>
                <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 text-xs sm:text-sm font-semibold">
                  <Coins className="w-4 h-4 text-yellow-500" />
                  <span className="text-gray-200">{credits}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  {isAdmin && (
                    <button onClick={loadAdminData} className="text-gray-400 hover:text-white transition-colors p-1" title="Boshqaruv">
                      <ShieldAlert className="w-5 h-5" />
                    </button>
                  )}
                  <button onClick={loadHistory} className="text-gray-400 hover:text-white transition-colors p-1" title="Tarix">
                    <History className="w-5 h-5" />
                  </button>
                  <img src={user.photoURL || 'https://via.placeholder.com/32'} alt="avatar" className="w-8 h-8 rounded-full border border-white/10 object-cover" />
                  <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors p-1" title="Chiqish">
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl font-bold transition-all text-sm shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
              >
                <LogIn className="w-4 h-4" />
                Kirish
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center p-4 max-w-7xl mx-auto w-full">
        
        {/* Auth Modal */}
        {showAuthModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="glass-panel-heavy rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center animate-fade-in-up">
              <div className="w-14 h-14 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <LogIn className="w-6 h-6 text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Dublyajni boshlash uchun kiring</h2>
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                Hoziroq ro'yxatdan o'ting va <strong>3 ta mutlaqo bepul</strong> dublyaj qilish huquqiga ega bo'ling.
              </p>
              <button 
                onClick={handleLogin}
                className="w-full bg-white text-gray-900 hover:bg-gray-100 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 transition-all mb-4 active:scale-[0.98]"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google orqali kirish
              </button>
              <button 
                onClick={() => setShowAuthModal(false)}
                className="text-sm font-semibold text-gray-500 hover:text-gray-300 transition-colors"
              >
                Hozircha emas
              </button>
            </div>
          </div>
        )}

        {/* Billing Modal */}
        {showBillingModal && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[60] flex items-center justify-center p-4">
            <div className="glass-panel-heavy rounded-3xl max-w-4xl w-full shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-fade-in-up">
              <div className="p-5 sm:p-6 border-b border-white/5 flex justify-between items-center sticky top-0 bg-[#060813]/90 backdrop-blur-md z-10">
                <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-3">
                  <CreditCard className="w-6 h-6 text-indigo-400" /> Ta'rifni yangilash
                </h2>
                <button onClick={() => { setShowBillingModal(false); setSelectedPlanToBuy(null); }} className="text-gray-400 hover:text-white transition-colors text-lg p-1">✕</button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                {!selectedPlanToBuy ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Free Plan */}
                      <div className={`p-6 rounded-2xl border transition-all ${userPlan === 'free' ? 'border-blue-500 bg-blue-500/5 relative shadow-lg shadow-blue-500/5' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                        {userPlan === 'free' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs px-3.5 py-1 rounded-full font-bold shadow-md">Faol Ta'rif</span>}
                        <h3 className="text-xl font-bold text-white mb-1">Free</h3>
                        <p className="text-gray-400 text-xs mb-4">Loyiha bilan tanishish uchun</p>
                        <div className="mb-6 flex items-baseline"><span className="text-3xl font-black text-white">0 so'm</span> <span className="text-gray-500 text-xs ml-1">/ oy</span></div>
                        <ul className="space-y-3 mb-8 text-sm text-gray-300">
                          <li className="flex items-center gap-2">
                            <span className="text-blue-400 text-xs">✓</span> 3 ta dublyaj
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-blue-400 text-xs">✓</span> Maksimal 1 daqiqa video
                          </li>
                          <li className="flex items-center gap-2 text-gray-500">
                            <span>✕</span> Tarixni saqlash
                          </li>
                          <li className="flex items-center gap-2 text-gray-500">
                            <span>✕</span> 24/7 yordam
                          </li>
                        </ul>
                        <button disabled className="w-full bg-white/5 text-gray-400 py-2.5 rounded-xl font-bold text-sm cursor-not-allowed">Boshlang'ich</button>
                      </div>

                      {/* Pro Plan */}
                      <div className={`p-6 rounded-2xl border relative transition-all ${userPlan === 'pro' ? 'border-indigo-500 bg-indigo-500/5 shadow-lg shadow-indigo-500/5' : 'border-indigo-500/30 bg-indigo-950/15 hover:bg-indigo-950/20 shadow-xl shadow-indigo-500/5'}`}>
                        {userPlan === 'pro' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-xs px-3.5 py-1 rounded-full font-bold shadow-md">Faol Ta'rif</span>}
                        {userPlan !== 'pro' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs px-3.5 py-1 rounded-full font-bold shadow-md">Tavsiya etamiz</span>}
                        <h3 className="text-xl font-bold text-white mb-1">Pro</h3>
                        <p className="text-gray-400 text-xs mb-4">Aktiv foydalanuvchilar uchun</p>
                        <div className="mb-6 flex items-baseline"><span className="text-3xl font-black text-white">130 000 so'm</span> <span className="text-gray-500 text-xs ml-1">/ oy</span></div>
                        <ul className="space-y-3 mb-8 text-sm text-gray-300">
                          <li className="flex items-center gap-2 font-medium text-indigo-300">
                            <span>★</span> 50 ta dublyaj
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-indigo-400 text-xs">✓</span> Maksimal 5 daqiqa video
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-indigo-400 text-xs">✓</span> Tarixni saqlash
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-indigo-400 text-xs">✓</span> Tezkor API xizmati
                          </li>
                        </ul>
                        {userPlan === 'pro' ? (
                          <button disabled className="w-full bg-white/5 text-gray-450 py-2.5 rounded-xl font-bold text-sm cursor-not-allowed">Faol</button>
                        ) : (
                          <button onClick={() => setSelectedPlanToBuy('pro')} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-2.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/20">Obuna bo'lish</button>
                        )}
                      </div>

                      {/* Creator Plan */}
                      <div className={`p-6 rounded-2xl border transition-all ${userPlan === 'creator' ? 'border-purple-500 bg-purple-500/5 relative shadow-lg shadow-purple-500/5' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                        {userPlan === 'creator' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-xs px-3.5 py-1 rounded-full font-bold shadow-md">Faol Ta'rif</span>}
                        <h3 className="text-xl font-bold text-white mb-1">Creator</h3>
                        <p className="text-gray-400 text-xs mb-4">Bloger va agentliklar uchun</p>
                        <div className="mb-6 flex items-baseline"><span className="text-3xl font-black text-white">390 000 so'm</span> <span className="text-gray-500 text-xs ml-1">/ oy</span></div>
                        <ul className="space-y-3 mb-8 text-sm text-gray-300">
                          <li className="flex items-center gap-2 font-medium text-purple-300">
                            <span>★</span> 200 ta dublyaj
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-purple-400 text-xs">✓</span> Maksimal 10 daqiqa video
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-purple-400 text-xs">✓</span> Cheksiz imkoniyatlar
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-purple-400 text-xs">✓</span> 24/7 yordam & Shaxsiy API
                          </li>
                        </ul>
                        {userPlan === 'creator' ? (
                          <button disabled className="w-full bg-white/5 text-gray-405 py-2.5 rounded-xl font-bold text-sm cursor-not-allowed">Faol</button>
                        ) : (
                          <button onClick={() => setSelectedPlanToBuy('creator')} className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"   >Obuna bo'lish</button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto bg-white/[0.02] border border-white/5 p-6 sm:p-8 rounded-2xl text-center">
                    <h3 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight">
                      {selectedPlanToBuy === 'pro' ? 'Pro' : 'Creator'} ta'rifini xarid qilish
                    </h3>
                    <p className="text-gray-400 text-sm mb-6">
                      Iltimos, to'lovni tasdiqlash uchun quyidagi amallarni bajaring:
                    </p>
                    
                    <div className="space-y-4 text-left">
                      <div className="bg-white/[0.03] p-4 sm:p-5 rounded-xl border border-white/5 flex gap-4 items-start">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 font-bold shrink-0">1</div>
                        <div className="flex-1">
                          <h4 className="text-white font-bold text-sm sm:text-base mb-1">Paynet orqali to'lovni amalga oshiring</h4>
                          <p className="text-xs sm:text-sm text-gray-400 mb-3 leading-relaxed">Quyidagi havola orqali kerakli summani to'lang (Pro - 130 000 so'm, Creator - 390 000 so'm).</p>
                          <a 
                            href="https://app.paynet.uz/?m=49156&i=4805742d-d76c-4b39-8c02-8ddf1c450f33&branchId=&actTypeId=144" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="inline-flex bg-[#00b2a3] hover:bg-[#009285] text-white px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-[0.97]"
                          >
                            Paynet da to'lash
                          </a>
                        </div>
                      </div>
 
                      <div className="bg-white/[0.03] p-4 sm:p-5 rounded-xl border border-white/5 flex gap-4 items-start">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold shrink-0">2</div>
                        <div className="flex-1">
                          <h4 className="text-white font-bold text-sm sm:text-base mb-1">Admin tasdiqlashi uchun chekni yuboring</h4>
                          <p className="text-xs sm:text-sm text-gray-400 mb-3 leading-relaxed">To'lov muvaffaqiyatli o'tgach, to'lov chekini va elektron pochtangizni (<strong>{user?.email}</strong>) adminga yuboring.</p>
                          <a 
                            href="https://t.me/Akramjon1984" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="inline-flex bg-[#0088cc] hover:bg-[#0077b3] text-white px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-[0.97]"
                          >
                            Telegram orqali yuborish
                          </a>
                        </div>
                      </div>
                    </div>
 
                    <div className="mt-8 pt-6 border-t border-white/5">
                      <button onClick={() => setSelectedPlanToBuy(null)} className="text-sm font-semibold text-gray-400 hover:text-white transition-colors">
                        &larr; Orqaga qaytish
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* History Modal */}
        {showHistoryModal && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="glass-panel-heavy rounded-3xl p-5 sm:p-6 max-w-2xl w-full shadow-2xl flex flex-col max-h-[80vh] animate-fade-in-up">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-400" /> Tarix
                </h2>
                <button onClick={() => setShowHistoryModal(false)} className="text-gray-400 hover:text-white p-1 text-lg">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto pr-1 space-y-3.5 custom-scrollbar">
                {historyLogs.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">Hozircha dublyaj tarixi yo'q.</p>
                ) : (
                  historyLogs.map(log => (
                    <div key={log.id} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:bg-white/[0.04] transition-all">
                      <div className="flex justify-between items-center mb-2.5">
                        <span className="text-[10px] font-extrabold tracking-wider bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded uppercase">{log.targetLanguage}</span>
                        <span className="text-xs text-gray-500">
                          {log.createdAt?.toDate ? new Date(log.createdAt.toDate()).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 mb-1.5"><strong>Original:</strong> {log.originalText}</p>
                      <p className="text-sm text-white font-medium mb-3"><strong>Tarjima:</strong> {log.translatedText}</p>
                      <div className="flex gap-2 justify-end pt-2 border-t border-white/5">
                        <button 
                          onClick={() => copyHistoryText(log.translatedText)}
                          className="text-xs bg-white/5 hover:bg-white/10 text-gray-300 px-3 py-1.5 rounded-lg border border-white/5 transition-all flex items-center gap-1 active:scale-[0.97]"
                        >
                          📋 Nusxalash
                        </button>
                        <button 
                          onClick={() => downloadHistorySRT(log.translatedText)}
                          className="text-xs bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 px-3 py-1.5 rounded-lg border border-indigo-500/30 transition-all flex items-center gap-1 active:scale-[0.97]"
                        >
                          📜 Subtitr (.srt)
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Admin Modal */}
        {showAdminModal && isAdmin && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="glass-panel-heavy rounded-3xl p-5 sm:p-6 max-w-4xl w-full shadow-2xl flex flex-col max-h-[85vh] animate-fade-in-up">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-400" /> Boshqaruv Paneli
                </h2>
                <button onClick={() => setShowAdminModal(false)} className="text-gray-400 hover:text-white p-1 text-lg">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <AdminAnalytics users={adminUsers} />
                <div className="overflow-x-auto border border-white/5 rounded-2xl">
                  <table className="w-full text-left text-sm text-gray-300 min-w-[600px]">
                    <thead className="text-xs text-gray-400 uppercase bg-white/[0.03] border-b border-white/5">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Email</th>
                        <th className="px-4 py-3 font-semibold">Turi</th>
                        <th className="px-4 py-3 font-semibold">Ruxsat (Plan)</th>
                        <th className="px-4 py-3 font-semibold">Urinishlar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {adminUsers.map(u => (
                        <tr key={u.uid} className="hover:bg-white/[0.01] transition-colors">
                          <td className="px-4 py-3.5 font-medium text-white max-w-[200px] truncate">{u.email}</td>
                          <td className="px-4 py-3.5">
                            <select className="bg-gray-900 border border-white/10 text-white rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none" value={u.role || 'user'} onChange={async (e) => {
                              await updateUserAdmin(u.uid!, { role: e.target.value });
                              await loadAdminData();
                            }}>
                              <option value="user">Foydalanuvchi</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td className="px-4 py-3.5">
                             <select className="bg-gray-900 border border-white/10 text-white rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none" value={u.plan || 'free'} onChange={async (e) => {
                              await updateUserAdmin(u.uid!, { plan: e.target.value });
                              await loadAdminData();
                            }}>
                              <option value="free">Bepul</option>
                              <option value="pro">Pro</option>
                              <option value="creator">Ijodkor</option>
                            </select>
                          </td>
                          <td className="px-4 py-3.5">
                            <input type="number" className="w-16 bg-gray-900 border border-white/10 text-white rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none" defaultValue={u.credits} onBlur={async (e) => {
                               if(parseInt(e.target.value) !== u.credits) {
                                 await updateUserAdmin(u.uid!, { credits: parseInt(e.target.value) || 0 });
                                 await loadAdminData();
                               }
                            }}/>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Intro Text */}
        {status === ProcessStatus.IDLE && (
          <div className="text-center mb-8 max-w-2xl animate-fade-in-up">
            <h2 className="text-3xl sm:text-5xl font-black mb-4 text-white leading-tight tracking-tight">
              Video Tarjima va <br/>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
                Sun'iy Intellekt Dublyaji
              </span>
            </h2>
            <p className="text-gray-400 text-sm sm:text-base mb-6 leading-relaxed max-w-lg mx-auto">
              Videoni yuklang. Biz uni tahlil qilamiz, matnni tarjima qilamiz va yangi professional ovoz bilan boyitamiz.
            </p>
            
            {/* Language Selector */}
            <div className="flex items-center justify-center gap-3 mb-2 bg-white/[0.03] p-1.5 px-3 rounded-full border border-white/5 shadow-sm mx-auto">
              <span className="text-xs sm:text-sm font-semibold text-gray-400 ml-1">Tilni tanlang:</span>
              <select 
                value={targetLanguage} 
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="bg-gray-950 border border-white/10 text-white text-xs sm:text-sm rounded-full focus:ring-1 focus:ring-blue-500 outline-none block p-1.5 px-3 cursor-pointer w-[140px] font-semibold"
              >
                <option value="O'zbek">O'zbek</option>
                <option value="Rus (Russian)">Rus (Русский)</option>
                <option value="Ingliz (English)">Ingliz (English)</option>
              </select>
            </div>
          </div>
        )}

        {/* Uploader */}
        {status === ProcessStatus.IDLE && (
          <VideoUploader onFileSelect={handleFileSelect} disabled={false} userPlan={userPlan} />
        )}

        {/* Loading States */}
        {(status === ProcessStatus.ANALYZING || status === ProcessStatus.GENERATING_AUDIO) && (
          <div className="flex flex-col items-center justify-center animate-pulse py-12">
            <div className="relative mb-6">
              <div className="w-14 h-14 border-2 border-indigo-500/20 border-t-2 border-t-indigo-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 w-14 h-14 bg-indigo-500/5 blur-md rounded-full animate-pulse-glow"></div>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-white mb-2 tracking-tight">
              {status === ProcessStatus.ANALYZING 
                ? (uploadProgress !== null ? `Video yuklanmoqda... ${uploadProgress}%` : "Video tahlil qilinmoqda...") 
                : "Ovoz yaratilmoqda..."}
            </h3>
            <p className="text-gray-450 text-xs sm:text-sm text-center max-w-sm leading-relaxed">
              {status === ProcessStatus.ANALYZING 
                ? (uploadProgress !== null 
                    ? "Video fayli serverga xavfsiz tarzda uzatilmoqda, iltimos kuting..." 
                    : `Original nutq aniqlanib, '${targetLanguage}' tiliga o'girilmoqda. Iltimos kuting...`) 
                : "Tarjima audio formatga o'tkazilmoqda."}
            </p>
          </div>
        )}

        {/* Review Step */}
        {status === ProcessStatus.REVIEWING && tempData && (
          <div className="w-full max-w-2xl glass-panel rounded-3xl p-6 sm:p-8 shadow-2xl animate-fade-in border border-white/5">
             <h3 className="text-xl font-black text-white mb-5 flex items-center gap-2">
               <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
               Tarjimani Tahrirlash
             </h3>
             
             <div className="mb-5">
               <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Tarjima matni ({targetLanguage})</label>
               <textarea 
                value={editableText}
                onChange={(e) => setEditableText(e.target.value)}
                className="w-full bg-gray-950 border border-white/10 rounded-2xl p-4 text-white text-sm sm:text-base focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-h-[130px] leading-relaxed transition-all"
               />
               <p className="text-xs text-gray-500 mt-2">Matnni video uzunligiga moslash uchun qisqartirishingiz yoki kengaytirishingiz mumkin.</p>
             </div>

             <div className="mb-6">
               <label className="block text-xs font-bold text-gray-400 mb-2.5 uppercase tracking-wider">Ovoz (Speaker)</label>
               <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                 {[
                     { name: 'Fenrir', gender: '👨 Erkak (Chuqur)' },
                     { name: 'Charon', gender: '👨 Erkak (Vazmin)' },
                     { name: 'Puck', gender: '👨 Erkak (Tinch)' },
                     { name: 'Orpheus', gender: '👨 Erkak (Tantanali)' },
                     { name: 'Aoede', gender: '👨 Erkak (Yumshoq)' },
                     { name: 'Zephyr', gender: '👨 Erkak (Jonli)' },
                     { name: 'Kore', gender: '👩 Ayol (Mayin)' },
                     { name: 'Leda', gender: '👩 Ayol (Rasmiy)' },
                     { name: 'Callisto', gender: '👩 Ayol (Energetik)' },
                     { name: 'Evadne', gender: '👩 Ayol (Tinch)' },
                     { name: 'Amalthea', gender: '👩 Ayol (Yorqin)' },
                     { name: 'Despina', gender: '👩 Ayol (Yumshoq)' },
                   ].map((v) => (
                     <button
                       key={v.name}
                       onClick={() => setSelectedVoice(v.name)}
                       className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 text-left flex flex-col active:scale-[0.97] ${
                         selectedVoice === v.name 
                         ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/20 scale-102 border border-indigo-500/30' 
                         : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/5'
                       }`}
                     >
                       <div className="flex items-center justify-between w-full">
                         <span>{v.name}</span>
                         <div className="flex items-center gap-1.5">
                           {v.name === tempData.recommendedVoice && <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-1.5 py-0.5 rounded font-bold">AI</span>}
                           <span 
                             role="button"
                             title="Ovoz namunasi tinglash"
                             onClick={(e) => handlePreviewVoice(e, v.name, v.gender)}
                             className="p-1 rounded-full hover:bg-white/20 transition-all text-xs opacity-75 hover:opacity-100"
                           >
                             🔊
                           </span>
                         </div>
                       </div>
                       <span className="text-[10px] opacity-60 font-normal mt-0.5">{v.gender}</span>
                     </button>
                   ))}
               </div>
             </div>

             <div className="flex gap-3">
               <button 
                onClick={handleReset}
                className="px-5 sm:px-7 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 hover:text-white font-bold text-xs sm:text-sm transition-all active:scale-[0.98]"
               >
                 Bekor qilish
               </button>
               <button 
                onClick={handleGenerateAudio}
                className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs sm:text-sm active:scale-[0.98] shadow-lg shadow-emerald-500/10"
               >
                 Ovoz Yaratish 
                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               </button>
             </div>
          </div>
        )}

        {/* Result */}
        {status === ProcessStatus.COMPLETED && videoFile && result && (
          <DubbingStudio 
            videoFile={videoFile} 
            result={result} 
            onReset={handleReset} 
          />
        )}

        {/* Error */}
        {status === ProcessStatus.ERROR && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center animate-shake backdrop-blur-md shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-400 text-2xl font-bold">!</span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-white mb-2 tracking-tight">Xatolik yuz berdi</h3>
            <p className="text-gray-300 text-sm mb-6 leading-relaxed">{error?.message}</p>
            <button 
              onClick={handleReset}
              className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-3 px-6 rounded-xl border border-white/10 transition-all active:scale-[0.98] text-sm"
            >
              Qaytadan urinib ko'ring
            </button>
          </div>
        )}
      </main>

      <footer className="py-6 text-center text-gray-500 text-xs border-t border-white/5 max-w-7xl mx-auto w-full px-4">
        &copy; {new Date().getFullYear()} InstaDub.uz AI. Barcha huquqlar himoyalangan.
      </footer>
    </div>
  );
};

export default App;