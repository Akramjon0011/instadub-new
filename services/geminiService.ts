import { GoogleGenAI, Modality } from "@google/genai";
import { fileToGenerativePart, decodeAudioData } from "../utils/audioUtils";

const apiKey = process.env.API_KEY || '';

// 1. Analyze Video: English Audio -> Target Language Text & Topic & Voice Tone
export const analyzeAndTranslateVideo = async (videoFile: File, duration: number, targetLanguage: string = "O'zbek"): Promise<{ translatedText: string; originalTranscription: string; topicSlug: string; recommendedVoice: string }> => {
  if (!apiKey) throw new Error("API Key topilmadi. Iltimos, API kaliti sozlanganligini tekshiring.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const videoPart = await fileToGenerativePart(videoFile);

  // We calculate approx word count needed. 
  // Average speaking rate is ~2-2.5 words per second for clear TTS.
  const targetWordCount = Math.max(5, Math.ceil(duration * 2.2)); 

  const prompt = `
    You are a professional Content Localizer and Dubbing Director.
    Your target language for the dubbing scripts is: ${targetLanguage}.
    Your goal is NOT just to translate, but to fully convey the MEANING, CONTEXT, and EMOTION of the video into the target language.

    METADATA:
    - Target Language: ${targetLanguage}
    - Video Duration: ${Math.ceil(duration)} seconds.
    - Target Word Count: Approximately ${targetWordCount} words (Adjust to match the video's pacing).

    TASKS:
    1. **ANALYZE DEEPLY (Visuals + Audio):** 
       - Listen to the speech AND look at the video frames. 
       - Understand what is actually happening, not just what is being said.
    
    2. **CREATIVE ADAPTATION (CRITICAL):** 
       - **Do NOT translate word-for-word.** Literal translation is forbidden if it sounds dry.
       - **Convey the Full Meaning:** If the speaker uses a short English phrase but the visual context implies a larger concept, EXPLAIN IT clearly in ${targetLanguage}. 
       - **Localization:** Use natural, modern conversational tone for ${targetLanguage} (TikTok/Instagram style). Use idioms that fit the language naturally.
       - **Objective:** The listener in ${targetLanguage} should understand the video BETTER than someone just listening to the original audio.

    3. **TIMING & PACING:** 
       - The translated text length MUST match the video flow temporally.
       - If the video is fast-paced, keep it punchy.
       - If the video is slow and atmospheric, use richer, descriptive words to fill the silence.

    4. **VOICE MATCHING:** Listen to the original speaker's gender and tone.
       - If target language is Russian or English, prefer Puck or Charon for men, and Kore for women.
       - If FEMALE: Select 'Kore' (Natural/Clear) or 'Zephyr' (Soft/Calm).
       - If MALE: Select 'Puck' (Natural/Mid), 'Charon' (Deep/Calm), or 'Fenrir' (Deep/Intense/Narrator).
    
    5. **TOPIC:** Create a file-safe slug describing the topic.

    Output JSON format exactly like this:
    {
      "original_transcription": "Transcription of the original audio...",
      "translated_script": "The adapted, rich, and context-aware script in ${targetLanguage}...",
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
      translatedText: json.translated_script || json.uzbek_translation, // fallback if it disobeys
      originalTranscription: json.original_transcription || json.english_transcription,
      topicSlug: json.topic_slug || 'video_dublyaj',
      recommendedVoice: json.recommended_voice || 'Fenrir' 
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

// 2. Generate Audio: Target Text -> Audio Buffer
export const generateSpeech = async (text: string, audioContext: AudioContext, voiceName: string = 'Fenrir'): Promise<AudioBuffer> => {
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