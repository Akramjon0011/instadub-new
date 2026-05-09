// Base64 decoding
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// PCM Data decoding to AudioBuffer
export async function decodeAudioData(
  base64String: string,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const data = decode(base64String);
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result as string;
      if (!base64String) {
        return reject(new Error("File empty or reading failed."));
      }
      const parts = base64String.split(',');
      let base64Data = parts[1];
      
      // Fallback if data doesn't split properly
      if (!base64Data) {
         if (base64String.length > 0 && !base64String.startsWith('data:')) {
             base64Data = base64String;
         } else {
             return reject(new Error("Invalid base64 string from file reader."));
         }
      }

      if (base64Data.length === 0) {
          return reject(new Error("Base64 string is empty."));
      }

      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type || 'video/mp4',
        },
      });
    };
    reader.onerror = (e) => reject(new Error("File reader error: " + e));
    reader.readAsDataURL(file);
  });
};
