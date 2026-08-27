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
  Bold,
  Italic,
  Wand2
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

const REFERENCE_ARCHETYPES = [
  { id: 'tut-1', name: 'Tutorial Archetype (Best CTR)', category: 'Tutorials', url: '/reference-thumbnails/tutorial-1-best-archetype.png' },
  { id: 'tut-3', name: 'Tutorial Modern Slate', category: 'Tutorials', url: '/reference-thumbnails/tutorial-3.png' },
  { id: 'tut-4', name: 'Tutorial Punchy Grid', category: 'Tutorials', url: '/reference-thumbnails/tutorial-4.png' },
  { id: 'tut-5', name: 'Tutorial Floating Dashboard', category: 'Tutorials', url: '/reference-thumbnails/tutorial-5.png' },
  { id: 'tut-6', name: 'Tutorial Step-by-Step 6', category: 'Tutorials', url: '/reference-thumbnails/tutorial-6.jpeg' },
  { id: 'tut-7', name: 'Tutorial Step-by-Step 7', category: 'Tutorials', url: '/reference-thumbnails/tutorial-7.jpeg' },
  { id: 'tut-8', name: 'Tutorial Clean Minimal 8', category: 'Tutorials', url: '/reference-thumbnails/tutorial-8.png' },
  { id: 'tut-9', name: 'Tutorial Highlight 9', category: 'Tutorials', url: '/reference-thumbnails/tutorial-9.png' },
  { id: 'tut-10', name: 'Tutorial Dark Focus 10', category: 'Tutorials', url: '/reference-thumbnails/tutorial-10.jpeg' },
  { id: 'tut-11', name: 'Tutorial Master 11', category: 'Tutorials', url: '/reference-thumbnails/tutorial-11.jpeg' },
  { id: 'tut-12', name: 'Tutorial Simple 12', category: 'Tutorials', url: '/reference-thumbnails/tutorial-12-simple.jpeg' },
  { id: 'tut-13', name: 'Tutorial Pro 13', category: 'Tutorials', url: '/reference-thumbnails/tutorial-13.jpeg' },
  { id: 'walk-1', name: 'Walkthrough Detailed 1', category: 'Tutorials', url: '/reference-thumbnails/walktrough-1.jpeg' },
  { id: 'walk-2', name: 'Walkthrough Detailed 2', category: 'Tutorials', url: '/reference-thumbnails/walktrough-2.jpeg' },
  { id: 'gfin-1', name: 'Google Finance Excel', category: 'Tutorials', url: '/reference-thumbnails/google-finance-excel.jpg' },
  { id: 'norm-1', name: 'Normal Tutorial Style', category: 'Tutorials', url: '/reference-thumbnails/normal-tutorial-style.jpeg' },
  { id: 'tipps-1', name: 'Tips & Tricks Lifehacks', category: 'Tutorials', url: '/reference-thumbnails/tipps-tricks-lifehacks-1.jpeg' },
  { id: 'cool-1', name: 'Cool Feature Highlight', category: 'Tutorials', url: '/reference-thumbnails/cool-feature-1.jpeg' },
  { id: 'bad-1', name: 'Software Fix & Troubleshoot', category: 'Tutorials', url: '/reference-thumbnails/bad-software-walktrough-for-hard.jpeg' },

  { id: 'cmp-bat', name: 'Admin Comparison Battle', category: 'Comparisons', url: '/reference-thumbnails/admin-comparison-battle-style.jpeg' },
  { id: 'cmp-2-1', name: 'Comparison Split 2-1', category: 'Comparisons', url: '/reference-thumbnails/admin-comparison-2-1.jpeg' },
  { id: 'cmp-ph', name: 'Comparison 3 Phones', category: 'Comparisons', url: '/reference-thumbnails/comparison-1-3-phones.jpeg' },
  { id: 'cmp-cln', name: 'Comparison Really Clean', category: 'Comparisons', url: '/reference-thumbnails/comparison-2-really-clean.jpeg' },
  { id: 'cmp-alt', name: 'Comparison Alternatives', category: 'Comparisons', url: '/reference-thumbnails/comparison-3-alternatives.jpeg' },
  { id: 'comb-1', name: 'Combination Connection', category: 'Comparisons', url: '/reference-thumbnails/combination-connection-1.jpeg' },

  { id: 'adm-dram', name: 'Admin Dramatic Bold', category: 'Modern Tech', url: '/reference-thumbnails/admin-dramatic-bold-style.jpeg' },
  { id: 'adm-edu', name: 'Admin Educational Friendly', category: 'Modern Tech', url: '/reference-thumbnails/admin-educational-friendly-style.jpeg' },
  { id: 'adm-nrg', name: 'Admin Energetic Tech', category: 'Modern Tech', url: '/reference-thumbnails/admin-energetic-tech-style.jpeg' },
  { id: 'adm-prod', name: 'Admin Modern Productivity', category: 'Modern Tech', url: '/reference-thumbnails/admin-modern-productivity-style.jpeg' },
  { id: 'adm-warn', name: 'Admin Striking Warning', category: 'Modern Tech', url: '/reference-thumbnails/admin-striking-warning-style.jpg' },
  { id: 'cas-tech', name: 'Casual Tech Style', category: 'Modern Tech', url: '/reference-thumbnails/casual-tech-style.jpeg' },
  { id: 'news-1', name: 'Breaking News & Updates', category: 'Modern Tech', url: '/reference-thumbnails/news-1.jpeg' },
  { id: 'nano-gen', name: 'Nano Banana AI Plate', category: 'Modern Tech', url: '/background/nano_banana_key1.png' },

  { id: 'des-1', name: 'Design Minimal 1', category: 'Design & Mobile', url: '/reference-thumbnails/design-1.png' },
  { id: 'des-2', name: 'Design Card 2', category: 'Design & Mobile', url: '/reference-thumbnails/design-2.png' },
  { id: 'des-3', name: 'Design Gradient 3', category: 'Design & Mobile', url: '/reference-thumbnails/design-3.png' },
  { id: 'des-4', name: 'Design Modern 4', category: 'Design & Mobile', url: '/reference-thumbnails/design-4.png' },
  { id: 'des-5', name: 'Design Sleek 5', category: 'Design & Mobile', url: '/reference-thumbnails/design-5.png' },
  { id: 'ph-1', name: 'Phone Screen 1', category: 'Design & Mobile', url: '/reference-thumbnails/phone-1.png' },
  { id: 'ph-2', name: 'Phone Screen 2', category: 'Design & Mobile', url: '/reference-thumbnails/phone-2.png' },
  { id: 'ph-3', name: 'Phone Screen 3', category: 'Design & Mobile', url: '/reference-thumbnails/phone-3.jpeg' },
  { id: 'lay-auto', name: 'Layout Automated Grid', category: 'Design & Mobile', url: '/reference-thumbnails/layout-automated.png' },
  { id: 'lay-edit', name: 'Layout Editorial High-CTR', category: 'Design & Mobile', url: '/reference-thumbnails/layout-editorial.png' },

  { id: 'arch-1', name: 'Classic Archetype 1', category: 'Classics', url: '/reference-thumbnails/Archetype.png' },
  { id: 'arch-2', name: 'Classic Archetype 2', category: 'Classics', url: '/reference-thumbnails/archetype2.jpg' },
  { id: 'arch-3', name: 'Classic Archetype 3', category: 'Classics', url: '/reference-thumbnails/archetype3.jpeg' },
  { id: 'arch-4', name: 'Classic Archetype 4', category: 'Classics', url: '/reference-thumbnails/archetype4.jpeg' },
  { id: 'arch-5', name: 'Classic Archetype 5', category: 'Classics', url: '/reference-thumbnails/archetype5.jpeg' },
  { id: 'arch-6', name: 'Classic Archetype 6', category: 'Classics', url: '/reference-thumbnails/archetype6.jpeg' },
  { id: 'arch-7', name: 'Classic Archetype 7', category: 'Classics', url: '/reference-thumbnails/archetype7.jpeg' },
  { id: 'hum-1', name: 'Humor & Expressive Face', category: 'Classics', url: '/reference-thumbnails/humor-1.jpg' },
  { id: 'fh-1', name: 'Forehead Reaction Style', category: 'Classics', url: '/reference-thumbnails/forehead-funny.jpeg' }
];

export const ThumbnailStudio: React.FC = () => {
  const location = useLocation();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const channels = StorageService.getChannels();
  const [selectedChannelId, setSelectedChannelId] = useState<string>(channels[0]?.id || 'virtualfd');

  const [activeTab, setActiveTab] = useState<'AI_GEN' | 'ARCHETYPES' | 'CUSTOM' | 'PERSONAS' | 'LOGOS' | 'SYMBOLS' | 'BGS' | 'LAYERS'>('AI_GEN');
  const [archetypeFilter, setArchetypeFilter] = useState<'ALL' | 'Tutorials' | 'Comparisons' | 'Modern Tech' | 'Design & Mobile' | 'Classics'>('ALL');
  const [activeLang, setActiveLang] = useState<string>('English');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [zoomScale, setZoomScale] = useState<number>(1);

  // Custom User Uploads State
  const [customAssets, setCustomAssets] = useState<CustomThumbnailAsset[]>(() => StorageService.getCustomThumbnailAssets());

  // AI Nano Banana 2 Generator State
  const [aiPrompt, setAiPrompt] = useState<string>('High-CTR YouTube thumbnail background for a software tutorial, vibrant gradient lighting, modern 3D UI elements, clean cinematic composition, 16:9');
  const [selectedRefArchetype, setSelectedRefArchetype] = useState<string>('/reference-thumbnails/tutorial-1-best-archetype.png');
  const [selectedPersonaUrl, setSelectedPersonaUrl] = useState<string>('/English/English.png');
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

  // AI Image Generation Handlers
  const handleGenerateAIImage = async () => {
    if (!aiPrompt.trim()) return;
    setIsGeneratingAI(true);
    setAiGenError(null);

    try {
      const dataUri = await AIService.generateThumbnailImage(aiPrompt, {
        aspectRatio,
        model: aiModel,
        imageSize: aiImageSize
      });

      setGeneratedAiImages(prev => [dataUri, ...prev]);

      // Automatically set as background
      setElements(prev => {
        const bgIdx = prev.findIndex(e => e.type === 'BACKGROUND');
        if (bgIdx >= 0) {
          const updated = [...prev];
          updated[bgIdx] = { ...updated[bgIdx], url: dataUri };
          return updated;
        } else {
          return [
            {
              id: `bg-${Date.now()}`,
              type: 'BACKGROUND',
              url: dataUri,
              x: 0,
              y: 0,
              width: aspectRatio === '16:9' ? 800 : 450,
              height: aspectRatio === '16:9' ? 450 : 800,
              zIndex: 1
            },
            ...prev
          ];
        }
      });
    } catch (err: any) {
      console.error('AI image generation error:', err);
      setAiGenError(err.message || 'Image generation failed');
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
    const persona = personaUrl || selectedPersonaUrl;

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
      const fullPrompt = `High-CTR YouTube thumbnail background plate for "${topic}", styled with dramatic volumetric lighting, cinematic color contrast, clean 3D graphic elements, matching visual style of reference archetype, 16:9 composition`;

      const generatedPlateUrl = await AIService.generateThumbnailImage(fullPrompt, {
        aspectRatio,
        model: aiModel,
        imageSize: aiImageSize,
        referenceImageBase64: refB64
      });

      setGeneratedAiImages(prev => [generatedPlateUrl, ...prev]);

      // 4. Find matched software logo if available
      const cleanSoftware = (brief.software_name || topic.split(' ')[0] || '').toLowerCase();
      const matchedLogo = ALL_APP_LOGOS.find(l => l.toLowerCase().includes(cleanSoftware)) || 'ChatGPT-Logo.png';

      // 5. Compose full canvas element tree
      const composedElements: ThumbnailElement[] = [
        {
          id: `bg-${Date.now()}`,
          type: 'BACKGROUND',
          url: generatedPlateUrl,
          x: 0,
          y: 0,
          width: aspectRatio === '16:9' ? 800 : 450,
          height: aspectRatio === '16:9' ? 450 : 800,
          zIndex: 1
        },
        {
          id: `person-${Date.now()}`,
          type: 'PERSON',
          url: persona || '/English/English.png',
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
        },
        {
          id: `logo-${Date.now()}`,
          type: 'LOGO',
          url: `/logos/${matchedLogo}`,
          x: 620,
          y: 220,
          width: 140,
          height: 140,
          zIndex: 3
        }
      ];

      setElements(composedElements);
      setSelectedId('text-top');
    } catch (err: any) {
      console.error('Auto-compose thumbnail failed:', err);
      setAiGenError(err.message || 'Auto-composition failed');
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
    alert('Saved to Custom Assets library!');
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
          <div className="grid grid-cols-8 gap-0.5 p-1 bg-surface-200 rounded-lg border border-border">
            {(['AI_GEN', 'ARCHETYPES', 'CUSTOM', 'PERSONAS', 'LOGOS', 'SYMBOLS', 'BGS', 'LAYERS'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-1.5 text-[8px] font-mono font-bold uppercase rounded-md transition-all truncate flex items-center justify-center gap-0.5 ${
                  activeTab === tab
                    ? 'bg-surface-100 text-foreground shadow-subtle'
                    : 'text-muted hover:text-foreground'
                }`}
                title={tab === 'AI_GEN' ? 'AI Nano Banana 2 Generator' : tab === 'ARCHETYPES' ? 'Reference Archetypes' : tab}
              >
                {tab === 'AI_GEN' ? (
                  <>
                    <Sparkles className="w-2.5 h-2.5 text-blue-400" />
                    <span>AI AUTO</span>
                  </>
                ) : tab === 'ARCHETYPES' ? (
                  <>
                    <Layers className="w-2.5 h-2.5 text-purple-400" />
                    <span>REFS (56)</span>
                  </>
                ) : tab}
              </button>
            ))}
          </div>

          {/* AI Nano Banana 2 Automated Generator Panel */}
          {activeTab === 'AI_GEN' && (
            <div className="p-3 rounded-lg bg-surface-200/80 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[10px] font-mono font-bold uppercase text-foreground">
                    1-Click Auto Thumbnail Factory
                  </span>
                </div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Nano Banana 2
                </span>
              </div>

              {/* 1. Pick Reference Archetype */}
              <div className="space-y-1">
                <label className="block text-[9px] font-mono text-muted flex items-center justify-between">
                  <span>1. Reference Visual Style:</span>
                  <span className="text-[8.5px] text-blue-400 font-bold">{REFERENCE_ARCHETYPES.find(a => a.url === selectedRefArchetype)?.name || 'Default Style'}</span>
                </label>
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {REFERENCE_ARCHETYPES.slice(0, 12).map(arch => (
                    <button
                      key={arch.id}
                      onClick={() => setSelectedRefArchetype(arch.url)}
                      className={`relative flex-shrink-0 w-16 aspect-video rounded-md overflow-hidden border transition-all ${
                        selectedRefArchetype === arch.url
                          ? 'border-blue-500 ring-2 ring-blue-500/30'
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
                <label className="block text-[9px] font-mono text-muted flex items-center justify-between">
                  <span>2. Host Persona Cutout:</span>
                  <span className="text-[8.5px] text-foreground font-bold">{activeLang} Persona</span>
                </label>
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {(DEFAULT_PERSONAS[activeLang] || DEFAULT_PERSONAS['English']).map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedPersonaUrl(p.url)}
                      className={`relative flex-shrink-0 w-10 h-10 rounded-lg bg-surface-300 border flex items-center justify-center p-0.5 transition-all ${
                        selectedPersonaUrl === p.url
                          ? 'border-emerald-500 ring-2 ring-emerald-500/30'
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
                <label className="block text-[9px] font-mono text-muted mb-1">
                  3. Topic / Prompt:
                </label>
                <textarea
                  rows={2}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Advanced Excel VLOOKUP automation tutorial..."
                  className="pro-input w-full rounded-md p-2 text-xs font-mono resize-y"
                />
              </div>

              {/* Prompt Suggestions */}
              <div className="space-y-1">
                <div className="flex gap-1 flex-wrap">
                  {[
                    'Excel Dashboard Neon',
                    'Notion Minimal 3D',
                    'SaaS Automation Studio',
                    'Clean Dark Slate'
                  ].map(style => (
                    <button
                      key={style}
                      onClick={() => setAiPrompt(`High-CTR YouTube thumbnail background for ${style}, dramatic volumetric lighting, ultra-clean 3D composition, 16:9`)}
                      className="px-1.5 py-0.5 rounded bg-surface-300 text-[8.5px] font-mono text-muted hover:text-foreground hover:bg-surface-100 transition-colors"
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model & Size Selector */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[8.5px] font-mono text-muted mb-0.5">Model Engine:</label>
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value as any)}
                    className="pro-input w-full text-[9.5px] rounded p-1 font-mono"
                  >
                    <option value="gemini-2.5-flash-image">Nano Banana Flash (Fast)</option>
                    <option value="gemini-3-pro-image">Nano Banana Pro (2K)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[8.5px] font-mono text-muted mb-0.5">Resolution Floor:</label>
                  <select
                    value={aiImageSize}
                    onChange={(e) => setAiImageSize(e.target.value as any)}
                    className="pro-input w-full text-[9.5px] rounded p-1 font-mono"
                  >
                    <option value="1K">1K (1344x768)</option>
                    <option value="2K">2K (2752x1536 Pro)</option>
                  </select>
                </div>
              </div>

              {aiGenError && (
                <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px] font-mono text-red-400">
                  {aiGenError}
                </div>
              )}

              {/* Action Buttons: Auto-Compose Full Thumbnail vs Background Only */}
              <div className="space-y-1.5">
                <button
                  onClick={() => handleAutoComposeThumbnail()}
                  disabled={isGeneratingAI || !aiPrompt.trim()}
                  className="btn-solid w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-elevation"
                >
                  {isGeneratingAI ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Composing AI Thumbnail (~15s)...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-blue-300" />
                      <span>Auto-Compose Complete Thumbnail</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleGenerateAIImage}
                  disabled={isGeneratingAI || !aiPrompt.trim()}
                  className="btn-outline w-full py-1.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 text-muted hover:text-foreground disabled:opacity-50"
                >
                  <Layers className="w-3 h-3" />
                  <span>Generate Background Plate Only</span>
                </button>
              </div>
            </div>
          )}

          {/* Reference Archetypes Browser Panel */}
          {activeTab === 'ARCHETYPES' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase text-foreground">
                  High-CTR Reference Library ({REFERENCE_ARCHETYPES.length})
                </span>
                <span className="text-[9px] font-mono text-muted">From Content Forge</span>
              </div>

              {/* Category Filter Pills */}
              <div className="flex gap-1 flex-wrap">
                {(['ALL', 'Tutorials', 'Comparisons', 'Modern Tech', 'Design & Mobile', 'Classics'] as const).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setArchetypeFilter(cat)}
                    className={`px-2 py-0.5 rounded text-[9px] font-mono font-semibold transition-colors ${
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
            
            {/* AI Generated Images Gallery */}
            {activeTab === 'AI_GEN' && (
              <div className="space-y-2">
                {generatedAiImages.length === 0 ? (
                  <div className="text-center py-8 text-xs text-muted space-y-1">
                    <Sparkles className="w-5 h-5 mx-auto text-muted/50 mb-1" />
                    <p className="font-semibold text-foreground">No AI thumbnails generated yet.</p>
                    <p className="text-[11px]">Type a prompt above and click "Generate AI Thumbnail" to produce high-CTR 16:9 plates.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-[10px] font-mono uppercase font-bold text-muted">
                      Generated AI Plates ({generatedAiImages.length}):
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {generatedAiImages.map((imgUri, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-surface-200 border border-border space-y-2 group">
                          <div className="aspect-video relative rounded-md overflow-hidden bg-black border border-border">
                            <img src={imgUri} alt={`AI Gen ${idx + 1}`} className="w-full h-full object-cover" />
                            <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-[9px] font-mono text-white">
                              Plate #{generatedAiImages.length - idx}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-1 pt-1">
                            <button
                              onClick={() => handleSetAiAsBg(imgUri)}
                              className="btn-solid py-1 px-1 rounded text-[9px] font-bold text-center"
                              title="Set as Canvas Background"
                            >
                              Set BG
                            </button>
                            <button
                              onClick={() => handleAddAiAsLayer(imgUri)}
                              className="btn-outline py-1 px-1 rounded text-[9px] font-bold text-center"
                              title="Add as Layer"
                            >
                              + Layer
                            </button>
                            <button
                              onClick={() => handleSaveAiToAssets(imgUri)}
                              className="btn-outline py-1 px-1 rounded text-[9px] font-bold text-center"
                              title="Save to Custom Assets Library"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Reference Archetypes Library (56 Templates) */}
            {activeTab === 'ARCHETYPES' && (
              <div className="space-y-3">
                <div className="text-[10px] font-mono uppercase font-bold text-muted">
                  Showing {REFERENCE_ARCHETYPES.filter(a => (archetypeFilter === 'ALL' || a.category === archetypeFilter) && a.name.toLowerCase().includes(searchQuery.toLowerCase())).length} Archetypes:
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {REFERENCE_ARCHETYPES
                    .filter(a => (archetypeFilter === 'ALL' || a.category === archetypeFilter) && a.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(arch => (
                      <div key={arch.id} className="p-1.5 rounded-lg bg-surface-200 border border-border hover:border-border-strong space-y-1.5 group">
                        <div className="aspect-video relative rounded overflow-hidden bg-black border border-border/50">
                          <img src={arch.url} alt={arch.name} className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-1">
                            <p className="text-[8.5px] font-bold text-white truncate">{arch.name}</p>
                            <span className="text-[7.5px] font-mono text-muted uppercase">{arch.category}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            onClick={() => handleAddAsset('BACKGROUND', arch.url)}
                            className="btn-solid py-1 px-1 rounded text-[8.5px] font-bold text-center"
                            title="Set as Canvas Background"
                          >
                            Use BG
                          </button>
                          <button
                            onClick={() => {
                              setSelectedRefArchetype(arch.url);
                              setActiveTab('AI_GEN');
                            }}
                            className="btn-outline py-1 px-1 rounded text-[8.5px] font-bold text-center text-blue-400 border-blue-500/30"
                            title="Use as Style Reference in AI Studio"
                          >
                            AI Auto
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
