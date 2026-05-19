import React, { useState, useEffect } from 'react';
import VideoUploader from './components/VideoUploader';
import DubbingStudio from './components/DubbingStudio';
import { analyzeAndTranslateVideo, generateSpeech } from './services/geminiService';
import { ProcessStatus, DubbingResult, ProcessingError, UserData } from './types';
import { auth } from './services/firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { initializeUser, getUserPlanData, consumeCredit, logDubbingHistory, upgradePlan, getAllUsers, updateUserAdmin } from './services/userService';
import { LogIn, LogOut, Video, Coins, History, CreditCard, Users, ShieldAlert } from 'lucide-react';
import { getDubbingHistory } from './services/userService';
import { AdminAnalytics } from './components/AdminAnalytics';

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [result, setResult] = useState<DubbingResult | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);

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
      await signInWithPopup(auth, provider);
      setShowAuthModal(false);
    } catch (err: any) {
      console.error("Login failed", err);
      if (err?.code === 'auth/unauthorized-domain') {
        setError({ message: "Firebase xatosi: Sizning Vercel domeningiz Firebase 'Authorized domains' ro'yxatida yo'q. Loyiha sozlamalarini to'g'rilang." });
      } else {
        setError({ message: "Tizimga kirishda xatolik: " + err?.message });
      }
      setStatus(ProcessStatus.ERROR);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setCredits(0);
  };

  const handleFileSelect = async (file: File) => {
    setVideoFile(file);
    setStatus(ProcessStatus.ANALYZING);
    setError(null);

    try {
      // Step 0: Get Video Duration
      const duration = await getVideoDuration(file);
      console.log(`Video duration detected: ${duration} seconds`);

      // Step 1: Analyze and Translate
      // Need to adjust analyzeAndTranslateVideo to accept targetLanguage if we want full support.
      const analysis = await analyzeAndTranslateVideo(file, duration, targetLanguage);
      
      // Save data and move to Review step
      setTempData(analysis);
      setEditableText(analysis.translatedText);
      setSelectedVoice(analysis.recommendedVoice);
      setStatus(ProcessStatus.REVIEWING);

    } catch (err: any) {
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
        friendlyMessage = "API kaliti ruxsatiga ega emas (403). Iltimos, AI Studio API sozlamalarini tekshiring yoki modelni o'zgartiring.";
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
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg">
              <Video className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
              InstaDub Uzbek
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <button onClick={() => setShowBillingModal(true)} className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700 hover:border-gray-500 transition-colors">
                  <span className="text-sm font-medium text-blue-400 capitalize">{userPlan}</span>
                </button>
                <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700">
                  <Coins className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm font-medium text-gray-200">{credits}</span>
                </div>
                <div className="flex items-center gap-3">
                  {isAdmin && (
                    <button onClick={loadAdminData} className="text-gray-400 hover:text-white transition-colors" title="Boshqaruv">
                      <ShieldAlert className="w-5 h-5" />
                    </button>
                  )}
                  <button onClick={loadHistory} className="text-gray-400 hover:text-white transition-colors" title="Tarix">
                    <History className="w-5 h-5" />
                  </button>
                  <img src={user.photoURL || 'https://via.placeholder.com/32'} alt="avatar" className="w-8 h-8 rounded-full border border-gray-700" />
                  <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors" title="Chiqish">
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
              >
                <LogIn className="w-4 h-4" />
                Kirish
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center p-4">
        
        {/* Auth Modal */}
        {showAuthModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full border border-gray-700 shadow-2xl text-center animate-fade-in-up">
              <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <LogIn className="w-8 h-8 text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Dublyajni boshlash uchun kiring</h2>
              <p className="text-gray-400 mb-6">
                Hoziroq ro'yxatdan o'ting va <strong>3 ta mutlaqo bepul</strong> dublyaj qilish huquqiga ega bo'ling.
              </p>
              <button 
                onClick={handleLogin}
                className="w-full bg-white text-gray-900 hover:bg-gray-100 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-colors mb-4"
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
                className="text-sm text-gray-500 hover:text-white transition-colors"
              >
                Hozircha emas
              </button>
            </div>
          </div>
        )}

        {/* Billing Modal */}
        {showBillingModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl max-w-4xl w-full border border-gray-700 shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto animate-fade-in-up">
              <div className="p-6 border-b border-gray-700 flex justify-between items-center sticky top-0 bg-gray-800/90 backdrop-blur z-10">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <CreditCard className="w-6 h-6 text-blue-400" /> Ta'rifni yangilash
                </h2>
                <button onClick={() => { setShowBillingModal(false); setSelectedPlanToBuy(null); }} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <div className="p-6">
                {!selectedPlanToBuy ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Free Plan */}
                      <div className={`p-6 rounded-xl border ${userPlan === 'free' ? 'border-blue-500 bg-blue-900/10 relative' : 'border-gray-700 bg-gray-900'}`}>
                        {userPlan === 'free' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs px-3 py-1 rounded-full font-bold">Joriy ta'rif</span>}
                        <h3 className="text-xl font-bold text-white mb-2">Free</h3>
                        <p className="text-gray-400 text-sm mb-4">Loyiha bilan tanishish uchun</p>
                        <div className="mb-6"><span className="text-3xl font-bold text-white">0 so'm</span> <span className="text-gray-500">/ oy</span></div>
                        <ul className="space-y-3 mb-6 text-sm text-gray-300">
                          <li className="flex gap-2">✅ 3 ta dublyaj</li>
                          <li className="flex gap-2">✅ Maksimal 1 daqiqa video</li>
                          <li className="flex gap-2">❌ Tarixni saqlash</li>
                          <li className="flex gap-2 text-gray-500">❌ 24/7 yordam</li>
                        </ul>
                        <button disabled className="w-full bg-gray-700 text-gray-400 py-2 rounded-lg font-medium">Boshlang'ich</button>
                      </div>

                      {/* Pro Plan */}
                      <div className={`p-6 rounded-xl border relative shadow-blue-500/20 shadow-xl ${userPlan === 'pro' ? 'border-blue-500 bg-blue-900/10' : 'border-blue-500/30 bg-gray-800'}`}>
                        {userPlan === 'pro' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs px-3 py-1 rounded-full font-bold">Joriy ta'rif</span>}
                        {userPlan !== 'pro' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-xs px-3 py-1 rounded-full font-bold">Tavsiya etamiz</span>}
                        <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
                        <p className="text-gray-400 text-sm mb-4">Aktiv foydalanuvchilar uchun</p>
                        <div className="mb-6"><span className="text-3xl font-bold text-white">130 000 so'm</span> <span className="text-gray-500">/ oy</span></div>
                        <ul className="space-y-3 mb-6 text-sm text-gray-300">
                          <li className="flex gap-2 font-medium text-blue-400">✅ 50 ta dublyaj</li>
                          <li className="flex gap-2">✅ Maksimal 5 daqiqa video</li>
                          <li className="flex gap-2">✅ Tarixni saqlash</li>
                          <li className="flex gap-2">✅ Tezkor API xizmati</li>
                        </ul>
                        {userPlan === 'pro' ? (
                          <button disabled className="w-full bg-gray-700 text-gray-400 py-2 rounded-lg font-medium">Faol</button>
                        ) : (
                          <button onClick={() => setSelectedPlanToBuy('pro')} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-medium transition-colors">Obuna bo'lish</button>
                        )}
                      </div>

                      {/* Creator Plan */}
                      <div className={`p-6 rounded-xl border ${userPlan === 'creator' ? 'border-purple-500 bg-purple-900/10 relative' : 'border-gray-700 bg-gray-900'}`}>
                        {userPlan === 'creator' && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-xs px-3 py-1 rounded-full font-bold">Joriy ta'rif</span>}
                        <h3 className="text-xl font-bold text-white mb-2">Creator</h3>
                        <p className="text-gray-400 text-sm mb-4">Bloger va agentliklar uchun</p>
                        <div className="mb-6"><span className="text-3xl font-bold text-white">390 000 so'm</span> <span className="text-gray-500">/ oy</span></div>
                        <ul className="space-y-3 mb-6 text-sm text-gray-300">
                          <li className="flex gap-2 font-medium text-purple-400">✅ 200 ta dublyaj</li>
                          <li className="flex gap-2 font-medium">✅ Maksimal 10 daqiqa video</li>
                          <li className="flex gap-2">✅ Cheksiz imkoniyatlar</li>
                          <li className="flex gap-2">✅ 24/7 yordam & Shaxsiy API</li>
                        </ul>
                        {userPlan === 'creator' ? (
                          <button disabled className="w-full bg-gray-700 text-gray-400 py-2 rounded-lg font-medium">Faol</button>
                        ) : (
                          <button onClick={() => setSelectedPlanToBuy('creator')} className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg font-medium transition-colors">Obuna bo'lish</button>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="max-w-2xl mx-auto bg-gray-900 border border-gray-700 p-8 rounded-xl text-center">
                    <h3 className="text-2xl font-bold text-white mb-4">
                      {selectedPlanToBuy === 'pro' ? 'Pro' : 'Creator'} ta'rifini xarid qilish
                    </h3>
                    <p className="text-gray-300 mb-6">
                      Iltimos, to'lovni tasdiqlash uchun quyidagi amallarni bajaring:
                    </p>
                    
                    <div className="space-y-6 text-left">
                      <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                        <div className="flex gap-3 items-start">
                          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold shrink-0">1</div>
                          <div>
                            <h4 className="text-white font-semibold mb-1">Paynet orqali to'lovni amalga oshiring</h4>
                            <p className="text-sm text-gray-400 mb-3">Quyidagi havola orqali kerakli summani to'lang (Pro - 130 000 so'm, Creator - 390 000 so'm).</p>
                            <a href="https://app.paynet.uz/?m=49156&i=4805742d-d76c-4b39-8c02-8ddf1c450f33&branchId=&actTypeId=144" target="_blank" rel="noopener noreferrer" className="inline-block bg-[#00b2a3] hover:bg-[#009285] text-white px-4 py-2 rounded font-medium transition-colors">
                              Paynet da to'lash
                            </a>
                          </div>
                        </div>
                      </div>

                      <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                        <div className="flex gap-3 items-start">
                          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold shrink-0">2</div>
                          <div>
                            <h4 className="text-white font-semibold mb-1">Admin tasdiqlashi uchun chekni yuboring</h4>
                            <p className="text-sm text-gray-400 mb-3">To'lov muvaffaqiyatli o'tgach, to'lov chekini va elektron pochtangizni (<strong>{user?.email}</strong>) adminga yuboring.</p>
                            <a href="https://t.me/Akramjon1984" target="_blank" rel="noopener noreferrer" className="inline-block bg-[#0088cc] hover:bg-[#0077b3] text-white px-4 py-2 rounded font-medium transition-colors">
                              Telegram orqali yuborish
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-gray-800">
                      <button onClick={() => setSelectedPlanToBuy(null)} className="text-gray-400 hover:text-white transition-colors">
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
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl p-6 max-w-2xl w-full border border-gray-700 shadow-2xl flex flex-col max-h-[80vh] animate-fade-in-up">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-400" /> Tarix
                </h2>
                <button onClick={() => setShowHistoryModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                {historyLogs.length === 0 ? (
                  <p className="text-center text-gray-500">Hozircha dublyaj tarixi yo'q.</p>
                ) : (
                  historyLogs.map(log => (
                    <div key={log.id} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-blue-400 uppercase">{log.targetLanguage}</span>
                        <span className="text-xs text-gray-500">
                          {log.createdAt?.toDate ? new Date(log.createdAt.toDate()).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 mb-2 truncate"><strong>Original:</strong> {log.originalText}</p>
                      <p className="text-sm text-gray-200 truncate"><strong>Tarjima:</strong> {log.translatedText}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Admin Modal */}
        {showAdminModal && isAdmin && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl p-6 max-w-4xl w-full border border-gray-700 shadow-2xl flex flex-col max-h-[80vh] animate-fade-in-up">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-400" /> Boshqaruv Paneli
                </h2>
                <button onClick={() => setShowAdminModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto pr-2">
                <AdminAnalytics users={adminUsers} />
                <table className="w-full text-left text-sm text-gray-300">
                  <thead className="text-xs text-gray-400 uppercase bg-gray-900 sticky top-0">
                    <tr>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Turi</th>
                      <th className="px-4 py-3">Ruxsat (Plan)</th>
                      <th className="px-4 py-3">Urinishlar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map(u => (
                      <tr key={u.uid} className="border-b border-gray-700 hover:bg-gray-700/50">
                        <td className="px-4 py-3 font-medium text-white">{u.email}</td>
                        <td className="px-4 py-3">
                          <select className="bg-gray-800 border border-gray-600 text-white rounded p-1" value={u.role || 'user'} onChange={async (e) => {
                            await updateUserAdmin(u.uid!, { role: e.target.value });
                            await loadAdminData();
                          }}>
                            <option value="user">Foydalanuvchi</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                           <select className="bg-gray-800 border border-gray-600 text-white rounded p-1" value={u.plan || 'free'} onChange={async (e) => {
                            await updateUserAdmin(u.uid!, { plan: e.target.value });
                            await loadAdminData();
                          }}>
                            <option value="free">Bepul</option>
                            <option value="pro">Pro</option>
                            <option value="creator">Ijodkor</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 flex gap-2 items-center">
                          <input type="number" className="w-20 bg-gray-800 border border-gray-600 text-white rounded p-1" defaultValue={u.credits} onBlur={async (e) => {
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
        )}
        
        {/* Intro Text */}
        {status === ProcessStatus.IDLE && (
          <div className="text-center mb-8 max-w-2xl animate-fade-in-up">
            <h2 className="text-4xl font-bold mb-4 text-white">Video Tarjima va <br/><span className="text-blue-500">Dublyaj</span></h2>
            <p className="text-gray-400 text-lg mb-6">
              Videoni yuklang. Biz uni tahlil qilamiz, matnni tarjima qilamiz va yangi ovoz bilan boyitamiz.
            </p>
            
            {/* Language Selector */}
            <div className="flex items-center justify-center gap-3 mb-4 bg-gray-800 p-2 rounded-xl inline-flex border border-gray-700 shadow-sm mx-auto">
              <span className="text-sm font-medium text-gray-300 ml-2">Tilni tanlang:</span>
              <select 
                value={targetLanguage} 
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="bg-gray-900 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 cursor-pointer w-[150px]"
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
          <div className="flex flex-col items-center justify-center animate-pulse">
            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
            <h3 className="text-xl font-semibold text-white mb-2">
              {status === ProcessStatus.ANALYZING ? "Video tahlil qilinmoqda..." : "Ovoz yaratilmoqda..."}
            </h3>
            <p className="text-gray-400">
              {status === ProcessStatus.ANALYZING 
                ? `Original nutq aniqlanib, '${targetLanguage}' tiliga o'girilmoqda...` 
                : "Tarjima audio formatga o'tkazilmoqda."}
            </p>
          </div>
        )}

        {/* Review Step */}
        {status === ProcessStatus.REVIEWING && tempData && (
          <div className="w-full max-w-2xl bg-gray-800 rounded-xl p-6 shadow-xl border border-gray-700 animate-fade-in">
             <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
               <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
               Tarjimani Tahrirlash
             </h3>
             
             <div className="mb-4">
               <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">Tarjima matni ({targetLanguage})</label>
               <textarea 
                value={editableText}
                onChange={(e) => setEditableText(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[120px]"
               />
               <p className="text-xs text-gray-500 mt-1">Matnni video uzunligiga moslash uchun qisqartiring yoki uzaytiring.</p>
             </div>

             <div className="mb-6">
               <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">Ovoz (Speaker)</label>
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['Fenrir', 'Charon', 'Puck', 'Kore'].map((voice) => (
                    <button
                      key={voice}
                      onClick={() => setSelectedVoice(voice)}
                      className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        selectedVoice === voice 
                        ? 'bg-blue-600 text-white shadow-lg scale-105' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {voice} {voice === tempData.recommendedVoice && <span className="text-xs opacity-75">(AI)</span>}
                    </button>
                  ))}
               </div>
             </div>

             <div className="flex gap-3">
               <button 
                onClick={handleReset}
                className="px-6 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors"
               >
                 Bekor qilish
               </button>
               <button 
                onClick={handleGenerateAudio}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
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
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-6 max-w-md text-center animate-shake">
            <div className="text-red-400 text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-bold text-white mb-2">Xatolik yuz berdi</h3>
            <p className="text-gray-300 mb-6">{error?.message}</p>
            <button 
              onClick={handleReset}
              className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded transition-colors"
            >
              Qaytadan urinib ko'ring
            </button>
          </div>
        )}
      </main>

      <footer className="py-6 text-center text-gray-600 text-sm">
        &copy; {new Date().getFullYear()} InstaDub AI.
      </footer>
    </div>
  );
};

export default App;