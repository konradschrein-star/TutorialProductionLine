import React, { useState, useRef, useEffect } from 'react';
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
  Sliders
} from 'lucide-react';
import { AIService } from '../services/aiService';
import { ThumbnailElement, ThumbnailBrief } from '../types';

const LANGUAGES = ['English', 'German', 'Spanish', 'Portuguese', 'Italian', 'French', 'Dutch', 'Japanese', 'Korean', 'Swedish'];

const STATIC_BGS = [
  '/background/bg-gradient-1.png',
  '/background/bg-gradient-2.png',
  '/background/bg-gradient-3.png',
  '/background/bg-soft-focus-1.png',
  '/background/bg-soft-focus-2.png',
  '/background/bg-workspace-1.png',
];

const STATIC_PERSONAS: Record<string, string[]> = {
  English: ['/English/0a7b453e-00a4-44df-9d32-23f269a8427f_removalai_preview.png', '/English/0df8417c-2b62-4aa8-9f20-149b5c3ff32a_removalai_preview.png'],
  German: ['/germanese/0eb28383-9b98-466d-8b06-538beea396d1_removalai_preview.png', '/germanese/2bf376ce-f597-40b9-b88e-6705d8f6f578_removalai_preview.png'],
  Spanish: ['/spanish/spanish_1_1783793169018-removebg-preview.png', '/spanish/spanish_3_1783793186761-removebg-preview.png'],
  Portuguese: ['/portoguese/0d8cea91-3bd0-4a97-b2af-8553cdb5e2c2_removalai_preview.png', '/portoguese/28d7a6e2-15c3-467f-bb73-0f146a997ebd_removalai_preview.png'],
  Italian: ['/Italy/03009044-1891-4745-8e68-d8e7daf4c47b_removalai_preview.png', '/Italy/081a8de0-1857-420b-a470-ceddf006e88b_removalai_preview.png'],
  French: ['/French/0f2e0a2d-70eb-48fc-95b6-b52bca1cfa06_removalai_preview.png', '/French/2a3e0f9b-64bb-4e92-9a0d-d9b897914ae9_removalai_preview.png'],
  Dutch: ['/Dutch/0d2c0b62-cfbd-45a4-ba09-4bf91ec557b7_removalai_preview.png', '/Dutch/2ff661d9-2a9b-449e-b9b5-27a3be095d3a_removalai_preview.png'],
  Japanese: ['/Japanese/31bf9c29-9194-49df-ba56-4baff00537d5_removalai_preview.png', '/Japanese/55bb0ed9-628e-45dd-8cda-7f85e89953c9_removalai_preview.png'],
  Korean: ['/Korean/48acff93-85ce-4426-b3c9-8b6deb49734b_removalai_preview.png', '/Korean/9acd591f-1c94-4de3-a017-80d19ec14b5c_removalai_preview.png'],
  Swedish: ['/Swedish/218cb5ee-5ebe-400d-a0ff-0cc690b97029_removalai_preview.png', '/Swedish/935cadb4-9559-4fd1-932b-9fe90f40b579_removalai_preview.png']
};

const SAMPLE_LOGOS = [
  'Excel.png', 'Canva.png', 'Notion.png', 'ChatGPT.png', 'Figma.png', 'Word.png',
  'Power_BI.png', 'Photoshop.png', 'CapCut.png', 'Blender.png', 'Discord.png', 'Shopify.png'
];

export const ThumbnailStudio: React.FC = () => {
  const location = useLocation();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState<'PERSONAS' | 'LOGOS' | 'SYMBOLS' | 'BGS' | 'LAYERS'>('PERSONAS');
  const [activeLang, setActiveLang] = useState<string>('English');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  // Canvas elements state
  const [elements, setElements] = useState<ThumbnailElement[]>([
    {
      id: 'bg-1',
      type: 'BACKGROUND',
      url: '/background/bg-gradient-1.png',
      x: 0,
      y: 0,
      width: 800,
      height: 450,
      zIndex: 1,
    },
    {
      id: 'person-1',
      type: 'PERSON',
      url: '/English/0a7b453e-00a4-44df-9d32-23f269a8427f_removalai_preview.png',
      x: 20,
      y: 40,
      width: 340,
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
    },
    {
      id: 'logo-1',
      type: 'LOGO',
      url: '/app_logos_png/Excel.png',
      x: 450,
      y: 230,
      width: 170,
      height: 170,
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

  useEffect(() => {
    if (location.state?.title) {
      setAutoGenTitle(location.state.title);
    }
  }, [location.state]);

  const selectedElement = elements.find(el => el.id === selectedId);

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

      setElements(prev => prev.map(el => {
        if (el.id === 'text-top') {
          return { ...el, text: brief.thumbnail_text_line1 };
        }
        if (el.id === 'text-bottom') {
          return { ...el, text: brief.thumbnail_text_line2 };
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
    const newEl: ThumbnailElement = {
      id: `el_${Date.now()}`,
      type,
      url,
      x: 220,
      y: 120,
      width: type === 'LOGO' ? 140 : type === 'PERSON' ? 300 : 100,
      height: type === 'LOGO' ? 140 : type === 'PERSON' ? 360 : 100,
      zIndex: elements.length + 1,
    };
    setElements([...elements, newEl]);
    setSelectedId(newEl.id);
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
        
        // Update canvas text elements synchronously for this language
        setElements(prev => prev.map(el => {
          if (el.id === 'text-top') return { ...el, text: trans.top };
          if (el.id === 'text-bottom') return { ...el, text: trans.bottom };
          return el;
        }));

        // Allow canvas React re-render cycle
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      
      {/* Header & AI Brief Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pro-panel p-3.5 rounded-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-surface-200 rounded-lg p-0.5 border border-border text-xs font-mono font-bold">
            <button
              onClick={() => setAspectRatio('16:9')}
              className={`px-2 py-1 rounded transition-colors ${aspectRatio === '16:9' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
            >
              16:9 HD
            </button>
            <button
              onClick={() => setAspectRatio('9:16')}
              className={`px-2 py-1 rounded transition-colors ${aspectRatio === '9:16' ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted'}`}
            >
              9:16 Shorts
            </button>
          </div>
          <div>
            <h2 className="text-sm font-bold font-display text-foreground">Thumbnail Canvas Inspector</h2>
            <p className="text-[11px] text-muted">DaVinci Resolve compositor with 10-language batch pack builder.</p>
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

      {/* Main Studio Grid: Left Asset Library (4 cols) / Right Canvas (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left Side: Asset Library & Layer Tree */}
        <div className="lg:col-span-4 pro-panel p-3.5 rounded-xl space-y-3 flex flex-col h-[580px]">
          
          {/* Tabs */}
          <div className="grid grid-cols-5 gap-0.5 p-1 bg-surface-200 rounded-lg border border-border">
            {(['PERSONAS', 'LOGOS', 'SYMBOLS', 'BGS', 'LAYERS'] as const).map(tab => (
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
                placeholder="Search library assets..."
                className="pro-input w-full rounded-md px-2.5 py-1 text-xs"
              />
              <Search className="w-3.5 h-3.5 text-muted absolute right-2.5 top-2" />
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-0.5">
            
            {activeTab === 'LAYERS' && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-muted font-bold px-1">Active Layers ({elements.length})</div>
                {elements.map(el => (
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

            {activeTab === 'PERSONAS' && (
              <div className="grid grid-cols-3 gap-2">
                {(STATIC_PERSONAS[activeLang] || STATIC_PERSONAS['English']).map((url, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('PERSON', url)}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-1 flex items-center justify-center transition-transform hover:scale-105"
                  >
                    <img src={url} alt="Persona" className="max-h-full object-contain" />
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'LOGOS' && (
              <div className="grid grid-cols-3 gap-2">
                {SAMPLE_LOGOS.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('LOGO', `/app_logos_png/${name}`)}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-2 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105"
                  >
                    <img src={`/app_logos_png/${name}`} alt={name} className="w-8 h-8 object-contain" />
                    <span className="text-[9px] font-mono text-muted truncate w-full text-center">
                      {name.replace('.png', '').replace('_', ' ')}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'SYMBOLS' && (
              <div className="grid grid-cols-3 gap-2">
                {['curved-arrow.png', 'badge-check.png', 'alert-triangle.png', 'flame.png', 'star.png', 'zap.png'].map((sym, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddAsset('SYMBOL', `/bulk_symbols_110_colored/${sym}`)}
                    className="aspect-square rounded-lg bg-surface-200 border border-border hover:border-border-strong p-2 flex items-center justify-center transition-transform hover:scale-105"
                  >
                    <img src={`/bulk_symbols_110_colored/${sym}`} alt={sym} className="w-8 h-8 object-contain" />
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'BGS' && (
              <div className="grid grid-cols-1 gap-2">
                {STATIC_BGS.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setElements(prev => prev.map(el => el.type === 'BACKGROUND' ? { ...el, url } : el));
                    }}
                    className="aspect-video rounded-lg overflow-hidden border border-border hover:border-border-strong relative"
                  >
                    <img src={url} alt="Background" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

          </div>

        </div>

        {/* Right Side: Interactive Canvas Workspace */}
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
                    style={{ zIndex: el.zIndex }}
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

          {/* Property Controls */}
          {selectedElement && (
            <div className="pro-panel p-3 rounded-lg flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase font-bold text-muted">{selectedElement.type}</span>
                {selectedElement.type === 'TEXT' && (
                  <input
                    type="text"
                    value={selectedElement.text || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setElements(prev => prev.map(el => el.id === selectedElement.id ? { ...el, text: val } : el));
                    }}
                    className="pro-input rounded px-2.5 py-1 text-xs font-bold"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
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
          )}

        </div>

      </div>

    </div>
  );
};
