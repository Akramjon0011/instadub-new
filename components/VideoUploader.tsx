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
    <div className="w-full max-w-xl mx-auto mb-8">
      {/* Tabs */}
      <div className="flex mb-4 bg-gray-800 rounded-lg p-1 border border-gray-700">
        <button
          onClick={() => { setActiveTab('file'); setError(null); }}
          disabled={disabled}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
            activeTab === 'file' 
              ? 'bg-gray-700 text-white shadow-sm' 
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Fayl Yuklash
        </button>
        <button
          onClick={() => { setActiveTab('url'); setError(null); }}
          disabled={disabled}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
            activeTab === 'url' 
              ? 'bg-gray-700 text-white shadow-sm' 
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
            flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer 
            transition-colors duration-300
            ${disabled 
              ? 'border-gray-600 bg-gray-800 opacity-50 cursor-not-allowed' 
              : 'border-blue-500 bg-gray-800 hover:bg-gray-750 hover:border-blue-400'}
          `}
        >
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <svg className="w-12 h-12 mb-4 text-blue-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/>
            </svg>
            <p className="mb-2 text-sm text-gray-300"><span className="font-semibold">Video yuklash uchun bosing</span></p>
            <p className="text-xs text-gray-400">MP4, MOV</p>
            <p className="text-xs text-yellow-500 mt-2">Tarifingiz bo'yicha limit: {limits.name}</p>
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
          <div className="mt-4 p-3 text-sm text-red-200 bg-red-900/30 border border-red-800/50 rounded-lg">
            <span className="font-bold">Xatolik:</span> {durationError}
          </div>
      )}

      {/* Tab Content: URL Upload */}
      {activeTab === 'url' && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 flex flex-col justify-center">
          <div className="w-full">
            <label htmlFor="url-input" className="block text-sm font-medium text-gray-300 mb-2">
              Video Linki (MP4)
            </label>
            <div className="flex gap-2">
              <input
                id="url-input"
                type="url"
                placeholder="https://example.com/video.mp4"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={disabled || isLoading}
                className="flex-1 bg-gray-900 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 placeholder-gray-500"
              />
              <button
                onClick={handleUrlSubmit}
                disabled={disabled || isLoading || !url}
                className={`
                  text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-800 font-medium rounded-lg text-sm px-5 py-2.5 text-center
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center
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
              <div className="mt-4 p-3 text-sm text-red-200 bg-red-900/30 border border-red-800/50 rounded-lg">
                <span className="font-bold">Xatolik:</span> {error}
              </div>
            )}

            <div className="mt-6 p-4 bg-gray-700/30 rounded-lg border border-gray-600/50">
               <h4 className="text-sm font-semibold text-blue-300 mb-2 flex items-center gap-2">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                 Instagram yoki YouTube?
               </h4>
               <p className="text-xs text-gray-400 mb-2 leading-relaxed">
                 Afsuski, Instagram va YouTube xavfsizlik (CORS) tufayli havolani to'g'ridan-to'g'ri qabul qilmaydi.
               </p>
               <div className="text-xs text-gray-300">
                 <span className="block mb-1">Tavsiya etilgan usul:</span>
                 <ol className="list-decimal list-inside space-y-1 pl-1">
                   <li>Videoni <a href="https://snapinsta.app/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">SnapInsta</a> kabi saytlardan yuklab oling.</li>
                   <li>"Fayl Yuklash" bo'limi orqali yuklang.</li>
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