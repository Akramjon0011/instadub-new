import { GoogleGenAI, Modality } from "@google/genai";
import { fileToGenerativePart, decodeAudioData } from "../utils/audioUtils";

const apiKey = process.env.API_KEY || '';

// 1. Analyze Video: English Audio -> Uzbek Text & Topic & Voice Tone
export const analyzeAndTranslateVideo = async (videoFile: File, duration: number): Promise<{ translatedText: string; originalTranscription: string; topicSlug: string; recommendedVoice: string }> => {
  if (!apiKey) throw new Error("API Key topilmadi. Iltimos, API kaliti sozlanganligini tekshiring.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const videoPart = await fileToGenerativePart(videoFile);

  // We calculate approx word count needed. 
  // Average speaking rate is ~2-2.5 words per second for clear TTS.
  const targetWordCount = Math.max(5, Math.ceil(duration * 2.2)); 

  const prompt = `
    You are a professional Content Localizer and Dubbing Director for the Uzbek market.
    Your goal is NOT just to translate, but to fully convey the MEANING, CONTEXT, and EMOTION of the video.

    METADATA:
    - Video Duration: ${Math.ceil(duration)} seconds.
    - Target Word Count: Approximately ${targetWordCount} words (Adjust to match the video's pacing).

    TASKS:
    1. **ANALYZE DEEPLY (Visuals + Audio):** 
       - Listen to the speech AND look at the video frames. 
       - Understand what is actually happening, not just what is being said.
    
    2. **CREATIVE ADAPTATION (CRITICAL):** 
       - **Do NOT translate word-for-word.** Literal translation is forbidden if it sounds dry.
       - **Convey the Full Meaning:** If the speaker uses a short English phrase but the visual context implies a larger concept, EXPLAIN IT in Uzbek. 
       - **Localization:** Use natural, modern Uzbek (Instagram/TikTok style). Use metaphors or idioms that Uzbeks understand if they fit the context.
       - **Visual Narration:** If the speaker says "Look at this" but doesn't describe it, you MUST describe what "this" is in the Uzbek dub (e.g., instead of "Bunga qarang", say "Mana bu ajoyib manzaraga qarang").
       - **Objective:** The Uzbek listener should understand the video BETTER than someone just listening to the English audio.

    3. **TIMING & PACING:** 
       - The Uzbek text length MUST match the video flow.
       - If the video is fast-paced, keep it punchy.
       - If the video is slow and atmospheric, use richer, descriptive words to fill the silence naturally.

    4. **VOICE MATCHING:** Listen to the original speaker's gender and tone.
       - If FEMALE: Select 'Kore' (Natural/Clear) or 'Zephyr' (Soft/Calm).
       - If MALE: Select 'Puck' (Natural/Mid), 'Charon' (Deep/Calm), or 'Fenrir' (Deep/Intense/Narrator).
    
    5. **TOPIC:** Create a file-safe slug (e.g. 'tuxum_haqida').

    Output JSON format:
    {
      "english_transcription": "Transcription of the original audio...",
      "uzbek_translation": "The adapted, rich, and context-aware Uzbek narration...",
      "topic_slug": "short_topic_name",
      "recommended_voice": "VoiceName"
    }
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: {
      parts: [
        videoPart,
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini.");

  try {
    const json = JSON.parse(text);
    return {
      translatedText: json.uzbek_translation,
      originalTranscription: json.english_transcription,
      topicSlug: json.topic_slug || 'video_dublyaj',
      recommendedVoice: json.recommended_voice || 'Fenrir' // Default to Fenrir if failed
    };
  } catch (e) {
    console.error("Failed to parse JSON", e);
    return { 
      translatedText: text, 
      originalTranscription: "Not available",
      topicSlug: 'video_dublyaj',
      recommendedVoice: 'Fenrir'
    };
  }
};

// 2. Generate Audio: Uzbek Text -> Audio Buffer (Now accepts voiceName)
export const generateUzbekSpeech = async (text: string, audioContext: AudioContext, voiceName: string = 'Fenrir'): Promise<AudioBuffer> => {
  if (!apiKey) throw new Error("API Key topilmadi. Iltimos, API kaliti sozlanganligini tekshiring.");

  const ai = new GoogleGenAI({ apiKey });

  console.log(`Generating speech with voice: ${voiceName}`);

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: text }] }],
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