// Custom A* implementation and multi-stop planning. No routing API is used.
export function buildGraph(rawGraph, zones, complianceWeight = 2) {
  const nodeById = new Map(rawGraph.nodes.map(n => [n.id, n]));
  const zoneById = new Map(zones.map(z => [z.id, z]));
  const adjacency = new Map(rawGraph.nodes.map(n => [n.id, []]));
  for (const edge of rawGraph.edges) {
    const [a, b, distance] = edge;
    if (!nodeById.has(a) || !nodeById.has(b)) throw new Error(`Edge references unknown node: ${a}-${b}`);
    if (!Number.isFinite(distance) || distance < 0) throw new Error(`Invalid distance for edge ${a}-${b}`);
    const make = (from, to) => {
      const node = nodeById.get(to);
      const zone = node.zoneId ? zoneById.get(node.zoneId) : null;
      const compliance = zone ? Math.max(0, Math.min(1, Number(zone.compliance) || 0)) : 1;
      const penalty = complianceWeight * (1 - compliance);
      return { to, distance, penalty, cost: distance + penalty };
    };
    adjacency.get(a).push(make(a, b));
    adjacency.get(b).push(make(b, a));
  }
  return { nodeById, adjacency, zones: zoneById };
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.items[p].priority <= item.priority) break;
      this.items[i] = this.items[p]; i = p;
    }
    this.items[i] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const root = this.items[0], last = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (true) {
        let left = 2 * i + 1, right = left + 1, smallest = i;
        if (left < this.items.length && this.items[left].priority < (smallest === i ? last.priority : this.items[smallest].priority)) smallest = left;
        if (right < this.items.length && this.items[right].priority < (smallest === i ? last.priority : this.items[smallest].priority)) smallest = right;
        if (smallest === i) break;
        this.items[i] = this.items[smallest]; i = smallest;
      }
      this.items[i] = last;
      // Re-heapify robustly after moving the last item.
      const all = this.items.splice(0);
      for (const item of all) this.push(item);
    }
    return root;
  }
  get size() { return this.items.length; }
}

export function aStar(graph, startId, goalId) {
  const { nodeById, adjacency } = graph;
  if (!nodeById.has(startId) || !nodeById.has(goalId)) throw new Error("Start or destination node does not exist.");
  if (startId === goalId) return { path: [startId], distance: 0, cost: 0, segments: [] };
  // h=0 is admissible for the compliance-augmented cost model, so this is
  // equivalent to Dijkstra's algorithm while preserving the A* framework.
  const open = new MinHeap();
  const g = new Map([[startId, 0]]);
  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const edgeByNode = new Map();
  open.push({ id: startId, priority: 0 });
  const closed = new Set();
  while (open.size) {
    const current = open.pop();
    if (!current) break;
    if (closed.has(current.id)) continue;
    if (current.id === goalId) break;
    closed.add(current.id);
    for (const edge of adjacency.get(current.id) || []) {
      if (closed.has(edge.to)) continue;
      const nextCost = g.get(current.id) + edge.cost;
      if (nextCost < (g.get(edge.to) ?? Infinity)) {
        g.set(edge.to, nextCost);
        distances.set(edge.to, (distances.get(current.id) || 0) + edge.distance);
        previous.set(edge.to, current.id);
        edgeByNode.set(edge.to, edge);
        open.push({ id: edge.to, priority: nextCost });
      }
    }
  }
  if (!previous.has(goalId)) throw new Error(`No route exists from ${startId} to ${goalId}.`);
  const path = [goalId];
  while (path[0] !== startId) {
    const parent = previous.get(path[0]);
    if (!parent) throw new Error("Route reconstruction failed.");
    path.unshift(parent);
  }
  const segments = [];
  for (let i = 1; i < path.length; i++) {
    const edge = edgeByNode.get(path[i]);
    segments.push({ from: path[i-1], to: path[i], distance: edge.distance, compliancePenalty: edge.penalty, cost: edge.cost });
  }
  return { path, distance: distances.get(goalId), cost: g.get(goalId), segments };
}

export function planMultiStop(graph, startId, stopIds, strategy = "nearest") {
  const remaining = [...new Set(stopIds)].filter(id => id !== startId);
  for (const id of remaining) if (!graph.nodeById.has(id)) throw new Error(`Unknown collection stop: ${id}`);
  const ordered = [];
  let current = startId;
  while (remaining.length) {
    let selectedIndex = 0, selectedPath = null;
    if (strategy === "nearest") {
      let best = Infinity;
      remaining.forEach((id, index) => {
        const path = aStar(graph, current, id);
        if (path.cost < best) { best = path.cost; selectedIndex = index; selectedPath = path; }
      });
    } else {
      selectedPath = aStar(graph, current, remaining[0]);
    }
    const next = remaining.splice(selectedIndex, 1)[0];
    ordered.push({ stopId: next, path: selectedPath });
    current = next;
  }
  const fullPath = [startId];
  let totalDistance = 0, totalCost = 0;
  const allSegments = [];
  for (const item of ordered) {
    totalDistance += item.path.distance; totalCost += item.path.cost;
    allSegments.push(...item.path.segments);
    fullPath.push(...item.path.path.slice(1));
  }
  return { startId, stopOrder: ordered.map(x => x.stopId), path: fullPath, distance: totalDistance, cost: totalCost, segments: allSegments, strategy, globallyOptimal: false };
}
