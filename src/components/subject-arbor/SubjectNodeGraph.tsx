
"use client";

import React, { useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  type Node,
  type Edge,
  type OnConnect,
} from 'reactflow';
import 'reactflow/dist/style.css'; // Essential ReactFlow styles
import type { TreeNodeData } from '@/types';

interface SubjectNodeGraphProps {
  treeData: TreeNodeData;
}

const nodeDefaults = {
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top,
};

// Function to transform TreeNodeData to ReactFlow nodes and edges
const transformDataToReactFlow = (rootNodeData: TreeNodeData): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nodeIdCounter = 0; // Reset counter for each transformation

  function buildFlowElements(
    tnData: TreeNodeData,
    parentId: string | null,
    level: number,
    siblingIndex: number,
    totalSiblings: number,
    parentX: number = 0 // X-coordinate of the parent, for relative positioning
  ) {
    nodeIdCounter++;
    // Create a more robust ID
    const safeName = tnData.name.replace(/[^a-zA-Z0-9-_]/g, '');
    const id = `rf-${safeName}-${nodeIdCounter}`;

    // Naive layout: Y by level. X tries to spread siblings and center under parent.
    // This is very basic. A real layout algorithm (ELK, Dagre) would be much better.
    const xOffsetDueToSiblings = (siblingIndex - (totalSiblings - 1) / 2) * 200; // Spread siblings
    const xPos = parentX + xOffsetDueToSiblings;
    const yPos = level * 120; // Vertical spacing based on level

    nodes.push({
      id,
      data: { label: tnData.name },
      position: { x: xPos, y: yPos },
      type: 'default', // Could be 'input' for root, 'output' for leaves if desired
      ...nodeDefaults,
      style: { 
        width: 150, 
        textAlign: 'center', 
        background: 'hsl(var(--card))', 
        color: 'hsl(var(--card-foreground))',
        border: '1px solid hsl(var(--border))'
      }
    });

    if (parentId) {
      edges.push({
        id: `edge-${parentId}-${id}`,
        source: parentId,
        target: id,
        type: 'smoothstep', // 'smoothstep', 'step', 'default' (straight)
        animated: false, // Set to true for animated edges
        style: { stroke: 'hsl(var(--primary))' }
      });
    }

    if (tnData.children && tnData.children.length > 0) {
      tnData.children.forEach((child, index) => {
        buildFlowElements(child, id, level + 1, index, tnData.children!.length, xPos);
      });
    }
  }

  buildFlowElements(rootNodeData, null, 0, 0, 1);
  
  // Attempt to center the graph - still very naive
  if (nodes.length > 0) {
    let minX = Infinity, maxX = -Infinity;
    nodes.forEach(n => {
        minX = Math.min(minX, n.position.x);
        maxX = Math.max(maxX, n.position.x + (n.style?.width as number || 150));
    });

    const graphWidth = maxX - minX;
    const xShift = -minX - (graphWidth / 2) + (typeof window !== 'undefined' ? (window.innerWidth * 0.4) / 2 : 150); // Shift to roughly center in its container
    const yInitialOffset = 50; // Push down a bit from the top

    nodes.forEach(n => {
        n.position.x += xShift;
        n.position.y += yInitialOffset;
    });
  }


  return { nodes, edges };
};

export function SubjectNodeGraph({ treeData }: SubjectNodeGraphProps) {
  const initialElements = useMemo(() => transformDataToReactFlow(treeData), [treeData]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialElements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialElements.edges);

  // Update nodes and edges if treeData changes
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = transformDataToReactFlow(treeData);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [treeData, setNodes, setEdges]);

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div style={{ height: '100%', width: '100%' }} className="bg-background rounded-lg border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        attributionPosition="bottom-left"
      >
        <Background gap={16} color="hsl(var(--border))" />
        <Controls />
        <MiniMap nodeStrokeWidth={3} zoomable pannable />
      </ReactFlow>
    </div>
  );
}
