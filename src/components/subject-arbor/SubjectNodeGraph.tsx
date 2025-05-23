
"use client";

import React, { useCallback, useMemo, useEffect, useState } from 'react';
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
  ControlButton, // For adding custom buttons to controls
} from 'reactflow';
import 'reactflow/dist/style.css'; // Essential ReactFlow styles
import type { TreeNodeData } from '@/types';
import { ArrowUpDown } from 'lucide-react'; // Icon for layout toggle

interface SubjectNodeGraphProps {
  treeData: TreeNodeData;
}

const NODE_WIDTH = 170; // Approximate node width for layout
const NODE_HEIGHT_WITH_PADDING = 50; // Approximate node height + padding for layout

// Function to transform TreeNodeData to ReactFlow nodes and edges (VERTICAL LAYOUT)
const transformDataToVerticalReactFlow = (rootNodeData: TreeNodeData): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nodeIdCounter = 0;

  const nodeStyle = {
    width: NODE_WIDTH,
    textAlign: 'center' as const,
    background: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
    border: '1px solid hsl(var(--border))',
    padding: '8px',
    borderRadius: 'var(--radius)',
  };

  function buildFlowElements(
    tnData: TreeNodeData,
    parentId: string | null,
    level: number,
    siblingIndex: number,
    totalSiblings: number,
    parentX: number = 0
  ) {
    nodeIdCounter++;
    const safeName = tnData.name.replace(/[^a-zA-Z0-9-_]/g, '');
    const id = `rf-vert-${safeName}-${nodeIdCounter}`;

    const xOffsetDueToSiblings = (siblingIndex - (totalSiblings - 1) / 2) * (NODE_WIDTH + 60);
    const xPos = parentX + xOffsetDueToSiblings;
    const yPos = level * (NODE_HEIGHT_WITH_PADDING + 70);

    nodes.push({
      id,
      data: { label: tnData.name },
      position: { x: xPos, y: yPos },
      type: 'default',
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: nodeStyle,
    });

    if (parentId) {
      edges.push({
        id: `edge-vert-${parentId}-${id}`,
        source: parentId,
        target: id,
        type: 'smoothstep',
        style: { stroke: 'hsl(var(--primary))', strokeWidth: 1.5 }
      });
    }

    if (tnData.children && tnData.children.length > 0) {
      tnData.children.forEach((child, index) => {
        buildFlowElements(child, id, level + 1, index, tnData.children!.length, xPos);
      });
    }
  }

  buildFlowElements(rootNodeData, null, 0, 0, 1);

  if (nodes.length > 0) {
    let minX = Infinity;
    nodes.forEach(n => {
        minX = Math.min(minX, n.position.x);
    });
    const xShift = -minX; // Shift to bring the leftmost part of the graph towards origin
    const yInitialOffset = 50;

    nodes.forEach(n => {
        n.position.x += xShift;
        n.position.y += yInitialOffset;
    });
  }

  return { nodes, edges };
};


// Function to transform TreeNodeData to ReactFlow nodes and edges (HORIZONTAL LAYOUT)
const transformDataToHorizontalReactFlow = (rootNodeData: TreeNodeData): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nodeIdCounter = 0;

  const HORIZONTAL_SPACING_PER_LEVEL = NODE_WIDTH + 100; // Space between levels
  const VERTICAL_SPACING_SIBLING_BLOCK = 20; // Base vertical spacing between sibling subtrees

  const nodeStyle = {
    width: NODE_WIDTH,
    textAlign: 'center' as const,
    background: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
    border: '1px solid hsl(var(--border))',
    padding: '8px',
    borderRadius: 'var(--radius)',
  };

  function calculatePositionsAndBuild(
    tnData: TreeNodeData,
    parentId: string | null,
    level: number,
    currentStartingY: number
  ): { nodeId: string; subtreeHeight: number; nodeCenterY: number } {
    nodeIdCounter++;
    const safeName = tnData.name.replace(/[^a-zA-Z0-9-_]/g, '');
    const id = `rf-horz-${safeName}-${nodeIdCounter}`;

    const xPos = level * HORIZONTAL_SPACING_PER_LEVEL;
    let yPos = currentStartingY; // Tentative Y, will be adjusted if it has children

    let childrenSubtreeTotalHeight = 0;
    const childResults: Array<{ nodeId: string; subtreeHeight: number; nodeCenterY: number }> = [];

    if (tnData.children && tnData.children.length > 0) {
      let childY = currentStartingY;
      tnData.children.forEach((child, index) => {
        if (index > 0) {
          childY += VERTICAL_SPACING_SIBLING_BLOCK; // Add spacing between children blocks
        }
        const childResult = calculatePositionsAndBuild(child, id, level + 1, childY);
        childResults.push(childResult);
        childY += childResult.subtreeHeight; // Next child starts after the previous child's subtree
      });

      childrenSubtreeTotalHeight = childY - currentStartingY;

      // Center parent Y relative to its children's spread
      if (childResults.length > 0) {
        const firstChildNode = nodes.find(n => n.id === childResults[0].nodeId)!;
        const lastChildNode = nodes.find(n => n.id === childResults[childResults.length - 1].nodeId)!;
        
        // Calculate the center based on the actual top of the first child's node and bottom of the last child's node in their block
        const firstChildTop = childResults[0].nodeCenterY - NODE_HEIGHT_WITH_PADDING / 2;
        const lastChildBlockBottom = childResults[childResults.length - 1].nodeCenterY + childResults[childResults.length-1].subtreeHeight / 2 - (childResults[childResults.length - 1].subtreeHeight - NODE_HEIGHT_WITH_PADDING )/2;
        // The effective Y range of children nodes themselves (not entire subtrees)
        const firstChildCenterY = childResults[0].nodeCenterY;
        const lastChildCenterY = childResults[childResults.length-1].nodeCenterY;
        yPos = (firstChildCenterY + lastChildCenterY) / 2;
      }
    }

    nodes.push({
      id,
      data: { label: tnData.name },
      position: { x: xPos, y: yPos },
      type: 'default',
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: nodeStyle,
    });

    if (parentId) {
      edges.push({
        id: `edge-horz-${parentId}-${id}`,
        source: parentId,
        target: id,
        type: 'smoothstep',
        style: { stroke: 'hsl(var(--primary))', strokeWidth: 1.5 }
      });
    }
    
    const ownNodeHeight = NODE_HEIGHT_WITH_PADDING;
    const effectiveSubtreeHeight = Math.max(ownNodeHeight, childrenSubtreeTotalHeight);

    return { nodeId: id, subtreeHeight: effectiveSubtreeHeight, nodeCenterY: yPos };
  }

  calculatePositionsAndBuild(rootNodeData, null, 0, 50); // Initial Y offset for the root

  // Normalize Y positions to start near 0 if they are all negative or very high due to centering logic
  if (nodes.length > 0) {
      let minY = Infinity;
      nodes.forEach(n => minY = Math.min(minY, n.position.y));
      if (minY > 50 || minY < 0) { // Arbitrary threshold to adjust if layout is far off
          const yShift = 50 - minY; // Target minY of 50
           nodes.forEach(n => n.position.y += yShift);
      }
  }


  return { nodes, edges };
};


export function SubjectNodeGraph({ treeData }: SubjectNodeGraphProps) {
  const [layoutMode, setLayoutMode] = useState<'vertical' | 'horizontal'>('vertical');

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!treeData) {
        setNodes([]);
        setEdges([]);
        return;
    }
    let newElements;
    if (layoutMode === 'vertical') {
      newElements = transformDataToVerticalReactFlow(treeData);
    } else {
      newElements = transformDataToHorizontalReactFlow(treeData);
    }
    setNodes(newElements.nodes);
    setEdges(newElements.edges);
  }, [treeData, layoutMode, setNodes, setEdges]);

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const toggleLayout = () => {
    setLayoutMode(prev => prev === 'vertical' ? 'horizontal' : 'vertical');
  };

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
        nodesDraggable={true} // Allow dragging to fine-tune
        edgesFocusable={false}
        nodesFocusable={false}
      >
        <Background gap={16} color="hsl(var(--border))" />
        <Controls>
          <ControlButton onClick={toggleLayout} title={layoutMode === 'vertical' ? "Switch to Horizontal Layout" : "Switch to Vertical Layout"}>
            <ArrowUpDown size={16}/>
          </ControlButton>
        </Controls>
        <MiniMap nodeStrokeWidth={3} zoomable pannable />
      </ReactFlow>
    </div>
  );
}

