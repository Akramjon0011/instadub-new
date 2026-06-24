import React, { ChangeEvent, useState } from 'react';

interface VideoUploaderProps {
  onFileSelect: (file: File) => void;
  disabled: boolean;
  userPlan?: string;
}

const VideoUploader: React.FC<VideoUploaderProps> = ({ onFileSelect, disabled, userPlan = 'free' }) => {
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

  return (
    <div className="w-full max-w-xl mx-auto mb-8 animate-fade-in-up">
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
      
      {durationError && (
        <div className="mt-4 p-3.5 text-xs sm:text-sm text-red-200 bg-red-500/10 border border-red-500/20 rounded-2xl animate-shake">
          <span className="font-bold">Xatolik:</span> {durationError}
        </div>
      )}
    </div>
  );
};

export default VideoUploader;