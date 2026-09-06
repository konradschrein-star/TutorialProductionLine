import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Rnd } from 'react-rnd';
import { toBlob } from 'html-to-image';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Sparkles,
  Download,
  Trash2,
  Search,
  Layers,
  Copy,
  FolderArchive,
  RefreshCw,
  Upload,
  Tv,
  ArrowUp,
  ArrowDown,
  Type,
  Bookmark,
  Wand2,
  User,
  LayoutGrid,
  Shapes,
  Image as ImageIcon,
  Star
} from 'lucide-react';
import { AIService } from '../services/aiService';
import { StorageService } from '../services/storageService';
import { useChannels } from '../hooks/useStore';
import { useToast, useConfirm } from '../components/ui/Feedback';
import { ThumbnailElement, ThumbnailBrief, CustomThumbnailAsset, Channel } from '../types';
import {
  PERSONAS,
  PERSONA_LANGUAGES,
  personasForLanguage,
  STUDIO_HOSTS,
  STUDIO_HOST_NAMES,
  LOGOS,
  SYMBOLS,
  BACKGROUNDS,
  REFERENCE_ARCHETYPES,
  ARCHETYPE_CATEGORIES,
  ArchetypeCategory,
  resolveLogoPath,
  resolveSymbolPath,
  assetDisplayName,
  findLogo,
  DEFAULT_BACKGROUND_URL,
  DEFAULT_PERSONA_URL,
  DEFAULT_REFERENCE_URL
} from '../data/thumbnailAssets';

// Language names for the 10-language ZIP pack (kept in sync with persona catalog).
const LANGUAGES = PERSONA_LANGUAGES;

const FONT_OPTIONS = [
  { label: 'Impact (Standard Bold)', value: 'Impact' },
  { label: 'Anton (Heavy Punch)', value: 'Anton' },
  { label: 'Montserrat ExtraBold', value: 'Montserrat' },
  { label: 'Bebas Neue (Tall Condensed)', value: 'Bebas Neue' },
  { label: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans' },
  { label: 'Arial Black', value: 'Arial Black' },
  { label: 'Inter Black', value: 'Inter' }
];

type StudioTab = 'AI_GEN' | 'ARCHETYPES' | 'CUSTOM' | 'PERSONAS' | 'LOGOS' | 'SYMBOLS' | 'BGS' | 'LAYERS';

const TABS: { key: StudioTab; label: string; tooltip: string; icon: React.ElementType }[] = [
  { key: 'AI_GEN', label: 'AI Auto', tooltip: 'AI Nano Banana 2 auto-composer', icon: Wand2 },
  { key: 'ARCHETYPES', label: 'Refs', tooltip: 'High-CTR reference archetypes', icon: Star },
  { key: 'CUSTOM', label: 'Custom', tooltip: 'Upload your own faces / logos', icon: Upload },
  { key: 'PERSONAS', label: 'Hosts', tooltip: 'Persona & host cutouts', icon: User },
  { key: 'LOGOS', label: 'Logos', tooltip: 'App logo library', icon: LayoutGrid },
  { key: 'SYMBOLS', label: 'Symbols', tooltip: 'Icon / symbol library', icon: Shapes },
  { key: 'BGS', label: 'Backgrounds', tooltip: 'Background plates', icon: ImageIcon },
  { key: 'LAYERS', label: 'Layers', tooltip: 'Layer tree & ordering', icon: Layers }
];

export const ThumbnailStudio: React.FC = () => {
  const location = useLocation();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const channels = useChannels();
  const [selectedChannelId, setSelectedChannelId] = useState<string>(channels[0]?.id || 'virtualfd');

  const [activeTab, setActiveTab] = useState<StudioTab>('AI_GEN');
  const [archetypeFilter, setArchetypeFilter] = useState<'ALL' | ArchetypeCategory>('ALL');

  // Persona source: language cutouts vs premium photoreal studio hosts
  const [personaSource, setPersonaSource] = useState<'LANG' | 'STUDIO'>('LANG');
  const [activeLang, setActiveLang] = useState<string>('English');
  const [activeHost, setActiveHost] = useState<string>(STUDIO_HOST_NAMES[0]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  // Custom User Uploads State
  const [customAssets, setCustomAssets] = useState<CustomThumbnailAsset[]>(() => StorageService.getCustomThumbnailAssets());

  // AI Nano Banana 2 Generator State
  const [aiPrompt, setAiPrompt] = useState<string>('High-CTR YouTube thumbnail background for a software tutorial, vibrant gradient lighting, modern 3D UI elements, clean cinematic composition, 16:9');
  const [selectedRefArchetype, setSelectedRefArchetype] = useState<string>(DEFAULT_REFERENCE_URL);
  const [selectedPersonaUrl, setSelectedPersonaUrl] = useState<string>(DEFAULT_PERSONA_URL);
  const [aiModel, setAiModel] = useState<'gemini-2.5-flash-image' | 'gemini-3-pro-image'>('gemini-2.5-flash-image');
  const [aiImageSize, setAiImageSize] = useState<'1K' | '2K'>('1K');
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [aiGenError, setAiGenError] = useState<string | null>(null);
  const [generatedAiImages, setGeneratedAiImages] = useState<string[]>([]);

  // Canvas elements state
  const [elements, setElements] = useState<ThumbnailElement[]>([
    {
      id: 'bg-1',
      type: 'BACKGROUND',
      url: DEFAULT_BACKGROUND_URL,
      x: 0,
      y: 0,
      width: 800,
      height: 450,
      zIndex: 1
    },
    {
      id: 'person-1',
      type: 'PERSON',
      url: DEFAULT_PERSONA_URL,
      x: 20,
      y: 40,
      width: 320,
      height: 410,
      zIndex: 2
    },
    {
      id: 'text-top',
      type: 'TEXT',
      text: 'LEARN FAST',
      x: 370,
      y: 45,
      width: 400,
      height: 80,
      zIndex: 4,
      fontFamily: 'Impact',
      fontSize: 64,
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 8,
      fontWeight: 'bold',
      fontStyle: 'italic',
      rotation: 0
    },
    {
      id: 'text-bottom',
      type: 'TEXT',
      text: 'IN 10 MINS',
      x: 370,
      y: 125,
      width: 400,
      height: 80,
      zIndex: 5,
      fontFamily: 'Impact',
      fontSize: 64,
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 8,
      fontWeight: 'bold',
      fontStyle: 'italic',
      rotation: 0
    },
    {
      id: 'logo-1',
      type: 'LOGO',
      url: resolveLogoPath('notion.png'),
      x: 450,
      y: 230,
      width: 150,
      height: 150,
      zIndex: 3,
      bgColor: '#ffffff',
      borderRadius: '50%',
      padding: '16px'
    },
    {
      id: 'arrow-1',
      type: 'SYMBOL',
      url: resolveSymbolPath('curved-arrow.png'),
      x: 620,
      y: 150,
      width: 120,
      height: 120,
      zIndex: 6,
      rotation: 0
    }
  ]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isBatchExporting, setIsBatchExporting] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [autoGenTitle, setAutoGenTitle] = useState<string>('');
  const [isGeneratingBrief, setIsGeneratingBrief] = useState<boolean>(false);
  const [currentBrief, setCurrentBrief] = useState<ThumbnailBrief | null>(null);

  const busy = isExporting || isBatchExporting;

  useEffect(() => {
    // Deep-link from other pages: accept both `topic` and `title` keys.
    const incoming = location.state?.topic ?? location.state?.title;
    if (incoming) setAutoGenTitle(incoming);
  }, [location.state]);

  const selectedElement = elements.find(el => el.id === selectedId);

  // Personas currently shown (language cutouts or studio host pack)
  const currentPersonas = personaSource === 'STUDIO'
    ? (STUDIO_HOSTS[activeHost] || [])
    : personasForLanguage(activeLang);

  // Filtered Assets
  const filteredLogos = useMemo(() =>
    LOGOS.filter(name => !searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase())),
    [searchQuery]
  );

  const filteredSymbols = useMemo(() =>
    SYMBOLS.filter(name => !searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase())),
    [searchQuery]
  );

  // Apply Channel Preset Styling
  const handleApplyChannelPreset = (channelId: string) => {
    setSelectedChannelId(channelId);
    const ch = channels.find(c => c.id === channelId);
    if (!ch || !ch.thumbnailStyle) return;

    setElements(prev => prev.map(el => {
      if (el.type === 'TEXT') {
        return {
          ...el,
          fontFamily: ch.thumbnailStyle?.fontFamily || el.fontFamily,
          fontSize: ch.thumbnailStyle?.fontSize || el.fontSize,
          color: ch.thumbnailStyle?.color || el.color,
          strokeColor: ch.thumbnailStyle?.strokeColor || el.strokeColor
        };
      }
      return el;
    }));
  };

  // Save current styling as channel default preset
  const handleSaveAsChannelPreset = () => {
    const ch = channels.find(c => c.id === selectedChannelId);
    if (!ch) return;

    const textEl = elements.find(el => el.type === 'TEXT');
    const updatedChannel: Channel = {
      ...ch,
      thumbnailStyle: {
        fontFamily: textEl?.fontFamily || 'Impact',
        fontSize: textEl?.fontSize || 64,
        color: textEl?.color || '#ffffff',
        strokeColor: textEl?.strokeColor || '#000000',
        badgeColor: ch.badgeColor
      }
    };

    StorageService.saveChannel(updatedChannel);
    toast(`Saved styling preset to ${ch.name}`, 'success', 'Preset saved');
  };

  // Upload Custom Reference Asset
  const handleUploadCustomAsset = (e: React.ChangeEvent<HTMLInputElement>, category: CustomThumbnailAsset['category']) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const newAsset: CustomThumbnailAsset = {
        id: `custom_${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        category,
        url: dataUrl,
        createdAt: new Date().toISOString()
      };

      StorageService.addCustomThumbnailAsset(newAsset);
      setCustomAssets(StorageService.getCustomThumbnailAssets());
      handleAddAsset(category === 'BGS' ? 'BACKGROUND' : category === 'PERSONAS' ? 'PERSON' : 'LOGO', dataUrl);
      toast('Uploaded and added to canvas.', 'success');
    };
    reader.onerror = () => toast('Could not read that file.', 'error');
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDeleteCustomAsset = async (asset: CustomThumbnailAsset) => {
    const ok = await confirm({
      title: 'Delete custom asset?',
      message: `"${asset.name}" will be permanently removed from your library.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    StorageService.deleteCustomThumbnailAsset(asset.id);
    setCustomAssets(StorageService.getCustomThumbnailAssets());
    toast('Custom asset deleted.', 'info');
  };

  // AI Brief Auto Generation
  const handleGenerateAIBrief = async () => {
    if (!autoGenTitle.trim()) {
      toast('Enter a video topic or title first.', 'warning');
      return;
    }

    setIsGeneratingBrief(true);
    try {
      const brief = await AIService.generateThumbnailBrief(autoGenTitle);
      setCurrentBrief(brief);

      const matchedLogo = findLogo(brief.software_name || autoGenTitle);

      setElements(prev => prev.map(el => {
        if (el.id === 'text-top') return { ...el, text: brief.thumbnail_text_line1 };
        if (el.id === 'text-bottom') return { ...el, text: brief.thumbnail_text_line2 };
        if (el.id === 'logo-1' && matchedLogo) return { ...el, url: resolveLogoPath(matchedLogo) };
        return el;
      }));

      if (matchedLogo) {
        toast(`Brief ready · matched ${assetDisplayName(matchedLogo)} logo.`, 'success');
      } else {
        toast('Brief ready. No matching app logo found — pick one from the Logos tab.', 'info');
      }
    } catch (e: any) {
      console.error(e);
      toast('Failed to generate thumbnail brief: ' + (e?.message || 'unknown error'), 'error');
    } finally {
      setIsGeneratingBrief(false);
    }
  };

  // Add Asset to Canvas
  const handleAddAsset = (type: ThumbnailElement['type'], url: string) => {
    if (type === 'BACKGROUND') {
      setElements(prev => prev.map(el => el.type === 'BACKGROUND' ? { ...el, url } : el));
      return;
    }

    const newEl: ThumbnailElement = {
      id: `el_${Date.now()}`,
      type,
      url,
      x: 220,
      y: 120,
      width: type === 'LOGO' ? 140 : type === 'PERSON' ? 300 : 100,
      height: type === 'LOGO' ? 140 : type === 'PERSON' ? 360 : 100,
      zIndex: elements.length + 1,
      rotation: 0
    };
    setElements([...elements, newEl]);
    setSelectedId(newEl.id);
  };

  // Add New Text Element
  const handleAddTextElement = () => {
    const newText: ThumbnailElement = {
      id: `text_${Date.now()}`,
      type: 'TEXT',
      text: 'NEW TEXT',
      x: 350,
      y: 200,
      width: 380,
      height: 70,
      zIndex: elements.length + 1,
      fontFamily: 'Impact',
      fontSize: 56,
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 6,
      fontWeight: 'bold',
      fontStyle: 'italic',
      rotation: 0
    };
    setElements([...elements, newText]);
    setSelectedId(newText.id);
  };

  // Duplicate Layer
  const handleDuplicate = (el: ThumbnailElement) => {
    const dupe: ThumbnailElement = {
      ...el,
      id: `el_${Date.now()}`,
      x: el.x + 20,
      y: el.y + 20,
      zIndex: elements.length + 1
    };
    setElements([...elements, dupe]);
    setSelectedId(dupe.id);
  };

  // Layer Reordering
  const handleMoveLayer = (id: string, direction: 'up' | 'down') => {
    setElements(prev => {
      const idx = prev.findIndex(e => e.id === id);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;

      const updated = [...prev];
      const temp = updated[idx];
      updated[idx] = updated[targetIdx];
      updated[targetIdx] = temp;
      return updated.map((el, i) => ({ ...el, zIndex: i + 1 }));
    });
  };

  const handleDeleteElement = (id: string) => {
    setElements(prev => prev.filter(item => item.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // Single PNG Export
  const handleExportPNG = async () => {
    if (!canvasRef.current) return;
    setIsExporting(true);
    setSelectedId(null);

    try {
      await new Promise(r => setTimeout(r, 200));
      const blob = await toBlob(canvasRef.current, { pixelRatio: 2.4 });

      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `thumbnail_${(autoGenTitle || 'custom').replace(/[^a-z0-9]/gi, '_')}_${personaSource === 'STUDIO' ? activeHost : activeLang}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Thumbnail exported.', 'success');
      }
    } catch (err: any) {
      console.error('Export failed:', err);
      toast('Export failed: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // Batch 10-Language Pack Exporter (ZIP)
  const handleBatchExportZip = async () => {
    if (!canvasRef.current) return;
    setIsBatchExporting(true);
    setSelectedId(null);
    setBatchProgress({ done: 0, total: LANGUAGES.length, label: 'Preparing brief…' });

    // Snapshot current text so we can restore it after the batch run.
    const originalTop = elements.find(e => e.id === 'text-top')?.text || 'LEARN FAST';
    const originalBottom = elements.find(e => e.id === 'text-bottom')?.text || 'STEP BY STEP';

    try {
      const zip = new JSZip();
      const brief = currentBrief || await AIService.generateThumbnailBrief(autoGenTitle || 'Custom Tutorial');

      for (let i = 0; i < LANGUAGES.length; i++) {
        const lang = LANGUAGES[i];
        setBatchProgress({ done: i, total: LANGUAGES.length, label: `Rendering ${lang}…` });

        const trans = brief.translations?.[lang] || { top: originalTop, bottom: originalBottom };

        setElements(prev => prev.map(el => {
          if (el.id === 'text-top') return { ...el, text: trans.top };
          if (el.id === 'text-bottom') return { ...el, text: trans.bottom };
          return el;
        }));

        await new Promise(r => setTimeout(r, 250));

        const blob = await toBlob(canvasRef.current, { pixelRatio: 2.4 });
        if (blob) {
          const folder = zip.folder(lang.toLowerCase());
          folder?.file(`thumbnail_${lang.toLowerCase()}.png`, blob);
        }
      }

      setBatchProgress({ done: LANGUAGES.length, total: LANGUAGES.length, label: 'Packaging ZIP…' });
      const zipContent = await zip.generateAsync({ type: 'blob' });
      saveAs(zipContent, `thumbnail_pack_${(autoGenTitle || 'tutorial').replace(/[^a-z0-9]/gi, '_')}_10langs.zip`);
      toast(`Exported ${LANGUAGES.length}-language thumbnail pack.`, 'success');
    } catch (err: any) {
      console.error('Batch export failed:', err);
      toast('Batch export failed: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      // Restore the original headline text.
      setElements(prev => prev.map(el => {
        if (el.id === 'text-top') return { ...el, text: originalTop };
        if (el.id === 'text-bottom') return { ...el, text: originalBottom };
        return el;
      }));
      setIsBatchExporting(false);
      setBatchProgress(null);
    }
  };

  // AI Image Generation Handlers
  const handleGenerateAIImage = async () => {
    if (!aiPrompt.trim()) return;
    setIsGeneratingAI(true);
    setAiGenError(null);

    try {
      const promptToSend = aiPrompt.includes('Text must be black')
        ? aiPrompt
        : `${aiPrompt.trim()}. Text must be black for contrast and have no mistakes. Only one person on the Thumbnail`;
      const dataUri = await AIService.generateThumbnailImage(promptToSend, {
        aspectRatio,
        model: aiModel,
        imageSize: aiImageSize
      });

      setGeneratedAiImages(prev => [dataUri, ...prev]);
      handleSetAiAsBg(dataUri);
      toast('Background plate generated.', 'success');
    } catch (err: any) {
      console.error('AI image generation error:', err);
      setAiGenError(err?.message || 'Image generation failed');
      toast('Image generation failed: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleSetAiAsBg = (url: string) => {
    setElements(prev => {
      const bgIdx = prev.findIndex(e => e.type === 'BACKGROUND');
      if (bgIdx >= 0) {
        const updated = [...prev];
        updated[bgIdx] = { ...updated[bgIdx], url };
        return updated;
      }
      return [
        {
          id: `bg-${Date.now()}`,
          type: 'BACKGROUND',
          url,
          x: 0,
          y: 0,
          width: aspectRatio === '16:9' ? 800 : 450,
          height: aspectRatio === '16:9' ? 450 : 800,
          zIndex: 1
        },
        ...prev
      ];
    });
  };

  const handleAddAiAsLayer = (url: string) => {
    const newEl: ThumbnailElement = {
      id: `ai-img-${Date.now()}`,
      type: 'LOGO',
      url,
      x: 100,
      y: 100,
      width: 250,
      height: 250,
      zIndex: Math.max(...elements.map(e => e.zIndex), 0) + 1
    };
    setElements(prev => [...prev, newEl]);
    setSelectedId(newEl.id);
  };

  // Helper to fetch image as base64
  const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  // Automated 1-Click Composition: Reference Archetype + Persona Cutout + AI Prompt + Hook Text
  const handleAutoComposeThumbnail = async (
    customTopic?: string,
    refUrl?: string,
    personaUrl?: string
  ) => {
    const topic = (customTopic || autoGenTitle || aiPrompt || 'Software Tutorial').trim();
    const reference = refUrl || selectedRefArchetype;
    const persona = personaUrl || selectedPersonaUrl || DEFAULT_PERSONA_URL;

    const ok = await confirm({
      title: 'Auto-compose new thumbnail?',
      message: 'This generates a fresh AI plate and replaces the current canvas layout.',
      confirmLabel: 'Compose'
    });
    if (!ok) return;

    setIsGeneratingAI(true);
    setAiGenError(null);

    try {
      // 1. Generate brief for hook text and logo detection
      const brief = await AIService.generateThumbnailBrief(topic);
      setCurrentBrief(brief);

      // 2. Fetch reference image base64 if selected
      let refB64: string | undefined = undefined;
      if (reference) {
        const b64 = await fetchImageAsBase64(reference);
        if (b64) refB64 = b64;
      }

      // 3. Generate background plate via Nano Banana 2
      const fullPrompt = `High-CTR YouTube thumbnail background plate for "${topic}", styled with dramatic volumetric lighting, cinematic color contrast, clean 3D graphic elements, matching visual style of reference archetype, 16:9 composition. Text must be black for contrast and have no mistakes. Only one person on the Thumbnail`;

      const generatedPlateUrl = await AIService.generateThumbnailImage(fullPrompt, {
        aspectRatio,
        model: aiModel,
        imageSize: aiImageSize,
        referenceImageBase64: refB64
      });

      setGeneratedAiImages(prev => [generatedPlateUrl, ...prev]);

      // 4. Find matched software logo (real logo list, graceful fallback)
      const matchedLogo = findLogo(brief.software_name || topic);

      // 5. Compose full canvas element tree
      const now = Date.now();
      const composedElements: ThumbnailElement[] = [
        {
          id: `bg-${now}`,
          type: 'BACKGROUND',
          url: generatedPlateUrl,
          x: 0,
          y: 0,
          width: aspectRatio === '16:9' ? 800 : 450,
          height: aspectRatio === '16:9' ? 450 : 800,
          zIndex: 1
        },
        {
          id: `person-${now}`,
          type: 'PERSON',
          url: persona,
          x: 20,
          y: 40,
          width: 320,
          height: 410,
          zIndex: 2
        },
        {
          id: 'text-top',
          type: 'TEXT',
          text: brief.thumbnail_text_line1 || 'LEARN FAST',
          x: 370,
          y: 45,
          width: 400,
          height: 80,
          zIndex: 4,
          fontFamily: 'Impact',
          fontSize: 64,
          color: '#ffffff',
          strokeColor: '#000000',
          strokeWidth: 8,
          fontWeight: 'bold',
          fontStyle: 'italic',
          rotation: 0
        },
        {
          id: 'text-bottom',
          type: 'TEXT',
          text: brief.thumbnail_text_line2 || 'STEP BY STEP',
          x: 370,
          y: 125,
          width: 400,
          height: 80,
          zIndex: 5,
          fontFamily: 'Impact',
          fontSize: 64,
          color: '#ffffff',
          strokeColor: '#000000',
          strokeWidth: 8,
          fontWeight: 'bold',
          fontStyle: 'italic',
          rotation: 0
        }
      ];

      // Only add a logo layer when we actually matched one on disk.
      if (matchedLogo) {
        composedElements.push({
          id: `logo-${now}`,
          type: 'LOGO',
          url: resolveLogoPath(matchedLogo),
          x: 620,
          y: 220,
          width: 140,
          height: 140,
          zIndex: 3,
          bgColor: '#ffffff',
          borderRadius: '50%',
          padding: '14px'
        });
      }

      setElements(composedElements);
      setSelectedId('text-top');

      if (matchedLogo) {
        toast(`Composed thumbnail · added ${assetDisplayName(matchedLogo)} logo.`, 'success');
      } else {
        toast('Composed thumbnail. No matching app logo — add one from the Logos tab.', 'warning');
      }
    } catch (err: any) {
      console.error('Auto-compose thumbnail failed:', err);
      setAiGenError(err?.message || 'Auto-composition failed');
      toast('Auto-composition failed: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleSaveAiToAssets = (url: string) => {
    const asset: CustomThumbnailAsset = {
      id: `ai_${Date.now()}`,
      name: `AI Plate ${generatedAiImages.length}`,
      category: 'BGS',
      url,
      createdAt: new Date().toISOString()
    };
    StorageService.addCustomThumbnailAsset(asset);
    setCustomAssets(StorageService.getCustomThumbnailAssets());
    toast('Saved to Custom Assets library.', 'success');
  };

  const canvasWidth = aspectRatio === '16:9' ? 800 : 450;
  const canvasHeight = aspectRatio === '16:9' ? 450 : 800;

  const batchPct = batchProgress ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">

      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pro-panel p-3.5 rounded-xl border border-border">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Aspect Ratio */}
          <div className="flex items-center bg-surface-200 rounded-lg p-0.5 border border-border text-xs font-mono font-bold">
            <button
              onClick={() => setAspectRatio('16:9')}
              className={`px-2.5 py-1 rounded transition-colors focus-ring ${aspectRatio === '16:9' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
            >
              16:9 HD
            </button>
            <button
              onClick={() => setAspectRatio('9:16')}
              className={`px-2.5 py-1 rounded transition-colors focus-ring ${aspectRatio === '9:16' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
            >
              9:16 Shorts
            </button>
          </div>

          {/* Channel Preset Dropdown & Save */}
          <div className="flex items-center gap-1.5 bg-surface-200 px-2 py-1 rounded-lg border border-border text-xs">
            <Tv className="w-3.5 h-3.5 text-muted" />
            <select
              value={selectedChannelId}
              onChange={(e) => handleApplyChannelPreset(e.target.value)}
              className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
            >
              {channels.map(c => (
                <option key={c.id} value={c.id} className="bg-surface-100 text-foreground">
                  Preset: {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleSaveAsChannelPreset}
              className="p-1 text-muted hover:text-foreground focus-ring rounded"
              title="Save current layout as default for this channel"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          </div>

          <div>
            <h2 className="text-sm font-bold font-display text-foreground">Thumbnail Canvas Studio</h2>
            <p className="text-[11px] text-muted">Configurable brand references with 10-language batch pack builder.</p>
          </div>
        </div>

        {/* AI Brief Input & Exporters */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <input
            type="text"
            value={autoGenTitle}
            onChange={(e) => setAutoGenTitle(e.target.value)}
            placeholder="Enter title for AI brief..."
            className="pro-input flex-1 md:w-64 rounded-lg px-3 py-1.5 text-xs text-foreground font-sans"
          />
          <button
            disabled={isGeneratingBrief || busy}
            onClick={handleGenerateAIBrief}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50"
          >
            {isGeneratingBrief ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI Brief
          </button>
          <button
            disabled={busy}
            onClick={handleExportPNG}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting ? 'Exporting…' : 'Export PNG'}
          </button>
          <button
            disabled={busy}
            onClick={handleBatchExportZip}
            className="btn-solid px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50"
          >
            <FolderArchive className="w-3.5 h-3.5" />
            {isBatchExporting ? 'Packaging…' : '10-Lang ZIP'}
          </button>
        </div>
      </div>

      {/* Batch export progress */}
      {batchProgress && (
        <div className="pro-panel p-3 rounded-xl border border-border space-y-2 animate-fadeIn">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="flex items-center gap-2 text-foreground font-bold">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
              {batchProgress.label}
            </span>
            <span className="text-muted">{batchProgress.done}/{batchProgress.total} · {batchPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-200 overflow-hidden">
            <div className="h-full bg-accent transition-all duration-300" style={{ width: `${batchPct}%` }} />
          </div>
        </div>
      )}

      {/* Main Studio Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Left Side: Asset Library & Layer Tree (4 cols) */}
        <div className={`lg:col-span-4 pro-panel p-3.5 rounded-xl space-y-3 flex flex-col h-[650px] ${busy ? 'opacity-60 pointer-events-none' : ''}`}>

          {/* Category Tabs — readable scrollable segmented control */}
          <div className="flex gap-1 p-1 bg-surface-200 rounded-lg border border-border overflow-x-auto scrollbar-none">
            {TABS.map(({ key, label, tooltip, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                title={tooltip}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold whitespace-nowrap transition-colors focus-ring ${
                  activeTab === key
                    ? 'bg-surface-100 text-foreground shadow-subtle'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                <Icon className={`w-4 h-4 ${activeTab === key ? 'text-accent' : ''}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* AI Nano Banana 2 Automated Generator Panel */}
          {activeTab === 'AI_GEN' && (
            <div className="p-3 rounded-lg bg-surface-200/80 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-bold uppercase text-foreground tracking-wide">
                    1-Click Auto Thumbnail
                  </span>
                </div>
                <span className="badge badge-accent">Nano Banana 2</span>
              </div>

              {/* 1. Pick Reference Archetype */}
              <div className="space-y-1">
                <label className="block text-[11px] font-mono text-muted flex items-center justify-between">
                  <span>1. Reference visual style</span>
                  <span className="text-accent font-bold truncate max-w-[140px]">{REFERENCE_ARCHETYPES.find(a => a.url === selectedRefArchetype)?.name || 'Default Style'}</span>
                </label>
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {REFERENCE_ARCHETYPES.slice(0, 14).map(arch => (
                    <button
                      key={arch.id}
                      onClick={() => setSelectedRefArchetype(arch.url)}
                      className={`relative flex-shrink-0 w-16 aspect-video rounded-md overflow-hidden border transition-all focus-ring ${
                        selectedRefArchetype === arch.url
                          ? 'border-accent ring-2 ring-accent/30'
                          : 'border-border opacity-70 hover:opacity-100'
                      }`}
                      title={arch.name}
                    >
                      <img src={arch.url} alt={arch.name} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Pick Persona Face */}
              <div className="space-y-1">
                <label className="block text-[11px] font-mono text-muted flex items-center justify-between">
                  <span>2. Host persona cutout</span>
                  <span className="text-foreground font-bold">{personaSource === 'STUDIO' ? `${activeHost} pack` : `${activeLang}`}</span>
                </label>
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {currentPersonas.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedPersonaUrl(p.url)}
                      className={`relative flex-shrink-0 w-11 h-11 rounded-lg bg-surface-300 border flex items-center justify-center p-0.5 transition-all focus-ring ${
                        selectedPersonaUrl === p.url
                          ? 'border-success ring-2 ring-success/30'
                          : 'border-border opacity-70 hover:opacity-100'
                      }`}
                      title={p.name}
                    >
                      <img src={p.url} alt={p.name} className="max-h-full object-contain" />
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Prompt Description */}
              <div>
                <label className="block text-[11px] font-mono text-muted mb-1">3. Topic / prompt</label>
                <textarea
                  rows={2}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Advanced Excel VLOOKUP automation tutorial..."
                  className="pro-input w-full rounded-md p-2 text-xs font-mono resize-y"
                />
              </div>

              {/* Prompt Suggestions */}
              <div className="flex gap-1 flex-wrap">
                {['Excel Dashboard Neon', 'Notion Minimal 3D', 'SaaS Automation Studio', 'Clean Dark Slate'].map(style => (
                  <button
                    key={style}
                    onClick={() => setAiPrompt(`High-CTR YouTube thumbnail background for ${style}, dramatic volumetric lighting, ultra-clean 3D composition, 16:9`)}
                    className="px-2 py-0.5 rounded bg-surface-300 text-[11px] font-mono text-muted hover:text-foreground hover:bg-surface-100 transition-colors focus-ring"
                  >
                    {style}
                  </button>
                ))}
              </div>

              {/* Model & Size Selector */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-mono text-muted mb-0.5">Model engine</label>
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value as any)}
                    className="pro-input w-full text-[11px] rounded p-1.5 font-mono"
                  >
                    <option value="gemini-2.5-flash-image">Nano Banana Flash (Fast)</option>
                    <option value="gemini-3-pro-image">Nano Banana Pro (2K)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-muted mb-0.5">Resolution floor</label>
                  <select
                    value={aiImageSize}
                    onChange={(e) => setAiImageSize(e.target.value as any)}
                    className="pro-input w-full text-[11px] rounded p-1.5 font-mono"
                  >
                    <option value="1K">1K (1344x768)</option>
                    <option value="2K">2K (2752x1536 Pro)</option>
                  </select>
                </div>
              </div>

              {aiGenError && (
                <div className="p-2 rounded bg-danger/10 border border-danger/20 text-[11px] font-mono text-danger">
                  {aiGenError}
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-1.5">
                <button
                  onClick={() => handleAutoComposeThumbnail()}
                  disabled={isGeneratingAI || !aiPrompt.trim()}
                  className="btn-solid w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-elevation"
                >
                  {isGeneratingAI ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Composing thumbnail (~15s)…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Auto-Compose Complete Thumbnail</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleGenerateAIImage}
                  disabled={isGeneratingAI || !aiPrompt.trim()}
                  className="btn-outline w-full py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 text-muted hover:text-foreground disabled:opacity-50"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Generate Background Plate Only</span>
                </button>
              </div>
            </div>
          )}

          {/* Reference Archetypes Browser Panel */}
          {activeTab === 'ARCHETYPES' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-foreground tracking-wide">
                  Reference Library ({REFERENCE_ARCHETYPES.length})
                </span>
                <span className="text-[11px] font-mono text-muted">High-CTR</span>
              </div>

              {/* Category Filter Pills */}
              <div className="flex gap-1 flex-wrap">
                {(['ALL', ...ARCHETYPE_CATEGORIES] as const).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setArchetypeFilter(cat)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-colors focus-ring ${
                      archetypeFilter === cat
                        ? 'bg-surface-100 text-foreground border border-border-strong'
                        : 'bg-surface-200 text-muted hover:text-foreground'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom Assets Upload Panel */}
          {activeTab === 'CUSTOM' && (
            <div className="p-2.5 rounded-lg bg-surface-200 border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-foreground tracking-wide">
                  Custom Uploads
                </span>
                <button
                  onClick={handleAddTextElement}
                  className="btn-outline px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1"
                >
                  <Type className="w-3 h-3" /> Add Text
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="btn-solid py-1.5 px-2 rounded text-[11px] font-bold text-center cursor-pointer flex items-center justify-center gap-1">
                  <Upload className="w-3 h-3" /> Face / Persona
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleUploadCustomAsset(e, 'PERSONAS')}
                  />
                </label>
                <label className="btn-outline py-1.5 px-2 rounded text-[11px] font-bold text-center cursor-pointer flex items-center justify-center gap-1">
                  <Upload className="w-3 h-3" /> Logo / Symbol
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(e) => handleUploadCustomAsset(e, 'LOGOS')}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Persona source + language / host selector */}
          {activeTab === 'PERSONAS' && (
            <div className="space-y-2">
              <div className="flex items-center bg-surface-200 rounded-lg p-0.5 border border-border text-[11px] font-semibold">
                <button
                  onClick={() => setPersonaSource('LANG')}
                  className={`flex-1 px-2 py-1 rounded transition-colors focus-ring ${personaSource === 'LANG' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
                >
                  Language Cutouts
                </button>
                <button
                  onClick={() => setPersonaSource('STUDIO')}
                  className={`flex-1 px-2 py-1 rounded transition-colors focus-ring ${personaSource === 'STUDIO' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
                >
                  Studio Hosts
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {personaSource === 'LANG'
                  ? PERSONA_LANGUAGES.map(lang => (
                      <button
                        key={lang}
                        onClick={() => setActiveLang(lang)}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold focus-ring ${
                          activeLang === lang
                            ? 'bg-surface-300 text-foreground border border-border-strong'
                            : 'bg-surface-200 text-muted hover:text-foreground'
                        }`}
                      >
                        {lang}
                      </button>
                    ))
                  : STUDIO_HOST_NAMES.map(name => (
                      <button
                        key={name}
                        onClick={() => setActiveHost(name)}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold focus-ring ${
                          activeHost === name
                            ? 'bg-surface-300 text-foreground border border-border-strong'
                            : 'bg-surface-200 text-muted hover:text-foreground'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
              </div>
            </div>
          )}

          {/* Search Box */}
          {(activeTab === 'LOGOS' || activeTab === 'SYMBOLS' || activeTab === 'ARCHETYPES') && (
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter assets..."
                className="pro-input w-full rounded-md px-2.5 py-1.5 text-xs"
              />
              <Search className="w-3.5 h-3.5 text-muted absolute right-2.5 top-2.5" />
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-0.5 space-y-2">

            {/* AI Generated Images Gallery */}
            {activeTab === 'AI_GEN' && (
              <div className="space-y-2">
                {generatedAiImages.length === 0 ? (
                  <div className="text-center py-8 text-xs text-muted space-y-1">
                    <Sparkles className="w-5 h-5 mx-auto text-muted/50 mb-1" />
                    <p className="font-semibold text-foreground">No AI thumbnails generated yet.</p>
                    <p className="text-[11px]">Type a prompt above and auto-compose to produce high-CTR 16:9 plates.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-[11px] font-mono uppercase font-bold text-muted">
                      Generated AI Plates ({generatedAiImages.length})
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {generatedAiImages.map((imgUri, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-surface-200 border border-border space-y-2 group">
                          <div className="aspect-video relative rounded-md overflow-hidden bg-black border border-border">
                            <img src={imgUri} alt={`AI Gen ${idx + 1}`} className="w-full h-full object-cover" />
                            <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-[10px] font-mono text-white">
                              Plate #{generatedAiImages.length - idx}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-1 pt-1">
                            <button onClick={() => handleSetAiAsBg(imgUri)} className="btn-solid py-1 px-1 rounded text-[11px] font-bold text-center" title="Set as Canvas Background">Set BG</button>
                            <button onClick={() => handleAddAiAsLayer(imgUri)} className="btn-outline py-1 px-1 rounded text-[11px] font-bold text-center" title="Add as Layer">+ Layer</button>
                            <button onClick={() => handleSaveAiToAssets(imgUri)} className="btn-outline py-1 px-1 rounded text-[11px] font-bold text-center" title="Save to Custom Assets Library">Save</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Reference Archetypes Library */}
            {activeTab === 'ARCHETYPES' && (
              <div className="space-y-3">
                <div className="text-[11px] font-mono uppercase font-bold text-muted">
                  Showing {REFERENCE_ARCHETYPES.filter(a => (archetypeFilter === 'ALL' || a.category === archetypeFilter) && a.name.toLowerCase().includes(searchQuery.toLowerCase())).length} archetypes
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {REFERENCE_ARCHETYPES
                    .filter(a => (archetypeFilter === 'ALL' || a.category === archetypeFilter) && a.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(arch => (
                      <div key={arch.id} className="p-1.5 rounded-lg bg-surface-200 border border-border hover:border-border-strong space-y-1.5 group">
                        <div className="aspect-video relative rounded overflow-hidden bg-black border border-border/50">
                          <img src={arch.url} alt={arch.name} className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-1">
                            <p className="text-[10px] font-bold text-white truncate">{arch.name}</p>
                            <span className="text-[9px] font-mono text-white/70 uppercase">{arch.category}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            onClick={() => handleAddAsset('BACKGROUND', arch.url)}
                            className="btn-solid py-1 px-1 rounded text-[11px] font-bold text-center"
                            title="Set as Canvas Background"
                          >
                            Use BG
                          </button>
                          <button
                            onClick={() => { setSelectedRefArchetype(arch.url); setActiveTab('AI_GEN'); }}
                            className="btn-outline py-1 px-1 rounded text-[11px] font-bold text-center text-accent border-accent/30"
                            title="Use as Style Reference in AI Studio"
                          >
                            AI Ref
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Custom References */}
            {activeTab === 'CUSTOM' && (
              <div className="space-y-2">
                {customAssets.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted space-y-1">
                    <p className="font-semibold text-foreground">No custom references uploaded.</p>
                    <p className="text-[11px]">Upload your persona faces or custom logo transparent PNGs above.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {customAssets.map(asset => (
                      <div key={asset.id} className="relative group">
                        <button
                          onClick={() => handleAddAsset(asset.category === 'BGS' ? 'BACKGROUND' : asset.category === 'PERSONAS' ? 'PERSON' : 'LOGO', asset.url)}
                          className="aspect-square w-full rounded-lg bg-surface-200 border border-border hover:border-border-strong p-1 flex items-center justify-center transition-transform hover:scale-105"
                        >
                          <img src={asset.url} alt={asset.name} className="max-h-full object-contain" />
                        </button>
                        <button
                          onClick={() => handleDeleteCustomAsset(asset)}
                          className="absolute top-1 right-1 p-1 rounded bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete Asset"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Layer Tree */}
            {activeTab === 'LAYERS' && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-mono uppercase text-muted font-bold px-1">Active Layers ({elements.length})</div>
                {elements.map((el) => (
                  <div
                    key={el.id}
                    onClick={() => setSelectedId(el.id)}
                    className={`p-2 rounded-lg border flex items-center justify-between text-xs cursor-pointer transition-colors ${
                      selectedId === el.id ? 'bg-surface-300 border-foreground/40 font-bold' : 'bg-surface-200/50 border-border hover:bg-surface-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-[10px] font-mono uppercase px-1 py-0.5 rounded bg-surface-300 text-muted">
                        {el.type}
                      </span>
                      <span className="truncate text-foreground text-[11px]">
                        {el.text || el.url?.split('/').pop() || el.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); handleMoveLayer(el.id, 'up'); }} className="p-1 text-muted hover:text-foreground" title="Move Up"><ArrowUp className="w-3 h-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); handleMoveLayer(el.id, 'down'); }} className="p-1 text-muted hover:text-foreground" title="Move Down"><ArrowDown className="w-3 h-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); handleDuplicate(el); }} className="p-1 text-muted hover:text-foreground" title="Duplicate"><Copy className="w-3 h-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteElement(el.id); }} className="p-1 text-muted hover:text-danger" title="Delete"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Personas (language cutouts or studio hosts) */}
            {activeTab === 'PERSONAS' && (
              <div className="grid grid-cols-3 gap-2">
                {currentPersonas.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => { handleAddAsset('PERSON', p.url); setSelectedPersonaUrl(p.url); }}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-1 flex flex-col items-center justify-center transition-transform hover:scale-105"
                    title={p.name}
                  >
                    <img src={p.url} alt={p.name} className="max-h-full object-contain" />
                  </button>
                ))}
              </div>
            )}

            {/* Logos */}
            {activeTab === 'LOGOS' && (
              <div className="grid grid-cols-3 gap-2">
                {filteredLogos.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('LOGO', resolveLogoPath(name))}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-2 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105"
                    title={assetDisplayName(name)}
                  >
                    <img src={resolveLogoPath(name)} alt={name} className="w-8 h-8 object-contain" />
                    <span className="text-[10px] font-mono text-muted truncate w-full text-center">
                      {assetDisplayName(name)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Symbols */}
            {activeTab === 'SYMBOLS' && (
              <div className="grid grid-cols-3 gap-2">
                {filteredSymbols.map((sym, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('SYMBOL', resolveSymbolPath(sym))}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-2 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105"
                    title={assetDisplayName(sym)}
                  >
                    <img src={resolveSymbolPath(sym)} alt={sym} className="w-8 h-8 object-contain" />
                    <span className="text-[10px] font-mono text-muted truncate w-full text-center">
                      {assetDisplayName(sym)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Backgrounds */}
            {activeTab === 'BGS' && (
              <div className="grid grid-cols-1 gap-2">
                {BACKGROUNDS.map((bg, i) => (
                  <button
                    key={i}
                    onClick={() => setElements(prev => prev.map(el => el.type === 'BACKGROUND' ? { ...el, url: bg.url } : el))}
                    className="aspect-video rounded-lg overflow-hidden border border-border hover:border-border-strong relative group"
                  >
                    <img src={bg.url} alt={bg.name} className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-2 text-[11px] font-mono font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">
                      {bg.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

          </div>

        </div>

        {/* Right Side: Interactive Canvas & Property Inspector (8 cols) */}
        <div className="lg:col-span-8 space-y-3">

          <div className="pro-panel p-4 rounded-xl flex flex-col items-center justify-center overflow-hidden min-h-[480px]">

            {/* Canvas */}
            <div
              ref={canvasRef}
              id="thumbnail-canvas"
              className="bg-black rounded-md overflow-hidden relative shadow-elevation select-none"
              style={{
                width: `${canvasWidth}px`,
                height: `${canvasHeight}px`,
                transform: aspectRatio === '9:16' ? 'scale(0.65)' : 'scale(1)',
                transformOrigin: 'top center'
              }}
            >
              {elements.map((el) => {
                const isSelected = selectedId === el.id;

                if (el.type === 'BACKGROUND' && el.url) {
                  return (
                    <img
                      key={el.id}
                      src={el.url}
                      alt="Background"
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      style={{ zIndex: el.zIndex }}
                    />
                  );
                }

                return (
                  <Rnd
                    key={el.id}
                    position={{ x: el.x, y: el.y }}
                    size={{ width: el.width, height: el.height }}
                    onDragStop={(_, d) => {
                      setElements(prev => prev.map(item => item.id === el.id ? { ...item, x: d.x, y: d.y } : item));
                    }}
                    onResizeStop={(_, __, ref, ___, position) => {
                      setElements(prev => prev.map(item => item.id === el.id ? {
                        ...item,
                        width: parseInt(ref.style.width, 10),
                        height: parseInt(ref.style.height, 10),
                        ...position
                      } : item));
                    }}
                    bounds="parent"
                    style={{
                      zIndex: el.zIndex,
                      transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined
                    }}
                    onClick={() => setSelectedId(el.id)}
                    className={`${isSelected ? 'ring-1 ring-foreground' : ''}`}
                  >
                    {el.type === 'TEXT' ? (
                      <div
                        className="w-full h-full flex items-center justify-start uppercase tracking-wider select-none font-bold"
                        style={{
                          fontFamily: el.fontFamily || 'Impact',
                          fontSize: `${el.fontSize || 64}px`,
                          color: el.color || '#ffffff',
                          WebkitTextStroke: `${el.strokeWidth || 8}px ${el.strokeColor || '#000000'}`,
                          paintOrder: 'stroke fill',
                          fontStyle: el.fontStyle || 'italic',
                          lineHeight: 1,
                          backgroundColor: el.bgColor || 'transparent',
                          borderRadius: el.borderRadius || '0',
                          padding: el.padding || '0'
                        }}
                      >
                        {el.text}
                      </div>
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center"
                        style={{
                          backgroundColor: el.bgColor || 'transparent',
                          borderRadius: el.borderRadius || '0',
                          padding: el.padding || '0'
                        }}
                      >
                        <img src={el.url} alt="Asset" className="w-full h-full object-contain pointer-events-none" />
                      </div>
                    )}
                  </Rnd>
                );
              })}
            </div>

          </div>

          {/* Property Inspector Bar when element selected */}
          {selectedElement && (
            <div className="pro-panel p-3.5 rounded-xl space-y-3 animate-fadeIn border border-border">

              {/* Row 1: Text content & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <span className="text-[10px] font-mono uppercase font-bold text-muted px-1.5 py-0.5 rounded bg-surface-200">
                    {selectedElement.type}
                  </span>
                  {selectedElement.type === 'TEXT' && (
                    <input
                      type="text"
                      value={selectedElement.text || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setElements(prev => prev.map(el => el.id === selectedElement.id ? { ...el, text: val } : el));
                      }}
                      className="pro-input rounded-md px-2.5 py-1 text-xs font-bold flex-1"
                    />
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleDuplicate(selectedElement)}
                    className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Duplicate
                  </button>
                  <button
                    onClick={() => handleDeleteElement(selectedElement.id)}
                    className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 text-danger hover:text-danger"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              </div>

              {/* Row 2: Typography & Styling (if TEXT) */}
              {selectedElement.type === 'TEXT' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-border text-xs">

                  <div>
                    <label className="block text-[10px] font-mono text-muted uppercase font-bold mb-0.5">Font</label>
                    <select
                      value={selectedElement.fontFamily || 'Impact'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setElements(prev => prev.map(el => el.id === selectedElement.id ? { ...el, fontFamily: val } : el));
                      }}
                      className="pro-input w-full rounded px-2 py-1 text-xs"
                    >
                      {FONT_OPTIONS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-muted uppercase font-bold mb-0.5">
                      Size: {selectedElement.fontSize || 64}px
                    </label>
                    <input
                      type="range"
                      min="24"
                      max="120"
                      value={selectedElement.fontSize || 64}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setElements(prev => prev.map(el => el.id === selectedElement.id ? { ...el, fontSize: val } : el));
                      }}
                      className="w-full cursor-pointer accent-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-muted uppercase font-bold mb-0.5">Text Color</label>
                    <input
                      type="color"
                      value={selectedElement.color || '#ffffff'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setElements(prev => prev.map(el => el.id === selectedElement.id ? { ...el, color: val } : el));
                      }}
                      className="w-full h-7 rounded border border-border cursor-pointer bg-surface-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-muted uppercase font-bold mb-0.5">
                      Stroke: {selectedElement.strokeWidth || 8}px
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={selectedElement.strokeWidth || 8}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setElements(prev => prev.map(el => el.id === selectedElement.id ? { ...el, strokeWidth: val } : el));
                      }}
                      className="w-full cursor-pointer accent-accent"
                    />
                  </div>

                </div>
              )}

            </div>
          )}

        </div>

      </div>

    </div>
  );
};
