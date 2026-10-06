export const LIVE_SECTIONS = [
  {
    id: 'general',
    label: 'General',
    title: 'Live Transcription',
    description: 'Generate translated captions and audio in real-time.',
  },
  {
    id: 'banking',
    label: 'Banking',
    title: 'Banking Transcription',
    description: 'Translate banking conversations and highlight important fields for review.',
  },
  {
    id: 'interview',
    label: 'Interview',
    title: 'Interview Transcription',
    description: 'Capture interviews and meetings with translated captions and speaker labels.',
  },
] as const

export type LiveSection = (typeof LIVE_SECTIONS)[number]
export type SessionMode = LiveSection['id']

export const getLiveSection = (id: string | undefined) => LIVE_SECTIONS.find((section) => section.id === id)
export const liveSectionPath = (id: SessionMode) => `/live/${id}`
export const DEFAULT_LIVE_PATH = liveSectionPath('general')
