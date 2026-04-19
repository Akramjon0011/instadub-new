import React, { useState } from 'react';
import VideoUploader from './components/VideoUploader';
import DubbingStudio from './components/DubbingStudio';
import { analyzeAndTranslateVideo, generateUzbekSpeech } from './services/geminiService';
import { ProcessStatus, DubbingResult, ProcessingError } from './types';

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [result, setResult] = useState<DubbingResult | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);

  // Temporary state for the Review Step
  const [tempData, setTempData] = useState<{
    originalText: string;
    translatedText: string;
    topicSlug: string;
    recommendedVoice: string;
  } | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string>('Fenrir');
  const [editableText, setEditableText] = useState<string>('');

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

  const handleFileSelect = async (file: File) => {
    setVideoFile(file);
    setStatus(ProcessStatus.ANALYZING);
    setError(null);

    try {
      // Step 0: Get Video Duration
      const duration = await getVideoDuration(file);
      console.log(`Video duration detected: ${duration} seconds`);

      // Step 1: Analyze and Translate
      const analysis = await analyzeAndTranslateVideo(file, duration);
      
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

    setStatus(ProcessStatus.GENERATING_AUDIO);
    
    try {
      // Step 2: Generate Speech
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = await generateUzbekSpeech(editableText, audioCtx, selectedVoice);
      await audioCtx.close(); 

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
      friendlyMessage = "Internetga ulanishda xatolik yuz berdi. Ehtimol fayl hajmi juda katta (10MB+) yoki internet tezligi past.";
    } else if (friendlyMessage.includes('API Key')) {
      friendlyMessage = "API Kaliti topilmadi. Tizim sozlamalarini tekshiring.";
    } else if (friendlyMessage.includes('400')) {
        friendlyMessage = "Noto'g'ri so'rov. Ehtimol fayl formati yoki hajmi (max 10MB) to'g'ri kelmadi.";
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
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
              InstaDub Uzbek
            </h1>
          </div>
          <div className="text-xs text-gray-500 hidden sm:block">
            Powered by Gemini AI
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center p-4">
        
        {/* Intro Text */}
        {status === ProcessStatus.IDLE && (
          <div className="text-center mb-10 max-w-2xl animate-fade-in-up">
            <h2 className="text-4xl font-bold mb-4 text-white">Ingliz tilidan O'zbek tiliga <br/><span className="text-blue-500">Video Dublyaj</span></h2>
            <p className="text-gray-400 text-lg">
              Videoni yuklang. Biz uni tahlil qilamiz, siz tarjimani tasdiqlaysiz va biz uni ovozlashtiramiz.
            </p>
          </div>
        )}

        {/* Uploader */}
        {status === ProcessStatus.IDLE && (
          <VideoUploader onFileSelect={handleFileSelect} disabled={false} />
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
                ? "Inglizcha matn aniqlanib, o'zbekchaga tarjima qilinmoqda." 
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
               <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">O'zbekcha Matn</label>
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