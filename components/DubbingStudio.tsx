import React, { useRef, useEffect, useState, useCallback } from 'react';
import { DubbingResult } from '../types';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { audioBufferToWav } from '../utils/wavLoader';

interface DubbingStudioProps {
  videoFile: File;
  result: DubbingResult;
  onReset: () => void;
}

const DubbingStudio: React.FC<DubbingStudioProps> = ({ videoFile, result, onReset }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [bgVolume, setBgVolume] = useState(0.15); // 15% original volume by default
  const [audioSpeed, setAudioSpeed] = useState(1.0); // Default 1.0 (Natural speed)
  const [syncStats, setSyncStats] = useState<{ videoDur: number, audioDur: number, rate: number }>({ videoDur: 0, audioDur: 0, rate: 1 });
  const [autoSync, setAutoSync] = useState(true); // Toggle for auto-sync feature
  
  // Audio Context Ref to manage playback state and mixing
  const audioContextRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsGainRef = useRef<GainNode | null>(null);

  const [renderProgress, setRenderProgress] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    
    // Initialize Audio Context
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
    // Create gain node for TTS
    ttsGainRef.current = audioContextRef.current.createGain();
    ttsGainRef.current.connect(audioContextRef.current.destination);

    return () => {
      URL.revokeObjectURL(url);
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [videoFile]);

  // Update sync stats
  useEffect(() => {
    const updateStats = () => {
      if (videoRef.current && result.audioBuffer) {
        const vDur = videoRef.current.duration || 0;
        const aDur = result.audioBuffer.duration / audioSpeed;
        
        if (vDur > 0 && aDur > 0) {
          // Calculate exact ratio needed to make video last as long as audio
          const rawRate = vDur / aDur;
          // Clamp between 0.2x (very slow) and 4.0x (very fast)
          // Ideally 0.5 to 1.5 is the sweet spot, but we allow more extreme if needed.
          const rate = Math.min(Math.max(rawRate, 0.2), 4.0);
          setSyncStats({ videoDur: vDur, audioDur: aDur, rate });
        }
      }
    };
    
    const vid = videoRef.current;
    if (vid) {
      vid.addEventListener('loadedmetadata', updateStats);
      vid.addEventListener('durationchange', updateStats);
    }
    // Try updating immediately in case metadata is already there
    updateStats();

    // Set interval to check duration periodically for a few seconds (sometimes duration loads late)
    const interval = setInterval(updateStats, 500);
    setTimeout(() => clearInterval(interval), 3000);

    return () => {
      if (vid) {
        vid.removeEventListener('loadedmetadata', updateStats);
        vid.removeEventListener('durationchange', updateStats);
      }
      clearInterval(interval);
    }
  }, [result.audioBuffer, audioSpeed, videoUrl]);

  const stopAudio = useCallback(() => {
    if (ttsSourceRef.current) {
      try {
        ttsSourceRef.current.stop();
        ttsSourceRef.current.disconnect();
      } catch (e) {}
      ttsSourceRef.current = null;
    }
  }, []);

  const getSyncFactor = useCallback(() => {
    if (!autoSync) return 1.0;
    
    let targetAudioDur = syncStats.audioDur;
    if (audioSpeed > 0) {
      targetAudioDur = syncStats.audioDur / audioSpeed;
    }
    
    if (targetAudioDur <= 0 || syncStats.videoDur <= 0) return 1.0;

    const rawRate = syncStats.videoDur / targetAudioDur;
    return Math.min(Math.max(rawRate, 0.2), 4.0);
  }, [autoSync, syncStats, audioSpeed]);

  // Live Playback Logic
  const playDubbed = useCallback(async () => {
    if (!videoRef.current || !result.audioBuffer || !audioContextRef.current || !ttsGainRef.current) return;

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    stopAudio();

    // Setup TTS Source
    const source = audioContextRef.current.createBufferSource();
    source.buffer = result.audioBuffer;
    source.playbackRate.value = audioSpeed; 
    source.connect(ttsGainRef.current);
    
    // Sync Video
    const playbackRate = getSyncFactor();
    videoRef.current.playbackRate = playbackRate;
    videoRef.current.currentTime = 0;
    
    // MIXING
    videoRef.current.muted = false;
    videoRef.current.volume = bgVolume; 

    // Start Video
    try {
      if (!videoRef.current.error) {
         videoRef.current.play().catch(e => {
             console.warn("Video play failed or not supported. Playing audio only.", e);
         });
      } else {
         console.warn("Video format is not supported by this browser. Playing audio only.");
      }
    } catch (e: any) {
      console.warn("Video play failed or not supported. Playing audio only.", e);
    }

    // CRITICAL: Re-apply playback rate immediately after play starts.
    videoRef.current.playbackRate = playbackRate;

    // Start Audio immediately without awaiting video to prevent lag
    source.start(0);
    
    ttsSourceRef.current = source;
    setIsPlaying(true);

    let ttsEnded = false;
    let videoEnded = false;
    let active = true;

    const stopPlayback = () => {
       if (ttsEnded && videoEnded) {
          setIsPlaying(false);
          active = false;
          videoRef.current?.pause(); 
       }
    };

    source.onended = () => {
      ttsEnded = true;
      stopPlayback();
    };

    if (videoRef.current) {
        videoRef.current.onended = () => {
            videoEnded = true;
            stopPlayback();
        };
    }
    
    const checkInterval = setInterval(() => {
        if (!active || !videoRef.current) {
            clearInterval(checkInterval);
            return;
        }
        
        // Tab throttling means we should check if media has actually played out
        const isVideoDone = videoRef.current.ended || videoRef.current.currentTime >= videoRef.current.duration - 0.1;
        
        if (ttsEnded && isVideoDone) {
            videoEnded = true;
            stopPlayback();
            clearInterval(checkInterval);
        }
    }, 1000);

  }, [result.audioBuffer, stopAudio, bgVolume, audioSpeed, getSyncFactor, result.translatedText]);

  const pausePlayback = () => {
    if (videoRef.current) videoRef.current.pause();
    stopAudio();
    setIsPlaying(false);
  };

  // Recording Logic
  const handleDownload = async () => {
    if (!videoRef.current || !result.audioBuffer || !audioContextRef.current) return;

    setRenderProgress(0);
    setIsRendering(true);
    stopAudio();

    try {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const dest = audioContextRef.current.createMediaStreamDestination();

      // 1. TTS Track -> Mixer
      const ttsSource = audioContextRef.current.createBufferSource();
      ttsSource.buffer = result.audioBuffer;
      ttsSource.playbackRate.value = audioSpeed; 
      ttsSource.connect(dest);

      // 2. Video Track setup - Capture directly from video
      let stream: MediaStream;
      const vid = videoRef.current as any;
      
      if (vid.captureStream) {
        stream = vid.captureStream();
      } else if (vid.mozCaptureStream) {
        stream = vid.mozCaptureStream();
      } else {
        throw new Error("Browser capture not supported");
      }

      try {
         const originalVidStream = vid.captureStream ? vid.captureStream() : (vid.mozCaptureStream ? vid.mozCaptureStream() : null);
         if (originalVidStream && originalVidStream.getAudioTracks().length > 0) {
             const bgSource = audioContextRef.current.createMediaStreamSource(originalVidStream);
             const bgGain = audioContextRef.current.createGain();
             bgGain.gain.value = bgVolume;
             bgSource.connect(bgGain);
             bgGain.connect(dest);
         }
      } catch (e) {
         console.warn("Could not mix original video audio stream", e);
      }

      const combinedStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const mimeType = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
      const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 25000000, audioBitsPerSecond: 256000 });

      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      
      let active = true;
      recorder.onstop = () => {
        active = false;
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        a.download = `${result.fileName || 'dubbed_video'}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsRendering(false);
        setIsPlaying(false);
        if (videoRef.current) {
            videoRef.current.playbackRate = 1;
            videoRef.current.volume = 1; 
        }
      };

      recorder.start();
      
      const playbackRate = getSyncFactor();
      videoRef.current.playbackRate = playbackRate;
      videoRef.current.currentTime = 0;
      videoRef.current.volume = bgVolume; 

      try {
        if (!videoRef.current.error) {
           videoRef.current.play().catch(e => console.warn(e));
           // Enforce rate after play
           videoRef.current.playbackRate = playbackRate;
        }
      } catch (e) {
        console.warn("Video could not be played during recording", e);
      }

      ttsSource.start(0);
      
      ttsSourceRef.current = ttsSource; 

      let ttsEnded = false;
      let videoEnded = false;

      const finishRecording = () => {
         if (ttsEnded && videoEnded && active) {
            recorder.stop();
            videoRef.current?.pause();
            active = false;
         }
      };

      ttsSource.onended = () => {
        ttsEnded = true;
        finishRecording();
      };

      if (videoRef.current) {
        videoRef.current.onended = () => {
          videoEnded = true;
          finishRecording();
        };
      }
      
      const checkInterval = setInterval(() => {
          if (!active || !videoRef.current) {
              clearInterval(checkInterval);
              return;
          }
          
          let progressBase = 0;
          if (videoRef.current.duration > 0) {
             progressBase = Math.round((videoRef.current.currentTime / videoRef.current.duration) * 100);
          }
          setRenderProgress(progressBase);

          const isVideoDone = videoRef.current.ended || videoRef.current.currentTime >= videoRef.current.duration - 0.1;
          
          if (ttsEnded && isVideoDone) {
              videoEnded = true;
              finishRecording();
              clearInterval(checkInterval);
          }
      }, 500);

    } catch (e: any) {
      console.error("Recording failed", e);
      setIsRendering(false);
      alert("Yuklashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.");
    }
  };

  const formatTime = (seconds: number) => {
    return Math.round(seconds * 10) / 10 + 's';
  };

  return (
    <div className="w-full max-w-5xl mx-auto animate-fade-in-up">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
        
        {/* Left Column: Video Preview (lg:col-span-5) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="glass-panel rounded-3xl p-4 sm:p-5 shadow-2xl border border-white/5 flex flex-col h-full justify-between">
            <h3 className="text-base sm:text-lg font-bold mb-3.5 text-indigo-300 flex justify-between items-center px-0.5">
              <span>Video Ko'rish</span>
              {isRendering && <span className="text-[10px] sm:text-xs text-red-400 font-extrabold animate-pulse">● YOZILMOQDA...</span>}
            </h3>
            
            <div className="relative aspect-[9/16] bg-black/60 rounded-2xl overflow-hidden mx-auto max-h-[480px] w-full max-w-[270px] border border-white/5 shadow-2xl">
              <video 
                ref={videoRef}
                src={videoUrl || undefined}
                className="w-full h-full object-contain"
                playsInline
                muted
                preload="auto"
                controls={false}
                onLoadedMetadata={(e) => {
                   const duration = e.currentTarget.duration;
                   if (duration && !isNaN(duration)) {
                      setSyncStats(prev => ({ ...prev, videoDur: duration }));
                   }
                }}
              />
              {/* Sync Status Overlay */}
              <div className="absolute top-3 left-3 right-3 bg-[#060813]/80 backdrop-blur-md rounded-xl p-2.5 text-[10px] sm:text-xs text-white border border-white/5 z-10 pointer-events-none">
                <div className="flex justify-between mb-1.5 opacity-85">
                  <span>Original: {formatTime(syncStats.videoDur)}</span>
                  <span>Audio: {formatTime(syncStats.audioDur)}</span>
                </div>
                {autoSync ? (
                   <div className={`font-bold border-t border-white/5 pt-1.5 flex items-center gap-1 ${getSyncFactor() < 0.95 ? 'text-yellow-450' : (getSyncFactor() > 1.05 ? 'text-blue-450' : 'text-green-400')}`}>
                   {getSyncFactor() < 0.98 
                      ? `⚠️ Video ${Math.round((1 - getSyncFactor()) * 100)}% sekinlashdi`
                      : getSyncFactor() > 1.02 
                        ? `⚡ Video ${Math.round((getSyncFactor() - 1) * 100)}% tezlashdi`
                        : `✅ Video va Audio mos`}
                  </div>
                ) : (
                  <div className="text-gray-500 border-t border-white/5 pt-1.5">
                    Avto-moslash o'chirilgan
                  </div>
                )}
              </div>

              {/* Rendering Overlay */}
              {isRendering && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-4 text-center">
                  <div className="relative mb-4">
                    <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-500 border-t-transparent"></div>
                  </div>
                  <h3 className="text-white font-bold text-sm sm:text-base mb-1.5">Video saqlanmoqda... {renderProgress}%</h3>
                  <p className="text-yellow-500 text-[10px] sm:text-xs font-semibold leading-relaxed px-1">
                    Iltimos, sahifani yopmang va boshqa oynaga o'tmang! <br/>Aks holda video to'xtab qolishi mumkin.
                  </p>
                </div>
              )}
            </div>
            
            {/* Quick Player controls (Play/Pause, New) */}
            <div className="flex gap-3 mt-5">
              {!isPlaying && !isRendering ? (
                <button 
                 onClick={playDubbed}
                 className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white font-bold py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs sm:text-sm active:scale-[0.98] shadow-lg shadow-emerald-500/10"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                  Eshitish
                </button>
              ) : (
                <button 
                 onClick={pausePlayback}
                 disabled={isRendering}
                 className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs sm:text-sm active:scale-[0.98] disabled:opacity-50"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  To'xtatish
                </button>
              )}
              
              <button 
               onClick={onReset}
               disabled={isRendering}
               className="px-4 py-2.5 border border-white/10 rounded-xl hover:bg-white/5 text-gray-300 font-bold text-xs sm:text-sm transition-all active:scale-[0.98] disabled:opacity-50"
              >
                Yangi video
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Audio details & mixing (lg:col-span-7) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Card 1: Dubbing Text */}
          <div className="glass-panel rounded-3xl p-5 sm:p-6 shadow-2xl border border-white/5 relative overflow-hidden flex flex-col flex-grow">
            <div className="absolute top-0 right-0 px-3 py-1 bg-indigo-600 text-[10px] font-extrabold tracking-wider uppercase rounded-bl-2xl shadow-md z-10">
              O'zbekcha Tarjima
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 mb-3.5">Dublyaj Matni</h3>
            <div className="overflow-y-auto pr-1 max-h-[180px] custom-scrollbar">
                <p className="text-white text-lg sm:text-xl font-bold leading-relaxed">
                  "{result.translatedText}"
                </p>
            </div>
          </div>

          {/* Card 2: Mixing Controls & Action */}
          <div className="glass-panel rounded-3xl p-5 sm:p-6 shadow-2xl border border-white/5 flex flex-col gap-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">Ovoz aralashtirish (Mixing) sozlamalari</h3>
            
            <div className="space-y-4">
              {/* Auto Sync Switch */}
              <div className="flex items-center justify-between bg-white/[0.02] p-3 rounded-2xl border border-white/5">
                <div className="flex flex-col">
                  <span className="text-xs sm:text-sm text-white font-bold">Avto-Moslash (Auto-Sync)</span>
                  <span className="text-[10px] text-gray-500">Video tezligini ovoz uzunligiga moslab tahrirlash</span>
                </div>
                <button 
                  onClick={() => setAutoSync(!autoSync)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${autoSync ? 'bg-indigo-600' : 'bg-white/10'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoSync ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Volume Slider */}
                <div className="bg-white/[0.02] p-3.5 rounded-2xl border border-white/5">
                  <div className="flex justify-between text-xs font-bold text-gray-400 mb-2">
                    <span>Fon musiqasi ovozi</span>
                    <span className="text-indigo-400">{Math.round(bgVolume * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="0.5" 
                    step="0.01" 
                    value={bgVolume}
                    onChange={(e) => setBgVolume(parseFloat(e.target.value))}
                    disabled={isPlaying || isRendering}
                    className="custom-slider"
                  />
                </div>

                {/* Speed Slider */}
                <div className="bg-white/[0.02] p-3.5 rounded-2xl border border-white/5">
                  <div className="flex justify-between text-xs font-bold text-gray-400 mb-2">
                    <span>Ovoz (TTS) tezligi</span>
                    <span className="text-green-400">{audioSpeed}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.8" 
                    max="1.5" 
                    step="0.1" 
                    value={audioSpeed}
                    onChange={(e) => setAudioSpeed(parseFloat(e.target.value))}
                    disabled={isPlaying || isRendering}
                    className="custom-slider custom-slider-speed"
                  />
                </div>
              </div>
            </div>

            {/* Download Action button */}
            <div className="pt-2">
              <button 
                onClick={handleDownload}
                disabled={isRendering}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg shadow-indigo-600/20 disabled:opacity-50 text-sm sm:text-base"
              >
                {isRendering ? (
                   <>
                     <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                       <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                       <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                     </svg>
                     Videoga yozilmoqda...
                   </>
                ) : (
                   <>
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                     Yuklab Olish (Tayyor video)
                   </>
                )}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default DubbingStudio;