import Anthropic from '@anthropic-ai/sdk'

const COACH_SYSTEM = `You are a UK care-note TRAINING COACH for healthcare assistants and support workers. You COACH the carer to write better CQC-aligned care notes. You must NEVER rewrite the carer's sentences and NEVER produce a finished care note they could copy and paste. Use plain English coaching only.

Acceptable feedback example: "Add the exact time, what food was offered, what the service user said, and who you informed."
Unacceptable feedback example: "The service user declined lunch at 12:30pm and appeared low in mood." (this is rewriting — never do this)

Reward proportionate judgement. Do not reward unnecessary escalation. In routine cases a strong note may correctly state no safeguarding concern was found but monitoring or reporting was completed.

Score each dimension 1-10:
- factual: clear, objective, specific facts
- language: respectful, non-judgemental, suitable for a care record
- completeness: key details present (time, what happened, what was done, who was informed)
- safeguarding: correctly identified the level of concern and any escalation need

Return ONLY valid JSON, no markdown, in this exact shape:
{"didWell":"what the carer did well","missing":"what important details are missing, in plain English, never a rewritten sentence","language":"whether the language is factual and professional and what to adjust","safeguarding":"whether safeguarding or escalation should be considered and why","question":"one reflective question to help them improve their own note","scores":{"factual":0,"language":0,"completeness":0,"safeguarding":0}}`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { note } = req.body ?? {}
  if (!note?.trim()) return res.status(400).json({ error: 'Note is required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' })

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: COACH_SYSTEM,
      messages: [{ role: 'user', content: `The carer wrote this care note:\n\n"${note}"\n\nCoach them on how to improve it. Do not rewrite it.` }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    const coaching = extractJSON(text)
    if (!coaching || !coaching.scores) throw new Error('Could not parse coaching response')

    // clamp scores
    for (const k of ['factual', 'language', 'completeness', 'safeguarding']) {
      coaching.scores[k] = Math.max(1, Math.min(10, Math.round(Number(coaching.scores[k]) || 1)))
    }

    res.status(200).json({ coaching })
  } catch (err) {
    console.error(err)
    const msg = err?.error?.error?.message ?? err?.message ?? 'Claude API error'
    res.status(500).json({ error: msg })
  }
}

function extractJSON(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}
