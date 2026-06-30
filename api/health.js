// Scheduled health check for the coaching endpoint.
//
// Invoked daily by a Vercel Cron job (see vercel.json "crons"). It calls the
// real /api/coach endpoint and verifies Claude responds. This catches the kind
// of outage that previously went unnoticed for ~two weeks: when the pinned
// Claude model (claude-sonnet-4-20250514) was retired, every coaching request
// 500'd but the UI silently showed a canned fallback. A failing check here
// returns a non-2xx status, which marks the cron run as failed and triggers
// Vercel's built-in failure email to the project owner.
//
// Optional: set ALERT_WEBHOOK_URL (a Slack/Discord/etc. incoming webhook) for a
// richer, faster alert. Optional: set CRON_SECRET in the Vercel project — Vercel
// then sends it as a Bearer token on cron requests, blocking public abuse of
// this endpoint (which would otherwise trigger a small Claude call per hit).
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Test the same default model /api/coach uses, via the public production path
  // so the whole chain (function + API key + model) is exercised end to end.
  const COACH_URL = 'https://www.carephrase.com/api/coach'
  let ok = false
  let detail = ''
  try {
    const r = await fetch(COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Health check. Reply with the single word OK.', max_tokens: 64 }),
    })
    const data = await r.json().catch(() => ({}))
    ok = r.ok && !data.error && typeof data.result === 'string'
    detail = ok ? 'coach endpoint healthy' : `status ${r.status}: ${data.error || 'no result field'}`
  } catch (err) {
    detail = `request failed: ${err?.message ?? err}`
  }

  if (!ok) {
    const hook = process.env.ALERT_WEBHOOK_URL
    if (hook) {
      try {
        await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `🚨 CarePhrase coaching health check FAILED — ${detail}` }),
        })
      } catch (e) { /* don't mask the original failure */ }
    }
    console.error('Coaching health check failed:', detail)
    return res.status(500).json({ ok: false, detail })
  }

  return res.status(200).json({ ok: true, detail })
}
