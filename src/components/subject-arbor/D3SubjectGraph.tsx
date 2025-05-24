
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
  isProcessingAction?: boolean;
  activeNodeGeneratingMore: string | null;
  setActiveNodeGeneratingMore: (id: string | null) => void;
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
  setActiveNodeGeneratingMore
}: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null);

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const activeNodeGeneratingMore_prev = useRef<string | null>(null);

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
        if (d.id === undefined) d.id = generatePathId(d); // Ensure ID is present, might be redundant if set earlier
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
      .attr('dy', '.35em')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => d.data.name);

    const nodeUpdate = nodeEnter.merge(node);

    // Apply event handlers to ALL nodes (new and existing)
    nodeUpdate
      .on('click', async (event, dNode: D3HierarchyNode) => {
        let nodeWasExpanded = !!dNode.children; // State *before* toggle
        let nodeWasCollapsedWithChildren = !dNode.children && !!dNode._children; // State *before* toggle
        let justManuallyExpanded = false;

        // 1. Toggle expansion/collapse state
        if (nodeWasExpanded) { // Node is currently expanded, so collapse it
            dNode._children = dNode.children;
            dNode.children = undefined;
        } else if (nodeWasCollapsedWithChildren) { // Node is currently collapsed with children, so expand it
            dNode.children = dNode._children;
            dNode._children = undefined;
            justManuallyExpanded = true;
        }
        // For true leaves, children and _children remain undefined

        // If we are already processing, or if the action was just to collapse an expanded node,
        // update the chart visually and return.
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction || dNode.isGeneratingMore || (nodeWasExpanded && !justManuallyExpanded)) {
            updateChart(dNode); // Update visual state (collapse/expand)
            if (activeNodeGeneratingMore === dNode.id && (nodeWasExpanded && !justManuallyExpanded)) { // If collapsing the loading node, cancel generation
                setActiveNodeGeneratingMore(null);
            }
            return;
        }

        // Proceed to "generate more children" if:
        // - It's a true leaf (nodeWasExpanded and nodeWasCollapsedWithChildren are both false)
        // - OR it was just manually expanded (justManuallyExpanded is true)
        const shouldGenerateMore = (!nodeWasExpanded && !nodeWasCollapsedWithChildren) || justManuallyExpanded;

        if (shouldGenerateMore) {
            if (!fieldOfStudy) {
                console.warn("Field of study is not set, cannot generate more children.");
                updateChart(dNode); // Still update chart for any toggle
                return;
            }
            // 3. Set loading state and initiate "generate more"
            dNode.isGeneratingMore = true;
            setActiveNodeGeneratingMore(dNode.id!);
            updateChart(dNode); // Update to show expansion (if nodeWasExpanded) AND loader icon

            try {
                const path = dNode.ancestors().map(n => n.data.name).reverse();
                await onGenerateMoreChildren(path, fieldOfStudy);
                // setActiveNodeGeneratingMore(null) will be called by parent via prop useEffect
            } catch (err) {
                console.error("Error in onGenerateMoreChildren from D3 graph click:", err);
                // Reset loading state on this node if error occurred here
                if (dNode.isGeneratingMore) {
                    dNode.isGeneratingMore = false;
                }
                if (activeNodeGeneratingMore === dNode.id) { // If this was the active node
                    setActiveNodeGeneratingMore(null); // Inform parent
                } else { // If a different node was active, just update this one visually
                    updateChart(dNode);
                }
            }
        } else {
            // This case (e.g., just collapsing) is handled by the early return,
            // but ensure chart is updated if we somehow reach here.
            updateChart(dNode);
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
  }, [fieldOfStudy, onGenerateMoreChildren, isProcessingAction, activeNodeGeneratingMore, setActiveNodeGeneratingMore, loaderIconRadius, nodeRadius, animationDuration]);


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
            const newTransform = d3.zoomIdentity
                .translate(initialXTranslate, initialYTranslate)
                .scale(currentTransform.k);

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
    newRootHierarchy.x0 = oldRoot?.x0 || initialX0;
    newRootHierarchy.y0 = oldRoot?.y0 || initialY0;

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
            } else if (!oldState.isCollapsed && dNode._children && !dNode.children) {
                dNode.children = dNode._children; // Restore expansion
                dNode._children = undefined;
            }
        } else {
            const parentD3Node = dNode.parent as D3HierarchyNode | null;
            dNode.x0 = parentD3Node?.x0 !== undefined ? parentD3Node.x0 : initialX0;
            dNode.y0 = parentD3Node?.y0 !== undefined ? parentD3Node.y0 : initialY0;
            if (isInitialLoad && dNode.depth > 1 && dNode.children) {
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
          const nodesForExtent = newRootHierarchy.descendants();
          const minX = d3.min(nodesForExtent, d => d.x!) || 0;
          const maxX = d3.max(nodesForExtent, d => d.x!) || dimensions.height;
          const minY = d3.min(nodesForExtent, d => d.y!) || 0;
          const maxY = d3.max(nodesForExtent, d => d.y!) || dimensions.width;

          const graphContentWidth = maxY - minY;
          const graphContentHeight = maxX - minX;

          const scaleX = graphContentWidth > 0 ? (dimensions.width - margin.left - margin.right) / graphContentWidth : 1;
          const scaleY = graphContentHeight > 0 ? (dimensions.height - margin.top - margin.bottom) / graphContentHeight : 1;
          const initialZoomScale = Math.min(scaleX, scaleY, 0.8);

          const initialXTranslate = margin.left + 50;
          const initialYTranslate = dimensions.height / 2;

          const calculatedScale = initialZoomScale > 0.05 ? initialZoomScale : 0.5;
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(calculatedScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
          d3State.current.g.attr("transform", initialTransform.toString());
      }
      sourceForAnimation = newRootHierarchy;
    } else {
        const activeNode = activeNodeGeneratingMore ? findNodeInHierarchy(newRootHierarchy, activeNodeGeneratingMore) : null;
        if (activeNode) {
            sourceForAnimation = activeNode;
            if (activeNode._children && activeNode.data.children && activeNode.data.children.length > (activeNode._children.length || 0) ) {
                activeNode.children = activeNode._children;
                activeNode._children = undefined;
            }
        } else {
            sourceForAnimation = newRootHierarchy;
        }
    }
    updateChart(sourceForAnimation);
  }, [treeData, fieldOfStudy, collapseAllNodesRecursive, getContainerDimensions, updateChart]);


  useEffect(() => {
    if (!d3State.current.root || !d3State.current.g) return;
    let nodeVisualStateChanged = false;
    let animationSourceNode: D3HierarchyNode | null = null;

    d3State.current.root.each(dNodeUntyped => {
        const dNode = dNodeUntyped as D3HierarchyNode;
        const shouldBeGenerating = activeNodeGeneratingMore === dNode.id;

        if (dNode.isGeneratingMore !== shouldBeGenerating) {
            dNode.isGeneratingMore = shouldBeGenerating;
            nodeVisualStateChanged = true;
            animationSourceNode = dNode; // Animate from the node changing state

            if (!shouldBeGenerating && dNode.id === activeNodeGeneratingMore_prev.current) { // Finished loading for this node
                // Ensure node is expanded to show new children
                if (dNode._children) {
                    dNode.children = dNode._children;
                    dNode._children = undefined;
                }
            }
        }
    });

    activeNodeGeneratingMore_prev.current = activeNodeGeneratingMore;

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
