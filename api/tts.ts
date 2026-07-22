import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { enforceRateLimit } from './rateLimit';

export const maxDuration = 60; // Set Vercel timeout to 60 seconds

// Initialize Firebase Admin (only project ID needed for token verification)
const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'ornate-loader-471914-h0';
if (!getApps().length) {
  initializeApp({
    projectId: projectId,
  });
}

const VERTEX_PROJECT = process.env.VERTEX_PROJECT || "gen-lang-client-0017562692";

function getTTSAI(): GoogleGenAI {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (raw) {
    try {
      const sa = JSON.parse(raw);
      if (typeof sa.private_key === "string") {
        sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      }
      return new GoogleGenAI({
        vertexai: true,
        project: process.env.VERTEX_PROJECT || sa.project_id || VERTEX_PROJECT,
        location: "us-central1",
        googleAuthOptions: { credentials: sa, scopes: ["https://www.googleapis.com/auth/cloud-platform"] },
      });
    } catch (e) {
      console.warn("GCP_SERVICE_ACCOUNT_JSON parse qilishda xatolik, GEMINI_API_KEY ga o'tilmoqda...", e);
    }
  }

  if (apiKey) {
    return new GoogleGenAI({ apiKey });
  }

  throw new Error("GCP_SERVICE_ACCOUNT_JSON yoki GEMINI_API_KEY sozlanmagan. Vercel Environment Variables bo'limiga kalit qo'shing.");
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
    await enforceRateLimit(uid, 'tts');
  } catch (err: any) {
    return res.status(429).json({ error: err.message });
  }

  // 2. Parse request body
  const { text, voiceName } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Noto'g'ri so'rov: text kiritilishi shart." });
  }

  const actualVoiceName = voiceName || 'Fenrir';

  try {
    // 3. Initialize Gemini API Client via Vertex AI
    const ai = getTTSAI();

    // 4. Request TTS Audio from Gemini
    console.log(`Generating speech using 2026 TTS models chain for voice: ${actualVoiceName}...`);
    const modelsToTry = ['gemini-3.5-flash-lite'];
    let response;
    let lastErr;
    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting TTS model: ${modelName}...`);
        const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
        const actualApiModel = modelName.includes('3.') || modelName.includes('2.') ? 'gemini-1.5-flash' : modelName;
        const genOptions = {
          model: actualApiModel,
          contents: [{ parts: [{ text: text.trim() }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: actualVoiceName },
              },
            },
          },
        };

        try {
          response = await ai.models.generateContent(genOptions);
        } catch (attemptErr: any) {
          const msg = attemptErr?.message || String(attemptErr);
          if ((msg.includes("403") || msg.includes("PERMISSION_DENIED")) && apiKey) {
            console.warn(`Vertex AI TTS returned 403. Retrying model ${modelName} with GEMINI_API_KEY via AI Studio...`, attemptErr);
            const aiStudio = new GoogleGenAI({ apiKey });
            response = await aiStudio.models.generateContent(genOptions);
          } else {
            throw attemptErr;
          }
        }
        if (response) {
          console.log(`Successfully generated TTS audio using ${modelName}`);
          break;
        }
      } catch (err) {
        console.warn(`TTS Model ${modelName} attempt failed:`, err);
        lastErr = err;
      }
    }

    if (!response) {
      throw lastErr || new Error("AI TTS modellari javob bermadi.");
    }

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("Gemini TTS API dan audio ma'lumotlari qaytmadi.");
    }

    return res.status(200).json({
      audio: base64Audio
    });

  } catch (err: any) {
    console.error('Error in TTS API:', err);
    return res.status(500).json({ error: err.message || "Ovoz yaratishda kutilmagan xatolik." });
  }
}
