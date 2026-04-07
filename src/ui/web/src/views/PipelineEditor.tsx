import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type PipelineEntry, type ProjectEntry, type ProviderInfo } from "../lib/api";
import { subscribeRunStream, type RunStreamState } from "../lib/run-stream";

type PipelineMode = "sequential" | "orchestrated";
type NodeKind = "stage" | "orchestrator" | "input" | "output";
type StageStatus = "idle" | "running" | "success" | "failed" | "cancelled";
type ValidationState = {
  pending: boolean;
  ok: boolean;
  error: string | null;
};
type StreamEvent = {
  seq: number;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
};
type ProviderEntryYaml = string | Record<string, unknown>;
type RawStageDocument = Record<string, unknown>;
type RawPipelineDocument = {
  name?: string;
  version?: string;
  mode?: PipelineMode;
  providers?: ProviderEntryYaml[] | Record<string, unknown>;
  context?: unknown;
  policies?: unknown;
  stages?: Record<string, RawStageDocument>;
};
type EditorNodeData = {
  kind: NodeKind;
  label: string;
  stageName?: string;
  provider?: string;
  model?: string;
  skill?: string;
  systemMessage?: string;
  allowedTools: string[];
  contextRead: string[];
  contextWrite: string[];
  maxTokens: string;
  temperature: string;
  timeout: string;
  maxIterations: string;
  extras: Record<string, unknown>;
  status: StageStatus;
};
type PipelineNode = Node<EditorNodeData>;
type PipelineEdge = Edge<{ kind: "dependency" | "derived" }>;
type DraftMeta = {
  name: string;
  version: string;
  mode: PipelineMode;
  context?: unknown;
  policies?: unknown;
  rawProviders: ProviderEntryYaml[];
  path: string;
};

const TOOL_OPTIONS = [
  "read_file",
  "write_file",
  "list_files",
  "run_command",
  "search_files",
  "get_context",
  "delegate",
] as const;

const INITIAL_VALIDATION: ValidationState = {
  pending: false,
  ok: false,
  error: "Loading pipeline…",
};

const FLOW_EDGE_STYLE = { stroke: "rgb(var(--accent))", strokeWidth: 1.4 };
const FLOW_GRID_COLOR = "rgb(var(--grid))";
const FLOW_MINIMAP_MASK = "rgb(var(--overlay) / 0.72)";

export function PipelineEditor({ pipelineId }: { pipelineId: string }) {
  return (
    <ReactFlowProvider>
      <PipelineEditorInner pipelineId={pipelineId} />
    </ReactFlowProvider>
  );
}

function PipelineEditorInner({ pipelineId }: { pipelineId: string }) {
  const { pushToast } = useToast();
  const [entry, setEntry] = useState<PipelineEntry | null>(null);
  const [draft, setDraft] = useState<DraftMeta | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [skills, setSkills] = useState<Array<{ id: string; path: string; name: string }>>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([]);
  const [dependencyEdges, setDependencyEdges, onDependencyEdgesChange] = useEdgesState<PipelineEdge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("editor-left-panel") !== "false";
  });
  const [rightPanelOpen, setRightPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("editor-right-panel") !== "false";
  });
  useEffect(() => {
    localStorage.setItem("editor-left-panel", String(leftPanelOpen));
  }, [leftPanelOpen]);
  useEffect(() => {
    localStorage.setItem("editor-right-panel", String(rightPanelOpen));
  }, [rightPanelOpen]);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>(INITIAL_VALIDATION);
  const [saving, setSaving] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsTarget, setSaveAsTarget] = useState("global");
  const [saveAsName, setSaveAsName] = useState("");
  const [runInput, setRunInput] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runEvents, setRunEvents] = useState<StreamEvent[]>([]);
  const [runActive, setRunActive] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<RunStreamState>("closed");
  const [cancelRunBusy, setCancelRunBusy] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<{
    screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number };
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const runStreamRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);
  const seenRunEventSeqsRef = useRef<Set<number>>(new Set());
  const lastSavedYamlRef = useRef("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        const pipeline = await api.getPipeline(pipelineId);
        const [providerList, projectList, skillList] = await Promise.all([
          api.listProviders(),
          api.listProjects(),
          api.listSkills(
            pipeline.entry.projectId
              ? { projectId: pipeline.entry.projectId, includeGlobal: true }
              : undefined,
          ),
        ]);
        if (pipeline.parseError || !pipeline.config) {
          throw new Error(pipeline.parseError ?? "Pipeline could not be parsed.");
        }

        const rawDocument = parseYaml(pipeline.yaml) as RawPipelineDocument;
        const editorState = createEditorState(rawDocument, pipeline.entry.path);

        setEntry(pipeline.entry);
        setDraft(editorState.meta);
        setNodes(editorState.nodes);
        setDependencyEdges(editorState.edges);
        setSelectedNodeId(null);
        setProviders(providerList);
        setProjects(projectList);
        setSkills(skillList);
        setSaveAsTarget(
          pipeline.entry.projectId &&
            projectList.some((project) => project.id === pipeline.entry.projectId)
            ? pipeline.entry.projectId
            : "global",
        );
        setSaveAsName(fileNameOf(pipeline.entry.path));
        lastSavedYamlRef.current = pipeline.yaml;
        setValidation({
          pending: false,
          ok: !pipeline.parseError,
          error: pipeline.parseError,
        });
      } catch (loadError) {
        const message = (loadError as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load pipeline", description: message });
      }
    };

    load();

    return () => {
      runStreamRef.current?.();
      runStreamRef.current = null;
    };
  }, [pipelineId, pushToast, setDependencyEdges, setNodes]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const stageNodes = useMemo(
    () => nodes.filter((node) => isStageKind(node.data.kind)),
    [nodes],
  );
  const providerIds = useMemo(
    () =>
      [...new Set(stageNodes.map((node) => node.data.provider).filter(Boolean) as string[])].sort(),
    [stageNodes],
  );
  const duplicateStageNames = useMemo(() => getDuplicateStageNames(stageNodes), [stageNodes]);
  const localDraftError = useMemo(
    () => getLocalDraftError(draft, stageNodes, duplicateStageNames),
    [draft, stageNodes, duplicateStageNames],
  );
  const pipelineYaml = useMemo(() => {
    if (!draft) return "";
    return serializeDraft(draft, stageNodes, dependencyEdges);
  }, [dependencyEdges, draft, stageNodes]);
  const derivedEdges = useMemo(() => {
    if (!draft) return [];
    return buildDerivedEdges(nodes, dependencyEdges, draft.mode);
  }, [dependencyEdges, draft, nodes]);
  const allEdges = useMemo(
    () => [...dependencyEdges, ...derivedEdges],
    [dependencyEdges, derivedEdges],
  );
  const dirty = pipelineYaml !== "" && pipelineYaml !== lastSavedYamlRef.current;

  useEffect(() => {
    if (!draft) return;

    if (draft.mode === "orchestrated") {
      setNodes((currentNodes) => {
        const orchestratorIds = currentNodes.filter((node) => node.data.kind === "orchestrator");
        if (orchestratorIds.length > 0) return currentNodes;

        const firstStage = currentNodes.find((node) => node.data.kind === "stage");
        if (!firstStage) return currentNodes;

        return currentNodes.map((node) =>
          node.id === firstStage.id
            ? {
                ...node,
                type: "orchestrator",
                data: { ...node.data, kind: "orchestrator" },
              }
            : node,
        );
      });
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.data.kind === "orchestrator"
          ? { ...node, type: "stage", data: { ...node.data, kind: "stage" } }
          : node,
      ),
    );
  }, [draft?.mode, setNodes]);

  useEffect(() => {
    if (!draft) return;

    if (localDraftError) {
      setValidation({ pending: false, ok: false, error: localDraftError });
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setValidation((current) => ({ ...current, pending: true, error: current.error }));
        const result = await api.validatePipeline(pipelineYaml);
        setValidation({
          pending: false,
          ok: result.ok,
          error: result.ok ? null : result.error ?? "Invalid pipeline.",
        });
      } catch (validationError) {
        setValidation({
          pending: false,
          ok: false,
          error: (validationError as Error).message,
        });
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [draft, localDraftError, pipelineYaml]);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (nodes.some((node) => node.id === selectedNodeId)) return;
    setSelectedNodeId(null);
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [runEvents]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const onConnect = (connection: Connection) => {
    if (!draft || draft.mode !== "sequential") return;
    if (!connection.source || !connection.target || connection.source === connection.target) return;

    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target) return;
    if (!isStageKind(source.data.kind) || !isStageKind(target.data.kind)) return;

    setDependencyEdges((currentEdges) =>
      addEdge(
        {
          ...connection,
          id: `dep-${connection.source}-${connection.target}`,
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          data: { kind: "dependency" },
          style: FLOW_EDGE_STYLE,
        },
        currentEdges,
      ),
    );
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/openthk-node-kind") as NodeKind;
    if (!reactFlowInstance || (kind !== "stage" && kind !== "orchestrator")) return;

    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    addStageNode(kind, position);
  };

  const addStageNode = (kind: "stage" | "orchestrator", position?: { x: number; y: number }) => {
    if (!draft) return;
    if (kind === "orchestrator" && nodes.some((node) => node.data.kind === "orchestrator")) {
      setError("Only one orchestrator is allowed.");
      return;
    }

    const nextName = uniqueStageName(
      kind === "orchestrator" ? "orchestrator" : "stage",
      stageNodes.map((node) => node.data.stageName ?? node.id),
    );
    const newNode = createStageNode({
      id: `node-${crypto.randomUUID()}`,
      kind,
      stageName: nextName,
      position:
        position ??
        {
          x: 240 + stageNodes.length * 220,
          y: 120 + (stageNodes.length % 3) * 140,
        },
    });

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(newNode.id);
    if (kind === "orchestrator") {
      setDraft((currentDraft) =>
        currentDraft ? { ...currentDraft, mode: "orchestrated" } : currentDraft,
      );
    }
  };

  const updateDraft = <K extends keyof DraftMeta>(key: K, value: DraftMeta[K]) => {
    setDraft((currentDraft) => (currentDraft ? { ...currentDraft, [key]: value } : currentDraft));
  };

  const updateSelectedNode = (
    updater: (node: PipelineNode) => PipelineNode,
  ) => {
    if (!selectedNodeId) return;
    setNodes((currentNodes) =>
      currentNodes.map((node) => (node.id === selectedNodeId ? updater(node) : node)),
    );
  };

  const deleteSelectedStage = () => {
    if (!selectedNode || !isStageKind(selectedNode.data.kind)) return;
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNode.id));
    setDependencyEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    );
    setSelectedNodeId(null);
  };

  const savePipeline = async () => {
    if (!entry || !draft) return;
    if (!validation.ok) return;

    setSaving(true);
    setError(null);
    try {
      await api.savePipeline(entry.id, pipelineYaml);
      lastSavedYamlRef.current = pipelineYaml;
      setEntry((currentEntry) =>
        currentEntry
          ? {
              ...currentEntry,
              name: draft.name,
            }
          : currentEntry,
      );
      pushToast({ kind: "success", title: "Pipeline saved", description: entry.path });
    } catch (saveError) {
      const message = (saveError as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not save pipeline", description: message });
    } finally {
      setSaving(false);
    }
  };

  const saveAsPipeline = async () => {
    if (!draft) return;
    if (!validation.ok) return;

    const trimmedName = saveAsName.trim();
    if (!trimmedName) {
      const message = "Save As requires a file name.";
      setError(message);
      pushToast({ kind: "error", title: "Save As requires a target", description: message });
      return;
    }

    const normalizedFileName = normalizeFileName(trimmedName);
    const targetProject =
      saveAsTarget === "global"
        ? null
        : projects.find((project) => project.id === saveAsTarget) ?? null;
    if (saveAsTarget !== "global" && !targetProject) {
      const message = "Select a registered project for the copy destination.";
      setError(message);
      pushToast({ kind: "error", title: "Invalid project target", description: message });
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result =
        saveAsTarget === "global"
          ? await api.createGlobalPipeline(draft.name, pipelineYaml, false, normalizedFileName)
          : await api.createProjectPipeline(
              saveAsTarget,
              draft.name,
              pipelineYaml,
              false,
              normalizedFileName,
            );
      lastSavedYamlRef.current = pipelineYaml;
      setSaveAsOpen(false);
      pushToast({
        kind: "success",
        title: "Pipeline saved as new file",
        description: result.pipeline.path,
      });
      window.location.hash = `#/pipelines/${result.pipeline.id}`;
    } catch (saveError) {
      const message = (saveError as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not save pipeline copy", description: message });
    } finally {
      setSaving(false);
    }
  };

  const startRun = async () => {
    if (!entry || !draft) return;
    if (!runInput.trim()) {
      const message = "Run input is required.";
      setError(message);
      pushToast({ kind: "error", title: "Run input required", description: message });
      return;
    }

    setRunBusy(true);
    setError(null);

    try {
      if (dirty) {
        if (!validation.ok) throw new Error(validation.error ?? "Pipeline is invalid.");
        await api.savePipeline(entry.id, pipelineYaml);
        lastSavedYamlRef.current = pipelineYaml;
      }

      const result = await api.runPipeline(entry.id, runInput.trim());
      runStreamRef.current?.();
      runStreamRef.current = null;
      setRunId(result.runId);
      runIdRef.current = result.runId;
      seenRunEventSeqsRef.current = new Set();
      setRunEvents([]);
      setRunActive(true);
      setStreamState("connecting");
      setCancelRunBusy(false);
      resetNodeStatuses();
      pushToast({ kind: "success", title: "Run started", description: result.runId });

      runStreamRef.current = subscribeRunStream({
        runId: result.runId,
        eventTypes: [
          "pipeline:start",
          "pipeline:complete",
          "stage:start",
          "stage:progress",
          "stage:complete",
          "stage:error",
          "stage:warning",
          "context:read",
          "context:write",
          "policy:violation",
          "tool:call",
          "tool:result",
          "delegate:start",
          "delegate:complete",
          "delegate:error",
          "tokens:update",
          "thinking:start",
          "thinking:end",
          "run:done",
          "run:error",
        ],
        onStateChange: setStreamState,
        isTerminalEvent: (event) => event.type === "run:done",
        onEvent: (event) => {
          if (seenRunEventSeqsRef.current.has(event.seq)) return;
          seenRunEventSeqsRef.current.add(event.seq);
          setRunEvents((currentEvents) => [...currentEvents, event]);
          applyRunEvent(event);
        },
      });
    } catch (runError) {
      const message = (runError as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not start run", description: message });
    } finally {
      setRunBusy(false);
    }
  };

  const cancelCurrentRun = async () => {
    if (!runId) return;

    setCancelRunBusy(true);
    try {
      const result = await api.cancelRun(runId);
      if (!result.ok) {
        throw new Error("Run is no longer active.");
      }
      pushToast({ kind: "info", title: "Cancellation requested", description: runId });
    } catch (cancelError) {
      const message = (cancelError as Error).message;
      setCancelRunBusy(false);
      pushToast({ kind: "error", title: "Could not cancel run", description: message });
    }
  };

  const resetNodeStatuses = () => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        isStageKind(node.data.kind)
          ? { ...node, data: { ...node.data, status: "idle" } }
          : node,
      ),
    );
  };

  const applyRunEvent = (event: StreamEvent) => {
    const payload = event.payload;
    if (event.type === "stage:start" && typeof payload.stageName === "string") {
      setStageStatus(payload.stageName, "running");
      return;
    }
    if (event.type === "stage:error" && typeof payload.stageName === "string") {
      setStageStatus(payload.stageName, "failed");
      return;
    }
    if (event.type === "stage:complete" && payload.result && typeof payload.result === "object") {
      const result = payload.result as Record<string, unknown>;
      if (typeof result.stageName === "string") {
        if (result.status === "cancelled") {
          setStageStatus(result.stageName, "cancelled");
        } else {
          setStageStatus(result.stageName, result.status === "success" ? "success" : "failed");
        }
      }
      return;
    }
    if (event.type === "run:done") {
      setRunActive(false);
      setCancelRunBusy(false);
      if (payload.status === "cancelled") {
        markRunningStages("cancelled");
        pushToast({ kind: "info", title: "Run cancelled", description: runIdRef.current ?? undefined });
      } else if (payload.status === "failed") {
        markRunningStages("failed");
        pushToast({ kind: "error", title: "Run failed", description: String(payload.error ?? "") || undefined });
      } else {
        pushToast({ kind: "success", title: "Run finished", description: runIdRef.current ?? undefined });
      }
      return;
    }
    if (event.type === "run:error") {
      markRunningStages("failed");
    }
  };

  const setStageStatus = (stageName: string, status: StageStatus) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.data.stageName === stageName
          ? { ...node, data: { ...node.data, status } }
          : node,
      ),
    );
  };

  const markRunningStages = (status: Extract<StageStatus, "failed" | "cancelled">) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        isStageKind(node.data.kind) && node.data.status === "running"
          ? { ...node, data: { ...node.data, status } }
          : node,
      ),
    );
  };

  if (error && !draft) {
    return (
      <EmptyState
        title="Pipeline unavailable"
        description={error}
        action={
          <a href="#/pipelines" className="btn">
            Back to pipelines
          </a>
        }
      />
    );
  }

  if (!draft || !entry) {
    return <div className="p-6 text-sm text-ink-400">Loading editor…</div>;
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 border-b border-ink-700 px-6 py-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 min-w-0 flex-1">
            <div className="flex items-center gap-3 text-sm">
              <a href="#/pipelines" className="text-ink-400 hover:text-ink-100">
                ← Pipelines
              </a>
              <span className="text-ink-500">/</span>
              <span className="font-medium truncate">{entry.name}</span>
              {dirty && <span className="text-[10px] uppercase tracking-widest text-yellow-500">Unsaved</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="label block mb-1">Name</label>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                />
              </div>
              <div>
                <label className="label block mb-1">Version</label>
                <input
                  className="input"
                  value={draft.version}
                  onChange={(event) => updateDraft("version", event.target.value)}
                />
              </div>
              <div>
                <label className="label block mb-1">Mode</label>
                <select
                  className="input"
                  value={draft.mode}
                  onChange={(event) => updateDraft("mode", event.target.value as PipelineMode)}
                >
                  <option value="sequential">sequential</option>
                  <option value="orchestrated">orchestrated</option>
                </select>
              </div>
              <div>
                <label className="label block mb-1">Providers used</label>
                <div className="panel h-[38px] px-3 flex items-center gap-2 overflow-x-auto">
                  {providerIds.length === 0 ? (
                    <span className="text-xs text-ink-400">No stage providers yet.</span>
                  ) : (
                    providerIds.map((providerId) => (
                      <span
                        key={providerId}
                        className="text-[11px] px-2 py-1 border border-ink-600 bg-ink-800 whitespace-nowrap"
                      >
                        {providerId}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button className="btn" onClick={() => setSaveAsOpen(true)} disabled={saving}>
              Save As
            </button>
            <button className="btn" onClick={savePipeline} disabled={saving || !dirty || !validation.ok}>
              Save
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
            <span
              className={`px-2 py-1 border ${
              validation.pending
                ? "border-yellow-500 text-yellow-500"
                : validation.ok
                  ? "border-green-500 text-green-500"
                  : "border-red-500 text-red-500"
            }`}
          >
            {validation.pending ? "Validating…" : validation.ok ? "Valid" : "Invalid"}
          </span>
          <span className="text-ink-400 font-mono truncate">{draft.path}</span>
          {validation.error && <span className="text-red-400">{validation.error}</span>}
          {!validation.error && draft.mode === "orchestrated" && (
            <span className="text-ink-400">Connections are visual-only in orchestrated mode.</span>
          )}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      </div>

      <div
        className="flex-1 min-h-0 grid"
        style={{
          gridTemplateColumns: `${leftPanelOpen ? "240px" : "0px"} minmax(0,1fr) ${rightPanelOpen ? "340px" : "0px"}`,
          transition: "grid-template-columns 220ms ease",
        }}
      >
        <aside
          className={`border-r border-ink-700 bg-ink-900 overflow-auto transition-opacity duration-200 ${leftPanelOpen ? "p-4 space-y-4 opacity-100" : "p-0 opacity-0 pointer-events-none"}`}
        >
          <div>
            <div className="label mb-2">Palette</div>
            <div className="space-y-2">
              <PaletteCard
                title="Stage"
                subtitle="Sequential or worker node"
                kind="stage"
              />
              <PaletteCard
                title="Orchestrator"
                subtitle="Delegates work in orchestrated mode"
                kind="orchestrator"
              />
            </div>
          </div>

          <div>
            <div className="label mb-2">Canvas</div>
            <div className="text-xs text-ink-400 space-y-2">
              <p>Drag node cards into the canvas.</p>
              <p>Connect stage handles left→right to create `depends_on` in sequential mode.</p>
              <p>Input and output nodes are derived automatically from the current graph.</p>
            </div>
          </div>

          <div>
            <div className="label mb-2">YAML preview</div>
            <pre className="panel p-3 text-[11px] font-mono whitespace-pre-wrap break-words max-h-[320px] overflow-auto">
              {pipelineYaml}
            </pre>
          </div>
        </aside>

        <div
          className="relative min-h-0 bg-ink-950"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Floating panel toggles (n8n-style) */}
          <button
            type="button"
            onClick={() => setLeftPanelOpen((v) => !v)}
            title={leftPanelOpen ? "Hide palette" : "Show palette"}
            className="absolute top-3 left-3 z-10 w-8 h-8 flex items-center justify-center rounded-lg bg-ink-900/90 border border-ink-700 text-ink-300 hover:text-ink-100 hover:bg-ink-800 backdrop-blur shadow-lg transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {leftPanelOpen ? (
                <path d="M15 18l-6-6 6-6" />
              ) : (
                <path d="M9 18l6-6-6-6" />
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setRightPanelOpen((v) => !v)}
            title={rightPanelOpen ? "Hide inspector" : "Show inspector"}
            className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-lg bg-ink-900/90 border border-ink-700 text-ink-300 hover:text-ink-100 hover:bg-ink-800 backdrop-blur shadow-lg transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {rightPanelOpen ? (
                <path d="M9 18l6-6-6-6" />
              ) : (
                <path d="M15 18l-6-6 6-6" />
              )}
            </svg>
          </button>
          <ReactFlow
            nodes={nodes}
            edges={allEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onDependencyEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            onInit={setReactFlowInstance}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
            minZoom={0.2}
            maxZoom={2}
            nodeTypes={NODE_TYPES}
            proOptions={{ hideAttribution: true }}
            panOnScroll
            selectionOnDrag
            panOnDrag={[1, 2]}
            zoomOnDoubleClick={false}
            defaultEdgeOptions={{
              type: "smoothstep",
              animated: false,
              markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "rgb(var(--accent))" },
              style: { ...FLOW_EDGE_STYLE, strokeWidth: 2 },
            }}
          >
            <Background variant={BackgroundVariant.Dots} color={FLOW_GRID_COLOR} gap={24} size={1.4} />
            <MiniMap
              nodeBorderRadius={6}
              pannable
              zoomable
              maskColor={FLOW_MINIMAP_MASK}
              nodeColor={(node) => getMiniMapColor(node as PipelineNode)}
              style={{
                backgroundColor: "rgb(var(--ink-900) / 0.85)",
                border: "1px solid rgb(var(--ink-700) / 0.5)",
                borderRadius: 8,
              }}
            />
            <Controls
              showInteractive={false}
              className="!bg-ink-900/90 !border !border-ink-700/50 !rounded-lg !shadow-lg !backdrop-blur"
            />
          </ReactFlow>
        </div>

        <aside
          className={`border-l border-ink-700 bg-ink-900 overflow-auto transition-opacity duration-200 ${rightPanelOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          <div className="px-4 py-3 border-b border-ink-700">
            <div className="text-sm font-medium">Inspector</div>
            <div className="text-[11px] text-ink-400 mt-1">
              {selectedNode ? selectedNode.data.label : "Select a node to edit its fields."}
            </div>
          </div>

          {!selectedNode ? (
            <div className="p-4 text-sm text-ink-400">No node selected.</div>
          ) : !isStageKind(selectedNode.data.kind) ? (
            <div className="p-4 text-sm text-ink-400">
              {selectedNode.data.kind === "input"
                ? "Input is derived from the current graph roots."
                : "Output is derived from the current graph leaves."}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-ink-400 uppercase tracking-widest">
                  {selectedNode.data.kind}
                </div>
                <button className="btn !py-1 !px-2 text-xs" onClick={deleteSelectedStage}>
                  Delete
                </button>
              </div>

              <Field label="Stage name">
                <input
                  className="input"
                  value={selectedNode.data.stageName ?? ""}
                  onChange={(event) => {
                    const nextName = ensureUniqueStageName(
                      event.target.value,
                      stageNodes.map((node) => node.data.stageName ?? node.id),
                      selectedNode.id,
                      stageNodes,
                    );
                    updateSelectedNode((node) => ({
                      ...node,
                      data: { ...node.data, label: nextName, stageName: nextName },
                    }));
                  }}
                />
              </Field>

              <Field label="Provider">
                <select
                  className="input"
                  value={selectedNode.data.provider ?? ""}
                  onChange={(event) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      data: { ...node.data, provider: event.target.value },
                    }))
                  }
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.id}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Model">
                <input
                  className="input"
                  value={selectedNode.data.model ?? ""}
                  onChange={(event) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      data: { ...node.data, model: event.target.value },
                    }))
                  }
                />
              </Field>

              <Field label="Skill">
                <input
                  className="input"
                  list="skills-list"
                  value={selectedNode.data.skill ?? ""}
                  onChange={(event) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      data: { ...node.data, skill: event.target.value },
                    }))
                  }
                />
                <datalist id="skills-list">
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id} />
                  ))}
                </datalist>
              </Field>

              <Field label="System message">
                <textarea
                  className="input min-h-[92px]"
                  value={selectedNode.data.systemMessage ?? ""}
                  onChange={(event) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      data: { ...node.data, systemMessage: event.target.value },
                    }))
                  }
                />
              </Field>

              <Field label="Allowed tools">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {TOOL_OPTIONS.map((toolName) => {
                    const checked = selectedNode.data.allowedTools.includes(toolName);
                    return (
                      <label key={toolName} className="flex items-center gap-2 text-ink-300">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            updateSelectedNode((node) => ({
                              ...node,
                              data: {
                                ...node.data,
                                allowedTools: event.target.checked
                                  ? [...node.data.allowedTools, toolName].sort()
                                  : node.data.allowedTools.filter((item) => item !== toolName),
                              },
                            }))
                          }
                        />
                        <span className="font-mono text-[11px]">{toolName}</span>
                      </label>
                    );
                  })}
                </div>
              </Field>

              <ChipListEditor
                label="Context read"
                values={selectedNode.data.contextRead}
                onChange={(nextValues) =>
                  updateSelectedNode((node) => ({
                    ...node,
                    data: { ...node.data, contextRead: nextValues },
                  }))
                }
              />

              <ChipListEditor
                label="Context write"
                values={selectedNode.data.contextWrite}
                onChange={(nextValues) =>
                  updateSelectedNode((node) => ({
                    ...node,
                    data: { ...node.data, contextWrite: nextValues },
                  }))
                }
              />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Max tokens">
                  <input
                    className="input"
                    value={selectedNode.data.maxTokens}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, maxTokens: event.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Temperature">
                  <input
                    className="input"
                    value={selectedNode.data.temperature}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, temperature: event.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Timeout (s)">
                  <input
                    className="input"
                    value={selectedNode.data.timeout}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, timeout: event.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Max iterations">
                  <input
                    className="input"
                    value={selectedNode.data.maxIterations}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, maxIterations: event.target.value },
                      }))
                    }
                  />
                </Field>
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="shrink-0 border-t border-ink-700 bg-ink-900 px-6 py-4 grid grid-cols-[360px_minmax(0,1fr)] gap-4">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Run From Editor</div>
            <div className="text-[11px] text-ink-400 mt-1">
              Saves the current YAML first, then starts a run and colors nodes live.
            </div>
          </div>

          <textarea
            className="input min-h-[88px]"
            placeholder="Describe what this pipeline should do..."
            value={runInput}
            onChange={(event) => setRunInput(event.target.value)}
          />

          <div className="flex items-center gap-3">
            <button className="btn-accent" onClick={startRun} disabled={runBusy || !validation.ok}>
              {runBusy ? "Starting…" : "Run Pipeline"}
            </button>
            {runActive && (
              <button className="btn" onClick={cancelCurrentRun} disabled={cancelRunBusy}>
                {cancelRunBusy ? "Cancelling…" : "Cancel run"}
              </button>
            )}
            <div className="text-xs text-ink-400">
              {runId ? `Run ${runId}` : "No active run"}
              {runActive && " · live"}
              {runId && ` · stream:${streamState}`}
            </div>
          </div>
        </div>

        <div className="panel min-h-[180px] flex flex-col">
          <div className="px-4 py-2 border-b border-ink-700 flex items-center justify-between">
            <div className="label">Run stream</div>
            <div className="text-[11px] text-ink-400">{runEvents.length} events</div>
          </div>
          <div ref={logRef} className="flex-1 overflow-auto p-4 font-mono text-[11px] space-y-1">
            {runEvents.length === 0 ? (
              <div className="text-ink-400">No run events yet.</div>
            ) : (
              runEvents.map((event) => (
                <div key={event.seq} className="text-ink-300">
                  <span className="text-ink-500">[{new Date(event.ts).toLocaleTimeString()}]</span>{" "}
                  <span className="text-accent">{event.type}</span>{" "}
                  <span className="text-ink-400">{formatRunEvent(event)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {saveAsOpen && (
        <div className="fixed inset-0 z-50 overlay-scrim flex items-center justify-center p-6">
          <div className="panel w-full max-w-lg">
            <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
              <div className="text-sm font-medium">Save pipeline as</div>
              <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={() => setSaveAsOpen(false)}>
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3">
              <Field label="Destination">
                <select
                  className="input"
                  value={saveAsTarget}
                  onChange={(event) => setSaveAsTarget(event.target.value)}
                >
                  <option value="global">Global (~/.openthk/pipelines)</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.path})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="File name">
                <input
                  className="input"
                  value={saveAsName}
                  onChange={(event) => setSaveAsName(event.target.value)}
                />
              </Field>
              <div className="text-[11px] text-ink-400">
                {saveAsTarget === "global"
                  ? "The copy will be stored in ~/.openthk/pipelines."
                  : `The copy will be stored in ${
                      projects.find((project) => project.id === saveAsTarget)?.path ?? "the selected project"
                    }/.openthk/pipelines.`}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-ink-700 flex justify-end gap-2">
              <button className="btn" onClick={() => setSaveAsOpen(false)}>
                Cancel
              </button>
              <button className="btn-accent" onClick={saveAsPipeline} disabled={saving || !validation.ok}>
                Save As
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PaletteCard({
  title,
  subtitle,
  kind,
}: {
  title: string;
  subtitle: string;
  kind: "stage" | "orchestrator";
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/openthk-node-kind", kind);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="panel p-3 cursor-grab active:cursor-grabbing"
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-[11px] text-ink-400 mt-1">{subtitle}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      {children}
    </div>
  );
}

function ChipListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (nextValues: string[]) => void;
}) {
  const [draftValue, setDraftValue] = useState("");

  return (
    <Field label={label}>
      <div className="panel p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {values.length === 0 ? (
            <span className="text-xs text-ink-400">No entries.</span>
          ) : (
            values.map((value) => (
              <span key={value} className="inline-flex items-center gap-2 px-2 py-1 border border-ink-600 text-xs">
                <span className="font-mono">{value}</span>
                <button
                  className="text-ink-400 hover:text-ink-100"
                  onClick={() => onChange(values.filter((item) => item !== value))}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1 font-mono"
            value={draftValue}
            placeholder="input.*"
            onChange={(event) => setDraftValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const value = draftValue.trim();
                if (!value || values.includes(value)) return;
                onChange([...values, value]);
                setDraftValue("");
              }
            }}
          />
          <button
            className="btn"
            onClick={() => {
              const value = draftValue.trim();
              if (!value || values.includes(value)) return;
              onChange([...values, value]);
              setDraftValue("");
            }}
          >
            Add
          </button>
        </div>
      </div>
    </Field>
  );
}

function PipelineNodeCard({ data, selected }: { data: EditorNodeData; selected?: boolean }) {
  const tone = getNodeTone(data.kind, data.status);
  const showTarget = data.kind !== "input";
  const showSource = data.kind !== "output";
  const statusDot: Record<StageStatus, string> = {
    idle: "bg-ink-600",
    running: "bg-accent animate-pulse-soft",
    success: "bg-green-500",
    failed: "bg-red-500",
    cancelled: "bg-orange-500",
  };
  const kindIcon = data.kind === "orchestrator" ? "◆" : data.kind === "input" ? "▶" : data.kind === "output" ? "■" : "●";

  return (
    <div
      className={`min-w-[200px] rounded-xl border-2 ${tone} bg-ink-900/95 backdrop-blur shadow-lg overflow-hidden transition-all duration-150 ${
        selected ? "ring-2 ring-accent ring-offset-2 ring-offset-ink-950 shadow-accent/20" : "hover:border-ink-500"
      }`}
    >
      {showTarget && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-accent !border-2 !border-ink-900 !-left-1.5"
        />
      )}
      {showSource && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-accent !border-2 !border-ink-900 !-right-1.5"
        />
      )}
      <div className="px-3 py-2.5 border-b border-ink-700/60 flex items-center justify-between gap-3 bg-ink-800/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-accent text-sm shrink-0">{kindIcon}</span>
          <div className="text-sm font-semibold text-ink-100 truncate">{data.label}</div>
        </div>
        {isStageKind(data.kind) && (
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[data.status]}`} />
        )}
      </div>
      <div className="px-3 py-2 text-[11px] space-y-1">
        {isStageKind(data.kind) ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-ink-500 w-12 shrink-0">provider</span>
              <span className="font-mono text-ink-300 truncate">{data.provider || "—"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-ink-500 w-12 shrink-0">model</span>
              <span className="font-mono text-ink-300 truncate">{data.model || "—"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-ink-500 w-12 shrink-0">skill</span>
              <span className="text-ink-300 truncate">{data.skill || "—"}</span>
            </div>
          </>
        ) : (
          <div className="text-ink-400">{data.kind === "input" ? "Pipeline entry point" : "Pipeline exit"}</div>
        )}
      </div>
    </div>
  );
}

const NODE_TYPES = {
  stage: PipelineNodeCard,
  orchestrator: PipelineNodeCard,
  input: PipelineNodeCard,
  output: PipelineNodeCard,
};

function isStageKind(kind: NodeKind): kind is "stage" | "orchestrator" {
  return kind === "stage" || kind === "orchestrator";
}

function createEditorState(rawDocument: RawPipelineDocument, path: string): {
  meta: DraftMeta;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
} {
  const mode: PipelineMode = rawDocument.mode ?? "sequential";
  const stageEntries = Object.entries(rawDocument.stages ?? {});
  const stageNodes: PipelineNode[] = [];
  const stageIdByName = new Map<string, string>();
  const layerByStage = new Map<string, number>();

  const stageDeps = new Map<string, string[]>();
  for (const [stageName, stageDoc] of stageEntries) {
    const deps = Array.isArray(stageDoc.depends_on)
      ? stageDoc.depends_on.filter((dep): dep is string => typeof dep === "string")
      : [];
    stageDeps.set(stageName, deps);
  }

  for (const [stageName] of stageEntries) {
    layerByStage.set(stageName, resolveStageLayer(stageName, stageDeps, new Set()));
  }

  for (const [index, [stageName, stageDoc]] of stageEntries.entries()) {
    const nodeId = `node-${index + 1}`;
    stageIdByName.set(stageName, nodeId);
    const layer = layerByStage.get(stageName) ?? 1;
    const row = stageNodes.filter((node) => Math.round((node.position.x - 220) / 260) === layer).length;
    const kind: NodeKind = stageDoc.role === "orchestrator" ? "orchestrator" : "stage";

    stageNodes.push({
      id: nodeId,
      type: kind,
      position: { x: 220 + layer * 260, y: 90 + row * 150 },
      data: {
        kind,
        label: stageName,
        stageName,
        provider: stringValue(stageDoc.provider) ?? "openai",
        model: stringValue(stageDoc.model) ?? "gpt-4o",
        skill: stringValue(stageDoc.skill) ?? "core/echo@1.0",
        systemMessage: stringValue(stageDoc.system_message) ?? "",
        allowedTools: stringArray(stageDoc.allowed_tools),
        contextRead: stringArray((stageDoc.context as Record<string, unknown> | undefined)?.read),
        contextWrite: stringArray((stageDoc.context as Record<string, unknown> | undefined)?.write),
        maxTokens: numberString(stageDoc.max_tokens),
        temperature: numberString(stageDoc.temperature),
        timeout: numberString(stageDoc.timeout),
        maxIterations: numberString(stageDoc.max_iterations),
        extras: extractStageExtras(stageDoc),
        status: "idle",
      },
    });
  }

  const inputNode: PipelineNode = {
    id: "input-node",
    type: "input",
    draggable: false,
    selectable: true,
    position: { x: 20, y: 220 },
    data: {
      kind: "input",
      label: "Input",
      allowedTools: [],
      contextRead: [],
      contextWrite: [],
      maxTokens: "",
      temperature: "",
      timeout: "",
      maxIterations: "",
      extras: {},
      status: "idle",
    },
  };

  const outputNode: PipelineNode = {
    id: "output-node",
    type: "output",
    draggable: false,
    selectable: true,
    position: { x: 220 + Math.max(...[1, ...stageNodes.map((node) => node.position.x / 260)]) * 260 + 220, y: 220 },
    data: {
      kind: "output",
      label: "Output",
      allowedTools: [],
      contextRead: [],
      contextWrite: [],
      maxTokens: "",
      temperature: "",
      timeout: "",
      maxIterations: "",
      extras: {},
      status: "idle",
    },
  };

  const dependencyEdges: PipelineEdge[] = [];
  for (const [stageName, stageDoc] of stageEntries) {
    const targetId = stageIdByName.get(stageName);
    if (!targetId) continue;
    const deps = Array.isArray(stageDoc.depends_on)
      ? stageDoc.depends_on.filter((dep): dep is string => typeof dep === "string")
      : [];

    for (const dep of deps) {
      const sourceId = stageIdByName.get(dep);
      if (!sourceId) continue;
      dependencyEdges.push({
        id: `dep-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        data: { kind: "dependency" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        style: FLOW_EDGE_STYLE,
      });
    }
  }

  return {
    meta: {
      name: rawDocument.name ?? "untitled-pipeline",
      version: rawDocument.version ?? "0.1.0",
      mode,
      context: rawDocument.context,
      policies: rawDocument.policies,
      rawProviders: normalizeProviderEntries(rawDocument.providers),
      path,
    },
    nodes: [inputNode, ...stageNodes, outputNode],
    edges: dependencyEdges,
  };
}

function buildDerivedEdges(
  nodes: PipelineNode[],
  dependencyEdges: PipelineEdge[],
  mode: PipelineMode,
): PipelineEdge[] {
  const stageNodes = nodes.filter((node) => isStageKind(node.data.kind));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const node of stageNodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, 0);
  }

  for (const edge of dependencyEdges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }

  const derived: PipelineEdge[] = [];
  const orchestrator = stageNodes.find((node) => node.data.kind === "orchestrator");

  if (mode === "orchestrated" && orchestrator) {
    derived.push({
      id: `derived-input-${orchestrator.id}`,
      source: "input-node",
      target: orchestrator.id,
      data: { kind: "derived" },
      animated: true,
      style: { stroke: "#3a3a40", strokeDasharray: "4 3" },
    });

    for (const node of stageNodes) {
      if (node.id === orchestrator.id) continue;
      derived.push({
        id: `derived-orchestrator-${orchestrator.id}-${node.id}`,
        source: orchestrator.id,
        target: node.id,
        data: { kind: "derived" },
        animated: true,
        style: { stroke: "#3a3a40", strokeDasharray: "4 3" },
      });
      derived.push({
        id: `derived-output-${node.id}`,
        source: node.id,
        target: "output-node",
        data: { kind: "derived" },
        style: { stroke: "#3a3a40", strokeDasharray: "4 3" },
      });
    }

    return derived;
  }

  for (const node of stageNodes) {
    if ((incoming.get(node.id) ?? 0) === 0) {
      derived.push({
        id: `derived-input-${node.id}`,
        source: "input-node",
        target: node.id,
        data: { kind: "derived" },
        style: { stroke: "#3a3a40", strokeDasharray: "4 3" },
      });
    }
    if ((outgoing.get(node.id) ?? 0) === 0) {
      derived.push({
        id: `derived-output-${node.id}`,
        source: node.id,
        target: "output-node",
        data: { kind: "derived" },
        style: { stroke: "#3a3a40", strokeDasharray: "4 3" },
      });
    }
  }

  return derived;
}

function serializeDraft(
  draft: DraftMeta,
  stageNodes: PipelineNode[],
  dependencyEdges: PipelineEdge[],
): string {
  const stageNameById = new Map(
    stageNodes.map((node) => [node.id, node.data.stageName ?? node.id]),
  );
  const usedProviders = [...new Set(stageNodes.map((node) => node.data.provider).filter(Boolean) as string[])];

  const incomingDepsByNode = new Map<string, string[]>();
  for (const edge of dependencyEdges) {
    const target = incomingDepsByNode.get(edge.target) ?? [];
    const sourceName = stageNameById.get(edge.source);
    if (sourceName) target.push(sourceName);
    incomingDepsByNode.set(edge.target, target);
  }

  const stages: Record<string, Record<string, unknown>> = {};
  for (const node of stageNodes) {
    const stageName = node.data.stageName ?? node.id;
    const stageDoc: Record<string, unknown> = {};
    const systemMessage = (node.data.systemMessage ?? "").trim();

    stageDoc.provider = node.data.provider || "openai";
    stageDoc.model = node.data.model || "gpt-4o";
    stageDoc.skill = node.data.skill || "core/echo@1.0";
    if (systemMessage) {
      stageDoc.system_message = systemMessage;
    }
    stageDoc.context = {
      read: node.data.contextRead,
      write: node.data.contextWrite,
    };

    if (draft.mode === "sequential") {
      const dependsOn = incomingDepsByNode.get(node.id) ?? [];
      if (dependsOn.length > 0) {
        stageDoc.depends_on = dependsOn;
      }
    }

    if (node.data.allowedTools.length > 0) {
      stageDoc.allowed_tools = node.data.allowedTools;
    }
    if (node.data.kind === "orchestrator" && draft.mode === "orchestrated") {
      stageDoc.role = "orchestrator";
    }

    maybeAssignNumber(stageDoc, "max_tokens", node.data.maxTokens);
    maybeAssignNumber(stageDoc, "temperature", node.data.temperature, true);
    maybeAssignNumber(stageDoc, "timeout", node.data.timeout);
    maybeAssignNumber(stageDoc, "max_iterations", node.data.maxIterations);

    for (const [key, value] of Object.entries(node.data.extras)) {
      if (!(key in stageDoc)) stageDoc[key] = value;
    }

    stages[stageName] = stageDoc;
  }

  const document: Record<string, unknown> = {
    name: draft.name,
    version: draft.version,
    mode: draft.mode,
    providers: buildProviderEntries(draft.rawProviders, usedProviders),
    stages,
  };

  if (draft.context !== undefined) document.context = draft.context;
  if (draft.policies !== undefined) document.policies = draft.policies;

  return stringifyYaml(document, {
    lineWidth: 0,
    indent: 2,
  });
}

function buildProviderEntries(
  rawProviders: ProviderEntryYaml[],
  usedProviderIds: string[],
): ProviderEntryYaml[] {
  const byId = new Map<string, ProviderEntryYaml>();
  for (const providerEntry of rawProviders) {
    const providerId = providerEntryId(providerEntry);
    if (providerId) byId.set(providerId, providerEntry);
  }

  const entries = usedProviderIds.map((providerId) => byId.get(providerId) ?? providerId);
  return entries.length > 0 ? entries : ["openai"];
}

function createStageNode({
  id,
  kind,
  stageName,
  position,
}: {
  id: string;
  kind: "stage" | "orchestrator";
  stageName: string;
  position: { x: number; y: number };
}): PipelineNode {
  return {
    id,
    type: kind,
    position,
    data: {
      kind,
      label: stageName,
      stageName,
      provider: "openai",
      model: "gpt-4o",
      skill: "core/echo@1.0",
      systemMessage: "",
      allowedTools: [],
      contextRead: ["input.*"],
      contextWrite: [`${stageName}.*`],
      maxTokens: "",
      temperature: "",
      timeout: "",
      maxIterations: "",
      extras: {},
      status: "idle",
    },
  };
}

function extractStageExtras(stageDocument: RawStageDocument): Record<string, unknown> {
  const extras = { ...stageDocument };
  delete extras.provider;
  delete extras.model;
  delete extras.skill;
  delete extras.system_message;
  delete extras.context;
  delete extras.depends_on;
  delete extras.allowed_tools;
  delete extras.role;
  delete extras.max_tokens;
  delete extras.temperature;
  delete extras.timeout;
  delete extras.max_iterations;
  return extras;
}

function normalizeProviderEntries(
  providers: RawPipelineDocument["providers"],
): ProviderEntryYaml[] {
  if (Array.isArray(providers)) return providers;
  if (!providers || typeof providers !== "object") return [];

  return Object.entries(providers).map(([name, value]) =>
    value && typeof value === "object"
      ? { id: name, ...(value as Record<string, unknown>) }
      : name,
  );
}

function providerEntryId(entry: ProviderEntryYaml): string | null {
  if (typeof entry === "string") return entry;
  if (typeof entry.id === "string") return entry.id;
  return null;
}

function getDuplicateStageNames(stageNodes: PipelineNode[]): string[] {
  const counts = new Map<string, number>();
  for (const node of stageNodes) {
    const stageName = node.data.stageName?.trim();
    if (!stageName) continue;
    counts.set(stageName, (counts.get(stageName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
}

function getLocalDraftError(
  draft: DraftMeta | null,
  stageNodes: PipelineNode[],
  duplicateStageNames: string[],
): string | null {
  if (!draft) return "Draft not loaded.";
  if (!draft.name.trim()) return "Pipeline name is required.";
  if (!draft.version.trim()) return "Pipeline version is required.";
  if (stageNodes.length === 0) return "At least one stage is required.";
  if (duplicateStageNames.length > 0) {
    return `Stage names must be unique. Duplicates: ${duplicateStageNames.join(", ")}`;
  }
  if (draft.mode === "orchestrated") {
    const orchestrators = stageNodes.filter((node) => node.data.kind === "orchestrator");
    if (orchestrators.length !== 1) {
      return "Orchestrated mode requires exactly one orchestrator node.";
    }
  }
  return null;
}

function uniqueStageName(base: string, existingNames: string[]): string {
  const normalizedBase = sanitizeStageName(base);
  if (!existingNames.includes(normalizedBase)) return normalizedBase;

  let suffix = 2;
  while (existingNames.includes(`${normalizedBase}-${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedBase}-${suffix}`;
}

function ensureUniqueStageName(
  proposedName: string,
  _allNames: string[],
  currentNodeId: string,
  stageNodes: PipelineNode[],
): string {
  const sanitized = sanitizeStageName(proposedName || "stage");
  const otherNames = stageNodes
    .filter((node) => node.id !== currentNodeId)
    .map((node) => node.data.stageName ?? node.id);
  return uniqueStageName(sanitized, otherNames);
}

function sanitizeStageName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "stage";
}

function resolveStageLayer(
  stageName: string,
  stageDeps: Map<string, string[]>,
  seen: Set<string>,
): number {
  if (seen.has(stageName)) return 1;
  seen.add(stageName);
  const deps = stageDeps.get(stageName) ?? [];
  if (deps.length === 0) return 1;
  return (
    1 +
    Math.max(
      ...deps.map((dep) => resolveStageLayer(dep, stageDeps, new Set(seen))),
    )
  );
}

function maybeAssignNumber(
  target: Record<string, unknown>,
  key: string,
  value: string,
  allowFloat = false,
): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  const parsed = allowFloat ? Number(trimmed) : Number.parseInt(trimmed, 10);
  if (!Number.isNaN(parsed)) target[key] = parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function numberString(value: unknown): string {
  return typeof value === "number" ? String(value) : "";
}

function fileNameOf(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? path : path.slice(slashIndex + 1);
}

function normalizeFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.endsWith(".yaml") && !trimmed.endsWith(".yml")) {
    return `${trimmed}.yaml`;
  }
  return trimmed;
}

function formatRunEvent(event: StreamEvent): string {
  const payload = event.payload;
  if (event.type === "stage:start") return `${payload.stageName} (${payload.model})`;
  if (event.type === "stage:error") return `${payload.stageName}: ${payload.error}`;
  if (event.type === "stage:warning") return `${payload.stageName}: ${payload.message}`;
  if (event.type === "tool:call") return `${payload.stageName} → ${payload.toolName}`;
  if (event.type === "tool:result") return `${payload.stageName} ← ${payload.toolName}`;
  if (event.type === "stage:complete" && payload.result && typeof payload.result === "object") {
    const result = payload.result as Record<string, unknown>;
    return `${result.stageName} ${result.status} ${result.durationMs ?? 0}ms`;
  }
  if (event.type === "run:done") return `status=${payload.status} tokens=${payload.totalTokens}`;
  if (event.type === "pipeline:complete") return "pipeline complete";
  return JSON.stringify(payload).slice(0, 140);
}

function getNodeTone(kind: NodeKind, status: StageStatus): string {
  if (kind === "input" || kind === "output") return "border-ink-600";
  if (status === "running") return "border-accent";
  if (status === "success") return "border-green-500";
  if (status === "failed") return "border-red-500";
  if (status === "cancelled") return "border-yellow-500";
  return kind === "orchestrator" ? "border-yellow-500" : "border-ink-600";
}

function getMiniMapColor(node: PipelineNode): string {
  if (node.data.kind === "input" || node.data.kind === "output") return "rgb(var(--ink-500))";
  if (node.data.status === "running") return "rgb(var(--accent))";
  if (node.data.status === "success") return "#4ade80";
  if (node.data.status === "failed") return "#f87171";
  if (node.data.status === "cancelled") return "#facc15";
  return node.data.kind === "orchestrator" ? "#facc15" : "rgb(var(--ink-300))";
}
