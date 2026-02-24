import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

export const UI_LOCALE_STORAGE_KEY = 'bs_ui_locale'

export type UiLocale =
  | 'en'
  | 'hi'
  | 'bn'
  | 'ta'
  | 'te'
  | 'mr'
  | 'gu'
  | 'kn'
  | 'ml'
  | 'pa'
  | 'ur'
  | 'or'
  | 'as'

export const UI_LOCALES: Array<{ code: UiLocale; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi (हिन्दी)' },
  { code: 'bn', label: 'Bengali (বাংলা)' },
  { code: 'ta', label: 'Tamil (தமிழ்)' },
  { code: 'te', label: 'Telugu (తెలుగు)' },
  { code: 'mr', label: 'Marathi (मराठी)' },
  { code: 'gu', label: 'Gujarati (ગુજરાતી)' },
  { code: 'kn', label: 'Kannada (ಕನ್ನಡ)' },
  { code: 'ml', label: 'Malayalam (മലയാളം)' },
  { code: 'pa', label: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'ur', label: 'Urdu (اردو)' },
  { code: 'or', label: 'Odia (ଓଡ଼ିଆ)' },
  { code: 'as', label: 'Assamese (অসমীয়া)' },
]

const pickInitialLocale = (): UiLocale => {
  if (typeof window === 'undefined') return 'en'
  const raw = window.localStorage.getItem(UI_LOCALE_STORAGE_KEY) ?? ''
  const hit = UI_LOCALES.find((l) => l.code === raw)
  if (hit) return hit.code

  const nav = (navigator.language ?? '').toLowerCase()
  const byPrefix = UI_LOCALES.find((l) => nav === l.code || nav.startsWith(`${l.code}-`))
  return byPrefix?.code ?? 'en'
}

export const persistUiLocale = (locale: UiLocale) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale)
}

export const resources = {
  en: {
    translation: {
      app: { name: 'BhashaSakha' },
      nav: { live: 'Live', dashboard: 'Dashboard', account: 'Account', admin: 'Admin' },
      common: {
        back: 'Back',
        close: 'Close',
        done: 'Done',
        on: 'On',
        off: 'Off',
        save: 'Save',
        cancel: 'Cancel',
        loading: 'Loading…',
        error: 'Error',
      },
      auth: {
        signIn: 'Sign in',
        signOut: 'Sign out',
        createAccount: 'Create account',
        needAccount: 'Need an account? Sign up',
        haveAccount: 'Already have an account? Sign in',
        signedInAs: 'Signed in as',
        signInToManage: 'Sign in to manage your account.',
        goToLogin: 'Go to login',
        email: 'Email',
        password: 'Password',
        pleaseWait: 'Please wait…',
      },
      live: {
        title: 'Live Transcription',
        subtitle: 'Generate translated captions and audio in real-time.',
        pressAndTalk: 'Press and start talking',
        signedInHint: 'Captions appear immediately. Translation appears per finalized phrase.',
        signedOutHint: 'Sign in is required to start capture.',
        private: 'Private',
        shareable: 'Shareable',
        transcribe: 'Transcribe',
        translate: 'Translate',
        dubbing: 'Dubbing',
        share: 'Share',
        openEditor: 'Open editor',
        savedHint: 'Saved to your Dashboard while running.',
        signInHintFooter: 'Sign in to save sessions.',
        signInToStart: 'Sign in to start live capture.',
      },
      settings: {
        title: 'Settings',
        sessionTitle: 'Session settings',
        advanced: 'Advanced options (kept out of the main flow).',
        uiLanguage: 'App language',
        currentSpeaker: 'Current speaker',
        primaryTarget: 'Primary target language',
        translateToMulti: 'Translate to (multi)',
        voicePlayback: 'Voice playback (TTS)',
        voicePlaybackHint: 'Speaks the translated line for your selected language.',
        ttsLanguage: 'TTS language',
        voice: 'Voice',
        voiceHint: 'Select an installed voice (availability depends on browser/OS).',
        genderPreference: 'Gender preference',
        genderAny: 'Any',
        genderFemale: 'Prefer female',
        genderMale: 'Prefer male',
        toneRate: 'Rate',
        tonePitch: 'Pitch',
        toneVolume: 'Volume',
        ttsStylePrompt: 'TTS style prompt',
        ttsStylePromptHint: 'Used by server TTS to control tone (Gemini). Example: “A calm female voice, customer support style.”',
        ttsStylePromptPlaceholder: 'e.g. A male Marathi voice, slightly energetic, studio quality.',
      },
      dashboard: {
        title: 'Dashboard',
        subtitle: 'Your saved live sessions.',
        newLiveSession: 'New live session',
        quickCreate: 'Quick create',
        quickCreateHint: 'Creates a private session owned by your account.',
        sessionTitleLabel: 'Title',
        createAndOpen: 'Create & open',
        recentSessions: 'Recent sessions',
        noSessions: 'No sessions yet.',
        source: 'source',
      },
      session: {
        notFound: 'Session not found.',
        backToDashboard: 'Back to dashboard',
        visibility: { public: 'public', private: 'private' },
        speechNotSupported: 'SpeechRecognition not supported in this browser.',
        liveStoredHint: 'Live captions are stored as segments in Supabase.',
      },
      account: {
        title: 'Account',
        plan: 'Plan',
        planHint: 'Billing UI can be added here.',
        integrations: 'Integrations',
        integrationsHint: 'Zoom/OBS/Teams hooks can be added here.',
      },
      admin: {
        title: 'Admin',
        accessDenied: 'Access denied',
      },
    },
  },
  hi: {
    translation: {
      nav: { live: 'लाइव', dashboard: 'डैशबोर्ड', account: 'खाता', admin: 'एडमिन' },
      common: { back: 'वापस', close: 'बंद करें', done: 'हो गया', on: 'चालू', off: 'बंद', save: 'सहेजें', cancel: 'रद्द', loading: 'लोड हो रहा है…', error: 'त्रुटि' },
      auth: {
        signIn: 'साइन इन',
        signOut: 'साइन आउट',
        createAccount: 'खाता बनाएँ',
        needAccount: 'खाता चाहिए? साइन अप करें',
        haveAccount: 'पहले से खाता है? साइन इन करें',
        signedInAs: 'साइन इन किया हुआ',
        signInToManage: 'अपना खाता प्रबंधित करने के लिए साइन इन करें।',
        goToLogin: 'लॉगिन पर जाएँ',
        email: 'ईमेल',
        password: 'पासवर्ड',
        pleaseWait: 'कृपया प्रतीक्षा करें…',
      },
      live: {
        title: 'लाइव ट्रांसक्रिप्शन',
        subtitle: 'रीयल-टाइम में अनुवादित कैप्शन और ऑडियो बनाएं।',
        pressAndTalk: 'दबाएँ और बोलना शुरू करें',
        private: 'निजी',
        shareable: 'शेयर करने योग्य',
        transcribe: 'लिप्यंतरण',
        translate: 'अनुवाद',
        dubbing: 'डबिंग',
        share: 'शेयर',
        openEditor: 'एडिटर खोलें',
        savedHint: 'चलते समय आपके डैशबोर्ड में सहेजा जाता है।',
        signInHintFooter: 'सेशन सहेजने के लिए साइन इन करें।',
        signInToStart: 'लाइव कैप्चर शुरू करने के लिए साइन इन करें।',
      },
      settings: {
        title: 'सेटिंग्स',
        sessionTitle: 'सेशन सेटिंग्स',
        advanced: 'उन्नत विकल्प (मुख्य प्रवाह से अलग)।',
        uiLanguage: 'ऐप भाषा',
        currentSpeaker: 'वर्तमान वक्ता',
        primaryTarget: 'प्राथमिक लक्ष्य भाषा',
        translateToMulti: 'अनुवाद करें (एकाधिक)',
        voicePlayback: 'वॉइस प्लेबैक (TTS)',
        voicePlaybackHint: 'चुनी गई भाषा के लिए अनुवादित पंक्ति बोलता है।',
        ttsLanguage: 'TTS भाषा',
        voice: 'आवाज़',
        voiceHint: 'इंस्टॉल की गई आवाज़ चुनें (उपलब्धता ब्राउज़र/OS पर निर्भर)।',
        genderPreference: 'लिंग वरीयता',
        genderAny: 'कोई भी',
        genderFemale: 'महिला प्राथमिक',
        genderMale: 'पुरुष प्राथमिक',
        toneRate: 'गति',
        tonePitch: 'पिच',
        toneVolume: 'वॉल्यूम',
        ttsStylePrompt: 'TTS स्टाइल प्रॉम्प्ट',
        ttsStylePromptHint: 'सर्वर TTS (Gemini) में आवाज़ का टोन नियंत्रित करता है। उदाहरण: “शांत महिला आवाज़, कस्टमर सपोर्ट शैली।”',
        ttsStylePromptPlaceholder: 'उदा. मराठी पुरुष आवाज़, थोड़ी ऊर्जा, स्टूडियो क्वालिटी।',
      },
      dashboard: {
        title: 'डैशबोर्ड',
        subtitle: 'आपके सहेजे गए सेशन।',
        newLiveSession: 'नया लाइव सेशन',
        quickCreate: 'त्वरित बनाएं',
        quickCreateHint: 'आपके खाते के स्वामित्व वाला निजी सेशन बनाता है।',
        sessionTitleLabel: 'शीर्षक',
        createAndOpen: 'बनाएँ और खोलें',
        recentSessions: 'हाल के सेशन',
        noSessions: 'अभी कोई सेशन नहीं।',
        source: 'स्रोत',
      },
      session: {
        notFound: 'सेशन नहीं मिला।',
        backToDashboard: 'डैशबोर्ड पर वापस',
        speechNotSupported: 'इस ब्राउज़र में SpeechRecognition समर्थित नहीं है।',
        liveStoredHint: 'लाइव कैप्शन Supabase में सेगमेंट के रूप में सहेजे जाते हैं।',
      },
      account: {
        title: 'खाता',
        plan: 'योजना',
        planHint: 'बिलिंग UI यहाँ जोड़ा जा सकता है।',
        integrations: 'इंटीग्रेशन',
        integrationsHint: 'Zoom/OBS/Teams हुक यहाँ जोड़े जा सकते हैं।',
      },
      admin: { title: 'एडमिन', accessDenied: 'अनुमति नहीं' },
    },
  },
  bn: {
    translation: {
      nav: { live: 'লাইভ', dashboard: 'ড্যাশবোর্ড', account: 'অ্যাকাউন্ট', admin: 'অ্যাডমিন' },
      common: { back: 'ফিরে যান', close: 'বন্ধ', done: 'শেষ', on: 'চালু', off: 'বন্ধ', save: 'সংরক্ষণ', cancel: 'বাতিল', loading: 'লোড হচ্ছে…', error: 'ত্রুটি' },
      auth: {
        signIn: 'সাইন ইন',
        signOut: 'সাইন আউট',
        createAccount: 'অ্যাকাউন্ট তৈরি করুন',
        needAccount: 'অ্যাকাউন্ট নেই? সাইন আপ করুন',
        haveAccount: 'অ্যাকাউন্ট আছে? সাইন ইন করুন',
        signedInAs: 'সাইন ইন করা',
        signInToManage: 'আপনার অ্যাকাউন্ট পরিচালনা করতে সাইন ইন করুন।',
        goToLogin: 'লগইনে যান',
        email: 'ইমেইল',
        password: 'পাসওয়ার্ড',
        pleaseWait: 'অনুগ্রহ করে অপেক্ষা করুন…',
      },
      live: {
        title: 'লাইভ ট্রান্সক্রিপশন',
        subtitle: 'রিয়েল-টাইমে অনুবাদিত ক্যাপশন এবং অডিও তৈরি করুন।',
        pressAndTalk: 'চাপুন এবং কথা বলা শুরু করুন',
        private: 'ব্যক্তিগত',
        shareable: 'শেয়ারযোগ্য',
        transcribe: 'লিপ্যন্তর',
        translate: 'অনুবাদ',
        dubbing: 'ডাবিং',
        share: 'শেয়ার',
        openEditor: 'এডিটর খুলুন',
        savedHint: 'চলাকালীন আপনার ড্যাশবোর্ডে সংরক্ষিত হয়।',
        signInHintFooter: 'সেশন সংরক্ষণ করতে সাইন ইন করুন।',
        signInToStart: 'লাইভ ক্যাপচার শুরু করতে সাইন ইন করুন।',
      },
      settings: {
        title: 'সেটিংস',
        sessionTitle: 'সেশন সেটিংস',
        advanced: 'উন্নত বিকল্প (মূল প্রবাহের বাইরে)।',
        uiLanguage: 'অ্যাপ ভাষা',
        currentSpeaker: 'বর্তমান বক্তা',
        primaryTarget: 'প্রাথমিক লক্ষ্য ভাষা',
        translateToMulti: 'অনুবাদ করুন (একাধিক)',
        voicePlayback: 'ভয়েস প্লেব্যাক (TTS)',
        voicePlaybackHint: 'আপনার নির্বাচিত ভাষার জন্য অনুবাদিত লাইন পড়ে শোনায়।',
        ttsLanguage: 'TTS ভাষা',
        voice: 'ভয়েস',
        voiceHint: 'ইনস্টল করা ভয়েস নির্বাচন করুন (উপলব্ধতা ব্রাউজার/OS নির্ভর)।',
        genderPreference: 'লিঙ্গ পছন্দ',
        genderAny: 'যেকোনো',
        genderFemale: 'নারী পছন্দ',
        genderMale: 'পুরুষ পছন্দ',
        toneRate: 'গতি',
        tonePitch: 'পিচ',
        toneVolume: 'ভলিউম',
      },
      dashboard: {
        title: 'ড্যাশবোর্ড',
        subtitle: 'আপনার সংরক্ষিত লাইভ সেশন।',
        newLiveSession: 'নতুন লাইভ সেশন',
        quickCreate: 'দ্রুত তৈরি',
        quickCreateHint: 'আপনার অ্যাকাউন্টের মালিকানাধীন ব্যক্তিগত সেশন তৈরি করে।',
        sessionTitleLabel: 'শিরোনাম',
        createAndOpen: 'তৈরি করে খুলুন',
        recentSessions: 'সাম্প্রতিক সেশন',
        noSessions: 'এখনও কোনো সেশন নেই।',
        source: 'উৎস',
      },
      session: {
        notFound: 'সেশন পাওয়া যায়নি।',
        backToDashboard: 'ড্যাশবোর্ডে ফিরুন',
        speechNotSupported: 'এই ব্রাউজারে SpeechRecognition সমর্থিত নয়।',
        liveStoredHint: 'লাইভ ক্যাপশন Supabase-এ সেগমেন্ট হিসেবে সংরক্ষণ হয়।',
      },
      account: {
        title: 'অ্যাকাউন্ট',
        plan: 'প্ল্যান',
        planHint: 'বিলিং UI এখানে যোগ করা যেতে পারে।',
        integrations: 'ইন্টিগ্রেশন',
        integrationsHint: 'Zoom/OBS/Teams হুক এখানে যোগ করা যেতে পারে।',
      },
      admin: { title: 'অ্যাডমিন', accessDenied: 'অনুমতি নেই' },
    },
  },
  ta: { translation: {} },
  te: { translation: {} },
  mr: { translation: {} },
  gu: { translation: {} },
  kn: { translation: {} },
  ml: { translation: {} },
  pa: { translation: {} },
  ur: { translation: {} },
  or: { translation: {} },
  as: { translation: {} },
} as const

i18n
  .use(initReactI18next)
  .init({
    resources: resources as any,
    lng: pickInitialLocale(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

export default i18n
