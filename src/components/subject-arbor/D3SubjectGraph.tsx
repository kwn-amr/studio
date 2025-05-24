"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
// Assuming TreeNodeData is defined in '@/types' like:
// export interface TreeNodeData {
//   name: string;
//   description?: string;
//   children?: TreeNodeData[];
//   // other properties
// }
import type { TreeNodeData } from '@/types';
import { Button } from '@/components/ui/button'; // Assuming Shadcn/UI or similar
import { ImageIcon, Minimize, Maximize, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';

export interface D3HierarchyNode extends d3.HierarchyPointNode<TreeNodeData> {
  _children?: D3HierarchyNode[];
  children?: D3HierarchyNode[];
  x0?: number;
  y0?: number;
  id: string; // Ensure id is always string
  isGeneratingMore?: boolean; // Local D3 flag for loading state
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string | null;
  onGenerateMoreChildren: (path: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // Global loading state (e.g., initial tree load)
  activeNodeGeneratingMore: string | null; // ID of node whose children are being loaded
  setActiveNodeGeneratingMore: (id: string | null) => void; // Function to update parent's loading state
}

// Helper to generate a stable ID based on path
function generatePathId(d: d3.HierarchyNode<TreeNodeData>): string {
  return d.ancestors().map(node => node.data.name.replace(/[^\w\s-]/gi, '_')).reverse().join('/');
}

// Helper to find a node by ID in the D3 hierarchy
function findNodeInHierarchy(node: D3HierarchyNode | null, id: string): D3HierarchyNode | null {
  if (!node) return null;
  if (node.id === id) return node;
  const childrenToSearch = node.children || node._children;
  if (childrenToSearch) {
    for (const child of childrenToSearch) {
      const found = findNodeInHierarchy(child, id);
      if (found) return found;
    }
  }
  return null;
}


export function D3SubjectGraph({
  treeData,
  fieldOfStudy,
  onGenerateMoreChildren,
  isProcessingAction,
  activeNodeGeneratingMore,
  setActiveNodeGeneratingMore,
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
  }>({
    svg: null,
    g: null,
    root: null,
    treeLayout: null,
    zoomBehavior: null,
    dimensions: {width: 0, height: 0},
    margin: { top: 20, right: 180, bottom: 20, left: 120 }
  });

  const animationDuration = 750;
  const nodeRadius = typeof document !== 'undefined' 
    ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--node-radius')) || 6 
    : 6;
  const loaderIconRadius = nodeRadius + 2;


  const updateNodeVisualState = useCallback((nodeSelection: d3.Selection<SVGGElement, D3HierarchyNode, SVGGElement, unknown>) => {
    nodeSelection.select<SVGCircleElement>('circle.node-main-circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = 'node-main-circle ';
        classes += (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        if (d.isGeneratingMore) classes += ' node-loading';
        return classes;
      });

    nodeSelection.select<SVGGElement>('.node-loader-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');
    
    nodeSelection.select<SVGTextElement>('text')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 12) : (nodeRadius + 12)) 
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1)
      .text(d => d.data.name);
  }, [nodeRadius]);


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

    nodes.forEach(d => {
        if (d.id === undefined) d.id = generatePathId(d);
        if (d.x0 === undefined) d.x0 = effectiveSource.x0 !== undefined ? effectiveSource.x0 : d.x;
        if (d.y0 === undefined) d.y0 = effectiveSource.y0 !== undefined ? effectiveSource.y0 : d.y;
    });

    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id);

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`);

    nodeEnter.append('circle')
      .attr('class', 'node-main-circle')
      .attr('r', 1e-6); 

    const loaderGroupEnter = nodeEnter.append('g')
      .attr('class', 'node-loader-group')
      .style('pointer-events', 'none');
      
    loaderGroupEnter.append('circle')
      .attr('r', loaderIconRadius + 2)
      .attr('class', 'node-loader-backdrop');

    loaderGroupEnter.append('path')
        .attr('d', Loader2.path) 
        .attr('class', 'node-loader-spinner animate-spin')
        .attr('transform', `translate(${-loaderIconRadius/1.5}, ${-loaderIconRadius/1.5}) scale(0.6)`);

    nodeEnter.append('text')
      .attr('dy', '.35em');

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate
      .on('click', async (event, dNode: D3HierarchyNode) => {
        let nodeWasExpanded = !!dNode.children;
        let nodeWasCollapsedWithChildren = !dNode.children && !!dNode._children;
        let nodeWasJustExpanded = false;
        
        if (nodeWasExpanded) { 
            dNode._children = dNode.children;
            dNode.children = undefined;
            if (activeNodeGeneratingMore === dNode.id) { 
                if (typeof setActiveNodeGeneratingMore === 'function') {
                    setActiveNodeGeneratingMore(null);
                } else {
                    console.error("D3SubjectGraph Error: setActiveNodeGeneratingMore is not a function when trying to clear active node on collapse.", { nodeId: dNode.id, propValue: setActiveNodeGeneratingMore });
                }
                dNode.isGeneratingMore = false;
            }
        } else if (nodeWasCollapsedWithChildren) { 
            dNode.children = dNode._children;
            dNode._children = undefined;
            nodeWasJustExpanded = true;
        }

        updateNodeVisualState(nodeUpdate.filter(n => n.id === dNode.id));
        updateChart(dNode); 

        if (nodeWasExpanded && !nodeWasJustExpanded) { 
            return;
        }
        
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction || dNode.isGeneratingMore) {
            if (nodeWasJustExpanded) updateChart(dNode); 
            return;
        }
        
        const shouldGenerateMore = (!dNode.children && !dNode._children) || nodeWasJustExpanded;

        if (shouldGenerateMore) {
            if (!fieldOfStudy) {
                console.warn("D3SubjectGraph: Field of study is not set, cannot generate more children.");
                return;
            }
            dNode.isGeneratingMore = true;
            if (typeof setActiveNodeGeneratingMore === 'function') {
                setActiveNodeGeneratingMore(dNode.id); 
            } else {
                console.error("D3SubjectGraph Error: setActiveNodeGeneratingMore is not a function when trying to set active node.", { nodeId: dNode.id, propValue: setActiveNodeGeneratingMore });
            }
            updateChart(dNode); 

            try {
                const path = dNode.ancestors().map(n => n.data.name).reverse();
                await onGenerateMoreChildren(path, fieldOfStudy);
            } catch (err) {
                console.error("D3SubjectGraph: Error in onGenerateMoreChildren callback from D3 graph click:", err);
                if (dNode.isGeneratingMore) { 
                    dNode.isGeneratingMore = false;
                }
                if (typeof setActiveNodeGeneratingMore === 'function') {
                    if (activeNodeGeneratingMore === dNode.id) { 
                        setActiveNodeGeneratingMore(null); 
                    } else { 
                        updateChart(dNode);
                    }
                } else {
                     console.error("D3SubjectGraph Error: setActiveNodeGeneratingMore is not a function during error handling in onGenerateMoreChildren.", { nodeId: dNode.id, propValue: setActiveNodeGeneratingMore });
                     updateChart(dNode); 
                }
            }
        }
      })
      .on('mouseover', function(event, dNode) { 
        if (dNode.isGeneratingMore || !tooltipRef.current || !graphWrapperRef.current) return;

        const [mx, my] = d3.pointer(event, graphWrapperRef.current);
        let tooltipContent = `<strong>${dNode.data.name}</strong>`;
        if (dNode.data.description && dNode.data.description.trim() !== '') {
            tooltipContent += `<br><small style="display: block; margin-top: 4px; color: hsl(var(--muted-foreground));">${dNode.data.description.trim()}</small>`;
        }
        
        const tooltipSelection = d3.select(tooltipRef.current);
        tooltipSelection.html(tooltipContent)
              .style('opacity', 1);

        const tooltipNodeEl = tooltipSelection.node() as HTMLDivElement;
        const tooltipWidth = tooltipNodeEl.offsetWidth;
        const tooltipHeight = tooltipNodeEl.offsetHeight;
        const wrapperWidth = graphWrapperRef.current.clientWidth;
        const wrapperHeight = graphWrapperRef.current.clientHeight;

        let left = mx + 15;
        let top = my + 10;

        if (left + tooltipWidth + 10 > wrapperWidth) left = mx - tooltipWidth - 15;
        if (left < 5) left = 5;
        if (top + tooltipHeight + 10 > wrapperHeight) top = my - tooltipHeight - 10;
        if (top < 5) top = 5;

        tooltipSelection.style('left', `${left}px`).style('top', `${top}px`);
        d3.select(this as SVGGElement).select('circle.node-main-circle').classed('hovered', true);
        g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source.id === dNode.id || l.target.id === dNode.id);
      })
      .on('mouseout', function() { 
        if (tooltipRef.current) {
            d3.select(tooltipRef.current).style('opacity', 0);
        }
        d3.select(this as SVGGElement).select('circle.node-main-circle').classed('hovered', false);
        g.selectAll('path.link').classed('highlighted', false);
      });

    nodeUpdate.transition()
      .duration(animationDuration)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    updateNodeVisualState(nodeUpdate); 

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
        return d3.linkHorizontal<unknown, {x:number, y:number}>()
          .x(dVal => dVal.y).y(dVal => dVal.x)({ source: o, target: o });
      });

    linkEnter.merge(link)
      .transition()
      .duration(animationDuration)
      .attr('d', d3.linkHorizontal<any, D3HierarchyNode>() 
          .x(dVal => dVal.y!)
          .y(dVal => dVal.x!)
      );

    link.exit().transition()
      .duration(animationDuration)
      .attr('d', () => {
        const o = { x: effectiveSource.x || 0, y: effectiveSource.y || 0 };
        return d3.linkHorizontal<unknown, {x:number, y:number}>()
          .x(dVal => dVal.y).y(dVal => dVal.x)({ source: o, target: o });
      })
      .remove();

    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }, [
      fieldOfStudy, onGenerateMoreChildren, isProcessingAction, 
      updateNodeVisualState, setActiveNodeGeneratingMore, activeNodeGeneratingMore, 
      animationDuration, loaderIconRadius, nodeRadius
    ]);


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
      const backgroundColor = wrapperStyle.backgroundColor || (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--background') : 'white');

      toPng(svgRef.current, { backgroundColor, pixelRatio: 2 })
        .then((dataUrl) => {
          const link = document.createElement('a');
          const safeFieldOfStudy = (fieldOfStudy || "subject_graph").replace(/\s+/g, '_').toLowerCase();
          link.download = `${safeFieldOfStudy}.png`;
          link.href = dataUrl;
          link.click();
        })
        .catch((err) => {
          console.error('D3SubjectGraph: Failed to export PNG:', err);
        });
    }
  }, [fieldOfStudy, activeNodeGeneratingMore, isProcessingAction]);

  const getContainerDimensions = useCallback(() => {
    if (graphWrapperRef.current) {
      return {
        width: graphWrapperRef.current.clientWidth,
        height: graphWrapperRef.current.clientHeight,
      };
    }
    return { width: 600, height: 400 }; 
  }, []);


  useEffect(() => { 
    const initOrResize = () => {
        if (!svgRef.current || !graphWrapperRef.current || typeof window === 'undefined') return;
        
        d3State.current.dimensions = getContainerDimensions();
        const { width, height } = d3State.current.dimensions;

        const svg = d3.select(svgRef.current).attr('width', width).attr('height', height);

        if (!d3State.current.svg) { 
            d3State.current.svg = svg;
            d3State.current.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
                .scaleExtent([0.05, 5])
                .on('zoom', (event) => {
                    if (d3State.current.g) d3State.current.g.attr('transform', event.transform);
                });
            svg.call(d3State.current.zoomBehavior);
            d3State.current.g = svg.append('g');
            // MODIFIED: Increased vertical separation in nodeSize from nodeRadius * 6 to nodeRadius * 10
            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([nodeRadius * 10, 220]); 
        } else {
            // If already initialized, ensure treeLayout is updated if nodeRadius changed dynamically (though unlikely for this setup)
            // Or if you want to make nodeSize responsive beyond initial setup:
             d3State.current.treeLayout?.nodeSize([nodeRadius * 10, 220]);
        }

        if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
            const { margin } = d3State.current;
            const initialXTranslate = margin.left + 50;
            const initialYTranslate = height / 2;
            
            let currentTransform = d3.zoomTransform(d3State.current.svg.node()!);
            const isInitialSetup = currentTransform.k === 1 && currentTransform.x === 0 && currentTransform.y === 0;

            if (isInitialSetup || !d3State.current.root) {
                 const newTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(0.7);
                 d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
                 if (d3State.current.g) d3State.current.g.attr('transform', newTransform.toString());
            } else if (d3State.current.root) { 
                // On resize, if already initialized, we want to update the chart with current layout settings
                updateChart(d3State.current.root);
            }
        }
    };

    initOrResize(); 

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && graphWrapperRef.current) {
        resizeObserver = new ResizeObserver(initOrResize);
        resizeObserver.observe(graphWrapperRef.current);
    } else if (typeof window !== 'undefined') {
        window.addEventListener('resize', initOrResize);
    }

    return () => {
        if (resizeObserver && graphWrapperRef.current) resizeObserver.unobserve(graphWrapperRef.current);
        if (resizeObserver) resizeObserver.disconnect();
        if (typeof window !== 'undefined') window.removeEventListener('resize', initOrResize);
    };
  }, [getContainerDimensions, updateChart, nodeRadius]);


  useEffect(() => { 
    if (!d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g && !treeData) { 
          d3State.current.g.selectAll("*").remove();
          d3State.current.root = null;
      }
      return;
    }

    if (!treeData) { 
        if (d3State.current.g) d3State.current.g.selectAll("*").remove();
        d3State.current.root = null;
        return;
    }

    const oldRoot = d3State.current.root;
    const isNewFieldOfStudy = fieldOfStudy && oldRoot && oldRoot.data.name !== fieldOfStudy && treeData.name === fieldOfStudy;
    const isRootNameChanged = oldRoot && oldRoot.data.name !== treeData.name && !isNewFieldOfStudy;
    const isInitialLoad = !oldRoot || isNewFieldOfStudy || isRootNameChanged;
    
    const { margin, dimensions } = d3State.current;
    const initialX0 = dimensions.height / 2; 
    const initialY0 = margin.left + 50; 

    const oldNodeStates = new Map<string, { isCollapsed: boolean, x0: number, y0: number, isGeneratingMore?: boolean }>();
    if (oldRoot && !isInitialLoad) {
        oldRoot.eachBefore(node => {
            const d3Node = node as D3HierarchyNode;
            if (d3Node.id) { 
                oldNodeStates.set(d3Node.id, {
                    isCollapsed: !!d3Node._children && !d3Node.children,
                    x0: d3Node.x0 !== undefined ? d3Node.x0 : d3Node.x,
                    y0: d3Node.y0 !== undefined ? d3Node.y0 : d3Node.y,
                    isGeneratingMore: d3Node.isGeneratingMore
                });
            }
        });
    }
    
    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    newRootHierarchy.x0 = oldRoot && !isInitialLoad ? oldRoot.x0 : initialX0;
    newRootHierarchy.y0 = oldRoot && !isInitialLoad ? oldRoot.y0 : initialY0;
    
    let sourceForAnimation: D3HierarchyNode = newRootHierarchy;

    newRootHierarchy.eachBefore((dNodeUntyped) => {
        const dNode = dNodeUntyped as D3HierarchyNode;
        dNode.id = generatePathId(dNode);
        const oldState = oldNodeStates.get(dNode.id);

        if (oldState && !isInitialLoad) { 
            dNode.x0 = oldState.x0;
            dNode.y0 = oldState.y0;
            dNode.isGeneratingMore = oldState.isGeneratingMore;
            if (oldState.isCollapsed && dNode.children) {
                dNode._children = dNode.children;
                dNode.children = undefined;
            }
        } else { 
            const parentD3Node = dNode.parent as D3HierarchyNode | null;
            dNode.x0 = parentD3Node?.x0 !== undefined ? parentD3Node.x0 : newRootHierarchy.x0;
            dNode.y0 = parentD3Node?.y0 !== undefined ? parentD3Node.y0 : newRootHierarchy.y0;
            if (dNode.depth > 1 && dNode.children) {
                if(isInitialLoad || (dNode.parent && dNode.parent.id !== activeNodeGeneratingMore)){ 
                    dNode._children = dNode.children;
                    dNode.children = undefined;
                }
            }
        }
        if (dNode.id === activeNodeGeneratingMore) {
            if (dNode._children && !dNode.children) { 
                dNode.children = dNode._children;
                dNode._children = undefined;
            }
            dNode.isGeneratingMore = true; 
        } else if (dNode.isGeneratingMore && dNode.id !== activeNodeGeneratingMore) {
            dNode.isGeneratingMore = false;
        }
    });
    
    d3State.current.root = newRootHierarchy;

    if (isInitialLoad) {
      if (newRootHierarchy.children) { 
        newRootHierarchy.children.forEach(child => {
          collapseAllNodesRecursive(child as D3HierarchyNode, false); 
        });
      }
      setIsFullyExpanded(false); 

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const calculatedScale = 0.7; 
          const targetX = initialY0; 
          const targetY = initialX0;
          const initialTransform = d3.zoomIdentity.translate(targetX, targetY).scale(calculatedScale);
          
          d3State.current.svg.transition().duration(animationDuration)
              .call(d3State.current.zoomBehavior.transform, initialTransform);
      }
      sourceForAnimation = newRootHierarchy; 
    } else {
        const activeNodeInNewHierarchy = activeNodeGeneratingMore ? findNodeInHierarchy(newRootHierarchy, activeNodeGeneratingMore) : null;
        sourceForAnimation = activeNodeInNewHierarchy || newRootHierarchy;
    }
    updateChart(sourceForAnimation);
  }, [treeData, fieldOfStudy, collapseAllNodesRecursive, updateChart, activeNodeGeneratingMore, animationDuration]);


  useEffect(() => { 
    if (!d3State.current.root || !d3State.current.g) return;
    
    let visualChangeRequired = false;
    let nodeToUpdateFrom: D3HierarchyNode | null = null;

    d3State.current.root.each(dNodeUntyped => {
        const dNode = dNodeUntyped as D3HierarchyNode;
        const shouldBeGenerating = activeNodeGeneratingMore === dNode.id;

        if (dNode.isGeneratingMore !== shouldBeGenerating) {
            dNode.isGeneratingMore = shouldBeGenerating;
            visualChangeRequired = true;
            if (!nodeToUpdateFrom || (dNode.depth > (nodeToUpdateFrom.depth || -1))) {
                nodeToUpdateFrom = dNode; 
            }
        }
    });
    
    if (visualChangeRequired) {
        updateChart(nodeToUpdateFrom || d3State.current.root);
    }
  }, [activeNodeGeneratingMore, updateChart]);


  return (
    <div ref={graphWrapperRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }} className="bg-background border border-border rounded-lg">
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
          wordWrap: 'break-word',
        }}
      ></div>
    </div>
  );
}