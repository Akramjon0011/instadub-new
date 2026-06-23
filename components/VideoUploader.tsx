import React, { ChangeEvent, useState } from 'react';

interface VideoUploaderProps {
  onFileSelect: (file: File) => void;
  disabled: boolean;
  userPlan?: string;
}

const VideoUploader: React.FC<VideoUploaderProps> = ({ onFileSelect, disabled, userPlan = 'free' }) => {
  const [activeTab, setActiveTab] = useState<'file' | 'url'>('file');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [durationError, setDurationError] = useState<string | null>(null);
  
  const planLimits = {
    free: { name: "1 daqiqa, 20MB", size: 20 * 1024 * 1024, duration: 60 },
    pro: { name: "5 daqiqa, 100MB", size: 100 * 1024 * 1024, duration: 300 },
    creator: { name: "10 daqiqa, 500MB", size: 500 * 1024 * 1024, duration: 600 }
  };
  const limits = planLimits[userPlan as keyof typeof planLimits] || planLimits.free;
  
  const MAX_SIZE_BYTES = limits.size;
  const MAX_DURATION_SECONDS = limits.duration;

  // Helper to check duration before uploading
  const checkDuration = (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        if (video.duration > MAX_DURATION_SECONDS) {
          resolve(false);
        } else {
          resolve(true);
        }
      };
      video.onerror = () => {
        resolve(true); // If cannot read, pass through and let it fail later
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setDurationError(null);
      setError(null);
      
      if (file.size > MAX_SIZE_BYTES) {
        alert(`Fayl hajmi juda katta! ${limits.name} gacha bo'lgan videolarni yuklang.`);
        e.target.value = ''; // Reset input
        return;
      }
      
      const isValidDuration = await checkDuration(file);
      if (!isValidDuration) {
        setDurationError(`Video hajmi uzun. Qisqaroq video yuklang (${limits.name} max).`);
        e.target.value = '';
        return;
      }

      onFileSelect(file);
    }
  };

  const handleUrlSubmit = async () => {
    if (!url.trim()) return;
    
    // Pre-check for known CORS-blocking domains to avoid "Failed to fetch" errors
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('instagram.com') || lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be') || lowerUrl.includes('tiktok.com')) {
       setError("Instagram, YouTube va TikTok havolalari xavfsizlik (CORS) sababli to'g'ridan-to'g'ri ishlamaydi. Iltimos, videoni yuklab olib, 'Fayl Yuklash' orqali kiriting.");
       return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Attempt to fetch
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Linkdan yuklab bo'lmadi. Status: ${response.status}`);
      }
      
      const blob = await response.blob();

      if (blob.size > MAX_SIZE_BYTES) {
        throw new Error(`Video hajmi tarifingiz doirasidan katta. Iltimos, kichikroq yuklang (max ${limits.name}).`);
      }

      const contentType = response.headers.get("content-type");
      
      if (contentType && !contentType.startsWith('video/')) {
         throw new Error("Kiritilgan havola video fayl emas.");
      }

      // Generate a generic filename or extract from URL
      const fileName = "downloaded_video.mp4";
      const file = new File([blob], fileName, { type: contentType || 'video/mp4' });
      
      onFileSelect(file);
    } catch (err: any) {
      console.error(err);
      let msg = "Ushbu havoladan to'g'ridan-to'g'ri yuklab bo'lmadi.";
      
      if (err.message.includes('Failed to fetch')) {
        msg = "Havola ochilmadi (CORS cheklovi). Sayt ruxsat bermadi. Iltimos, videoni qurilmangizga saqlab, fayl sifatida yuklang.";
      } else if (err.message.includes('tarifingiz')) {
        msg = err.message;
      } else if (err.message.includes('video fayl emas')) {
        msg = err.message;
      }

      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto mb-8 animate-fade-in-up">
      {/* Tabs */}
      <div className="flex mb-5 bg-white/5 rounded-2xl p-1 border border-white/5">
        <button
          onClick={() => { setActiveTab('file'); setError(null); }}
          disabled={disabled}
          className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-200 ${
            activeTab === 'file' 
              ? 'bg-white/10 text-white shadow-sm border border-white/5' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Fayl Yuklash
        </button>
        <button
          onClick={() => { setActiveTab('url'); setError(null); }}
          disabled={disabled}
          className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-200 ${
            activeTab === 'url' 
              ? 'bg-white/10 text-white shadow-sm border border-white/5' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Link orqali
        </button>
      </div>

      {/* Tab Content: File Upload */}
      {activeTab === 'file' && (
        <label 
          htmlFor="video-upload" 
          className={`
            flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-3xl cursor-pointer 
            transition-all duration-300 group
            ${disabled 
              ? 'border-white/5 bg-white/[0.01] opacity-50 cursor-not-allowed' 
              : 'border-indigo-500/30 bg-white/[0.02] hover:bg-white/[0.04] hover:border-indigo-500/50'}
          `}
        >
          <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 text-center">
            <div className="w-14 h-14 bg-indigo-500/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-6 h-6 text-indigo-400 group-hover:animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <p className="mb-1 text-sm font-bold text-white">Video yuklash uchun bosing</p>
            <p className="text-xs text-gray-500">MP4, MOV formatlarida</p>
            <span className="text-[10px] sm:text-xs font-bold text-yellow-500/80 bg-yellow-500/5 border border-yellow-500/10 rounded-full px-3 py-1 mt-4">
              Tarifingiz bo'yicha limit: {limits.name}
            </span>
          </div>
          <input 
            id="video-upload" 
            type="file" 
            accept="video/*" 
            className="hidden" 
            onChange={handleFileChange}
            disabled={disabled}
          />
        </label>
      )}
      
      {/* Show duration error if any */}
      {activeTab === 'file' && durationError && (
          <div className="mt-4 p-3.5 text-xs sm:text-sm text-red-200 bg-red-500/10 border border-red-500/20 rounded-2xl animate-shake">
            <span className="font-bold">Xatolik:</span> {durationError}
          </div>
      )}

      {/* Tab Content: URL Upload */}
      {activeTab === 'url' && (
        <div className="glass-panel rounded-3xl p-5 sm:p-6 flex flex-col justify-center border border-white/5">
          <div className="w-full">
            <label htmlFor="url-input" className="block text-xs font-bold text-gray-400 mb-2.5 uppercase tracking-wider">
              Video Linki (MP4)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="url-input"
                type="url"
                placeholder="https://example.com/video.mp4"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={disabled || isLoading}
                className="flex-1 bg-gray-950 border border-white/10 text-white text-xs sm:text-sm rounded-xl focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none block p-3 placeholder-gray-650"
              />
              <button
                onClick={handleUrlSubmit}
                disabled={disabled || isLoading || !url}
                className={`
                  text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold rounded-xl text-xs sm:text-sm px-6 py-3 text-center
                  disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center min-w-[100px]
                `}
              >
                {isLoading ? (
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  'Yuklash'
                )}
              </button>
            </div>

            {error && (
              <div className="mt-4 p-3.5 text-xs sm:text-sm text-red-205 bg-red-500/10 border border-red-500/20 rounded-2xl animate-shake">
                <span className="font-bold">Xatolik:</span> {error}
              </div>
            )}

            <div className="mt-6 p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10">
               <h4 className="text-xs sm:text-sm font-bold text-indigo-300 mb-2 flex items-center gap-2">
                 <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                 Instagram yoki YouTube?
               </h4>
               <p className="text-[11px] sm:text-xs text-gray-400 mb-3.5 leading-relaxed">
                 Afsuski, Instagram va YouTube xavfsizlik (CORS) cheklovlari tufayli videolarni to'g'ridan-to'g'ri bu yerga yuklashga ruxsat bermaydi.
               </p>
               <div className="text-[11px] sm:text-xs text-gray-300 bg-black/20 p-3 rounded-xl border border-white/5">
                 <span className="block mb-1.5 font-semibold text-white">Tavsiya etilgan usul:</span>
                 <ol className="list-decimal list-inside space-y-1.5 pl-0.5">
                   <li>Videoni <a href="https://snapinsta.app/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline font-medium">SnapInsta</a> kabi bepul sayt orqali qurilmangizga yuklab oling.</li>
                   <li>Uni yuqoridagi <span className="font-semibold text-white">"Fayl Yuklash"</span> bo'limi orqali kiriting.</li>
                 </ol>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoUploader;