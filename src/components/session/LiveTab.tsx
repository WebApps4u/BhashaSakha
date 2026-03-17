import ControlsPanel from '@/components/session/ControlsPanel'
import SegmentsPanel, { type SegmentRow as SegmentPreview, type TranslationRow, type RiskRow } from '@/components/session/SegmentsPanel'

type SpeechStatus = 'idle' | 'listening' | 'paused'

export default function LiveTab({
  isOwner,
  status,
  micLevel,
  interim,
  segments,
  translationsBySegmentId,
  risksBySegmentId,
  canConfirm,
  onToggleRiskConfirmed,
  speakerLabel,
  onSpeakerLabel,
  targetLangs,
  onTargetLangs,
  ttsEnabled,
  onTtsEnabled,
  ttsLang,
  onTtsLang,
  isTranslating,
  shareEnabled,
  shareUrl,
  shareBusy,
  exportBusy,
  onStart,
  onPause,
  onResume,
  onStop,
  onEnableShare,
  onCopyShare,
  onExportTxt,
  onExportVtt,
  onUploadVtt,
}: {
  isOwner: boolean
  status: SpeechStatus
  micLevel: number
  interim: string
  segments: SegmentPreview[]
  translationsBySegmentId: Record<string, TranslationRow[]>
  risksBySegmentId: Record<string, RiskRow[]>
  canConfirm: boolean
  onToggleRiskConfirmed: (riskId: string, next: boolean) => void
  speakerLabel: string
  onSpeakerLabel: (label: string) => void
  targetLangs: string[]
  onTargetLangs: (langs: string[]) => void
  ttsEnabled: boolean
  onTtsEnabled: (enabled: boolean) => void
  ttsLang: string
  onTtsLang: (lang: string) => void
  isTranslating: boolean
  shareEnabled: boolean
  shareUrl: string
  shareBusy: boolean
  exportBusy: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onEnableShare: () => void
  onCopyShare: () => void
  onExportTxt: () => void
  onExportVtt: () => void
  onUploadVtt: () => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ControlsPanel
        isOwner={isOwner}
        status={status}
        micLevel={micLevel}
        speakerLabel={speakerLabel}
        onSpeakerLabel={onSpeakerLabel}
        targetLangs={targetLangs}
        onTargetLangs={onTargetLangs}
        ttsEnabled={ttsEnabled}
        onTtsEnabled={onTtsEnabled}
        ttsLang={ttsLang}
        onTtsLang={onTtsLang}
        shareEnabled={shareEnabled}
        shareUrl={shareUrl}
        shareBusy={shareBusy}
        exportBusy={exportBusy}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onEnableShare={onEnableShare}
        onCopyShare={onCopyShare}
        onExportTxt={onExportTxt}
        onExportVtt={onExportVtt}
        onUploadVtt={onUploadVtt}
      />

      <div className="lg:col-span-2">
        <SegmentsPanel
          segments={segments}
          interim={interim}
          status={status}
          translationsBySegmentId={translationsBySegmentId}
          isTranslating={isTranslating}
          risksBySegmentId={risksBySegmentId}
          canConfirm={canConfirm}
          onToggleRiskConfirmed={onToggleRiskConfirmed}
        />
      </div>
    </div>
  )
}
