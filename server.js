import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'

// Manually read .env — works regardless of dotenv version
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1].trim()] = match[2].trim()
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY
console.log('API key loaded:', API_KEY ? '✅ yes' : '❌ missing')

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

function getClient() {
  return new Anthropic({ apiKey: API_KEY })
}

function errorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Invalid API key. Check your ANTHROPIC_API_KEY in the .env file.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limit reached. Please wait a moment and try again.'
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`
  return err?.message ?? 'Unknown error'
}

// Care Note Training Coach — coaches, never rewrites
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

function extractJSON(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

app.post('/api/feedback', async (req, res) => {
  const { note } = req.body
  if (!note?.trim()) return res.status(400).json({ error: 'Note is required' })
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured. Add your ANTHROPIC_API_KEY to the .env file.' })

  try {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: COACH_SYSTEM,
      messages: [{ role: 'user', content: `The carer wrote this care note:\n\n"${note}"\n\nCoach them on how to improve it. Do not rewrite it.` }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    const coaching = extractJSON(text)
    if (!coaching || !coaching.scores) throw new Error('Could not parse coaching response')
    for (const k of ['factual', 'language', 'completeness', 'safeguarding']) {
      coaching.scores[k] = Math.max(1, Math.min(10, Math.round(Number(coaching.scores[k]) || 1)))
    }
    res.json({ coaching })
  } catch (err) {
    console.error('Coaching error:', err)
    res.status(500).json({ error: errorMessage(err) })
  }
})

// Handover Feedback
app.post('/api/handover', async (req, res) => {
  const { scenario, userHandover } = req.body
  if (!scenario?.trim() || !userHandover?.trim()) return res.status(400).json({ error: 'Scenario and handover required' })
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured.' })

  try {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: `You are a UK care training specialist helping Healthcare Assistants improve their handover communication.

Given a care scenario and the learner's handover, provide feedback in this format:

**What you did well:**
• [point 1]
• [point 2]

**What to improve:**
• [point 1]
• [point 2]

**Improved version:**
[Write a professional model handover]

Be warm, encouraging, and practical. Use correct UK care terminology.`,
      messages: [{ role: 'user', content: `Scenario: ${scenario}\n\nMy handover: ${userHandover}` }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    res.json({ result: text })
  } catch (err) {
    console.error('Handover error:', err)
    res.status(500).json({ error: errorMessage(err) })
  }
})

// Interview Feedback
app.post('/api/interview', async (req, res) => {
  const { question, userAnswer } = req.body
  if (!question?.trim() || !userAnswer?.trim()) return res.status(400).json({ error: 'Question and answer required' })
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured.' })

  try {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: `You are a UK care sector interview coach helping Healthcare Assistants and Support Workers.

Given an interview question and the learner's answer, provide feedback in this format:

**Strengths:**
• [what they did well]

**Suggestions:**
• [specific improvements]

**Stronger version:**
[Write a model answer]

Be warm, encouraging, and specific. Reference UK care values (dignity, safeguarding, person-centred care, duty of care).`,
      messages: [{ role: 'user', content: `Interview question: ${question}\n\nMy answer: ${userAnswer}` }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    res.json({ result: text })
  } catch (err) {
    console.error('Interview error:', err)
    res.status(500).json({ error: errorMessage(err) })
  }
})

app.listen(PORT, () => {
  console.log(`CarePhrase API server running on http://localhost:${PORT}`)
})
