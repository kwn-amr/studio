
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNodeData } from '@/types';
import { Button } from '@/components/ui/button';
import { ImageIcon, Minimize, Maximize, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';

export interface D3HierarchyNode extends d3.HierarchyPointNode<TreeNodeData> {
  _children?: D3HierarchyNode[];
  children?: D3HierarchyNode[];
  x0?: number;
  y0?: number;
  id: string; 
  isGeneratingMore?: boolean;
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
  onGenerateMoreChildren: (targetNodePath: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // True if initial tree is loading
  activeNodeGeneratingMore: string | null; // ID of node currently having children generated
  setActiveNodeGeneratingMore: (id: string | null) => void;
}

export function D3SubjectGraph({ 
  treeData, 
  fieldOfStudy, 
  onGenerateMoreChildren, 
  isProcessingAction,
  activeNodeGeneratingMore,
  setActiveNodeGeneratingMore
}: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null);

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  
  const d3State = useRef<{
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null;
    g: d3.Selection<SVGGElement, unknown, null, undefined> | null;
    root: D3HierarchyNode | null;
    treeLayout: d3.TreeLayout<TreeNodeData> | null;
    zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    dimensions: { width: number; height: number };
    margin: { top: number; right: number; bottom: number; left: number };
    initialLoadDone: boolean; // To track if the first data load has happened
  }>({
    svg: null,
    g: null,
    root: null,
    treeLayout: null,
    zoomBehavior: null,
    dimensions: {width: 0, height: 0},
    margin: { top: 20, right: 180, bottom: 20, left: 120 },
    initialLoadDone: false,
  });

  const animationDuration = 750;
  const nodeRadius = 6;
  const loaderIconRadius = 8;

  const getContainerDimensions = useCallback(() => {
    if (graphWrapperRef.current) {
      const parent = graphWrapperRef.current;
      return {
        width: parent.clientWidth,
        height: parent.clientHeight,
      };
    }
    return { width: 600, height: 400 }; // Default fallback
  }, []);

  const generatePathId = useCallback((d: d3.HierarchyNode<TreeNodeData>): string => {
    return d.ancestors().map(n => n.data.name.replace(/[^a-zA-Z0-9-_]/g, '_')).reverse().join('/');
  }, []);


  const updateChart = useCallback((sourceNodeParam?: D3HierarchyNode) => {
    if (!d3State.current.g || !d3State.current.root || !d3State.current.treeLayout || !tooltipRef.current || !graphWrapperRef.current) return;

    const g = d3State.current.g;
    const rootNode = d3State.current.root;
    const treeLayout = d3State.current.treeLayout;
    const tooltip = d3.select(tooltipRef.current);
    const currentGraphWrapper = graphWrapperRef.current;
    
    const treeDataLayout = treeLayout(rootNode);
    const nodes = treeDataLayout.descendants() as D3HierarchyNode[];
    const links = treeDataLayout.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    const effectiveSource = sourceNodeParam || rootNode;

    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id); 

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`);

    nodeEnter.on('click', async (event, dNode) => {
      event.stopPropagation(); // Prevent event bubbling

      let nodeWasExpanded = false;
      if (dNode.children) {
        dNode._children = dNode.children;
        dNode.children = undefined;
      } else if (dNode._children) {
        dNode.children = dNode._children;
        dNode._children = undefined;
        nodeWasExpanded = true; 
      }
      
      // If an action is already processing globally, or for this specific node,
      // or if the node was just collapsed, only update the chart for expansion/collapse.
      if (isProcessingAction || dNode.isGeneratingMore || activeNodeGeneratingMore === dNode.id) {
        if (nodeWasExpanded || !dNode.children) { // If it was expanded or is a leaf
            updateChart(dNode); // Ensure UI reflects expansion/collapse
        }
        return;
      }
      
      // Conditions to try generating more:
      // 1. It's a leaf node (no children, no _children).
      // 2. It was just expanded and now has children visible.
      // (Simplified: always try if not already loading)
      dNode.isGeneratingMore = true;
      setActiveNodeGeneratingMore(dNode.id!); 
      updateChart(dNode); // Update to show loader icon & potential expansion

      try {
        const path: string[] = dNode.ancestors().map(n => n.data.name).reverse();
        await onGenerateMoreChildren(path, fieldOfStudy);
        // setActiveNodeGeneratingMore(null) will be called by page.tsx's finally block
        // which will trigger the useEffect to update dNode.isGeneratingMore and re-render.
      } catch (err) {
        console.error("Error in onGenerateMoreChildren callback from D3 graph:", err);
        if (dNode.isGeneratingMore) { // Reset local flag if error
            dNode.isGeneratingMore = false;
        }
        // If this node was the one globally active, clear it.
        if (activeNodeGeneratingMore === dNode.id) {
            setActiveNodeGeneratingMore(null); 
        } else { 
          // If not, it means setActiveNodeGeneratingMore(null) might have already been called
          // or another node is active. Just update this node's visuals.
          updateChart(dNode);
        }
      }
    });
    
    nodeEnter.on('mouseover', function(event, dNode) {
        if (dNode.isGeneratingMore) return;
        d3.select(this).select('circle.node-main-circle').classed('hovered', true);
        g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source === dNode || l.target === dNode);

        const [mx, my] = d3.pointer(event, currentGraphWrapper);
        let tooltipContent = `<strong>${dNode.data.name}</strong>`;
        if (dNode.data.description && dNode.data.description.trim() !== '') {
           tooltipContent += `<br><small style="display: block; margin-top: 4px; color: hsl(var(--muted-foreground));">${dNode.data.description.trim()}</small>`;
        }
        
        const tooltipNodeEl = tooltip.node() as HTMLDivElement;
        tooltip.html(tooltipContent)
               .style('opacity', 1);

        const tooltipWidth = tooltipNodeEl.offsetWidth;
        const tooltipHeight = tooltipNodeEl.offsetHeight;
        const wrapperWidth = currentGraphWrapper.clientWidth;
        const wrapperHeight = currentGraphWrapper.clientHeight;

        let left = mx + 15;
        let top = my + 10;

        if (left + tooltipWidth + 10 > wrapperWidth) {
            left = mx - tooltipWidth - 15; 
        }
        if (left < 5) left = 5;

        if (top + tooltipHeight + 10 > wrapperHeight) {
            top = my - tooltipHeight - 10; 
        }
        if (top < 5) top = 5;
        
        tooltip.style('left', left + 'px')
               .style('top', top + 'px');
      })
      .on('mouseout', function() {
        tooltip.style('opacity', 0);
        d3.select(this).select('circle.node-main-circle').classed('hovered', false);
        g.selectAll('path.link').classed('highlighted', false);
      });

    nodeEnter.append('circle')
      .attr('class', 'node-main-circle')
      .attr('r', 1e-6);
    
    const loaderGroupEnter = nodeEnter.append('g')
      .attr('class', 'node-loader-group')
      .style('display', 'none') // Initially hidden, controlled by dNode.isGeneratingMore
      .attr('transform', `translate(0,0)`) // Position relative to node center
      .style('pointer-events', 'none'); // Don't interfere with clicks on main node

    loaderGroupEnter.append('circle')
      .attr('r', loaderIconRadius + 2) // Slightly larger backdrop
      .attr('class', 'node-loader-backdrop');

    // Use Lucide Loader2 path directly
    loaderGroupEnter.append('path')
      .attr('d', Loader2.path) // d="M21 12a9 9 0 1 1-6.219-8.55"
      .attr('class', 'node-loader-spinner animate-spin')
      .attr('transform', `translate(${-loaderIconRadius/1.5}, ${-loaderIconRadius/1.5}) scale(0.6)`); // Adjust scale and position

    nodeEnter.append('text')
      .attr('dy', '.35em')
      .text(d => d.data.name);

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
      .duration(animationDuration)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    nodeUpdate.select<SVGCircleElement>('circle.node-main-circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = 'node-main-circle ';
        classes += (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        if (d.isGeneratingMore) classes += ' node-loading'; // Class to dim the node
        return classes;
      });
    
    nodeUpdate.select<SVGGElement>('.node-loader-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');
    
    nodeUpdate.select('text')
      .attr('x', nodeRadius + 5) // Always position text to the right of the circle
      .attr('text-anchor', 'start') // Always anchor text at the start (left)
      .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1); // Dim text if loading

    const nodeExit = node.exit().transition()
      .duration(animationDuration)
      .attr('transform', `translate(${effectiveSource.y || 0},${effectiveSource.x0 || 0})`)
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    const link = g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
      .data(links, d => d.target.id);

    const linkEnter = link.enter().insert('path', 'g')
      .attr('class', 'link')
      .attr('d', () => {
        const o = { x: effectiveSource.x0 || 0, y: effectiveSource.y0 || 0 };
        return d3.linkHorizontal<any, {x:number, y:number}>().x(dNode => dNode.y).y(dNode => dNode.x)({ source: o, target: o });
      });

    linkEnter.merge(link)
      .transition()
      .duration(animationDuration)
      .attr('d', d3.linkHorizontal<any, D3HierarchyNode, D3HierarchyNode>()
          .x(dNode => dNode.y!)
          .y(dNode => dNode.x!)
      );

    link.exit().transition()
      .duration(animationDuration)
      .attr('d', () => {
        const o = { x: effectiveSource.x || 0, y: effectiveSource.y || 0 };
        return d3.linkHorizontal<any, {x:number, y:number}>().x(dNode => dNode.y).y(dNode => dNode.x)({ source: o, target: o });
      })
      .remove();

    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, activeNodeGeneratingMore, isProcessingAction, setActiveNodeGeneratingMore]);


  const collapseAllNodesRecursive = useCallback((d: D3HierarchyNode, keepRootChildren = false) => {
    if (d.children) {
      if (!keepRootChildren || d !== d3State.current.root) { 
        d._children = d.children;
        d.children.forEach(child => collapseAllNodesRecursive(child, false)); 
        d.children = undefined;
      } else { 
        d.children.forEach(child => collapseAllNodesRecursive(child, false)); 
      }
    }
  }, []);

  const expandAllNodesRecursive = useCallback((d: D3HierarchyNode) => {
    if (d._children) {
        d.children = d._children;
        d._children = undefined;
    }
    if (d.children) {
        d.children.forEach(expandAllNodesRecursive);
    }
  }, []);

  const handleToggleExpandAll = () => {
    if (!d3State.current.root || activeNodeGeneratingMore || isProcessingAction) return;
    if (isFullyExpanded) {
      collapseAllNodesRecursive(d3State.current.root, true); 
    } else {
      expandAllNodesRecursive(d3State.current.root);
    }
    setIsFullyExpanded(!isFullyExpanded);
    updateChart(d3State.current.root);
  };

  const handleExportPng = useCallback(() => {
    if (svgRef.current && graphWrapperRef.current && !activeNodeGeneratingMore && !isProcessingAction) {
      const wrapperStyle = getComputedStyle(graphWrapperRef.current);
      const backgroundColor = wrapperStyle.backgroundColor || 'hsl(var(--background))'; // Fallback to CSS var if needed
      
      toPng(svgRef.current, {
          backgroundColor: backgroundColor,
          pixelRatio: 2 
      })
        .then((dataUrl) => {
          const link = document.createElement('a');
          link.download = `${fieldOfStudy.toLowerCase().replace(/\s+/g, '_')}_graph.png`;
          link.href = dataUrl;
          link.click();
        })
        .catch((err) => {
          console.error('Failed to export PNG:', err);
        });
    }
  }, [fieldOfStudy, activeNodeGeneratingMore, isProcessingAction]);


  useEffect(() => {
    const initOrResize = () => {
        if (!svgRef.current || !graphWrapperRef.current) return;
        d3State.current.dimensions = getContainerDimensions();
        const { width, height } = d3State.current.dimensions;
        
        const svg = d3.select(svgRef.current)
            .attr('width', width)
            .attr('height', height);

        if (!d3State.current.svg) { 
            d3State.current.svg = svg;
            d3State.current.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
              .scaleExtent([0.05, 5]) 
              .on('zoom', (event) => {
                if (d3State.current.g) {
                  d3State.current.g.attr('transform', event.transform);
                }
            });
            svg.call(d3State.current.zoomBehavior);
            d3State.current.g = svg.append('g');
            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]);
        }
        
        if (d3State.current.root && d3State.current.svg && d3State.current.zoomBehavior) {
            const { margin } = d3State.current;
            const currentTransform = d3.zoomTransform(d3State.current.svg.node()!);
            
            const newTransform = d3.zoomIdentity
                .translate(margin.left + 50, height / 2) // Keep root relatively left, vertically centered
                .scale(currentTransform.k); // Keep current scale if already zoomed

            d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
        }
        if (d3State.current.root) {
           updateChart(d3State.current.root); // Re-render with new layout if needed
        }
    };

    initOrResize();
    const resizeObserver = new ResizeObserver(initOrResize);
    if (graphWrapperRef.current) resizeObserver.observe(graphWrapperRef.current);
    
    return () => {
      if (graphWrapperRef.current) resizeObserver.unobserve(graphWrapperRef.current);
      resizeObserver.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getContainerDimensions]); // updateChart removed, called internally or by other effects


  useEffect(() => {
    if (!d3State.current.g || !d3State.current.treeLayout || !d3State.current.dimensions.width) return;
    
    if (!treeData) {
      if (d3State.current.g) d3State.current.g.selectAll("*").remove();
      d3State.current.root = null;
      d3State.current.initialLoadDone = false;
      return;
    }
    
    const { margin, dimensions } = d3State.current;
    const isInitialLoad = !d3State.current.initialLoadDone || (d3State.current.root && d3State.current.root.data.name !== treeData.name && fieldOfStudy === treeData.name);
    const oldRoot = d3State.current.root;
    const oldNodeStates = new Map<string, { isCollapsed: boolean, x0?: number, y0?: number }>();

    if (oldRoot && !isInitialLoad) {
      oldRoot.eachBefore(d => {
        oldNodeStates.set(d.id, {
          isCollapsed: !!d._children && !d.children,
          x0: d.x0,
          y0: d.y0
        });
      });
    }
    
    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    let sourceForAnimation: D3HierarchyNode = newRootHierarchy;

    newRootHierarchy.eachBefore(dNode => {
      dNode.id = generatePathId(dNode);
      const oldState = oldNodeStates.get(dNode.id);

      if (oldState) {
        dNode.x0 = oldState.x0;
        dNode.y0 = oldState.y0;
        if (oldState.isCollapsed && dNode.children) {
          dNode._children = dNode.children;
          dNode.children = undefined;
        } else if (!oldState.isCollapsed && dNode._children){ // Was expanded, ensure it stays expanded
          dNode.children = dNode._children;
          dNode._children = undefined;
        }
      } else { // New node
        const parent = dNode.parent as D3HierarchyNode | null;
        dNode.x0 = parent ? parent.x0 : dimensions.height / 2;
        dNode.y0 = parent ? parent.y0 : 0;
        if (dNode.depth > 1 && isInitialLoad) { // Collapse deeper nodes on initial load
          if (dNode.children) {
            dNode._children = dNode.children;
            dNode.children = undefined;
          }
        }
      }
      // Ensure the actively generating node and its new children are expanded
      if (activeNodeGeneratingMore && dNode.id === activeNodeGeneratingMore && dNode._children) {
        dNode.children = dNode._children;
        dNode._children = undefined;
        sourceForAnimation = dNode; // Animate from this node
      }
    });
    
    newRootHierarchy.x0 = dimensions.height / 2;
    newRootHierarchy.y0 = 0;
    d3State.current.root = newRootHierarchy;

    if (isInitialLoad) {
      if (newRootHierarchy.children) {
        newRootHierarchy.children.forEach(child => {
          if (child.children) collapseAllNodesRecursive(child as D3HierarchyNode, false);
        });
      }
      setIsFullyExpanded(false);
      d3State.current.initialLoadDone = true;

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = Math.min(0.7, dimensions.width / (newRootHierarchy.height * 220 + margin.left + margin.right + 100), dimensions.height / (newRootHierarchy.descendants().length * 35 + margin.top + margin.bottom + 50)); 
          const initialXTranslate = margin.left + 50; 
          const initialYTranslate = dimensions.height / 2;
          
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(initialZoomScale > 0 ? initialZoomScale : 0.5);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
          d3State.current.g.attr("transform", initialTransform.toString());
      }
      sourceForAnimation = newRootHierarchy;
    }
    
    updateChart(sourceForAnimation);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, fieldOfStudy]); // fieldOfStudy added to correctly detect initial load of a new tree


  useEffect(() => {
    if (!d3State.current.root || !d3State.current.g) return;
    let nodeChanged = false;
    let nodeToAnimateFrom: D3HierarchyNode | null = null;

    d3State.current.root.each(node => {
        const d = node as D3HierarchyNode;
        const shouldBeGenerating = activeNodeGeneratingMore === d.id;
        if (d.isGeneratingMore !== shouldBeGenerating) {
            d.isGeneratingMore = shouldBeGenerating;
            nodeChanged = true;
            nodeToAnimateFrom = d; 
        }
        // If loading just finished for this node, ensure it's expanded
        if (d.isGeneratingMore === false && activeNodeGeneratingMore === null && d.id === d3State.current.root?.descendants().find(n => (n as D3HierarchyNode).isGeneratingMore === true)?.id) {
           // This logic is tricky as activeNodeGeneratingMore is already null
           // Handled better by page.tsx triggering treeData update, then above useEffect handles expansion.
        }
    });
    
    // If loading completed (activeNodeGeneratingMore became null)
    if (activeNodeGeneratingMore === null && d3State.current.root) {
        const previouslyGeneratingNodeId = d3State.current.root.descendants().find(n => (n as D3HierarchyNode).isGeneratingMore === true)?.id;
        if (previouslyGeneratingNodeId) {
            const nodeThatFinished = d3State.current.root.descendants().find(n => n.id === previouslyGeneratingNodeId) as D3HierarchyNode | undefined;
            if (nodeThatFinished) {
                nodeThatFinished.isGeneratingMore = false;
                if (nodeThatFinished._children) { // Ensure it's expanded to show new children
                    nodeThatFinished.children = nodeThatFinished._children;
                    nodeThatFinished._children = undefined;
                }
                nodeChanged = true;
                nodeToAnimateFrom = nodeThatFinished;
            }
        }
    }


    if (nodeChanged && nodeToAnimateFrom) {
        updateChart(nodeToAnimateFrom);
    } else if (nodeChanged && !nodeToAnimateFrom && d3State.current.root) {
        updateChart(d3State.current.root); // Fallback if no specific node was targeted
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeGeneratingMore, updateChart]);


  return (
    <div ref={graphWrapperRef} style={{ width: '100%', height: '100%', position: 'relative' }} className="bg-background border border-border rounded-lg">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button variant="outline" size="sm" onClick={handleToggleExpandAll} title={isFullyExpanded ? "Collapse All Nodes" : "Expand All Nodes"} disabled={!treeData || !!activeNodeGeneratingMore || !!isProcessingAction}>
            {isFullyExpanded ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="sr-only">{isFullyExpanded ? "Collapse All Nodes" : "Expand All Nodes"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPng} title="Export as PNG" disabled={!treeData || !!activeNodeGeneratingMore || !!isProcessingAction}>
            <ImageIcon className="h-4 w-4" />
            <span className="sr-only">Export as PNG</span>
          </Button>
      </div>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }}></svg>
      <div
        ref={tooltipRef}
        className="d3-tooltip"
        style={{
          position: 'absolute',
          textAlign: 'left',
          padding: '6px 10px',
          font: '12px sans-serif',
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 'var(--radius)',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
          boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
          zIndex: 10,
          maxWidth: '250px',
        }}
      ></div>
    </div>
  );
}

    