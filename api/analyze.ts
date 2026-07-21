import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { enforceRateLimit } from './rateLimit';

// Initialize Firebase Admin (only project ID needed for token verification)
const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'ornate-loader-471914-h0';
if (!getApps().length) {
  initializeApp({
    projectId: projectId,
  });
}

const VERTEX_PROJECT = process.env.VERTEX_PROJECT || "gen-lang-client-0017562692";

function getVertexCredentials() {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON sozlanmagan. Host'ning Environment Variables bo'limiga Vertex service account JSON qo'shing.");
  }
  const sa = JSON.parse(raw);
  if (typeof sa.private_key === "string") {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }
  return sa;
}

function getAI(location = "global"): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: VERTEX_PROJECT,
    location,
    googleAuthOptions: { credentials: getVertexCredentials(), scopes: ["https://www.googleapis.com/auth/cloud-platform"] },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Verify User Session via Firebase Auth Token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Kirish taqiqlangan: Token topilmadi.' });
  }

  let uid: string;
  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch (err: any) {
    console.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Seans muddati tugagan yoki xato token.' });
  }

  try {
    await enforceRateLimit(uid, 'analyze');
  } catch (err: any) {
    return res.status(429).json({ error: err.message });
  }

  // 2. Parse request body
  const { videoUrl, duration, targetLanguage, mimeType } = req.body;
  if (!videoUrl || !duration) {
    return res.status(400).json({ error: "Noto'g'ri so'rov: videoUrl va duration kiritilishi shart." });
  }

  const actualTargetLanguage = targetLanguage || "O'zbek";
  const actualMimeType = mimeType || 'video/mp4';

  try {
    // 3. Download the video from Firebase Storage
    console.log(`Downloading video from storage: ${videoUrl}`);
    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Video yuklab olishda xatolik yuz berdi. Status: ${downloadResponse.status}`);
    }

    const contentLength = downloadResponse.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 25 * 1024 * 1024) {
      throw new Error("Video hajmi 25MB dan oshmasligi kerak (Vercel memory limit).");
    }

    const arrayBuffer = await downloadResponse.arrayBuffer();
    const videoBuffer = Buffer.from(arrayBuffer);
    
    if (videoBuffer.length > 25 * 1024 * 1024) {
      throw new Error("Video hajmi 25MB dan oshmasligi kerak.");
    }

    // 4. Initialize Gemini API Client via Vertex AI
    const ai = getAI("global");

    // 5. Upload video to Gemini File API
    console.log(`Uploading video buffer to Gemini File API (size: ${videoBuffer.length} bytes)...`);
    const blob = new Blob([videoBuffer], { type: actualMimeType });
    const file = await ai.files.upload({
      file: blob,
      config: {
        mimeType: actualMimeType,
      }
    });

    console.log(`Video uploaded to Gemini. File URI: ${file.uri}`);

    // 6. Request translation and transcription
    const targetWordCount = Math.max(5, Math.ceil(duration * 2.2));
    const prompt = `
      You are a professional Content Localizer and Dubbing Director.
      Your target language for the dubbing explicitly is: ${actualTargetLanguage}.
      Your goal is NOT just to translate, but to fully convey the MEANING, CONTEXT, and EMOTION of the video into the target language.
      The source video could be in ANY language (English, Uzbek, Russian, Spanish, etc.).

      METADATA:
      - Target Language: ${actualTargetLanguage}
      - Video Duration: ${Math.ceil(duration)} seconds.
      - Target Word Count: Approximately ${targetWordCount} words (Adjust to match the video's pacing).

      TASKS:
      1. **ANALYZE DEEPLY (Visuals + Audio):**
         - Detect the ORIGINAL SPOKEN LANGUAGE of the video.
         - Listen to the speech AND look at the video frames.
         - Understand what is actually happening, not just what is being said.

      2. **CREATIVE ADAPTATION (CRITICAL):**
         - **Do NOT translate word-for-word.** Literal translation is forbidden if it sounds dry.
         - **Convey the Full Meaning:** If the speaker uses a short phrase in their language but the visual context implies a larger concept, EXPLAIN IT clearly in ${actualTargetLanguage}.
         - **Localization:** Use natural, modern conversational tone for ${actualTargetLanguage} (TikTok/Instagram style). Use idioms that fit the language naturally.
         - **Objective:** The listener in ${actualTargetLanguage} should understand the video BETTER than someone just listening to the original audio.

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

    console.log(`Generating content with 2026 models chain (gemini-2.5-flash -> gemini-2.0-flash -> gemini-1.5-flash)...`);
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let response;
    let lastErr;
    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting model: ${modelName}...`);
        response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
                { text: prompt }
              ]
            }
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                source_language: { type: 'STRING', description: "The native language of the video (e.g., 'Uzbek', 'English')" },
                original_transcription: { type: 'STRING', description: "Transcription of the original audio in its native language" },
                translated_script: { type: 'STRING', description: `The adapted, rich, and context-aware script perfectly translated into ${actualTargetLanguage}` },
                topic_slug: { type: 'STRING', description: "short_topic_name" },
                recommended_voice: { type: 'STRING', description: "VoiceName: Male (Fenrir, Charon, Puck, Orpheus, Aoede, Zephyr) or Female (Kore, Leda, Callisto, Evadne, Amalthea, Despina)" }
              },
              required: ["source_language", "original_transcription", "translated_script", "topic_slug", "recommended_voice"]
            }
          }
        });
        if (response) {
          console.log(`Successfully generated content using ${modelName}`);
          break;
        }
      } catch (err) {
        console.warn(`Model ${modelName} attempt failed:`, err);
        lastErr = err;
      }
    }

    if (!response) {
      throw lastErr || new Error("AI Studio / Vertex AI modellari javob bermadi.");
    }

    // 7. Clean up file in Gemini File API
    try {
      console.log(`Cleaning up file ${file.name} from Gemini File API...`);
      await ai.files.delete({ name: file.name });
    } catch (cleanupErr) {
      console.warn("Failed to delete Gemini temporary file:", cleanupErr);
    }

    const text = response.text;
    if (!text) {
      throw new Error("Gemini API dan bo'sh javob keldi.");
    }

    const cleanJsonStr = text.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
    const json = JSON.parse(cleanJsonStr);

    return res.status(200).json({
      sourceLanguage: json.source_language || 'English',
      originalTranscription: json.original_transcription || '',
      translatedText: json.translated_script || '',
      topicSlug: json.topic_slug || 'video_dublyaj',
      recommendedVoice: json.recommended_voice || 'Fenrir'
    });

  } catch (err: any) {
    console.error('Error in analyze API:', err);
    return res.status(500).json({ error: err.message || "Tahlil qilishda kutilmagan xatolik." });
  }
}
