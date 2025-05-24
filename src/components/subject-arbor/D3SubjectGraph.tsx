
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
  isGeneratingMore?: boolean; // Local D3 flag for loading state
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string | null;
  onGenerateMoreChildren: (path: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // This is when the initial tree is loading
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
  isProcessingAction, // This is when the initial tree is loading
  activeNodeGeneratingMore, // ID of node currently generating more, or null
  setActiveNodeGeneratingMore // Function to set the above ID
}: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null);

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const prevActiveNodeGeneratingMoreRef = useRef<string | null>(null);

  const setActiveNodeGeneratingMoreRef = useRef(setActiveNodeGeneratingMore);
  useEffect(() => {
    setActiveNodeGeneratingMoreRef.current = setActiveNodeGeneratingMore;
  }, [setActiveNodeGeneratingMore]);


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
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1)
      .text(d => d.data.name);
  }, [loaderIconRadius, nodeRadius, animationDuration]);


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
      .attr('d', Loader2.path) // Assuming Loader2 is { path: "M..." }
      .attr('class', 'node-loader-spinner animate-spin')
      .attr('transform', `translate(${-loaderIconRadius/1.5}, ${-loaderIconRadius/1.5}) scale(0.6)`);

    nodeEnter.append('text')
      .attr('dy', '.35em')
      .text(d => d.data.name); // Text positioning is handled in updateNodeVisualState

    const nodeUpdate = nodeEnter.merge(node);

    // Apply event handlers to ALL nodes (new and existing)
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
                setActiveNodeGeneratingMoreRef.current(null); // Cancel generation
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
            // If we returned early but just expanded a node, ensure that expansion is shown
            // This case is mostly covered by the updateChart(dNode) call above.
            return;
        }
        
        // Proceed to "generate more children" if:
        // - It's a true leaf (nodeWasExpanded and nodeWasCollapsedWithChildren are both false)
        // - OR it was just manually expanded (nodeWasJustExpanded is true)
        const shouldGenerateMore = (!nodeWasExpanded && !nodeWasCollapsedWithChildren) || nodeWasJustExpanded;

        if (shouldGenerateMore) {
            if (!fieldOfStudy) {
                console.warn("Field of study is not set, cannot generate more children.");
                return;
            }
            // 3. Set loading state and initiate "generate more"
            dNode.isGeneratingMore = true;
            setActiveNodeGeneratingMoreRef.current(dNode.id!); 
            updateChart(dNode); // Update to show expansion (if nodeWasExpanded) AND loader icon

            try {
                const path = dNode.ancestors().map(n => n.data.name).reverse();
                await onGenerateMoreChildren(path, fieldOfStudy);
                // setActiveNodeGeneratingMore(null) will be called by parent via prop useEffect if successful
            } catch (err) {
                console.error("Error in onGenerateMoreChildren from D3 graph click:", err);
                // Reset loading state on this node if error occurred here
                if (dNode.isGeneratingMore) { // Check if still generating for this node
                    dNode.isGeneratingMore = false;
                }
                if (activeNodeGeneratingMore === dNode.id) { // If this was the active node
                    setActiveNodeGeneratingMoreRef.current(null); // Inform parent
                } else { // If a different node was active, just update this one visually
                   updateChart(dNode);
                }
            }
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
  }, [fieldOfStudy, onGenerateMoreChildren, isProcessingAction, activeNodeGeneratingMore, loaderIconRadius, nodeRadius, animationDuration, updateNodeVisualState]);


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
          const safeFieldOfStudy = fieldOfStudy || "subject_arbor";
          link.download = `${safeFieldOfStudy.toLowerCase().replace(/\s+/g, '_')}_graph.png`;
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
            const initialXTranslate = margin.left + 50;
            const initialYTranslate = height / 2;

            const currentTransform = d3.zoomTransform(d3State.current.svg.node()!);
            let newTransform = d3.zoomIdentity
                .translate(initialXTranslate, initialYTranslate)
                .scale(currentTransform.k);

            // If scale is 0 or too small, reset to a default scale
            if (newTransform.k <= 0.05) {
                 newTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(0.5);
            }


            d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
        }
    };

    initOrResize();

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
    const isInitialLoad = !oldRoot || (fieldOfStudy && oldRoot.data.name !== fieldOfStudy) || (oldRoot && oldRoot.data.name !== treeData.name);

    const { margin, dimensions } = d3State.current;
    const initialX0 = dimensions.height / 2;
    const initialY0 = 0;

    const oldNodeStates = new Map<string, { isCollapsed: boolean, x0: number, y0: number }>();
    if (oldRoot && !isInitialLoad) {
        oldRoot.eachBefore(node => {
            const d3Node = node as D3HierarchyNode;
            if (d3Node.id) { // Ensure ID exists
                oldNodeStates.set(d3Node.id, {
                    isCollapsed: !!d3Node._children && !d3Node.children,
                    x0: d3Node.x0 !== undefined ? d3Node.x0 : d3Node.x,
                    y0: d3Node.y0 !== undefined ? d3Node.y0 : d3Node.y
                });
            }
        });
    }

    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    newRootHierarchy.x0 = oldRoot?.x0 ?? initialX0; // Use initial if oldRoot or its x0 is undefined
    newRootHierarchy.y0 = oldRoot?.y0 ?? initialY0;

    let sourceForAnimation: D3HierarchyNode = newRootHierarchy;

    newRootHierarchy.eachBefore((dNodeUntyped) => {
        const dNode = dNodeUntyped as D3HierarchyNode;
        dNode.id = generatePathId(dNode);
        const oldState = oldNodeStates.get(dNode.id);

        if (oldState) {
            dNode.x0 = oldState.x0;
            dNode.y0 = oldState.y0;
            if (oldState.isCollapsed && dNode.children) { // If it was collapsed and now has children, keep it collapsed
                dNode._children = dNode.children;
                dNode.children = undefined;
            } else if (!oldState.isCollapsed && dNode.children) { // If it was expanded and has children, ensure _children is undefined
                dNode._children = undefined;
            } else if (!oldState.isCollapsed && dNode._children && !dNode.children){ // If it was expanded, but new data suggests it should be collapsed (e.g. _children set but no children)
                 // This case should be rare if treeData is the source of truth for structure
                 // but if d3.hierarchy created _children, ensure it's shown as expanded
                 dNode.children = dNode._children;
                 dNode._children = undefined;
            }
        } else { // New node
            const parentD3Node = dNode.parent as D3HierarchyNode | null;
            dNode.x0 = parentD3Node?.x0 !== undefined ? parentD3Node.x0 : newRootHierarchy.x0;
            dNode.y0 = parentD3Node?.y0 !== undefined ? parentD3Node.y0 : newRootHierarchy.y0;
            if (isInitialLoad && dNode.depth > 1 && dNode.children) { // Default collapse deeper nodes on initial load
                dNode._children = dNode.children;
                dNode.children = undefined;
            }
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
          const calculatedScale = 0.7; // Start slightly zoomed out
          const initialXTranslate = margin.left + 50;
          const initialYTranslate = dimensions.height / 2;
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(calculatedScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
          d3State.current.g.attr("transform", initialTransform.toString());
      }
      sourceForAnimation = newRootHierarchy;
    } else {
        // Not an initial load, determine animation source
        const activeNodeInNewHierarchy = activeNodeGeneratingMore ? findNodeInHierarchy(newRootHierarchy, activeNodeGeneratingMore) : null;
        if (activeNodeInNewHierarchy) {
            sourceForAnimation = activeNodeInNewHierarchy;
            // Ensure this active node is expanded if it now has children
            if (activeNodeInNewHierarchy.data.children && activeNodeInNewHierarchy.data.children.length > 0 && activeNodeInNewHierarchy._children) {
                 activeNodeInNewHierarchy.children = activeNodeInNewHierarchy._children;
                 activeNodeInNewHierarchy._children = undefined;
            }
        } else {
            sourceForAnimation = newRootHierarchy; // Default to root if no specific active node
        }
    }
    updateChart(sourceForAnimation);
  }, [treeData, fieldOfStudy, collapseAllNodesRecursive, getContainerDimensions, updateChart]);


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
            if (!animationSourceNode || animationSourceNode.depth < dNode.depth) {
                 animationSourceNode = dNode;
            }
        }
    });
    
    if (nodeVisualStateChanged) {
        updateChart(animationSourceNode || d3State.current.root);
    }

    // Handle expansion of the node *after* its children have been loaded
    if (prevActiveNodeGeneratingMoreRef.current && !activeNodeGeneratingMore) {
        // A node just finished loading
        const finishedNode = findNodeInHierarchy(d3State.current.root, prevActiveNodeGeneratingMoreRef.current);
        if (finishedNode) {
            if (finishedNode._children) { // If it was collapsed, expand it
                finishedNode.children = finishedNode._children;
                finishedNode._children = undefined;
                nodeVisualStateChanged = true; // Mark that visual state changed
                animationSourceNode = finishedNode;
            }
            if (finishedNode.isGeneratingMore) { // Ensure loader is off
                 finishedNode.isGeneratingMore = false;
                 nodeVisualStateChanged = true;
                 animationSourceNode = finishedNode;
            }
        }
        if (nodeVisualStateChanged) {
            updateChart(animationSourceNode || finishedNode || d3State.current.root);
        }
    }
    prevActiveNodeGeneratingMoreRef.current = activeNodeGeneratingMore;

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

    
