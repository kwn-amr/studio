
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNodeData } from '@/types';
import { Button } from '@/components/ui/button';
import { ImageIcon, Minimize, Maximize, Loader2, PlusCircle } from 'lucide-react';
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
  isProcessingAction?: boolean; // True if initial tree generation is in progress
  activeNodeGeneratingMore: string | null; // ID of node currently having children generated
  setActiveNodeGeneratingMore: (id: string | null) => void; // To inform parent about loading state
}

// Helper to generate stable path-based ID
function generatePathId(d: d3.HierarchyNode<TreeNodeData>): string {
  return d.ancestors().map(n => n.data.name.replace(/[^\w\s-]/gi, '_')).reverse().join('/');
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
  // selectedNodeForMoreButton state has been removed

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
  const nodeRadius = 6;
  const loaderIconRadius = 8;


  const findNodeInHierarchy = useCallback((nodeId: string, hierarchyNode: D3HierarchyNode | null): D3HierarchyNode | null => {
    if (!hierarchyNode) return null;
    if (hierarchyNode.id === nodeId) return hierarchyNode;
    const childrenToSearch = hierarchyNode.children || hierarchyNode._children;
    if (childrenToSearch) {
      for (const child of childrenToSearch) {
        const found = findNodeInHierarchy(nodeId, child);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const updateChart = useCallback((sourceNodeParam?: D3HierarchyNode) => {
    if (!d3State.current.g || !d3State.current.root || !d3State.current.treeLayout || !tooltipRef.current || !graphWrapperRef.current) return;

    const g = d3State.current.g;
    let rootNode = d3State.current.root;
    const treeLayout = d3State.current.treeLayout;
    const tooltip = d3.select(tooltipRef.current);
    const currentGraphWrapper = graphWrapperRef.current;
    
    if (!rootNode) return;

    const treeDataLayout = treeLayout(rootNode);
    const nodes = treeDataLayout.descendants() as D3HierarchyNode[];
    const links = treeDataLayout.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    const effectiveSource = sourceNodeParam || rootNode;

    nodes.forEach(d => {
        if (!d.id) {
            d.id = generatePathId(d);
        }
    });

    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id);

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`)
      .on('click', async (event, dNode) => {
        let nodeWasExpanded = false;
        if (dNode.children) {
            dNode._children = dNode.children;
            dNode.children = undefined;
        } else if (dNode._children) {
            dNode.children = dNode._children;
            dNode._children = undefined;
            nodeWasExpanded = true;
        }
        
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction || dNode.isGeneratingMore) {
            if (nodeWasExpanded) updateChart(dNode); 
            return;
        }

        if (nodeWasExpanded || (!dNode.children && !dNode._children)) {
            dNode.isGeneratingMore = true;
            setActiveNodeGeneratingMore(dNode.id!); 
            updateChart(dNode); 

            try {
              const path: string[] = dNode.ancestors().map(n => n.data.name).reverse();
              await onGenerateMoreChildren(path, fieldOfStudy);
            } catch (err) {
              console.error("Error in onGenerateMoreChildren callback from D3 graph:", err);
              if (dNode.isGeneratingMore) {
                  dNode.isGeneratingMore = false;
              }
              // If the active node was this one, clear it.
              // The parent page.tsx is primarily responsible for clearing activeNodeGeneratingMore on success/failure.
              // This local reset is mainly for direct errors from the call.
              if (activeNodeGeneratingMore === dNode.id) {
                setActiveNodeGeneratingMore(null); 
              } else {
                 updateChart(dNode); 
              }
            }
        } else {
           updateChart(dNode); // If only collapsing, just update
        }
      })
      .on('mouseover', function(event, dNode) {
        if (dNode.isGeneratingMore) return;

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
        
        d3.select(this).select('circle.node-main-circle').classed('hovered', true);
        g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source === dNode || l.target === dNode);
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
      .style('display', 'none') // Initially hidden
      .attr('transform', `translate(0,0)`) 
      .style('pointer-events', 'none');

    loaderGroupEnter.append('circle')
      .attr('r', loaderIconRadius + 2) 
      .attr('class', 'node-loader-backdrop');

    loaderGroupEnter.append('path')
      .attr('d', Loader2.path)
      .attr('class', 'node-loader-spinner animate-spin')
      .attr('transform', `translate(${-loaderIconRadius / 1.5}, ${-loaderIconRadius / 1.5}) scale(0.6)`);


    nodeEnter.append('text')
      .attr('dy', '.35em');
      // x and text-anchor will be set in nodeUpdate

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
        if (d.isGeneratingMore) classes += ' node-loading';
        return classes;
      });
    
    nodeUpdate.select<SVGGElement>('.node-loader-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');
    
    nodeUpdate.select<SVGTextElement>('text')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1)
      .text(d => d.data.name);

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
      const backgroundColor = wrapperStyle.backgroundColor || 'hsl(var(--background))';
      
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

  const getContainerDimensions = useCallback(() => {
    if (graphWrapperRef.current) {
      const parent = graphWrapperRef.current;
      return {
        width: parent.clientWidth,
        height: parent.clientHeight,
      };
    }
    return { width: 600, height: 400 };
  }, []);

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
        
        if (d3State.current.root && d3State.current.g && d3State.current.svg && d3State.current.zoomBehavior) {
            const { margin } = d3State.current;
            const initialXTranslate = margin.left + 50; 
            const initialYTranslate = height / 2;
            const currentTransform = d3.zoomTransform(d3State.current.svg.node()!);
            
            const newTransform = d3.zoomIdentity
                .translate(initialXTranslate, initialYTranslate)
                .scale(currentTransform.k); 

            d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
            updateChart(d3State.current.root);
        } else if (d3State.current.root) {
           updateChart(d3State.current.root);
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
  }, [getContainerDimensions, updateChart]); 


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

    const { margin, dimensions } = d3State.current;
    const oldRoot = d3State.current.root;
    const isInitialLoad = !oldRoot || oldRoot.data.name !== treeData.name || (fieldOfStudy !== oldRoot.data.name && oldRoot.data.name !== treeData.name);

    // Map old node states before creating new hierarchy
    const oldNodeStates = new Map<string, { isCollapsed: boolean, x0?: number, y0?: number }>();
    if (oldRoot && !isInitialLoad) {
        oldRoot.eachBefore(node => {
            const dNode = node as D3HierarchyNode;
            oldNodeStates.set(dNode.id, {
                isCollapsed: !!dNode._children && !dNode.children,
                x0: dNode.x0,
                y0: dNode.y0
            });
        });
    }
    
    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    newRootHierarchy.x0 = oldRoot?.x0 || dimensions.height / 2;
    newRootHierarchy.y0 = oldRoot?.y0 || 0;
    
    newRootHierarchy.eachBefore(dNode => {
        dNode.id = generatePathId(dNode);
        dNode.isGeneratingMore = dNode.id === activeNodeGeneratingMore;

        const oldState = oldNodeStates.get(dNode.id);
        if (oldState) {
            dNode.x0 = oldState.x0;
            dNode.y0 = oldState.y0;
            if (oldState.isCollapsed && dNode.children) {
                dNode._children = dNode.children;
                dNode.children = undefined;
            }
        } else { // New node
            const parent = dNode.parent as D3HierarchyNode | null;
            dNode.x0 = parent ? parent.x0 : newRootHierarchy.x0;
            dNode.y0 = parent ? parent.y0 : newRootHierarchy.y0;
            if (isInitialLoad && dNode.depth > 1 && dNode.children) { // Collapse deep on initial
                dNode._children = dNode.children;
                dNode.children = undefined;
            }
        }
    });
    
    d3State.current.root = newRootHierarchy;
    let sourceForAnimation: D3HierarchyNode = newRootHierarchy;

    if (isInitialLoad) {
      if (newRootHierarchy.children) {
        newRootHierarchy.children.forEach(child => collapseAllNodesRecursive(child as D3HierarchyNode, false));
      }
      setIsFullyExpanded(false);

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = Math.min(0.7, 
              dimensions.width / (newRootHierarchy.height * 250 + margin.left + margin.right), 
              dimensions.height / (newRootHierarchy.descendants().length * 40 + margin.top + margin.bottom)
          );
          const initialXTranslate = margin.left + 50; 
          const initialYTranslate = dimensions.height / 2;
          
          const effectiveScale = Math.max(0.1, initialZoomScale > 0 ? initialZoomScale : 0.4);
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(effectiveScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
      }
    } else if (activeNodeGeneratingMore) { // If update due to "generate more"
        const activeNode = findNodeInHierarchy(activeNodeGeneratingMore, newRootHierarchy);
        if (activeNode) {
            sourceForAnimation = activeNode;
             // Ensure this node is expanded if children were added
            if (activeNode._children && activeNode.data.children && activeNode.data.children.length > 0) {
                activeNode.children = activeNode._children;
                activeNode._children = undefined;
            }
        }
    }
    updateChart(sourceForAnimation);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, fieldOfStudy]); // Removed activeNodeGeneratingMore, findNodeInHierarchy, updateChart from deps


  useEffect(() => {
    if (!d3State.current.root || !d3State.current.g) return;
    let nodeChanged = false;
    let animationSourceNode: D3HierarchyNode | null = null;

    d3State.current.root.each(node => {
        const d3Node = node as D3HierarchyNode;
        const shouldBeGenerating = activeNodeGeneratingMore === d3Node.id;
        
        if (d3Node.isGeneratingMore !== shouldBeGenerating) {
            d3Node.isGeneratingMore = shouldBeGenerating;
            nodeChanged = true;
            animationSourceNode = d3Node; // Animate from the node changing state
        }

        // If loading finished for this node (activeNodeGeneratingMore became null)
        // AND this node was the one loading, ensure it's expanded
        if (!activeNodeGeneratingMore && d3Node.isGeneratingMore === false && d3Node.id === d3State.current.root?.lastGeneratingNodeId) {
             if (d3Node._children && d3Node.data.children && d3Node.data.children.length > 0) {
                d3Node.children = d3Node._children;
                d3Node._children = undefined;
                nodeChanged = true; 
                animationSourceNode = d3Node;
            }
        }
    });

    // Store the last active node ID on the root for the next check
    if (activeNodeGeneratingMore) {
        (d3State.current.root as any).lastGeneratingNodeId = activeNodeGeneratingMore;
    } else if (d3State.current.root) {
        delete (d3State.current.root as any).lastGeneratingNodeId;
    }


    if (nodeChanged) {
        updateChart(animationSourceNode || d3State.current.root);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeGeneratingMore]); // findNodeInHierarchy, updateChart removed

  return (
    <div ref={graphWrapperRef} style={{ width: '100%', height: '100%', position: 'relative' }} className="bg-background border border-border rounded-lg">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleToggleExpandAll} 
            title={isFullyExpanded ? "Collapse Sub-Levels" : "Expand All Nodes"} 
            disabled={!treeData || !!activeNodeGeneratingMore || !!isProcessingAction}
          >
            {isFullyExpanded ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="sr-only">{isFullyExpanded ? "Collapse Sub-Levels" : "Expand All Nodes"}</span>
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportPng} 
            title="Export as PNG" 
            disabled={!treeData || !!activeNodeGeneratingMore || !!isProcessingAction}
          >
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

