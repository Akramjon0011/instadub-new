import { decodeAudioData } from "../utils/audioUtils";
import { auth } from "./firebase";

export const analyzeAndTranslateVideo = async (
  videoUrl: string,
  duration: number,
  targetLanguage: string = "O'zbek",
  mimeType: string = "video/mp4"
): Promise<{ translatedText: string; originalTranscription: string; topicSlug: string; recommendedVoice: string }> => {
  
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error("Sahifaga kiring: Dublyaj qilish uchun tizimga kirgan bo'lishingiz shart.");
  }

  console.log(`Sending video URL to backend proxy for translation: ${videoUrl}`);

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({
      videoUrl,
      duration,
      targetLanguage,
      mimeType
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Tahlil qilishda xatolik yuz berdi (Status: ${response.status})`);
  }

  const json = await response.json();

  return {
    translatedText: json.translatedText || "Tarjima matni bo'sh qoldi.",
    originalTranscription: json.originalTranscription || "Asl matn topilmadi",
    topicSlug: json.topicSlug || 'video_dublyaj',
    recommendedVoice: json.recommendedVoice || 'Fenrir'
  };
};

export const generateSpeech = async (
  text: string,
  audioContext: AudioContext,
  voiceName: string = 'Fenrir'
): Promise<AudioBuffer> => {
  const cleanText = text?.trim() || "Texnik xatolik: matn topilmadi.";

  console.log(`Requesting speech generation from serverless proxy: ${voiceName}`);

  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error("Sahifaga kiring: Ovoz yaratish uchun tizimga kirgan bo'lishingiz shart.");
  }

  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({
      text: cleanText,
      voiceName
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Ovoz yaratishda xatolik yuz berdi (Status: ${response.status})`);
  }

  const json = await response.json();
  const base64Audio = json.audio;

  if (!base64Audio) {
    throw new Error("Gemini API dan audio ma'lumotlari qaytmadi.");
  }

  return await decodeAudioData(base64Audio, audioContext, 24000, 1);
};
