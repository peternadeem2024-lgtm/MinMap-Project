import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Upload,
  Plus as PlusIcon,
  Maximize2,
  Trash2,
  Wand2,
  ZoomIn,
  ZoomOut,
  Save,
  FolderOpen,
  FileJson,
  Image as ImageIcon,
  Share2,
  Sidebar as SidebarIcon,
  FolderPlus,
  FilePlus2,
} from "lucide-react";

/**
 * React Mind Map – Single‑file App (clean)
 * - Compact nodes
 * - Edge (+) buttons on hover to add directional children
 * - Drag nodes, pan background, wheel‑zoom (to cursor)
 * - Inline rename on double‑click (nodes, categories, and map names)
 * - Auto‑layout, Fit to screen, Export/Import JSON, Export PNG, Local save/load, Save As… (File Picker)
 * - Left tree sidebar with categories & sub‑categories; (+) to create map under a category
 * - Auto‑hiding top toolbar
 * - Expand/Collapse all categories
 */

// ---------------- Types ----------------
export type NodeT = {
  id: string;
  label: string;
  x: number;
  y: number;
  parentId?: string | null;
  color?: string;
  side?: 'left' | 'right' | 'up' | 'down';
};

export type MindMapDoc = { id: string; name: string; nodes: NodeT[]; updatedAt: number };
export type Category = { id: string; name: string; maps: MindMapDoc[]; children?: Category[] };


// ---------------- Constants & simple helpers ----------------
const uid = () => Math.random().toString(36).slice(2, 10);
const NODE_W = 100; // smaller nodes
const NODE_H = 38;

const INITIAL_NODES: NodeT[] = [
  { id: "root", label: "Central Idea", x: 0, y: 0, parentId: null, color: "#fef08a" },
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------- File helpers ----------------
function download(name: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function saveBlobWithPicker(defaultName: string, mime: string, blob: Blob, extensions: string[]) {
  const anyWin = window as any;
  try {
    if (typeof anyWin.showSaveFilePicker !== 'function') {
      downloadBlob(defaultName, blob);
      return;
    }
    const handle = await anyWin.showSaveFilePicker({
      suggestedName: defaultName,
      types: [{ description: mime, accept: { [mime]: extensions } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (err: any) {
    if (err && (err.name === 'AbortError' || err.code === 20)) return; // user canceled
    console.error('saveBlobWithPicker error', err);
    try { downloadBlob(defaultName, blob); } catch {}
  }
}

// ---------------- Mind map helpers ----------------
function buildChildrenMap(nodes: NodeT[]) {
  const byParent = new Map<string | null, NodeT[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const key = n.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  const roots = (byParent.get(null) || []).filter((n) => !n.parentId);
  for (const n of nodes) {
    if (!n.parentId || !ids.has(n.parentId)) {
      if (!roots.includes(n)) roots.push(n);
    }
  }
  return { byParent, roots };
}

function autoLayout(nodes: NodeT[]) {
  const { byParent, roots } = buildChildrenMap(nodes);
  const V = 90;  // vertical spacing (tight)
  const H = 120; // horizontal spacing (tight)

  let cursorX = 0;
  function place(n: NodeT, depth: number) {
    const ch = byParent.get(n.id) || [];
    if (ch.length === 0) {
      const x = cursorX * H;
      const y = depth * V;
      n.x = x; n.y = y;
      cursorX += 1;
      return { x, y };
    } else {
      const childPositions = ch.map((c) => place(c, depth + 1));
      const minX = Math.min(...childPositions.map((p) => p.x));
      const maxX = Math.max(...childPositions.map((p) => p.x));
      const x = (minX + maxX) / 2; const y = depth * V;
      n.x = x; n.y = y;
      return { x, y };
    }
  }

  roots.forEach((r) => place(r, 0));

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const n of nodes) { n.x -= midX; n.y -= midY; }
  return nodes;
}

function edgePath(ax: number, ay: number, bx: number, by: number) {
  const dx = (bx - ax) * 0.5;
  const c1x = ax + dx, c1y = ay;
  const c2x = bx - dx, c2y = by;
  return `M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`;
}

function renameNode(nodes: NodeT[], id: string, newLabel: string) {
  const label = String(newLabel ?? "").trim();
  const safe = label.length ? label : "(empty)";
  return nodes.map((n) => (n.id === id ? { ...n, label: safe } : n));
}

function directionOffset(dir: NodeT['side'] | null): [number, number] | null {
  switch (dir) {
    case 'left': return [-160, 0];
    case 'right': return [160, 0];
    case 'up': return [0, -100];
    case 'down': return [0, 100];
    default: return null;
  }
}

// ---------------- Category tree helpers ----------------
function safeParseCategories(raw: string | null): Category[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    const norm = (arr: any): Category[] => Array.isArray(arr)
      ? arr.map((c) => ({
          id: c.id || uid(),
          name: c.name || 'Category',
          maps: Array.isArray(c.maps) ? c.maps : [],
          children: norm(c.children || []),
        }))
      : [];
    if (Array.isArray(parsed)) return norm(parsed);
    if (parsed && Array.isArray((parsed as any).categories)) return norm((parsed as any).categories);
    return [];
  } catch { return []; }
}

function findCategoryById(list: Category[], id: string): Category | null {
  for (const c of list) {
    if (c.id === id) return c;
    const deeper = c.children ? findCategoryById(c.children, id) : null;
    if (deeper) return deeper;
  }
  return null;
}

function updateCategory(list: Category[], id: string, updater: (c: Category) => Category): Category[] {
  return list.map((c) => {
    if (c.id === id) return updater({ ...c, children: c.children ? [...c.children] : [] });
    return { ...c, children: c.children ? updateCategory(c.children, id, updater) : [] };
  });
}

function upsertMapInCategories(cats: Category[], catId: string, doc: MindMapDoc): Category[] {
  const walk = (list: Category[]): Category[] => list.map((c) => {
    if (c.id === catId) {
      const i = c.maps.findIndex((m) => m.name === doc.name);
      const maps = i >= 0 ? Object.assign([...c.maps], { [i]: doc }) : [doc, ...c.maps];
      return { ...c, maps };
    }
    const children = c.children && c.children.length ? walk(c.children) : c.children;
    return { ...c, children };
  });
  return walk(Array.isArray(cats) ? cats : []);
}

function deleteMapFromTree(list: Category[], catId: string, mapId: string): Category[] {
  return updateCategory(list, catId, (c) => ({ ...c, maps: c.maps.filter((m) => m.id !== mapId) }));
}

function addSubCategory(list: Category[], parentId: string, name: string): Category[] {
  const child: Category = { id: uid(), name, maps: [], children: [] };
  return updateCategory(list, parentId, (c) => ({ ...c, children: [...(c.children || []), child] }));
}

function renameCategoryTree(list: Category[], id: string, newName: string): Category[] {
  const name = String(newName ?? '').trim() || '(unnamed)';
  return updateCategory(list, id, (c) => ({ ...c, name }));
}

function uniqueMapName(maps: MindMapDoc[], base: string): string {
  // Make names like: Base, Base (2), Base (3), ...
  let root = (base || 'Untitled').trim();
  const sufStart = root.lastIndexOf(' (');
  if (sufStart !== -1 && root.endsWith(')')) {
    const num = root.slice(sufStart + 2, -1);
    const digits = num.length > 0 && Array.from(num).every((ch) => ch >= '0' && ch <= '9');
    if (digits) root = root.slice(0, sufStart);
  }
  if (!maps.some((m) => m.name === root)) return root;
  let i = 2;
  while (maps.some((m) => m.name === `${root} (${i})`)) i++;
  return `${root} (${i})`;
}

function renameMapInTree(list: Category[], catId: string, mapId: string, newName: string): Category[] {
  return updateCategory(list, catId, (c) => {
    const base = String(newName ?? '').trim() || '(unnamed map)';
    const name = uniqueMapName(c.maps.filter(m => m.id !== mapId), base);
    const maps = c.maps.map((m) => (m.id === mapId ? { ...m, name, updatedAt: Date.now() } : m));
    return { ...c, maps };
  });
}

// Collect all category ids (for expand/collapse all)
function collectCategoryIds(list: Category[]): string[] {
  const ids: string[] = [];
  const walk = (arr: Category[]) => { for (const c of arr) { ids.push(c.id); if (c.children && c.children.length) walk(c.children); } };
  walk(Array.isArray(list) ? list : []);
  return ids;
}

// ---------------- Node component ----------------
function Node({ n, selected, onPointerDown, onClick, onDoubleClick, onAddChild }:{
  n: NodeT;
  selected: boolean;
  onPointerDown: (e: any, n: NodeT) => void;
  onClick: (n: NodeT) => void;
  onDoubleClick?: (n: NodeT) => void;
  onAddChild?: (n: NodeT, dir: NonNullable<NodeT['side']>) => void;
}) {
  const [hover, setHover] = useState(false);
  const mkPlus = (x: number, y: number, dir: NonNullable<NodeT['side']>) => (
    <g
      key={dir}
      data-role="plus"
      data-dir={dir}
      transform={`translate(${x}, ${y})`}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onAddChild && onAddChild(n, dir); }}
      style={{ cursor: "pointer", pointerEvents: "all" }}
    >
      <rect x={0} y={0} width={20} height={20} fill="#ffffff" fillOpacity={0} pointerEvents="all" />
      <rect x={6} y={6} width={8} height={8} rx={2} ry={2} fill="#0ea5e9" opacity={0.15} />
      <circle cx={10} cy={10} r={5} fill="#0ea5e9" opacity={0.35} />
      <path d="M 10 6 L 10 14 M 6 10 L 14 10" stroke="#0369a1" strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
  return (
    <g
      transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}
      onPointerDown={(e) => onPointerDown(e, n)}
      onClick={(e) => { e.stopPropagation(); onClick(n); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick && onDoubleClick(n); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ cursor: "grab" }}
    >
      <rect
        rx={10}
        ry={10}
        width={NODE_W}
        height={NODE_H}
        fill={n.color || "#e2e8f0"}
        className={`shadow ${selected ? "stroke-2 stroke-blue-500" : "stroke-1 stroke-slate-400"}`}
        strokeOpacity={0.8}
      />
      <text
        x={NODE_W / 2}
        y={NODE_H / 2}
        dominantBaseline="middle"
        textAnchor="middle"
        className="select-none"
        style={{ fontSize: 11, fontWeight: 600 }}
      >
        {n.label || "(empty)"}
      </text>
      {hover && mkPlus(NODE_W - 10, NODE_H / 2 - 10, "right")}
      {hover && mkPlus(-10,         NODE_H / 2 - 10, "left")}
      {hover && mkPlus(NODE_W / 2 - 10, -10,         "up")}
      {hover && mkPlus(NODE_W / 2 - 10, NODE_H - 10, "down")}
    </g>
  );
}

// ---------------- Category Tree Node (sidebar) ----------------
function CategoryTreeNode(props: {
  node: Category;
  depth: number;
  currentCatId: string | null;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onSaveHere: (id: string) => void;
  onAddSub: (id: string) => void;
  onStartRename: (cat: Category) => void;
  onLoadMap: (catId: string, mapId: string) => void;
  onDeleteMap: (catId: string, mapId: string) => void;
  // map rename
  mapEditing: { catId: string; mapId: string } | null;
  mapEditValue: string;
  onStartMapRename: (catId: string, map: MindMapDoc) => void;
  onMapEditChange: (v: string) => void;
  onCommitMapRename: () => void;
  onCancelMapRename: () => void;
}) {
  const { node, depth, currentCatId, expanded, onToggle, onSelect, onSaveHere, onAddSub, onStartRename, onLoadMap, onDeleteMap, mapEditing, mapEditValue, onStartMapRename, onMapEditChange, onCommitMapRename, onCancelMapRename } = props;
  const isOpen = !!expanded[node.id];
  const hasChildren = (node.children?.length || 0) > 0;
  return (
    <li className="rounded">
      <div className={`flex items-center gap-1 ${currentCatId === node.id ? "bg-slate-50 border border-slate-300" : "border border-transparent"} rounded px-2 py-1`}>
        <button className="w-4 text-slate-600" onClick={() => onToggle(node.id)} title={isOpen ? "Collapse" : "Expand"}>
          {hasChildren ? (isOpen ? "▾" : "▸") : <span className="opacity-40">•</span>}
        </button>
        <button
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => onStartRename(node)}
          className="text-left text-sm font-medium truncate flex-1"
          style={{ paddingLeft: depth * 8 }}
          title={node.name}
        >
          {node.name}
        </button>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" title="New map here" onClick={() => onSaveHere(node.id)}>
            <PlusIcon className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Add sub-category" onClick={() => onAddSub(node.id)}>
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ul className="mt-1 space-y-1 pl-6">
        {node.maps.length === 0 && <li className="text-xs text-slate-500 pl-4">No maps yet</li>}
        {node.maps.map((m) => (
          <li key={m.id} className="flex items-center justify-between group gap-2">
            {mapEditing && mapEditing.catId === node.id && mapEditing.mapId === m.id ? (
              <input
                autoFocus
                value={mapEditValue}
                onChange={(e) => onMapEditChange(e.target.value)}
                onBlur={onCommitMapRename}
                onKeyDown={(e) => { if ((e as any).key === 'Enter') onCommitMapRename(); if ((e as any).key === 'Escape') onCancelMapRename(); }}
                className="text-xs border rounded px-1 py-0.5 flex-1"
              />
            ) : (
              <button
                className="text-xs truncate text-left flex-1"
                title={m.name}
                onClick={() => onLoadMap(node.id, m.id)}
                onDoubleClick={() => onStartMapRename(node.id, m)}
              >
                {m.name}
              </button>
            )}
            <div className="opacity-0 group-hover:opacity-100 transition">
              <Button size="icon" variant="ghost" title="Delete" onClick={() => onDeleteMap(node.id, m.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {isOpen && hasChildren && (
        <ul className="mt-1 space-y-1">
          {node.children!.map((child) => (
            <CategoryTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              currentCatId={currentCatId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onSaveHere={onSaveHere}
              onAddSub={onAddSub}
              onStartRename={onStartRename}
              onLoadMap={onLoadMap}
              onDeleteMap={onDeleteMap}
              mapEditing={mapEditing}
              mapEditValue={mapEditValue}
              onStartMapRename={onStartMapRename}
              onMapEditChange={onMapEditChange}
              onCommitMapRename={onCommitMapRename}
              onCancelMapRename={onCancelMapRename}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------- App ----------------
export default function MindMapApp() {
  const [nodes, setNodes] = useState<NodeT[]>(INITIAL_NODES);
  const [selectedId, setSelectedId] = useState<string | null>("root");
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Sidebar (categories)
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [currentCatId, setCurrentCatId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState("");

  // Options
  const [alternateSide, setAlternateSide] = useState(true);
  const [autoLayoutOnAdd, setAutoLayoutOnAdd] = useState(false);
  const altFlipRef = useRef(1);

  // Inline rename (nodes)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Category inline rename
  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catEditValue, setCatEditValue] = useState("");
  const catInputRef = useRef<HTMLInputElement | null>(null);

  // Map inline rename (sidebar maps)
  const [mapEditing, setMapEditing] = useState<{ catId: string; mapId: string } | null>(null);
  const [mapEditValue, setMapEditValue] = useState("");

  // Persist categories
  const CKEY = "mindmap.categories.v2";
  useEffect(() => {
    const raw = localStorage.getItem(CKEY);
    let initial = safeParseCategories(raw);
    if (!initial.length) {
      const def: Category = { id: uid(), name: "General", maps: [], children: [] };
      initial = [def];
    }
    setCategories(initial);
    setCurrentCatId(initial[0]?.id ?? null);
    setExpanded((e) => ({ ...e, [initial[0].id]: true }));
  }, []);
  useEffect(() => { try { localStorage.setItem(CKEY, JSON.stringify(categories)); } catch {} }, [categories]);

  // Category CRUD
  const createCategory = useCallback(() => {
    const name = newCatName.trim() || `Category ${Date.now().toString().slice(-4)}`;
    const cat: Category = { id: uid(), name, maps: [], children: [] };
    setCategories((prev) => [cat, ...prev]);
    setCurrentCatId(cat.id);
    setExpanded((e) => ({ ...e, [cat.id]: true }));
    setNewCatName("");
  }, [newCatName]);

  const createSubCategory = useCallback((parentId: string) => {
    const name = prompt('Sub-category name', 'New Group')?.trim();
    if (!name) return;
    setCategories((prev) => addSubCategory(prev, parentId, name));
    setExpanded((e) => ({ ...e, [parentId]: true }));
  }, []);

  const toggleExpand = useCallback((id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] })), []);

  const expandAllCats = useCallback(() => {
    const all = collectCategoryIds(categories);
    setExpanded(Object.fromEntries(all.map((id) => [id, true])));
  }, [categories]);
  const collapseAllCats = useCallback(() => {
    setExpanded({});
  }, []);

  const startCategoryRename = useCallback((cat: Category) => {
    setCatEditingId(cat.id);
    setCatEditValue(cat.name);
    setTimeout(() => catInputRef.current?.focus(), 0);
  }, []);
  const commitCategoryRename = useCallback(() => {
    if (!catEditingId) return;
    setCategories((prev) => renameCategoryTree(prev, catEditingId, catEditValue));
    setCatEditingId(null);
  }, [catEditingId, catEditValue]);
  const cancelCategoryRename = useCallback(() => setCatEditingId(null), []);

  // Map rename handlers
  const startMapRename = useCallback((catId: string, map: MindMapDoc) => {
    setMapEditing({ catId, mapId: map.id });
    setMapEditValue(map.name);
  }, []);

  const commitMapRename = useCallback(() => {
    if (!mapEditing) return;
    setCategories((prev) => renameMapInTree(prev, mapEditing.catId, mapEditing.mapId, mapEditValue));
    setMapEditing(null);
  }, [mapEditing, mapEditValue]);

  const cancelMapRename = useCallback(() => setMapEditing(null), []);

  // Map save/load under categories
  const saveCurrentAsMap = useCallback((nameOverride?: string, targetCategoryId?: string) => {
    const catId = targetCategoryId ?? currentCatId;
    if (!catId) return;
    const base = (nameOverride ?? prompt("Map name:", "Untitled")) || "Untitled";
    const cat = findCategoryById(categories, catId);
    const unique = uniqueMapName(cat?.maps || [], base);
    const doc: MindMapDoc = { id: uid(), name: unique, nodes, updatedAt: Date.now() };
    setCategories((prev) => upsertMapInCategories(prev, catId, doc));
  }, [nodes, currentCatId, categories]);

  const createEmptyMapHere = useCallback((catId: string) => {
    const cat = findCategoryById(categories, catId);
    if (!cat) return;
    const suggested = uniqueMapName(cat.maps, 'Untitled');
    const name = prompt('New map name:', suggested) || suggested;
    const doc: MindMapDoc = { id: uid(), name, nodes: INITIAL_NODES.map((n) => ({ ...n })), updatedAt: Date.now() };
    setCategories((prev) => upsertMapInCategories(prev, catId, doc));
    setCurrentCatId(catId);
    setNodes(doc.nodes.map((n) => ({ ...n })));
    setSelectedId(doc.nodes[0]?.id ?? null);
  }, [categories]);

  const loadMap = useCallback((catId: string, mapId: string) => {
    const cat = findCategoryById(categories, catId);
    const doc = cat?.maps.find((m) => m.id === mapId) || null;
    if (!doc) return;
    setNodes(doc.nodes.map((n) => ({ ...n })));
    setSelectedId(doc.nodes[0]?.id ?? null);
  }, [categories]);

  const deleteMap = useCallback((catId: string, mapId: string) => {
    if (!confirm("Delete this mind map?")) return;
    setCategories((prev) => deleteMapFromTree(prev, catId, mapId));
  }, []);

  // Create child node
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) || null, [nodes, selectedId]);
  const addChildAt = useCallback((parent: NodeT | null, dir: NodeT['side'] | null = null) => {
    const parentId = parent ? parent.id : null;
    const id = uid();
    const px = parent?.x || 0; const py = parent?.y || 0;
    let off = directionOffset(dir); let side = dir as NodeT['side'] | null;
    if (!off) {
      const lr = alternateSide ? (altFlipRef.current *= -1) : 1;
      off = [lr * 160, (Math.random() * 80 - 40)];
      side = off[0] >= 0 ? 'right' : 'left';
    } else {
      if (dir === 'up' || dir === 'down') off = [off[0] + (Math.random() * 40 - 20), off[1]];
      else off = [off[0], off[1] + (Math.random() * 40 - 20)];
    }
    const newNode: NodeT = { id, label: "New Node", x: px + off[0], y: py + off[1], parentId: parentId || null, color: "#f1f5f9", side: (side || undefined) as any };
    setNodes((prev) => (autoLayoutOnAdd ? autoLayout([...prev, newNode].map((n) => ({ ...n }))) : [...prev, newNode]));
    setSelectedId(id); setEditingId(id); setEditValue("New Node");
  }, [alternateSide, autoLayoutOnAdd]);
  const addChild = useCallback((parentOverride: NodeT | null = null, dir: NodeT['side'] | null = null) => { const parent = parentOverride ?? selectedNode ?? null; addChildAt(parent, dir); }, [selectedNode, addChildAt]);

  const addRoot = useCallback(() => {
    const id = uid();
    const newNode: NodeT = { id, label: "Root", x: Math.random() * 200 - 100, y: Math.random() * 80 - 40, parentId: null, color: "#e9d5ff" };
    setNodes((prev) => [...prev, newNode]); setSelectedId(id);
  }, []);

  const deleteNode = useCallback(() => {
    if (!selectedNode) return; const id = selectedNode.id; const toDelete = new Set<string>([id]); let changed = true;
    while (changed) { changed = false; for (const n of nodes) { if (!toDelete.has(n.id) && n.parentId && toDelete.has(n.parentId)) { toDelete.add(n.id); changed = true; } } }
    setNodes((prev) => prev.filter((n) => !toDelete.has(n.id))); setSelectedId(null); if (editingId && toDelete.has(editingId)) setEditingId(null);
  }, [nodes, selectedNode, editingId]);

  // Drag/pan/zoom
  const dragRef = useRef<{ type: null | 'node' | 'pan'; id: string | null; startX: number; startY: number; nodeStartX: number; nodeStartY: number; panStartX: number; panStartY: number; }>({ type: null, id: null, startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0, panStartX: 0, panStartY: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  const onNodePointerDown = useCallback((e: any, n: NodeT) => {
    const target: any = e.target; if (target && typeof target.closest === 'function') { const isPlus = target.closest('[data-role="plus"]'); if (isPlus) { e.stopPropagation(); return; } }
    if (editingId) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: "node", id: n.id, startX: e.clientX, startY: e.clientY, nodeStartX: n.x, nodeStartY: n.y, panStartX: 0, panStartY: 0 };
  }, [editingId]);

  const onBgPointerDown = useCallback((e: any) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); dragRef.current = { type: "pan", id: null, startX: e.clientX, startY: e.clientY, nodeStartX: 0, nodeStartY: 0, panStartX: tx, panStartY: ty }; }, [tx, ty]);

  const onPointerMove = useCallback((e: any) => {
    const st = dragRef.current; if (!st || !st.type) return;
    if (st.type === "node" && st.id) { const dx = (e.clientX - st.startX) / scale; const dy = (e.clientY - st.startY) / scale; setNodes((prev) => prev.map((n) => (n.id === st.id ? { ...n, x: st.nodeStartX + dx, y: st.nodeStartY + dy } : n)));
    } else if (st.type === "pan") { const dx = e.clientX - st.startX; const dy = e.clientY - st.startY; setTx(st.panStartX + dx); setTy(st.panStartY + dy); }
  }, [scale]);

  const onPointerUp = useCallback(() => { dragRef.current = { type: null, id: null, startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0, panStartX: 0, panStartY: 0 }; }, []);

  useEffect(() => { const svg = svgRef.current; if (!svg) return; svg.addEventListener("pointermove", onPointerMove); window.addEventListener("pointerup", onPointerUp); return () => { svg.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); }; }, [onPointerMove, onPointerUp]);

  const onWheel = useCallback((e: any) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = (e.clientX - (rect?.left || 0) - tx) / scale;
    const cy = (e.clientY - (rect?.top || 0) - ty) / scale;
    const delta = -e.deltaY * 0.0015;
    const newScale = clamp(scale * (1 + delta), 0.25, 3);
    setTx((tx0) => (e ? e.clientX - (rect?.left || 0) - cx * newScale : tx0));
    setTy((ty0) => (e ? e.clientY - (rect?.top || 0) - cy * newScale : ty0));
    setScale(newScale);
  }, [scale, tx, ty]);

  const zoomAtCenter = useCallback((factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const px = (rect?.width || 0) / 2;
    const py = (rect?.height || 0) / 2;
    const cx = (px - tx) / scale;
    const cy = (py - ty) / scale;
    const newScale = clamp(scale * factor, 0.25, 3);
    setTx(px - cx * newScale);
    setTy(py - cy * newScale);
    setScale(newScale);
  }, [scale, tx, ty]);

  const zoomOutNTimes = useCallback((n: number) => { zoomAtCenter(Math.pow(1 / 1.15, n)); }, [zoomAtCenter]);

  // Edges
  const edges = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.id, n] as const));
    const out: { id: string; from: NodeT; to: NodeT }[] = [];
    for (const n of nodes) {
      if (n.parentId && map.has(n.parentId)) {
        const p = map.get(n.parentId)!;
        out.push({ id: `${n.parentId}_${n.id}`, from: p, to: n });
      }
    }
    return out;
  }, [nodes]);

  const fitToScreen = useCallback(() => {
    if (nodes.length === 0) return;
    const padding = 100;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80;
    const maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 50;
    const maxY = Math.max(...ys) + 50;
    const w = maxX - minX;
    const h = maxY - minY;

    const rect = svgRef.current?.getBoundingClientRect();
    const vw = Math.max(200, (rect?.width || 800) - padding);
    const vh = Math.max(200, (rect?.height || 600) - padding);
    const s = clamp(Math.min(vw / w, vh / h), 0.25, 3);
    setScale(s);
    setTx(((rect?.width || 0) - w * s) / 2 - minX * s);
    setTy(((rect?.height || 0) - h * s) / 2 - minY * s);
  }, [nodes]);

  // Export/Import
  const onExportJSON = useCallback(() => {
    download("mindmap.json", JSON.stringify({ nodes }, null, 2), "application/json");
  }, [nodes]);

  const onSaveAsJSON = useCallback(async () => {
    const blob = new Blob([JSON.stringify({ nodes }, null, 2)], { type: 'application/json' });
    await saveBlobWithPicker('mindmap.json', 'application/json', blob, ['.json']);
  }, [nodes]);

  const onImportJSON = useCallback((file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data)) setNodes(data);
        else if (data && Array.isArray(data.nodes)) setNodes(data.nodes);
        else alert("Invalid JSON format.");
      } catch { alert("Failed to parse JSON file."); }
    };
    reader.readAsText(file);
  }, []);

  const onSaveLocal = useCallback(() => { localStorage.setItem("mindmap.nodes", JSON.stringify(nodes)); }, [nodes]);
  const onLoadLocal = useCallback(() => {
    const raw = localStorage.getItem("mindmap.nodes");
    if (!raw) return;
    try {
      const nn = JSON.parse(raw);
      if (Array.isArray(nn)) setNodes(nn);
      else if (nn && Array.isArray(nn.nodes)) setNodes(nn.nodes);
    } catch {}
  }, []);

  const renderStageToPNGBlob = useCallback(async (): Promise<Blob | null> => {
    const svgEl = svgRef.current;
    if (!svgEl) return null;
    const g = svgEl.querySelector("g[data-stage]");
    if (!g) return null;

    const bbox = svgEl.getBoundingClientRect();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(bbox.width));
    svg.setAttribute("height", String(bbox.height));
    const clone = g.cloneNode(true);
    svg.appendChild(clone);

    const serializer = new XMLSerializer();
    const str = serializer.serializeToString(svg);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml" }));
    await new Promise((res) => { (img.onload as any) = res; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(bbox.width);
    canvas.height = Math.ceil(bbox.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
  }, []);

  const onExportPNG = useCallback(async () => { const b = await renderStageToPNGBlob(); if (b) downloadBlob('mindmap.png', b); }, [renderStageToPNGBlob]);
  const onSaveAsPNG = useCallback(async () => { const b = await renderStageToPNGBlob(); if (b) await saveBlobWithPicker('mindmap.png', 'image/png', b, ['.png']); }, [renderStageToPNGBlob]);

  const onAutoLayout = useCallback(() => { setNodes((prev) => autoLayout(prev.map((n) => ({ ...n })))); }, []);

  const toggleFullscreen = useCallback(() => {
    const el: any = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.();
  }, []);

  // Node rename
  const commitEdit = useCallback(() => { if (!editingId) return; setNodes((prev) => renameNode(prev, editingId, editValue)); setEditingId(null); }, [editingId, editValue]);
  const cancelEdit = useCallback(() => setEditingId(null), []);

  // Init + resize
  useEffect(() => { fitToScreen(); zoomOutNTimes(4); }, []);
  useEffect(() => {
    const onResize = () => fitToScreen();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitToScreen]);

  // ---------------- Runtime tests ----------------
  const [tests, setTests] = useState<{ name: string; pass: boolean; details: string }[]>([]);
  useEffect(() => {
    function assert(name: string, cond: boolean, details = "") { return { name, pass: !!cond, details }; }
    const sample: NodeT[] = [
      { id: "A", label: "A", x: 0, y: 0, parentId: null },
      { id: "B", label: "B", x: 0, y: 0, parentId: "A", side: 'right' },
      { id: "C", label: "C", x: 0, y: 0, parentId: "A" },
    ];
    const laid = autoLayout(sample.map((n) => ({ ...n })));
    const t1 = assert("autoLayout assigns positions", laid.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));

    const { byParent, roots } = buildChildrenMap(sample);
    const t2 = assert("buildChildrenMap finds 1 root", roots.length === 1 && roots[0].id === "A");
    const t3 = assert("buildChildrenMap maps children", (byParent.get("A") || []).length === 2);

    const renamed = renameNode(sample, "B", "  New  ");
    const t4 = assert("renameNode trims label", renamed.find((n) => n.id === "B")!.label === "New");
    const t5 = assert("renameNode protects empty -> (empty)", renameNode(sample, "B", " ").find((n) => n.id === "B")!.label === "(empty)");

    const p = edgePath(0, 0, 100, 50);
    const t6 = assert("edgePath format", typeof p === "string" && p.startsWith("M "));

    const t7 = assert("directionOffset left",  JSON.stringify(directionOffset('left'))  === JSON.stringify([-160, 0]));
    const t8 = assert("directionOffset right", JSON.stringify(directionOffset('right')) === JSON.stringify([160, 0]));
    const t9 = assert("directionOffset up",    JSON.stringify(directionOffset('up'))    === JSON.stringify([0, -100]));
    const t10 = assert("directionOffset down",  JSON.stringify(directionOffset('down'))  === JSON.stringify([0, 100]));

    const t11 = assert('safeParseCategories returns [] for garbage', Array.isArray(safeParseCategories('not json')) && safeParseCategories('not json').length === 0);
    const t12 = assert('safeParseCategories extracts categories field', Array.isArray(safeParseCategories(JSON.stringify({ categories: [] }))));

    // Upsert helper tests
    const fakeCats: Category[] = [
      { id: "cat1", name: "C1", maps: [], children: [] },
      { id: "cat2", name: "C2", maps: [{ id: "m1", name: "MapA", nodes: [], updatedAt: 1 }], children: [] },
    ];
    const newDoc: MindMapDoc = { id: "m2", name: "MapB", nodes: [], updatedAt: 2 };
    const t13 = assert("upsert inserts when absent", upsertMapInCategories(fakeCats, "cat1", newDoc).find(c=>c.id==="cat1")!.maps.some(m=>m.name==="MapB"));
    const updDoc: MindMapDoc = { id: "m1", name: "MapA", nodes: [{id:"x",label:"x",x:0,y:0}], updatedAt: 3 };
    const t14 = assert("upsert updates when present", upsertMapInCategories(fakeCats, "cat2", updDoc).find(c=>c.id==="cat2")!.maps.find(m=>m.name==="MapA")!.updatedAt === 3);

    const rootCats: Category[] = [{ id: "r1", name: "Root", maps: [], children: [{ id: "c1", name: "Child", maps: [], children: [] }] }];
    const docX: MindMapDoc = { id: "d1", name: "MapX", nodes: [], updatedAt: 1 };
    const t15 = assert("upsert works on nested id", (upsertMapInCategories(rootCats, "c1", docX).find(c=>c.id==="r1")!.children![0].maps.length === 1));
    const t16 = assert("addSubCategory adds child", (() => { const out = addSubCategory(rootCats, "r1", "Sub"); return out.find(c=>c.id==="r1")!.children!.some(x=>x.name==="Sub"); })());

    // Category rename
    const t17 = assert('renameCategoryTree trims', renameCategoryTree([{id:'c1',name:'Cat',maps:[],children:[]}], 'c1', '  New  ')[0].name === 'New');

    // uniqueMapName
    const mapsForNames: MindMapDoc[] = [{ id:'1', name:'Untitled', nodes:[], updatedAt:0 }, { id:'2', name:'Untitled (2)', nodes:[], updatedAt:0 }];
    const t18 = assert('uniqueMapName avoids collisions', uniqueMapName(mapsForNames, 'Untitled') === 'Untitled (3)');
    const t19 = assert('uniqueMapName returns base when free', uniqueMapName([], 'My Map') === 'My Map');

    const catsForRename: Category[] = [{ id: 'cx', name: 'C', maps: [
      { id: 'm1', name: 'Map', nodes: [], updatedAt: 0 },
      { id: 'm2', name: 'Map (2)', nodes: [], updatedAt: 0 },
    ], children: [] }];
    const t20 = assert('renameMapInTree trims & unique', (() => {
      const out = renameMapInTree(catsForRename, 'cx', 'm2', ' Map ');
      return out[0].maps.find(m=>m.id==='m2')!.name === 'Map (3)';
    })());
    const t21 = assert('renameMapInTree empty -> (unnamed map)', renameMapInTree([{id:'c', name:'C', maps: [{id:'m', name:'X', nodes:[], updatedAt:0}], children: []}], 'c', 'm', ' ').find(c=>c.id==='c')!.maps[0].name === '(unnamed map)');

    const mapsNum: MindMapDoc[] = [
      { id:'1', name:'X', nodes:[], updatedAt:0 },
      { id:'2', name:'X (2)', nodes:[], updatedAt:0 },
      { id:'3', name:'X (10)', nodes:[], updatedAt:0 },
    ];
    const t22 = assert('uniqueMapName strips numeric suffix before incrementing', uniqueMapName(mapsNum, 'X (10)') === 'X (3)');

    const results = [t1,t2,t3,t4,t5,t6,t7,t8,t9,t10,t11,t12,t13,t14,t15,t16,t17,t18,t19,t20,t21,t22];
    setTests(results);
    console.table(results.map(r => ({ Test: r.name, PASS: r.pass, Details: r.details })));
  }, []);

  const currentCat = Array.isArray(categories) ? (currentCatId ? findCategoryById(categories, currentCatId) : null) : null;

  // ---------------- Render ----------------
  return (
    <div className="fixed inset-0 bg-slate-50 text-slate-900">
      {/* Auto‑hiding toolbar (hover near top edge) */}
      <div className="absolute top-0 left-0 right-0 z-30 group">
        <div className="h-2 w-full" />
        <div className="flex items-center gap-2 p-2 border-b bg-white/90 backdrop-blur-md transition duration-200 ease-out opacity-0 -translate-y-full group-hover:opacity-100 group-hover:translate-y-0 shadow-sm">
          <Button size="sm" onClick={() => addChild(null, null)} className="gap-2"><PlusIcon className="h-4 w-4" /> Child</Button>
          <Button size="sm" variant="secondary" onClick={addRoot} className="gap-2"><PlusIcon className="h-4 w-4" /> Root</Button>
          <Button size="sm" variant="destructive" onClick={deleteNode} disabled={!selectedNode} className="gap-2"><Trash2 className="h-4 w-4" /> Delete</Button>
          <Separator orientation="vertical" className="mx-1" />
          <Button size="sm" variant="outline" onClick={onAutoLayout} className="gap-2"><Wand2 className="h-4 w-4" /> Auto‑layout</Button>
          <Button size="sm" variant="outline" onClick={fitToScreen} className="gap-2"><Maximize2 className="h-4 w-4" /> Fit</Button>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Button size="sm" variant="outline" onClick={() => setSidebarOpen(s => !s)} className="gap-2"><SidebarIcon className="h-4 w-4" /> {sidebarOpen ? 'Hide' : 'Categories'}</Button>
            <Button size="sm" variant="outline" disabled={!currentCatId} onClick={() => saveCurrentAsMap()} className="gap-2"><Save className="h-4 w-4" /> Save to Category</Button>
            <div className="flex items-center gap-1 ml-2">
              <Button size="icon" variant="ghost" onClick={() => setScale((s) => clamp(s * 1.15, 0.25, 3))}><ZoomIn className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => setScale((s) => clamp(s / 1.15, 0.25, 3))}><ZoomOut className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={() => zoomOutNTimes(4)}>−×4</Button>
              <Button size="icon" variant="ghost" onClick={toggleFullscreen} title="Fullscreen"><Maximize2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2"><Share2 className="h-4 w-4" /> Share / IO</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Data</DropdownMenuLabel>
              <DropdownMenuItem onClick={onExportJSON} className="gap-2"><FileJson className="h-4 w-4" /> Export JSON (Download)</DropdownMenuItem>
              <DropdownMenuItem onClick={onSaveAsJSON} className="gap-2"><FileJson className="h-4 w-4" /> Save As… JSON</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Import</DropdownMenuLabel>
              <DropdownMenuItem className="gap-2" onClick={() => (document.getElementById('file-json') as HTMLInputElement)?.click()}>
                <Upload className="h-4 w-4" /> Import JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Image</DropdownMenuLabel>
              <DropdownMenuItem onClick={onExportPNG} className="gap-2"><ImageIcon className="h-4 w-4" /> Export PNG (Download)</DropdownMenuItem>
              <DropdownMenuItem onClick={onSaveAsPNG} className="gap-2"><ImageIcon className="h-4 w-4" /> Save As… PNG</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input id="file-json" type="file" accept=".json,application/json" className="hidden" onChange={(e) => onImportJSON((e.target as HTMLInputElement).files?.[0] as File)} />
        </div>
      </div>

      {/* Left slider sidebar */}
      <div className={`absolute top-0 bottom-0 left-0 z-20 transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <aside className="h-full w-[280px] bg-white/95 backdrop-blur border-r shadow-sm p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Categories</h3>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="text-xs px-2" onClick={expandAllCats}>Expand all</Button>
              <Button size="sm" variant="ghost" className="text-xs px-2" onClick={collapseAllCats}>Collapse all</Button>
              <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(false)} title="Hide"><SidebarIcon className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input value={newCatName} onChange={(e)=>setNewCatName(e.target.value)} placeholder="New category" className="flex-1 border rounded px-2 py-1 text-sm" />
            <Button size="sm" className="gap-1" onClick={createCategory}><FolderPlus className="h-4 w-4" /> Add</Button>
          </div>
          <div className="overflow-y-auto pr-1">
            <ul className="space-y-1">
              {categories.map((cat) => (
                <CategoryTreeNode
                  key={cat.id}
                  node={cat}
                  depth={0}
                  currentCatId={currentCatId}
                  expanded={expanded}
                  onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                  onSelect={(id) => setCurrentCatId(id)}
                  onSaveHere={(id) => createEmptyMapHere(id)}
                  onAddSub={(id) => createSubCategory(id)}
                  onStartRename={(cat) => startCategoryRename(cat)}
                  onLoadMap={(catId, mapId) => loadMap(catId, mapId)}
                  onDeleteMap={(catId, mapId) => deleteMap(catId, mapId)}
                  mapEditing={mapEditing}
                  mapEditValue={mapEditValue}
                  onStartMapRename={(catId, m) => startMapRename(catId, m)}
                  onMapEditChange={(v) => setMapEditValue(v)}
                  onCommitMapRename={commitMapRename}
                  onCancelMapRename={cancelMapRename}
                />
              ))}
            </ul>
          </div>

          {/* Inline category rename (floating) */}
          {catEditingId && (() => {
            const cat = findCategoryById(categories, catEditingId!);
            if (!cat) return null;
            return (
              <div className="mt-2">
                <input
                  ref={catInputRef}
                  autoFocus
                  value={catEditValue}
                  onChange={(e) => setCatEditValue(e.target.value)}
                  onBlur={commitCategoryRename}
                  onKeyDown={(e) => { if ((e as any).key === 'Enter') commitCategoryRename(); if ((e as any).key === 'Escape') cancelCategoryRename(); }}
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </div>
            );
          })()}

          <div className="mt-auto pt-2 border-t text-xs text-slate-500">
            <div className="flex items-center justify-between"><span>Current:</span><span className="font-medium">{currentCat?.name || '—'}</span></div>
            <Button size="sm" variant="outline" className="w-full mt-2 gap-2" onClick={()=>saveCurrentAsMap()}><FilePlus2 className="h-4 w-4" /> Save as new map</Button>
          </div>
        </aside>
      </div>

      {/* Full‑bleed canvas */}
      <div className="absolute inset-0">
        <svg
          ref={svgRef}
          className="w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-50 via-slate-100 to-slate-50"
          onPointerDown={onBgPointerDown as any}
          onWheel={onWheel as any}
          style={{ paddingLeft: sidebarOpen ? 280 : 0 }}
        >
          <defs>
            <pattern id="smallGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
            </pattern>
            <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
              <rect width="100" height="100" fill="url(#smallGrid)" />
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#cbd5e1" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g data-stage transform={`translate(${tx}, ${ty}) scale(${scale})`}>
            {edges.map((e) => (
              <path key={e.id} d={edgePath(e.from.x, e.from.y, e.to.x, e.to.y)} fill="none" stroke="#94a3b8" strokeWidth={1.4} />
            ))}

            {nodes.map((n) => (
              <Node
                key={n.id}
                n={n}
                selected={n.id === selectedId}
                onPointerDown={onNodePointerDown}
                onClick={(node) => setSelectedId(node.id)}
                onDoubleClick={(node)=>{ setSelectedId(node.id); setEditingId(node.id); setEditValue(node.label || ""); }}
                onAddChild={(node, dir) => addChild(node, dir)}
              />
            ))}

            {editingId && (() => {
              const n = nodes.find((x) => x.id === editingId); if (!n) return null; const x = n.x - NODE_W / 2; const y = n.y - NODE_H / 2;
              return (
                <foreignObject x={x} y={y} width={NODE_W} height={NODE_H}>
                  <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <input
                      ref={inputRef}
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => { if ((e as any).key === "Enter") commitEdit(); if ((e as any).key === "Escape") cancelEdit(); }}
                      style={{ width: "88%", height: 24, borderRadius: 8, border: "1px solid #94a3b8", padding: "0 10px", fontWeight: 600, textAlign: "center", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}
                    />
                  </div>
                </foreignObject>
              );
            })()}
          </g>
        </svg>
      </div>
    </div>
  );
}
