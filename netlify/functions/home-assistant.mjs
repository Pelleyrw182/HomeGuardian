const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const { prompt = '', profile = {}, tasks = [], image = '' } = await request.json()

    const hasImage = typeof image === 'string' && image.startsWith('data:image/')

    const systemPrompt =
      'You are HomeGuardian, a concise home maintenance assistant. Provide practical, safety-first guidance with clear next steps. When an image is provided, identify the likely issue visible in the photo and provide a concrete fix plan.'

    const userPrompt = [
      `Home profile: ${JSON.stringify(profile)}`,
      `Active tasks: ${JSON.stringify(tasks)}`,
      `Question: ${prompt}`,
      hasImage
        ? 'Respond in plain text with: (1) likely problem, (2) why this is likely, (3) step-by-step fix plan, (4) when to call a professional.'
        : 'Respond in plain text with: (1) priority assessment, (2) next 3 steps, (3) risk if ignored.',
    ].join('\n')

    const userMessageContent = hasImage
      ? [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: image } },
        ]
      : userPrompt

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessageContent },
        ],
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return new Response(JSON.stringify({ error: `OpenRouter request failed: ${text}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content

    if (!content) {
      return new Response(JSON.stringify({ error: 'No assistant response content returned' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ response: content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
