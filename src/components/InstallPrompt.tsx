import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHelp, setShowIosHelp] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Already installed / running standalone — never show.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari standalone flag
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) return

    // Android / Chrome: capture the native install prompt.
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // iOS Safari has no beforeinstallprompt — detect and offer instructions.
    const ua = window.navigator.userAgent
    const isIos = /iphone|ipad|ipod/i.test(ua)
    const isSafari = /^((?!chrome|crios|fxios|android).)*safari/i.test(ua)
    if (isIos && isSafari) setShowIosHelp(true)

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  async function handleInstall() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }

  if (dismissed) return null
  if (!deferred && !showIosHelp) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 px-4 pb-4">
      <div className="max-w-3xl mx-auto bg-blue-800 text-white rounded-xl shadow-lg p-4 flex items-start gap-3">
        <div className="bg-white rounded-lg p-1 shrink-0">
          <img src="/ddl-logo.png" alt="" className="h-8 w-8 object-contain" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">Install CarePhrase</p>
          {deferred ? (
            <p className="text-blue-200 text-xs mt-0.5">Add it to your home screen to use it like an app, even offline.</p>
          ) : (
            <p className="text-blue-200 text-xs mt-0.5">
              Tap the <strong>Share</strong> button, then <strong>"Add to Home Screen"</strong> to install.
            </p>
          )}
          {deferred && (
            <button
              onClick={handleInstall}
              className="mt-2 bg-white text-blue-800 font-semibold text-sm px-4 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Install app
            </button>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-blue-200 hover:text-white text-lg leading-none shrink-0"
          aria-label="Dismiss install prompt"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
