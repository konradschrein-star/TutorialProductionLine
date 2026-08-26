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
  Sliders, 
  Upload, 
  Plus, 
  Palette,
  Tv,
  ArrowUp,
  ArrowDown,
  Type,
  Eye,
  EyeOff,
  Bookmark,
  RotateCw,
  Sun,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Bold,
  Italic
} from 'lucide-react';
import { AIService } from '../services/aiService';
import { StorageService } from '../services/storageService';
import { ThumbnailElement, ThumbnailBrief, CustomThumbnailAsset, Channel } from '../types';

const LANGUAGES = ['English', 'German', 'Spanish', 'Portuguese', 'Italian', 'French', 'Dutch', 'Japanese', 'Korean', 'Swedish'];

const FONT_OPTIONS = [
  { label: 'Impact (Standard Bold)', value: 'Impact' },
  { label: 'Anton (Heavy Punch)', value: 'Anton' },
  { label: 'Montserrat ExtraBold', value: 'Montserrat' },
  { label: 'Bebas Neue (Tall Condensed)', value: 'Bebas Neue' },
  { label: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans' },
  { label: 'Arial Black', value: 'Arial Black' },
  { label: 'Inter Black', value: 'Inter' }
];

const DEFAULT_BGS = [
  { name: 'Abstract Gradient Blue', url: '/background/bg_1_1128207.jpg' },
  { name: 'Dark Corporate Slate', url: '/background/bg_5_4386356.jpg' },
  { name: 'Neon Glow Studio', url: '/background/bg_6_322338.jpg' },
  { name: 'Modern Minimal Tech', url: '/background/bg_9_5717314.jpg' }
];

const DEFAULT_PERSONAS: Record<string, { name: string; url: string }[]> = {
  English: [
    { name: 'English Host Pro', url: '/English/English.png' },
    { name: 'English Presenter 1', url: '/English/english_persona_3_1783711821680-removebg-preview.png' },
    { name: 'English Presenter 2', url: '/English/english_persona_4_1783711831752-removebg-preview.png' },
    { name: 'English Creator', url: '/English/new_english_persona_1783711373283-removebg-preview.png' }
  ],
  Spanish: [
    { name: 'Spanish Presenter 1', url: '/spanish/spanish_1_1783793169018-removebg-preview.png' },
    { name: 'Spanish Presenter 2', url: '/spanish/spanish_3_1783793186761-removebg-preview.png' },
    { name: 'Spanish Presenter 3', url: '/spanish/spanish_4_1783793195747-removebg-preview.png' }
  ],
  German: [
    { name: 'German Host 1', url: '/germanese/german_persona_1_1783711850388-removebg-preview.png' }
  ],
  Italian: [
    { name: 'Italian Host 1', url: '/Italy/italian_persona_1_1783711874987-removebg-preview.png' }
  ],
  French: [
    { name: 'French Host 1', url: '/French/french_1_1783793208007-removebg-preview.png' }
  ],
  Portuguese: [
    { name: 'Portuguese Host 1', url: '/portoguese/portuguese_1_1783793231454-removebg-preview.png' }
  ],
  Japanese: [
    { name: 'Japanese Host 1', url: '/Japanese/japanese_persona_1_1783711894982-removebg-preview.png' }
  ],
  Korean: [
    { name: 'Korean Host 1', url: '/Korean/korean_persona_1_1783711915998-removebg-preview.png' }
  ],
  Swedish: [
    { name: 'Swedish Host 1', url: '/Swedish/swedish_persona_1_1783711936998-removebg-preview.png' }
  ],
  Dutch: [
    { name: 'Dutch Host 1', url: '/English/English.png' }
  ]
};

const ALL_APP_LOGOS = [
  'asana.png', 'blender.png', 'calendly.png', 'cashapp.png', 'ChatGPT-Logo.png',
  'clickup.png', 'cloudflare.png', 'davinciresolve.png', 'discord.png', 'dropbox.png',
  'ebay.png', 'epicgames.png', 'etsy.png', 'facebook.png', 'figma.png',
  'gimp.png', 'github.png', 'gmail.png', 'googlecalendar.png', 'googlechrome.png',
  'googledocs.png', 'googledrive.png', 'googlemaps.png', 'googlemeet.png', 'googlephotos.png',
  'googlesheets.png', 'gumroad.png', 'icloud.png', 'imessage.png', 'inkscape.png',
  'instagram.png', 'krita.png', 'macos.png', 'mailchimp.png', 'namecheap.png',
  'netflix.png', 'netlify.png', 'notion.png', 'obsidian.png', 'obsstudio.png',
  'paypal.png', 'pinterest.png', 'playstation.png', 'reddit.png', 'replit.png',
  'roblox.png', 'safari.png', 'shopify.png', 'snapchat.png', 'spotify.png',
  'steam.png', 'streamlabs.png', 'stripe.png', 'telegram.png', 'tiktok.png',
  'todoist.png', 'trello.png', 'twitch.png', 'venmo.png', 'vercel.png',
  'whatsapp.png', 'wix.png', 'woocommerce.png', 'wordpress.png', 'youtube.png',
  'youtubestudio.png', 'zapier.png', 'zelle.png', 'zoom.png'
];

const ALL_SYMBOLS = [
  'curved-arrow.png', 'alert-circle.png', 'alert-triangle.png', 'badge-check.png',
  'badge.png', 'bell-ring.png', 'bell.png', 'camera.png', 'check-circle.png',
  'clock.png', 'cloud.png', 'code.png', 'crown.png', 'database.png',
  'diamond.png', 'dollar-sign.png', 'eye.png', 'file-text.png', 'flame.png',
  'gift.png', 'globe.png', 'heart.png', 'key.png', 'laptop.png',
  'lightbulb.png', 'lock.png', 'megaphone.png', 'mic.png', 'play.png',
  'rocket.png', 'shield.png', 'sparkle.png', 'sparkles.png', 'star.png',
  'target.png', 'thumbs-up.png', 'trending-up.png', 'trophy.png', 'tv.png',
  'video.png', 'wand-sparkles.png', 'zap.png'
];

export const ThumbnailStudio: React.FC = () => {
  const location = useLocation();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const channels = StorageService.getChannels();
  const [selectedChannelId, setSelectedChannelId] = useState<string>(channels[0]?.id || 'virtualfd');

  const [activeTab, setActiveTab] = useState<'CUSTOM' | 'PERSONAS' | 'LOGOS' | 'SYMBOLS' | 'BGS' | 'LAYERS'>('CUSTOM');
  const [activeLang, setActiveLang] = useState<string>('English');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [zoomScale, setZoomScale] = useState<number>(1);

  // Custom User Uploads State
  const [customAssets, setCustomAssets] = useState<CustomThumbnailAsset[]>(() => StorageService.getCustomThumbnailAssets());

  // Canvas elements state
  const [elements, setElements] = useState<ThumbnailElement[]>([
    {
      id: 'bg-1',
      type: 'BACKGROUND',
      url: '/background/bg_1_1128207.jpg',
      x: 0,
      y: 0,
      width: 800,
      height: 450,
      zIndex: 1,
    },
    {
      id: 'person-1',
      type: 'PERSON',
      url: '/English/English.png',
      x: 20,
      y: 40,
      width: 320,
      height: 410,
      zIndex: 2,
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
      url: '/app_logos_png/notion.png',
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
      url: '/bulk_symbols_110_colored/curved-arrow.png',
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
  const [autoGenTitle, setAutoGenTitle] = useState<string>('');
  const [isGeneratingBrief, setIsGeneratingBrief] = useState<boolean>(false);
  const [currentBrief, setCurrentBrief] = useState<ThumbnailBrief | null>(null);
  const [presetSavedNotice, setPresetSavedNotice] = useState<string>('');

  useEffect(() => {
    if (location.state?.topic || location.state?.title) {
      setAutoGenTitle(location.state.topic || location.state.title);
    }
  }, [location.state]);

  const selectedElement = elements.find(el => el.id === selectedId);

  // Filtered Assets
  const filteredLogos = useMemo(() => {
    return ALL_APP_LOGOS.filter(name => 
      !searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  const filteredSymbols = useMemo(() => {
    return ALL_SYMBOLS.filter(name => 
      !searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

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
          strokeColor: ch.thumbnailStyle?.strokeColor || el.strokeColor,
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
    setPresetSavedNotice(`✓ Saved styling preset to ${ch.name}`);
    setTimeout(() => setPresetSavedNotice(''), 2500);
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
    };
    reader.readAsDataURL(file);
  };

  // AI Brief Auto Generation
  const handleGenerateAIBrief = async () => {
    if (!autoGenTitle.trim()) {
      alert('Please enter a video topic or title first.');
      return;
    }

    setIsGeneratingBrief(true);
    try {
      const brief = await AIService.generateThumbnailBrief(autoGenTitle);
      setCurrentBrief(brief);

      // Match logo if found
      const cleanSoftware = (brief.software_name || '').toLowerCase();
      const matchedLogo = ALL_APP_LOGOS.find(l => l.toLowerCase().includes(cleanSoftware));

      setElements(prev => prev.map(el => {
        if (el.id === 'text-top') {
          return { ...el, text: brief.thumbnail_text_line1 };
        }
        if (el.id === 'text-bottom') {
          return { ...el, text: brief.thumbnail_text_line2 };
        }
        if (el.id === 'logo-1' && matchedLogo) {
          return { ...el, url: `/app_logos_png/${matchedLogo}` };
        }
        return el;
      }));
    } catch (e: any) {
      console.error(e);
      alert('Failed to generate thumbnail brief: ' + e.message);
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

  // Single PNG Export
  const handleExportPNG = async () => {
    if (!canvasRef.current) return;
    setIsExporting(true);
    setSelectedId(null);

    try {
      await new Promise(r => setTimeout(r, 200));
      const blob = await toBlob(canvasRef.current, {
        pixelRatio: 2.4,
      });

      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `thumbnail_${(autoGenTitle || 'custom').replace(/[^a-z0-9]/gi, '_')}_${activeLang}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      console.error('Export failed:', err);
      alert('Export failed: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Batch 10-Language Pack Exporter (ZIP)
  const handleBatchExportZip = async () => {
    if (!canvasRef.current) return;
    setIsBatchExporting(true);
    setSelectedId(null);

    try {
      const zip = new JSZip();
      const brief = currentBrief || await AIService.generateThumbnailBrief(autoGenTitle || 'Custom Tutorial');

      for (const lang of LANGUAGES) {
        const trans = brief.translations?.[lang] || { top: 'LEARN FAST', bottom: 'STEP BY STEP' };
        
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

      const zipContent = await zip.generateAsync({ type: 'blob' });
      saveAs(zipContent, `thumbnail_pack_${(autoGenTitle || 'tutorial').replace(/[^a-z0-9]/gi, '_')}_10langs.zip`);

    } catch (err: any) {
      console.error('Batch export failed:', err);
      alert('Batch export failed: ' + err.message);
    } finally {
      setIsBatchExporting(false);
    }
  };

  const canvasWidth = aspectRatio === '16:9' ? 800 : 450;
  const canvasHeight = aspectRatio === '16:9' ? 450 : 800;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pro-panel p-3.5 rounded-xl border border-border">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Aspect Ratio */}
          <div className="flex items-center bg-surface-200 rounded-lg p-0.5 border border-border text-xs font-mono font-bold">
            <button
              onClick={() => setAspectRatio('16:9')}
              className={`px-2.5 py-1 rounded transition-colors ${aspectRatio === '16:9' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
            >
              16:9 HD
            </button>
            <button
              onClick={() => setAspectRatio('9:16')}
              className={`px-2.5 py-1 rounded transition-colors ${aspectRatio === '9:16' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
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
              className="p-1 text-muted hover:text-foreground"
              title="Save current layout as default for this channel"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          </div>

          {presetSavedNotice && (
            <span className="text-[11px] font-mono text-emerald-500 font-bold animate-fadeIn">
              {presetSavedNotice}
            </span>
          )}

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
            disabled={isGeneratingBrief}
            onClick={handleGenerateAIBrief}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Brief
          </button>
          <button
            disabled={isExporting || isBatchExporting}
            onClick={handleExportPNG}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export PNG
          </button>
          <button
            disabled={isBatchExporting || isExporting}
            onClick={handleBatchExportZip}
            className="btn-solid px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 flex-shrink-0"
          >
            <FolderArchive className="w-3.5 h-3.5" />
            {isBatchExporting ? 'Packaging ZIP...' : '10-Lang ZIP'}
          </button>
        </div>
      </div>

      {/* Main Studio Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left Side: Asset Library & Layer Tree (4 cols) */}
        <div className="lg:col-span-4 pro-panel p-3.5 rounded-xl space-y-3 flex flex-col h-[650px]">
          
          {/* Category Tabs */}
          <div className="grid grid-cols-6 gap-0.5 p-1 bg-surface-200 rounded-lg border border-border">
            {(['CUSTOM', 'PERSONAS', 'LOGOS', 'SYMBOLS', 'BGS', 'LAYERS'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-1.5 text-[9px] font-mono font-bold uppercase rounded-md transition-all ${
                  activeTab === tab
                    ? 'bg-surface-100 text-foreground shadow-subtle'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Custom Assets Upload Panel */}
          {activeTab === 'CUSTOM' && (
            <div className="p-2.5 rounded-lg bg-surface-200 border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase text-foreground">
                  Custom Brand Reference Upload
                </span>
                <button
                  onClick={handleAddTextElement}
                  className="btn-outline px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                >
                  <Type className="w-3 h-3" /> + Add Text
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="btn-solid py-1.5 px-2 rounded text-[10px] font-bold text-center cursor-pointer flex items-center justify-center gap-1">
                  <Upload className="w-3 h-3" /> Face / Persona
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleUploadCustomAsset(e, 'PERSONAS')}
                  />
                </label>
                <label className="btn-outline py-1.5 px-2 rounded text-[10px] font-bold text-center cursor-pointer flex items-center justify-center gap-1">
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

          {/* Language selector for personas */}
          {activeTab === 'PERSONAS' && (
            <div className="flex flex-wrap gap-1">
              {LANGUAGES.map(lang => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                    activeLang === lang
                      ? 'bg-surface-300 text-foreground border border-border-strong'
                      : 'bg-surface-200 text-muted hover:text-foreground'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          )}

          {/* Search Box */}
          {activeTab !== 'LAYERS' && (
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter assets..."
                className="pro-input w-full rounded-md px-2.5 py-1 text-xs"
              />
              <Search className="w-3.5 h-3.5 text-muted absolute right-2.5 top-2" />
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-0.5 space-y-2">
            
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
                          onClick={() => {
                            StorageService.deleteCustomThumbnailAsset(asset.id);
                            setCustomAssets(StorageService.getCustomThumbnailAssets());
                          }}
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
                <div className="text-[10px] font-mono uppercase text-muted font-bold px-1">Active Layers ({elements.length})</div>
                {elements.map((el) => (
                  <div
                    key={el.id}
                    onClick={() => setSelectedId(el.id)}
                    className={`p-2 rounded-lg border flex items-center justify-between text-xs cursor-pointer transition-colors ${
                      selectedId === el.id ? 'bg-surface-300 border-foreground/40 font-bold' : 'bg-surface-200/50 border-border hover:bg-surface-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-surface-300 text-muted">
                        {el.type}
                      </span>
                      <span className="truncate text-foreground text-[11px]">
                        {el.text || el.url?.split('/').pop() || el.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoveLayer(el.id, 'up'); }}
                        className="p-1 text-muted hover:text-foreground"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoveLayer(el.id, 'down'); }}
                        className="p-1 text-muted hover:text-foreground"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDuplicate(el); }}
                        className="p-1 text-muted hover:text-foreground"
                        title="Duplicate"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setElements(prev => prev.filter(item => item.id !== el.id));
                          if (selectedId === el.id) setSelectedId(null);
                        }}
                        className="p-1 text-muted hover:text-red-500"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Default Personas */}
            {activeTab === 'PERSONAS' && (
              <div className="grid grid-cols-3 gap-2">
                {(DEFAULT_PERSONAS[activeLang] || DEFAULT_PERSONAS['English']).map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('PERSON', p.url)}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-1 flex flex-col items-center justify-center transition-transform hover:scale-105"
                  >
                    <img src={p.url} alt={p.name} className="max-h-full object-contain" />
                  </button>
                ))}
              </div>
            )}

            {/* All 71 Logos */}
            {activeTab === 'LOGOS' && (
              <div className="grid grid-cols-3 gap-2">
                {filteredLogos.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('LOGO', `/app_logos_png/${name}`)}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-2 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105"
                  >
                    <img src={`/app_logos_png/${name}`} alt={name} className="w-8 h-8 object-contain" />
                    <span className="text-[9px] font-mono text-muted truncate w-full text-center">
                      {name.replace(/\.png$/i, '').replace(/[-_]/g, ' ')}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* All 111 Symbols */}
            {activeTab === 'SYMBOLS' && (
              <div className="grid grid-cols-3 gap-2">
                {filteredSymbols.map((sym, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('SYMBOL', `/bulk_symbols_110_colored/${sym}`)}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-2 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105"
                  >
                    <img src={`/bulk_symbols_110_colored/${sym}`} alt={sym} className="w-8 h-8 object-contain" />
                    <span className="text-[9px] font-mono text-muted truncate w-full text-center">
                      {sym.replace(/\.png$/i, '').replace(/[-_]/g, ' ')}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Backgrounds */}
            {activeTab === 'BGS' && (
              <div className="grid grid-cols-1 gap-2">
                {DEFAULT_BGS.map((bg, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setElements(prev => prev.map(el => el.type === 'BACKGROUND' ? { ...el, url: bg.url } : el));
                    }}
                    className="aspect-video rounded-lg overflow-hidden border border-border hover:border-border-strong relative group"
                  >
                    <img src={bg.url} alt={bg.name} className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-2 text-[10px] font-mono font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">
                      {bg.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

          </div>

        </div>

        {/* Right Side: Interactive Canvas & Rich Property Inspector (8 cols) */}
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
                        <img
                          src={el.url}
                          alt="Asset"
                          className="w-full h-full object-contain pointer-events-none"
                        />
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
                    onClick={() => {
                      setElements(prev => prev.filter(el => el.id !== selectedElement.id));
                      setSelectedId(null);
                    }}
                    className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 text-red-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              </div>

              {/* Row 2: Typography & Styling (if TEXT) */}
              {selectedElement.type === 'TEXT' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-border text-xs">
                  
                  {/* Font Family */}
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

                  {/* Font Size */}
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
                      className="w-full cursor-pointer accent-foreground"
                    />
                  </div>

                  {/* Fill Color */}
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

                  {/* Stroke Border */}
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
                      className="w-full cursor-pointer accent-foreground"
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
