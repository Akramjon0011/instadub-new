import { GoogleGenAI, Modality, Type } from "@google/genai";
import { fileToGenerativePart, decodeAudioData } from "../utils/audioUtils";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY || '';

export const analyzeAndTranslateVideo = async (videoFile: File, duration: number, targetLanguage: string = "O'zbek"): Promise<{ translatedText: string; originalTranscription: string; topicSlug: string; recommendedVoice: string }> => {
  if (!apiKey) throw new Error("API Key topilmadi. Iltimos, '.env' faylida VITE_GEMINI_API_KEY ni sozlang.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const videoPart = await fileToGenerativePart(videoFile);

  const targetWordCount = Math.max(5, Math.ceil(duration * 2.2)); 

  const prompt = `
    You are a professional Content Localizer and Dubbing Director.
    Your target language for the dubbing explicitly is: ${targetLanguage}.
    Your goal is NOT just to translate, but to fully convey the MEANING, CONTEXT, and EMOTION of the video into the target language.
    The source video could be in ANY language (English, Uzbek, Russian, Spanish, etc.).

    METADATA:
    - Target Language: ${targetLanguage}
    - Video Duration: ${Math.ceil(duration)} seconds.
    - Target Word Count: Approximately ${targetWordCount} words (Adjust to match the video's pacing).

    TASKS:
    1. **ANALYZE DEEPLY (Visuals + Audio):** 
       - Detect the ORIGINAL SPOKEN LANGUAGE of the video.
       - Listen to the speech AND look at the video frames. 
       - Understand what is actually happening, not just what is being said.
    
    2. **CREATIVE ADAPTATION (CRITICAL):** 
       - **Do NOT translate word-for-word.** Literal translation is forbidden if it sounds dry.
       - **Convey the Full Meaning:** If the speaker uses a short phrase in their language but the visual context implies a larger concept, EXPLAIN IT clearly in ${targetLanguage}. 
       - **Localization:** Use natural, modern conversational tone for ${targetLanguage} (TikTok/Instagram style). Use idioms that fit the language naturally.
       - **Objective:** The listener in ${targetLanguage} should understand the video BETTER than someone just listening to the original audio.

    3. **TIMING & PACING:** 
       - The translated text length MUST match the video flow temporally.
       - If the video is fast-paced, keep it punchy.
       - If the video is slow and atmospheric, use richer, descriptive words to fill the silence.

    4. **VOICE MATCHING:** Listen to the original speaker's gender and tone.
       - If target language is Russian or English, prefer Puck or Charon for men, and Kore or Aoede for women.
       - If FEMALE: Select 'Kore' (Natural/Clear) or 'Zephyr' (Soft/Calm).
       - If MALE: Select 'Puck' (Natural/Mid), 'Charon' (Deep/Calm), or 'Fenrir' (Deep/Intense/Narrator).
    
    5. **TOPIC:** Create a file-safe slug describing the topic.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        videoPart,
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          source_language: { type: Type.STRING, description: "The native language of the video (e.g., 'Uzbek', 'English')" },
          original_transcription: { type: Type.STRING, description: "Transcription of the original audio in its native language" },
          translated_script: { type: Type.STRING, description: `The adapted, rich, and context-aware script perfectly translated into ${targetLanguage}` },
          topic_slug: { type: Type.STRING, description: "short_topic_name" },
          recommended_voice: { type: Type.STRING, description: "VoiceName: Fenrir, Charon, Puck, or Kore" }
        },
        required: ["source_language", "original_transcription", "translated_script", "topic_slug", "recommended_voice"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini.");

  try {
    const cleanJsonStr = text.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
    const json = JSON.parse(cleanJsonStr);
    
    return {
      translatedText: json.translated_script || "Tarjima matni bo'sh qoldi.",
      originalTranscription: json.original_transcription || "Asl matn topilmadi",
      topicSlug: json.topic_slug || 'video_dublyaj',
      recommendedVoice: json.recommended_voice || 'Fenrir' 
    };
  } catch (e) {
    let rawTextFallback = text.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
    if (rawTextFallback.length < 5) rawTextFallback = "Tarjima topilmadi xatosi API dan keldi.";
    return { 
      translatedText: rawTextFallback, 
      originalTranscription: "Not available",
      topicSlug: 'video_dublyaj',
      recommendedVoice: 'Fenrir'
    };
  }
};

export const generateSpeech = async (text: string, audioContext: AudioContext, voiceName: string = 'Fenrir'): Promise<AudioBuffer> => {
  if (!apiKey) throw new Error("API Key topilmadi. Iltimos, VITE_GEMINI_API_KEY sozlanganligini tekshiring.");
  
  const cleanText = text?.trim() || "Texnik xatolik: matn topilmadi.";

  const ai = new GoogleGenAI({ apiKey });

  console.log(`Generating speech with voice: ${voiceName}`);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: cleanText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("No audio data returned from Gemini.");
  }

  return await decodeAudioData(base64Audio, audioContext, 24000, 1);
};