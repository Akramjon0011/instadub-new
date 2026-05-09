import { fileToGenerativePart, decodeAudioData } from "../utils/audioUtils";

const API_BASE = import.meta.env.VITE_API_URL || '';

export const analyzeAndTranslateVideo = async (videoFile: File, duration: number, targetLanguage: string = "O'zbek"): Promise<{ translatedText: string; originalTranscription: string; topicSlug: string; recommendedVoice: string }> => {
  const videoPart = await fileToGenerativePart(videoFile);

  const response = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoPart, duration, targetLanguage })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Server xatosi: ${response.status}`);
  }

  const data = await response.json();
  return {
    translatedText: data.translatedText,
    originalTranscription: data.originalTranscription,
    topicSlug: data.topicSlug,
    recommendedVoice: data.recommendedVoice
  };
};

export const generateSpeech = async (text: string, audioContext: AudioContext, voiceName: string = 'Fenrir'): Promise<AudioBuffer> => {
  const cleanText = text?.trim() || "Texnik xatolik: matn topilmadi.";

  const response = await fetch(`${API_BASE}/api/generate-speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanText, voiceName })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Server xatosi: ${response.status}`);
  }

  const data = await response.json();
  const base64Audio = data.base64Audio;
  
  if (!base64Audio) {
    throw new Error("API'dan audio ma'lumot qaytmadi.");
  }

  return await decodeAudioData(base64Audio, audioContext, 24000, 1);
};