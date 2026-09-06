import React, { useState } from 'react';
import { 
  Globe, 
  Sparkles, 
  RefreshCw, 
  CheckCircle2, 
  X, 
  Download, 
  Languages, 
  Volume2,
  Copy,
  Check
} from 'lucide-react';
import { AIService } from '../services/aiService';
import { TTSService } from '../services/ttsService';
import { StorageService } from '../services/storageService';
import { GoogleDriveService } from '../services/googleDriveService';
import { useToast } from './ui/Feedback';

interface LocalizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  topic: string;
  originalScript: string;
  channelName: string;
}

const SUPPORTED_LANGUAGES = [
  { code: 'de', name: 'German', flag: '🇩🇪', voice: 'fish-paul-neutral' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸', voice: 'fish-paul-neutral' },
  { code: 'fr', name: 'French', flag: '🇫🇷', voice: 'fish-sarah-calm' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹', voice: 'fish-adam-punchy' },
  { code: 'it', name: 'Italian', flag: '🇮🇹', voice: 'fish-paul-neutral' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱', voice: 'fish-paul-neutral' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵', voice: 'fish-sarah-calm' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷', voice: 'fish-adam-punchy' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪', voice: 'fish-paul-neutral' }
];

export interface LocalizedResult {
  langCode: string;
  langName: string;
  flag: string;
  title: string;
  script: string;
  audioUrl?: string;
  thumbnailTop: string;
  thumbnailBottom: string;
}

export const LocalizationModal: React.FC<LocalizationModalProps> = ({
  isOpen,
  onClose,
  topic,
  originalScript,
  channelName
}) => {
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['de', 'es', 'fr', 'pt', 'it']);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [results, setResults] = useState<LocalizedResult[]>([]);
  const [copiedLang, setCopiedLang] = useState<string | null>(null);
  const toast = useToast();

  if (!isOpen) return null;

  const handleStartLocalization = async () => {
    if (selectedLangs.length === 0) {
      toast('Please select at least one language.', 'warning');
      return;
    }

    setIsTranslating(true);
    setProgress(5);
    const newResults: LocalizedResult[] = [];

    try {
      for (let i = 0; i < selectedLangs.length; i++) {
        const code = selectedLangs[i];
        const langObj = SUPPORTED_LANGUAGES.find(l => l.code === code);
        if (!langObj) continue;

        // 1. Generate Translated Script & Metadata
        const brief = await AIService.generateThumbnailBrief(topic || 'Software Tutorial');
        const translatedBrief = brief.translations?.[langObj.name] || { top: 'LEARN FAST', bottom: 'STEP BY STEP' };

        // Generate full script in target language via AI (Gemma/Gemini)
        const translatedScript = await AIService.translateScript(
          originalScript || topic,
          langObj.name
        );

        // 2. Synthesize audio
        let audioUrl: string | undefined;
        try {
          const { blob } = await TTSService.synthesizeVoice(translatedScript, langObj.voice, 1.15);
          audioUrl = URL.createObjectURL(blob);
        } catch {}

        const itemResult: LocalizedResult = {
          langCode: code,
          langName: langObj.name,
          flag: langObj.flag,
          title: `[${langObj.name}] ${topic}`,
          script: translatedScript,
          audioUrl,
          thumbnailTop: translatedBrief.top,
          thumbnailBottom: translatedBrief.bottom
        };

        newResults.push(itemResult);
        setProgress(Math.round(((i + 1) / selectedLangs.length) * 100));
        await new Promise(r => setTimeout(r, 200));
      }

      setResults(newResults);
    } catch (e: any) {
      toast('Localization error: ' + e.message, 'error');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopyScript = (script: string, langCode: string) => {
    navigator.clipboard.writeText(script);
    setCopiedLang(langCode);
    setTimeout(() => setCopiedLang(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-100 border border-border rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-elevation animate-fadeIn max-h-[85vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center font-bold">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-display text-foreground">
                Multi-Language Localization Factory
              </h2>
              <p className="text-[11px] text-muted">
                Translate scripts, generate multilingual voiceovers, and package deliverables.
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 rounded text-muted hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          
          {/* Target Languages Grid */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-foreground">
              Select Target Languages ({selectedLangs.length} selected)
            </label>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {SUPPORTED_LANGUAGES.map(lang => {
                const isSelected = selectedLangs.includes(lang.code);
                return (
                  <button
                    key={lang.code}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedLangs(selectedLangs.filter(c => c !== lang.code));
                      } else {
                        setSelectedLangs([...selectedLangs, lang.code]);
                      }
                    }}
                    className={`p-2 rounded-lg border text-left flex items-center justify-between text-xs transition-all ${
                      isSelected
                        ? 'bg-surface-300 border-foreground font-bold text-foreground shadow-subtle'
                        : 'bg-surface-200 border-border text-muted hover:border-border-strong'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span>{lang.flag}</span>
                      <span className="truncate">{lang.name}</span>
                    </span>
                    <span className="font-mono text-[10px]">{isSelected ? '✓' : '+'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Progress Bar */}
          {isTranslating && (
            <div className="p-3 rounded-lg bg-surface-200 border border-border space-y-2 text-center">
              <div className="text-xs font-bold text-foreground flex items-center justify-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Translating &amp; Synthesizing {selectedLangs.length} languages...
              </div>
              <div className="w-full bg-surface-300 h-1.5 rounded-full overflow-hidden">
                <div className="bg-foreground h-full transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
              <div className="text-[10px] font-mono text-muted">{progress}% completed</div>
            </div>
          )}

          {/* Results List */}
          {results.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-mono font-bold uppercase text-foreground">
                Generated Localized Packages ({results.length})
              </div>

              {results.map(res => (
                <div key={res.langCode} className="p-3 rounded-lg bg-surface-200 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{res.flag}</span>
                      <span className="text-xs font-bold text-foreground">{res.title}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyScript(res.script, res.langCode)}
                        className="btn-outline px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1"
                      >
                        {copiedLang === res.langCode ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        {copiedLang === res.langCode ? 'Copied' : 'Copy Script'}
                      </button>

                      {res.audioUrl && (
                        <a
                          href={res.audioUrl}
                          download={`audio_${res.langCode}.wav`}
                          className="btn-outline px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" /> Audio (.wav)
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="p-2 rounded bg-surface-100 border border-border text-[11px] font-mono text-muted leading-relaxed max-h-24 overflow-y-auto">
                    {res.script}
                  </div>

                  <div className="flex items-center gap-4 text-[10px] font-mono text-muted">
                    <span>Thumbnail Text: <strong className="text-foreground">{res.thumbnailTop}</strong> · <strong className="text-foreground">{res.thumbnailBottom}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <button
            onClick={onClose}
            className="btn-outline px-3.5 py-1.5 rounded-lg text-xs font-semibold"
          >
            Close
          </button>

          <button
            disabled={isTranslating || selectedLangs.length === 0}
            onClick={handleStartLocalization}
            className="btn-solid px-5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isTranslating ? 'Processing...' : `Localize to ${selectedLangs.length} Languages`}
          </button>
        </div>

      </div>
    </div>
  );
};
