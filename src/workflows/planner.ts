import { compareText } from "../order.js";
import type { AgentWorkflowNode, WorkflowGraph, WorkflowNode, WorkflowPlan } from "./types.js";

function firstOptimalCapacityBin(nodes: AgentWorkflowNode[], capacity: number): AgentWorkflowNode[] {
  if (nodes.length === 0) return [];
  const ordered = [...nodes].sort((left, right) => right.fanOut - left.fanOut || compareText(left.id, right.id));
  const lowerBound = Math.ceil(ordered.reduce((sum, node) => sum + node.fanOut, 0) / capacity);
  for (let binCount = lowerBound; binCount <= ordered.length; binCount += 1) {
    const loads = Array<number>(binCount).fill(0);
    const bins = Array.from({ length: binCount }, () => [] as AgentWorkflowNode[]);
    const failed = new Set<string>();
    const place = (index: number): boolean => {
      if (index === ordered.length) return true;
      const memo = `${index}:${[...loads].sort((a, b) => a - b).join(",")}`;
      if (failed.has(memo)) return false;
      const node = ordered[index]!;
      const triedLoads = new Set<number>();
      for (let bin = 0; bin < binCount; bin += 1) {
        const load = loads[bin]!;
        if (triedLoads.has(load) || load + node.fanOut > capacity) continue;
        triedLoads.add(load);
        loads[bin] = load + node.fanOut;
        bins[bin]!.push(node);
        if (place(index + 1)) return true;
        bins[bin]!.pop();
        loads[bin] = load;
        if (load === 0) break;
      }
      failed.add(memo);
      return false;
    };
    if (place(0)) {
      return bins
        .filter((bin) => bin.length > 0)
        .map((bin) => bin.sort((left, right) => compareText(left.id, right.id)))
        .sort((left, right) => compareText(left.map((node) => node.id).join("\0"), right.map((node) => node.id).join("\0")))[0]!;
    }
  }
  throw new Error("workflow cannot be packed within maxConcurrency");
}

export function planWorkflowGraph(graph: WorkflowGraph): WorkflowPlan {
  const remaining = new Map(graph.nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const waves: WorkflowPlan["waves"] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.needs.every((dependency) => completed.has(dependency)))
      .sort((left, right) => compareText(left.id, right.id));
    if (ready.length === 0) throw new Error("workflow cycle detected while planning");
    const free = ready.filter((node) => node.kind !== "agent");
    const agentNodes = ready.filter((node): node is AgentWorkflowNode => node.kind === "agent");
    const packed = firstOptimalCapacityBin(agentNodes, graph.maxConcurrency);
    const agents = packed.reduce((sum, node) => sum + node.fanOut, 0);
    const selected: WorkflowNode[] = [...free, ...packed].sort((left, right) => compareText(left.id, right.id));
    if (selected.length === 0) throw new Error("workflow cannot make progress within maxConcurrency");
    waves.push({ index: waves.length, nodes: selected.map((node) => node.id), agents });
    for (const node of selected) {
      remaining.delete(node.id);
      completed.add(node.id);
    }
  }
  const nodes = graph.nodes
    .map((node) => ({
      ...node,
      needs: [...node.needs].sort(compareText),
      inputs: [...node.inputs].sort(compareText),
      outputs: [...node.outputs].sort(compareText),
    }))
    .sort((left, right) => compareText(left.id, right.id));
  return {
    schemaVersion: 1,
    name: graph.name,
    description: graph.description,
    maxConcurrency: graph.maxConcurrency,
    maxAgents: Math.max(...waves.map((wave) => wave.agents)),
    nodes,
    waves,
    userGates: waves.flatMap((wave) => wave.nodes).filter((id) => nodes.find((node) => node.id === id)?.kind === "gate"),
  };
}
