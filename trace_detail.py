import json
import networkx as nx
from networkx.readwrite import json_graph
from pathlib import Path

data = json.loads(Path('graphify-out/graph.json').read_text(encoding='utf-8'))
G = json_graph.node_link_graph(data, edges='links')

# Find run_agent_loop node
target = None
for nid, ndata in G.nodes(data=True):
    if 'run_agent_loop' in ndata.get('label', '') or 'run_agent_loop' == nid:
        target = nid
        break

if not target:
    print('run_agent_loop not found')
else:
    d = G.nodes[target]
    print(f'run_agent_loop() :: community={d.get("community")}, file={d.get("source_file")}, deg={G.degree(target)}')
    print()
    for neighbor in G.neighbors(target):
        edge = G.edges[target, neighbor]
        nd = G.nodes[neighbor]
        print(f'  --{edge.get("relation","?")}--> {nd.get("label",neighbor)} [comm={nd.get("community","?")}] conf={edge.get("confidence","?")} conf_score={edge.get("confidence_score","?")}')

    print()
    # Also check what nodes are in community 1 (Agent Core Events) and community 8 (Agent Builder Rust)
    comm1_nodes = [n for n, nd in G.nodes(data=True) if nd.get('community') == 1]
    comm8_nodes = [n for n, nd in G.nodes(data=True) if nd.get('community') == 8]
    
    print(f'=== Community 1 (Agent Core Events) ({len(comm1_nodes)} nodes) ===')
    for n in sorted(comm1_nodes, key=lambda n: G.degree(n), reverse=True):
        nd = G.nodes[n]
        print(f'  {nd.get("label",n)} (deg {G.degree(n)})')
    
    print(f'\n=== Community 8 (Agent Builder Rust) ({len(comm8_nodes)} nodes) ===')
    for n in sorted(comm8_nodes, key=lambda n: G.degree(n), reverse=True):
        nd = G.nodes[n]
        print(f'  {nd.get("label",n)} (deg {G.degree(n)})')
    
    print()
    # Edges BETWEEN comm 1 and comm 8
    print('=== Edges bridging Community 1 <-> Community 8 ===')
    for u, v, d in G.edges(data=True):
        cu = G.nodes[u].get('community')
        cv = G.nodes[v].get('community')
        if (cu == 1 and cv == 8) or (cu == 8 and cv == 1):
            print(f'  {G.nodes[u].get("label",u)} --{d.get("relation","?")}--> {G.nodes[v].get("label",v)} [{d.get("confidence","?")}]')
