// Configuração do Supabase (projeto "mmibnm").
// A anon key é pública por design e só permite leitura (RLS).
// Troque estes valores se precisar apontar para outro projeto.
window.APP_CONFIG = {
  SUPABASE_URL: "https://whtbzermbyuxicswyvsy.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndodGJ6ZXJtYnl1eGljc3d5dnN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NzU2ODIsImV4cCI6MjEwNjQ1MTY4Mn0.ivEsQGVp2hEyjTSWwV58-OPoZx9tY7aTFiGImFrbmnw",
  // Se false, usa somente o snapshot local (data.json).
  USE_LIVE: true
};
