import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API Routes
  app.post('/api/analyze', async (req, res) => {
    try {
      const { videoPart, duration, targetLanguage } = req.body;
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

      if (!apiKey) {
        return res.status(500).json({ error: "API Key topilmadi. Iltimos, API kaliti sozlanganligini tekshiring." });
      }

      const ai = new GoogleGenAI({ apiKey });
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
        
        res.json({
          translatedText: json.translated_script || "Tarjima matni bo'sh qoldi (yoki video ichida ovoz aniqlanmadi).",
          originalTranscription: json.original_transcription || "Asl matn topilmadi",
          topicSlug: json.topic_slug || 'video_dublyaj',
          recommendedVoice: json.recommended_voice || 'Fenrir' 
        });
      } catch (e) {
        let rawTextFallback = text.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
        if (rawTextFallback.length < 5) rawTextFallback = "Tarjima topilmadi xatosi API dan keldi.";
        res.json({ 
          translatedText: rawTextFallback, 
          originalTranscription: "Not available",
          topicSlug: 'video_dublyaj',
          recommendedVoice: 'Fenrir'
        });
      }
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Xatolik yuz berdi" });
    }
  });

  app.post('/api/generate-speech', async (req, res) => {
    try {
      const { text, voiceName = 'Fenrir' } = req.body;
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

      if (!apiKey) {
        return res.status(500).json({ error: "API Key topilmadi. Iltimos, API kaliti sozlanganligini tekshiring." });
      }

      console.log(`Generating speech with voice: ${voiceName}`);

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
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
        return res.status(500).json({ error: "No audio data returned from Gemini." });
      }

      res.json({ base64Audio });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Xatolik yuz berdi" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
