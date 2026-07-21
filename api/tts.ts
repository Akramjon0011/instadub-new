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

function getTTSAI(): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: VERTEX_PROJECT,
    location: "us-central1",
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
    console.log(`Generating speech using gemini-3.1-flash-tts-preview for voice: ${actualVoiceName}...`);
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text: text.trim() }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: actualVoiceName },
          },
        },
      },
    });

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
