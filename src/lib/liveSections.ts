export const LIVE_SECTIONS = [
  {
    id: 'general',
    label: 'General',
    title: 'Live Transcription',
    description: 'Generate translated captions and audio in real-time.',
    path: '/live/general',
  },
  {
    id: 'banking',
    label: 'Banking',
    title: 'Banking Transcription',
    description: 'Translate banking conversations and highlight important fields for review.',
    path: '/live/banking',
  },
  {
    id: 'interview',
    label: 'Interview',
    title: 'Interview Simulator',
    description: 'Practise with an adaptive AI interview panel and get evidence-based feedback.',
    path: '/interview',
  },
] as const

export type LiveSection = (typeof LIVE_SECTIONS)[number]
export type SessionMode = LiveSection['id']

export const getLiveSection = (id: string | undefined) => LIVE_SECTIONS.find((section) => section.id === id)
export const liveSectionPath = (id: SessionMode) => LIVE_SECTIONS.find((section) => section.id === id)?.path ?? `/live/${id}`
export const DEFAULT_LIVE_PATH = liveSectionPath('general')
