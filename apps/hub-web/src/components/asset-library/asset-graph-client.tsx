'use client';

import '@xyflow/react/dist/style.css';

import { useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node,
  type Edge,
} from '@xyflow/react';
import {
  Layers,
  Users2,
  Image,
  Layout,
  X,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Data contract
// ---------------------------------------------------------------------------

export interface AssetGraphData {
  archetypes: Array<{
    id: string;
    name: string;
    description: string | null;
    image_style: string | null;
  }>;
  characters: Array<{
    id: string;
    name: string;
    description: string;
    archetype_id: string | null;
    reference_sheet_asset_id: string | null;
  }>;
  styleGuides: Array<{ id: string; name: string; archetype_id: string | null }>;
  characterAssets: Array<{ id: string; name: string; character_id: string | null }>;
  environments: Array<{
    id: string;
    name: string;
    archetype_id: string | null;
    background_asset_id: string;
  }>;
  backgroundAssets: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Node data shape
// ---------------------------------------------------------------------------

type EntityType = 'archetype' | 'character' | 'styleGuide' | 'characterAsset' | 'environment' | 'backgroundAsset';

interface AssetNodeData {
  label: string;
  entityType: EntityType;
  color: string;
  description: string | null;
  metadata: Record<string, string | null>;
  editPath: string;
  [key: string]: unknown;
}

const ENTITY_COLORS: Record<EntityType, string> = {
  archetype: 'hsl(262 97% 65%)',
  character: '#10b981',
  styleGuide: '#f59e0b',
  characterAsset: '#10b981',
  environment: '#14b8a6',
  backgroundAsset: '#f97316',
};

const ENTITY_LABELS: Record<EntityType, string> = {
  archetype: 'Archetype',
  character: 'Character',
  styleGuide: 'Style Guide',
  characterAsset: 'Character Asset',
  environment: 'Environment',
  backgroundAsset: 'Background',
};

// ---------------------------------------------------------------------------
// Custom node component
// ---------------------------------------------------------------------------

function EntityIcon({ entityType, size = 16 }: { entityType: EntityType; size?: number }) {
  const props = { size, strokeWidth: 1.5 };
  switch (entityType) {
    case 'archetype':    return <Layers {...props} />;
    case 'character':    return <Users2 {...props} />;
    case 'styleGuide':   return <Image {...props} />;
    case 'characterAsset': return <Image {...props} />;
    case 'environment':  return <Layout {...props} />;
    case 'backgroundAsset': return <Image {...props} />;
  }
}

function AssetGraphNode({ data }: NodeProps) {
  const nodeData = data as AssetNodeData;
  const { label, entityType, color } = nodeData;
  const truncated = label.length > 20 ? label.slice(0, 19) + '…' : label;

  const isSquare = entityType === 'styleGuide' || entityType === 'backgroundAsset';
  const isDiamond = entityType === 'styleGuide';

  return (
    <div
      className="flex flex-col items-center justify-center gap-0.5 select-none"
      style={{
        width: isDiamond ? 90 : entityType === 'archetype' ? 100 : 84,
        height: isDiamond ? 90 : entityType === 'archetype' ? 100 : 84,
        borderRadius: isSquare ? '8px' : '50%',
        transform: isDiamond ? 'rotate(45deg)' : undefined,
        border: `2px solid ${color}`,
        background: `${color}18`,
        boxShadow: entityType === 'archetype' ? `0 0 14px ${color}55` : `0 0 6px ${color}33`,
        cursor: 'pointer',
      }}
    >
      <div style={{ transform: isDiamond ? 'rotate(-45deg)' : undefined }}>
        <div style={{ color }} className="flex justify-center mb-0.5">
          <EntityIcon entityType={entityType} size={entityType === 'archetype' ? 18 : 15} />
        </div>
        <div
          className="text-center font-medium leading-tight"
          style={{
            color: '#e5e5e5',
            fontSize: entityType === 'archetype' ? '11px' : '10px',
            maxWidth: '72px',
            wordBreak: 'break-word',
          }}
        >
          {truncated}
        </div>
        <div
          className="text-center leading-tight mt-0.5"
          style={{ color: '#666', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}
        >
          {ENTITY_LABELS[entityType]}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { assetGraphNode: AssetGraphNode };

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

interface SidePanelProps {
  node: Node | null;
  onClose: () => void;
}

function SidePanel({ node, onClose }: SidePanelProps) {
  if (!node) return null;
  const data = node.data as AssetNodeData;

  return (
    <div
      className="fixed right-0 top-0 h-full bg-[#0a0a0a] border-l border-[#1e1e2e] z-50 overflow-y-auto"
      style={{ width: 320 }}
    >
      <div className="flex items-start justify-between p-4 border-b border-[#1e1e2e]">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{
                background: `${data.color}22`,
                color: data.color,
                border: `1px solid ${data.color}44`,
              }}
            >
              {ENTITY_LABELS[data.entityType]}
            </span>
          </div>
          <h2 className="text-base font-semibold text-white truncate">{data.label}</h2>
        </div>
        <button
          onClick={onClose}
          className="ml-2 p-1 rounded hover:bg-white/10 text-[#666] hover:text-white transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {data.description && (
          <div>
            <p className="text-xs text-[#666] uppercase tracking-wider mb-1">Description</p>
            <p className="text-sm text-[#aaa] leading-relaxed">{data.description}</p>
          </div>
        )}

        {Object.keys(data.metadata).length > 0 && (
          <div>
            <p className="text-xs text-[#666] uppercase tracking-wider mb-2">Details</p>
            <div className="space-y-2">
              {Object.entries(data.metadata).map(([key, value]) =>
                value ? (
                  <div key={key}>
                    <p className="text-xs text-[#555] capitalize">{key.replace(/_/g, ' ')}</p>
                    <p className="text-sm text-[#ccc] truncate">{value}</p>
                  </div>
                ) : null
              )}
            </div>
          </div>
        )}

        <Link
          href={data.editPath}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: `${data.color}18`,
            color: data.color,
            border: `1px solid ${data.color}33`,
          }}
        >
          <ExternalLink size={14} />
          View / Edit
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph builder helpers
// ---------------------------------------------------------------------------

const COL_X = { archetypes: 100, middle: 420, assets: 740 };
const V_SPACING = 130;
const V_OFFSET = 60;

function buildGraph(data: AssetGraphData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // --- Column 1: Archetypes ---
  data.archetypes.forEach((a, i) => {
    nodes.push({
      id: `arch-${a.id}`,
      type: 'assetGraphNode',
      position: { x: COL_X.archetypes, y: V_OFFSET + i * V_SPACING },
      data: {
        label: a.name,
        entityType: 'archetype',
        color: ENTITY_COLORS.archetype,
        description: a.description,
        metadata: { image_style: a.image_style },
        editPath: `/archetypes`,
      } satisfies AssetNodeData,
    });
  });

  // --- Column 2: Characters + Environments ---
  const middleEntities = [
    ...data.characters.map((c) => ({ kind: 'character' as const, entity: c })),
    ...data.environments.map((e) => ({ kind: 'environment' as const, entity: e })),
  ];

  middleEntities.forEach(({ kind, entity }, i) => {
    if (kind === 'character') {
      const c = entity as AssetGraphData['characters'][0];
      nodes.push({
        id: `char-${c.id}`,
        type: 'assetGraphNode',
        position: { x: COL_X.middle, y: V_OFFSET + i * V_SPACING },
        data: {
          label: c.name,
          entityType: 'character',
          color: ENTITY_COLORS.character,
          description: c.description,
          metadata: {},
          editPath: `/characters`,
        } satisfies AssetNodeData,
      });

      if (c.archetype_id) {
        edges.push({
          id: `e-char-arch-${c.id}`,
          source: `char-${c.id}`,
          target: `arch-${c.archetype_id}`,
          label: 'uses style',
          animated: false,
          style: { stroke: ENTITY_COLORS.archetype, strokeWidth: 1.5 },
          labelStyle: { fill: '#888', fontSize: 9 },
          labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.8 },
        });
      }

      if (c.reference_sheet_asset_id) {
        edges.push({
          id: `e-char-refsheet-${c.id}`,
          source: `char-${c.id}`,
          target: `chasset-${c.reference_sheet_asset_id}`,
          label: 'reference sheet',
          animated: false,
          style: { stroke: ENTITY_COLORS.character, strokeWidth: 1.5, strokeDasharray: '5,4' },
          labelStyle: { fill: '#888', fontSize: 9 },
          labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.8 },
        });
      }
    } else {
      const e = entity as AssetGraphData['environments'][0];
      nodes.push({
        id: `env-${e.id}`,
        type: 'assetGraphNode',
        position: { x: COL_X.middle, y: V_OFFSET + i * V_SPACING },
        data: {
          label: e.name,
          entityType: 'environment',
          color: ENTITY_COLORS.environment,
          description: null,
          metadata: {},
          editPath: `/environments`,
        } satisfies AssetNodeData,
      });

      if (e.background_asset_id) {
        edges.push({
          id: `e-env-bg-${e.id}`,
          source: `env-${e.id}`,
          target: `bgasset-${e.background_asset_id}`,
          label: 'background',
          animated: false,
          style: { stroke: ENTITY_COLORS.backgroundAsset, strokeWidth: 1.5 },
          labelStyle: { fill: '#888', fontSize: 9 },
          labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.8 },
        });
      }

      if (e.archetype_id) {
        edges.push({
          id: `e-env-arch-${e.id}`,
          source: `env-${e.id}`,
          target: `arch-${e.archetype_id}`,
          label: 'uses style',
          animated: false,
          style: { stroke: ENTITY_COLORS.archetype, strokeWidth: 1.5, strokeDasharray: '5,4' },
          labelStyle: { fill: '#888', fontSize: 9 },
          labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.8 },
        });
      }
    }
  });

  // --- Column 3: Style guides + background assets + character assets ---
  const col3: Array<{ nodeId: string; label: string; entityType: EntityType }> = [
    ...data.styleGuides.map((sg) => ({ nodeId: `sguide-${sg.id}`, label: sg.name, entityType: 'styleGuide' as EntityType })),
    ...data.backgroundAssets.map((ba) => ({ nodeId: `bgasset-${ba.id}`, label: ba.name, entityType: 'backgroundAsset' as EntityType })),
    ...data.characterAssets.map((ca) => ({ nodeId: `chasset-${ca.id}`, label: ca.name, entityType: 'characterAsset' as EntityType })),
  ];

  col3.forEach((item, i) => {
    nodes.push({
      id: item.nodeId,
      type: 'assetGraphNode',
      position: { x: COL_X.assets, y: V_OFFSET + i * V_SPACING },
      data: {
        label: item.label,
        entityType: item.entityType,
        color: ENTITY_COLORS[item.entityType],
        description: null,
        metadata: {},
        editPath: `/asset-library`,
      } satisfies AssetNodeData,
    });
  });

  // Style guide → archetype edges
  data.styleGuides.forEach((sg) => {
    if (sg.archetype_id) {
      edges.push({
        id: `e-sg-arch-${sg.id}`,
        source: `arch-${sg.archetype_id}`,
        target: `sguide-${sg.id}`,
        label: 'style guide',
        animated: false,
        style: { stroke: ENTITY_COLORS.archetype, strokeWidth: 1.5, strokeDasharray: '5,4' },
        labelStyle: { fill: '#888', fontSize: 9 },
        labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.8 },
      });
    }
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function AssetGraphClient({ data }: { data: AssetGraphData }) {
  const { nodes: initialNodes, edges: initialEdges } = buildGraph(data);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 200px)', minHeight: 480 }}>
      {/* React Flow dark-mode overrides */}
      <style>{`
        .react-flow { background: hsl(0 0% 0%); }
        .react-flow__background { background: hsl(0 0% 0%); }
        .react-flow__edge-path { opacity: 0.7; }
        .react-flow__controls button {
          background: #111;
          border-color: #333;
          color: #aaa;
          fill: #aaa;
        }
        .react-flow__controls button:hover {
          background: #1a1a1a;
          color: #fff;
          fill: #fff;
        }
        .react-flow__minimap {
          border-radius: 8px;
          overflow: hidden;
        }
      `}</style>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes as any}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{
          animated: false,
          style: { stroke: 'hsl(262 97% 65% / 0.4)' },
        }}
        style={{ background: 'hsl(0 0% 0%)' }}
      >
        <Background color="#1a1a2e" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(n) => ((n.data as AssetNodeData | undefined)?.color ?? '#888')}
          style={{ background: '#0a0a0a', border: '1px solid #222' }}
        />
      </ReactFlow>

      <SidePanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Layers size={40} className="mx-auto mb-3 text-[#333]" />
            <p className="text-[#555] text-sm">No entities found. Add archetypes, characters, or environments to see the graph.</p>
          </div>
        </div>
      )}
    </div>
  );
}
