export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Optional password. Set ACCESS_CODE in your host's environment variables.
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get('x-access-code') !== code) {
    return new Response('Unauthorized', { status: 401 });
  }

  let prompt;
  try { ({ prompt } = await req.json()); } catch { return new Response('Bad request', { status: 400 }); }
  if (typeof prompt !== 'string' || !prompt || prompt.length > 150000) {
    return new Response('Bad request', { status: 400 });
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 4000,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!upstream.ok) return new Response('Upstream error', { status: upstream.status });

  // Turn Anthropic's event stream into plain text the page can append.
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  const stream = upstream.body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('data: ')) continue;
        try {
          const j = JSON.parse(l.slice(6));
          if (j.type === 'content_block_delta' && j.delta.type === 'text_delta') ctrl.enqueue(enc.encode(j.delta.text));
        } catch {}
      }
    }
  }));
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
