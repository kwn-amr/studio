
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
  id: string; // Ensure id is always string
  isGeneratingMore?: boolean; // Local D3 flag for loading state
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string | null;
  onGenerateMoreChildren: (path: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // This is when the initial tree is loading (not "generate more")
  activeNodeGeneratingMore: string | null; // ID of node currently generating more, or null
  setActiveNodeGeneratingMore: (id: string | null) => void; // Function to set the above ID
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
  const nodeRadius = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--node-radius')) || 6;
  const loaderIconRadius = nodeRadius + 2;


  const updateNodeVisualState = useCallback((nodeSelection: d3.Selection<SVGGElement, D3HierarchyNode, SVGGElement, unknown>) => {
    nodeSelection.select<SVGCircleElement>('circle.node-main-circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = 'node-main-circle ';
        classes += (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        if (d.isGeneratingMore) classes += ' node-loading'; // Class to dim circle via CSS
        return classes;
      });

    nodeSelection.select<SVGGElement>('.node-loader-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');
    
    nodeSelection.select<SVGTextElement>('text')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1) // Dim text if loading
      .text(d => d.data.name);
  }, [nodeRadius, loaderIconRadius]); // Removed animationDuration as it wasn't directly used here


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
        if (d.id === undefined) d.id = generatePathId(d); // Should be set by now, but good fallback
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
      
    loaderGroupEnter.append('circle') // Backdrop for loader icon
      .attr('r', loaderIconRadius + 2) // Slightly larger than the icon
      .attr('class', 'node-loader-backdrop');

    loaderGroupEnter.append('path')
        .attr('d', Loader2.path)
        .attr('class', 'node-loader-spinner animate-spin') // For CSS animation
        .attr('transform', `translate(${-loaderIconRadius/1.5}, ${-loaderIconRadius/1.5}) scale(0.6)`); // Adjust size/position

    nodeEnter.append('text')
      .attr('dy', '.35em');

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate
      .on('click', async (event, dNode: D3HierarchyNode) => {
        let nodeWasExpanded = !!dNode.children;
        let nodeWasCollapsedWithChildren = !dNode.children && !!dNode._children;
        let nodeWasJustExpanded = false;
        
        // 1. Toggle expansion/collapse state
        if (nodeWasExpanded) { // Node is currently expanded, so collapse it
            dNode._children = dNode.children;
            dNode.children = undefined;
            if (activeNodeGeneratingMore === dNode.id) { // If collapsing the loading node
                setActiveNodeGeneratingMore(null); // Cancel generation
                dNode.isGeneratingMore = false; // Reset local flag
            }
        } else if (nodeWasCollapsedWithChildren) { // Node is currently collapsed with children, so expand it
            dNode.children = dNode._children;
            dNode._children = undefined;
            nodeWasJustExpanded = true;
        }
        // For true leaves, children and _children remain undefined

        // Update chart immediately for toggle
        updateNodeVisualState(nodeUpdate.filter(n => n.id === dNode.id)); // Update only the clicked node's visuals first for responsiveness
        updateChart(dNode); // Then update the whole chart for layout changes

        // 2. Check if we should proceed to "generate more"
        // Do not generate more if the click was just to collapse an already expanded node
        if (nodeWasExpanded && !nodeWasJustExpanded) {
            return;
        }
        
        // Prevent re-triggering if already generating for this node or globally
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction || dNode.isGeneratingMore) {
            if (nodeWasJustExpanded) updateChart(dNode); // ensure expansion is shown if we return early
            return;
        }
        
        const shouldGenerateMore = (!nodeWasExpanded && !nodeWasCollapsedWithChildren) || nodeWasJustExpanded;

        if (shouldGenerateMore) {
            if (!fieldOfStudy) {
                console.warn("Field of study is not set, cannot generate more children.");
                return;
            }
            // 3. Set loading state and initiate "generate more"
            dNode.isGeneratingMore = true;
            setActiveNodeGeneratingMore(dNode.id!); 
            updateChart(dNode); // Update to show expansion (if nodeWasExpanded) AND loader icon

            try {
                const path = dNode.ancestors().map(n => n.data.name).reverse();
                await onGenerateMoreChildren(path, fieldOfStudy);
                // setActiveNodeGeneratingMore(null) will be called by parent via prop useEffect if successful
            } catch (err) {
                console.error("Error in onGenerateMoreChildren from D3 graph click:", err);
                if (dNode.isGeneratingMore) { 
                    dNode.isGeneratingMore = false;
                }
                if (activeNodeGeneratingMore === dNode.id) { 
                    setActiveNodeGeneratingMore(null); 
                } else { 
                   updateChart(dNode);
                }
            }
        }
      })
      .on('mouseover', function(event, dNode) {
        if (dNode.isGeneratingMore) return; // Don't show tooltip if node is loading

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

        // Adjust if tooltip goes off-screen
        if (left + tooltipWidth + 10 > wrapperWidth) { // +10 for some padding from edge
            left = mx - tooltipWidth - 15;
        }
        if (left < 5) left = 5; // Ensure it's not too far left

        if (top + tooltipHeight + 10 > wrapperHeight) { // +10 for some padding from edge
            top = my - tooltipHeight - 10; // Place above cursor
        }
        if (top < 5) top = 5; // Ensure it's not too far up


        tooltip.style('left', left + 'px')
               .style('top', top + 'px');

        d3.select(this).select('circle.node-main-circle').classed('hovered', true);
        g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source.id === dNode.id || l.target.id === dNode.id);
      })
      .on('mouseout', function() {
        tooltip.style('opacity', 0);
        d3.select(this).select('circle.node-main-circle').classed('hovered', false);
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
  }, [fieldOfStudy, onGenerateMoreChildren, isProcessingAction, updateNodeVisualState, setActiveNodeGeneratingMore, activeNodeGeneratingMore, animationDuration, loaderIconRadius]);


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
      collapseAllNodesRecursive(d3State.current.root, true); // Keep first level expanded
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
          const safeFieldOfStudy = (fieldOfStudy || "subject_arbor").replace(/\s+/g, '_').toLowerCase();
          link.download = `${safeFieldOfStudy}_graph.png`;
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
    return { width: 600, height: 400 }; // Default dimensions
  }, []);


  useEffect(() => {
    const initOrResize = () => {
        if (!svgRef.current || !graphWrapperRef.current) return;
        d3State.current.dimensions = getContainerDimensions();
        const { width, height } = d3State.current.dimensions;

        const svg = d3.select(svgRef.current)
            .attr('width', width)
            .attr('height', height);

        if (!d3State.current.svg) { // Initialize only once
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
            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]); // Use nodeSize for consistent spacing
        }

        // Center graph on initial load or resize if root exists
        if (d3State.current.root && d3State.current.svg && d3State.current.zoomBehavior) {
            const { margin } = d3State.current;
            const initialXTranslate = margin.left + 50; // Initial horizontal offset
            const initialYTranslate = height / 2;    // Center vertically

            const currentTransform = d3.zoomTransform(d3State.current.svg.node()!);
            let newTransform = d3.zoomIdentity
                .translate(initialXTranslate, initialYTranslate)
                .scale(currentTransform.k); 
            
            if (newTransform.k <= 0.05) { // If scale is too small (e.g. 0), reset to a default
                 newTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(0.7);
            }

            d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
        }
    };

    initOrResize(); // Call once on mount

    const resizeObserver = new ResizeObserver(initOrResize);
    if (graphWrapperRef.current) {
      resizeObserver.observe(graphWrapperRef.current);
    }

    return () => {
      if (graphWrapperRef.current) {
        resizeObserver.unobserve(graphWrapperRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [getContainerDimensions]);


  useEffect(() => {
    if (!d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g && !treeData) { // If no treeData, clear the graph
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
    const isInitialLoad = !oldRoot || (fieldOfStudy && oldRoot.data.name !== fieldOfStudy) || (oldRoot && oldRoot.data.name !== treeData.name);
    
    const { margin, dimensions } = d3State.current;
    const initialX0 = dimensions.height / 2;
    const initialY0 = 0;

    // Preserve expanded/collapsed state and positions
    const oldNodeStates = new Map<string, { isCollapsed: boolean, x0: number, y0: number }>();
    if (oldRoot && !isInitialLoad) {
        oldRoot.eachBefore(node => {
            const d3Node = node as D3HierarchyNode;
            if (d3Node.id) { 
                oldNodeStates.set(d3Node.id, {
                    isCollapsed: !!d3Node._children && !d3Node.children,
                    x0: d3Node.x0 !== undefined ? d3Node.x0 : d3Node.x,
                    y0: d3Node.y0 !== undefined ? d3Node.y0 : d3Node.y
                });
            }
        });
    }
    
    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    newRootHierarchy.x0 = oldRoot?.x0 ?? initialX0;
    newRootHierarchy.y0 = oldRoot?.y0 ?? initialY0;
    
    let sourceForAnimation: D3HierarchyNode = newRootHierarchy;

    newRootHierarchy.eachBefore((dNodeUntyped) => {
        const dNode = dNodeUntyped as D3HierarchyNode;
        dNode.id = generatePathId(dNode);
        const oldState = oldNodeStates.get(dNode.id);

        if (oldState) {
            dNode.x0 = oldState.x0;
            dNode.y0 = oldState.y0;
            if (oldState.isCollapsed && dNode.children) {
                dNode._children = dNode.children;
                dNode.children = undefined;
            } else if (!oldState.isCollapsed && dNode.children) {
                dNode._children = undefined; // Ensure it's expanded if it was
            } else if (!oldState.isCollapsed && dNode._children && !dNode.children && dNode._children.length > 0) {
                 // This specific case: old was expanded, new data might have it implicitly collapsed
                 // by d3.hierarchy if children array from treeData was empty but some _children exist from oldState.
                 // We want to ensure if it was expanded, it tries to stay expanded if new children were added.
                 // The more robust way is just after this loop, check activeNodeGeneratingMore.
            }
        } else { // New node
            const parentD3Node = dNode.parent as D3HierarchyNode | null;
            dNode.x0 = parentD3Node?.x0 !== undefined ? parentD3Node.x0 : newRootHierarchy.x0;
            dNode.y0 = parentD3Node?.y0 !== undefined ? parentD3Node.y0 : newRootHierarchy.y0;
            // Default collapse deeper nodes
            if (dNode.depth > 1 && dNode.children) {
                 if(isInitialLoad || dNode.parent?.id !== activeNodeGeneratingMore){ // Only collapse if not part of the active generation
                    dNode._children = dNode.children;
                    dNode.children = undefined;
                 }
            }
        }
        // If this is the node that was just expanded to add more children, ensure it's expanded
        if (dNode.id === activeNodeGeneratingMore && dNode._children) {
            dNode.children = dNode._children;
            dNode._children = undefined;
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
          const initialXTranslate = margin.left + 50;
          const initialYTranslate = dimensions.height / 2;
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(calculatedScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
          d3State.current.g.attr("transform", initialTransform.toString()); // Apply transform to g element
      }
      sourceForAnimation = newRootHierarchy; // Animate from root for initial load
    } else {
        // Not an initial load, determine animation source
        const activeNodeInNewHierarchy = activeNodeGeneratingMore ? findNodeInHierarchy(newRootHierarchy, activeNodeGeneratingMore) : null;
        if (activeNodeInNewHierarchy) {
            sourceForAnimation = activeNodeInNewHierarchy;
            // Ensure this active node is expanded if it now has children (already handled in eachBefore)
        } else {
            sourceForAnimation = newRootHierarchy; // Default to root if no specific active node
        }
    }
    updateChart(sourceForAnimation);
  }, [treeData, fieldOfStudy, collapseAllNodesRecursive, getContainerDimensions, updateChart, activeNodeGeneratingMore ]); // Added activeNodeGeneratingMore


  // Effect to sync D3 node's .isGeneratingMore with activeNodeGeneratingMore prop
  useEffect(() => {
    if (!d3State.current.root || !d3State.current.g) return;
    let nodeVisualStateChanged = false;
    let animationSourceNode: D3HierarchyNode | null = null;

    // Sync D3 node's .isGeneratingMore with activeNodeGeneratingMore prop
    d3State.current.root.each(dNodeUntyped => {
        const dNode = dNodeUntyped as D3HierarchyNode;
        const shouldBeGenerating = activeNodeGeneratingMore === dNode.id;

        if (dNode.isGeneratingMore !== shouldBeGenerating) {
            dNode.isGeneratingMore = shouldBeGenerating;
            nodeVisualStateChanged = true;
            // Prefer the deepest node that changed state as animation source
            if (!animationSourceNode || (dNode.depth > (animationSourceNode.depth || -1) )) {
                 animationSourceNode = dNode;
            }
        }
    });
    
    if (nodeVisualStateChanged) {
        updateChart(animationSourceNode || d3State.current.root);
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
        }}
      ></div>
    </div>
  );
}

    

    