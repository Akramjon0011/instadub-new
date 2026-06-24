# Deploy Environment Script for Vercel (Non-interactive)
Write-Host "Adding VITE_GEMINI_API_KEY..."
vercel.cmd env add VITE_GEMINI_API_KEY production --value "AIzaSyCg99fqnNNmolXAHLiXZR8wuXeUzWtFChE" --yes --force --non-interactive

Write-Host "Adding VITE_FIREBASE_API_KEY..."
vercel.cmd env add VITE_FIREBASE_API_KEY production --value "AIzaSyBbXdw0_EgEGIit8FkaZ_oZ5NxLK9lD0RM" --yes --force --non-interactive

Write-Host "Adding VITE_FIREBASE_AUTH_DOMAIN..."
vercel.cmd env add VITE_FIREBASE_AUTH_DOMAIN production --value "ornate-loader-471914-h0.firebaseapp.com" --yes --force --non-interactive

Write-Host "Adding VITE_FIREBASE_PROJECT_ID..."
vercel.cmd env add VITE_FIREBASE_PROJECT_ID production --value "ornate-loader-471914-h0" --yes --force --non-interactive

Write-Host "Adding VITE_FIREBASE_STORAGE_BUCKET..."
vercel.cmd env add VITE_FIREBASE_STORAGE_BUCKET production --value "ornate-loader-471914-h0.firebasestorage.app" --yes --force --non-interactive

Write-Host "Adding VITE_FIREBASE_MESSAGING_SENDER_ID..."
vercel.cmd env add VITE_FIREBASE_MESSAGING_SENDER_ID production --value "16773751502" --yes --force --non-interactive

Write-Host "Adding VITE_FIREBASE_APP_ID..."
vercel.cmd env add VITE_FIREBASE_APP_ID production --value "1:16773751502:web:ed9773cc9fcc827a4c669f" --yes --force --non-interactive

Write-Host "Adding VITE_FIREBASE_DATABASE_ID..."
vercel.cmd env add VITE_FIREBASE_DATABASE_ID production --value "ai-studio-157ea605-c159-4711-a4c4-701f821fb861" --yes --force --non-interactive

Write-Host "Deploying to production..."
vercel.cmd deploy --prod --yes --non-interactive
