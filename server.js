const http = require('http');
const fs = require('fs');
const path = require('path');
 
const MODEL = 'gemini-3.1-flash-lite'; // free-tier text model
 
const UNDERSTAND_SYSTEM =
  'You check whether a request is understood. Do NOT do the task. Reply with JSON only: ' +
  '{"restatement":"one sentence","assumptions":["max 3, each under 15 words"],"questions":["max 2, each under 15 words"]}';
 
const IMPROVE_SYSTEM =
  'You rewrite a user request into a clear, well-structured prompt for an AI assistant. Do NOT answer the request. ' +
  'Use the original request, the assumptions the user marked WRONG, and the answers to the questions. ' +
  'Write the prompt with these labelled parts: Role, Goal, Context, Constraints, Output format. ' +
  'Turn each wrong assumption into a constraint. Keep it under 150 words. Reply with the prompt text only.';
 
async function callClaude(system, user, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: maxTokens }
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'API error');
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || '').join('');
}
 
const handlers = {
  '/api/understand': async (b) => {
    const text = await callClaude(UNDERSTAND_SYSTEM, String(b.request || ''), 300);
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  },
  '/api/improve': async (b) => {
    const wrong = (b.wrong || []).map((w) => '- ' + w).join('\n') || '(none)';
    const answers = (b.answers || []).map((x) => `- Q: ${x.q}\n  A: ${x.a}`).join('\n') || '(none)';
    const input = `Original request:\n${b.request}\n\nAssumptions marked WRONG:\n${wrong}\n\nAnswers:\n${answers}`;
    return { prompt: (await callClaude(IMPROVE_SYSTEM, input, 400)).trim() };
  },
  '/api/run': async (b) => ({ answer: (await callClaude('', String(b.prompt || ''), 800)).trim() })
};
 
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(err ? 'index.html not found' : data);
    });
  } else if (req.method === 'POST' && handlers[url]) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      try {
        const out = await handlers[url](JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(404); res.end();
  }
}).listen(process.env.PORT || 3000, () => console.log('Running on port ' + (process.env.PORT || 3000)));
 

