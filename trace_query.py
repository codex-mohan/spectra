import json, sys
import networkx as nx
from networkx.readwrite import json_graph
from pathlib import Path

data = json.loads(Path('graphify-out/graph.json').read_text(encoding='utf-8'))
G = json_graph.node_link_graph(data, edges='links')

question = 'Why does run_agent_loop bridge Agent Builder and Agent Core Events'
mode = 'bfs'
terms = [t.lower() for t in question.split() if len(t) > 3]

scored = []
for nid, ndata in G.nodes(data=True):
    label = ndata.get('label', '').lower()
    score = sum(1 for t in terms if t in label)
    if score > 0:
        scored.append((score, nid))
scored.sort(reverse=True)
start_nodes = [nid for _, nid in scored[:3]]

print('Start nodes:', [G.nodes[n].get('label', n) for n in start_nodes])

subgraph_nodes = set()
subgraph_edges = []

frontier = set(start_nodes)
subgraph_nodes = set(start_nodes)
for _ in range(3):
    next_frontier = set()
    for n in frontier:
        for neighbor in G.neighbors(n):
            if neighbor not in subgraph_nodes:
                next_frontier.add(neighbor)
                subgraph_edges.append((n, neighbor))
    subgraph_nodes.update(next_frontier)
    frontier = next_frontier

for nid in sorted(subgraph_nodes, key=lambda n: G.degree(n), reverse=True)[:30]:
    d = G.nodes[nid]
    comm = d.get('community', '?')
    label = d.get('label', nid)
    print(f'  [{comm}] {label} (deg {G.degree(nid)})')
print()
print('KEY EDGES:')
for u, v in subgraph_edges[:20]:
    if u in subgraph_nodes and v in subgraph_nodes:
        d = G.edges[u, v]
        print(f'  {G.nodes[u].get("label",u)} --{d.get("relation","?")}--> {G.nodes[v].get("label",v)} [{d.get("confidence","?")}]')
