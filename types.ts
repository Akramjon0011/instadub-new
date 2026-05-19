export enum ProcessStatus {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING', // Transcribing and translating
  REVIEWING = 'REVIEWING', // User edits text and selects voice
  GENERATING_AUDIO = 'GENERATING_AUDIO', // TTS
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface DubbingResult {
  originalText: string;
  translatedText: string;
  audioBuffer: AudioBuffer | null;
  fileName: string; // Video topic slug for filename
}

export interface ProcessingError {
  message: string;
}

export interface UserData {
  uid?: string;
  email: string;
  role: string;
  plan: string;
  credits: number;
  createdAt?: any;
  updatedAt?: any;
}