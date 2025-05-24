
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
  isGeneratingMore?: boolean; // Local D3 flag for loading state of this node
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
  onGenerateMoreChildren: (targetNodePath: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // True if initial tree is loading, passed from parent
  activeNodeGeneratingMore: string | null; // ID of node parent considers to be generating more
  setActiveNodeGeneratingMore: (id: string | null) => void; // Callback to parent
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
  const [selectedNodeForMoreButton, setSelectedNodeForMoreButton] = useState<string | null>(null);


  const d3State = useRef<{
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null;
    g: d3.Selection<SVGGElement, unknown, null, undefined> | null;
    root: D3HierarchyNode | null;
    treeLayout: d3.TreeLayout<TreeNodeData> | null;
    zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    dimensions: { width: number; height: number };
    margin: { top: number; right: number; bottom: number; left: number };
    initialLoadDone: boolean;
  }>({
    svg: null,
    g: null,
    root: null,
    treeLayout: null,
    zoomBehavior: null,
    dimensions: { width: 0, height: 0 },
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

    // Nodes
    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id);

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`);

    // Main click handler for nodes (expand/collapse AND trigger generate more)
    nodeEnter.on('click', async (event, dNode) => {
      event.stopPropagation();

      let nodeWasJustExpanded = false;
      if (dNode.children) { // Node is currently expanded, so collapse it
        dNode._children = dNode.children;
        dNode.children = undefined;
        if (dNode.id === activeNodeGeneratingMore) { // If collapsing the node that's loading, cancel loading
            setActiveNodeGeneratingMore(null);
            dNode.isGeneratingMore = false;
        }
      } else if (dNode._children) { // Node is collapsed, so expand it
        dNode.children = dNode._children;
        dNode._children = undefined;
        nodeWasJustExpanded = true;
      }
      // After toggling expansion, update the chart to reflect this
      updateChart(dNode);

      // Now, handle "generate more" if applicable
      // Conditions to try generating more:
      // 1. It's a leaf node (no children, no _children after potential expansion).
      // 2. Or, it was just expanded (nodeWasJustExpanded is true).
      const canGenerateMore = (!dNode.children && !dNode._children) || nodeWasJustExpanded;

      if (canGenerateMore) {
        // Prevent re-triggering if already generating for this node or globally, or if isProcessingAction (initial tree load)
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction || dNode.isGeneratingMore) {
            return;
        }

        // 3. Set loading state and initiate "generate more"
        dNode.isGeneratingMore = true;
        setActiveNodeGeneratingMore(dNode.id!); // Inform parent page
        updateChart(dNode); // Update to show expansion (if nodeWasExpanded) AND loader icon

        try {
          const path: string[] = dNode.ancestors().map(n => n.data.name).reverse();
          await onGenerateMoreChildren(path, fieldOfStudy);
          // setActiveNodeGeneratingMore(null) will be called by page.tsx's finally block
          // which will trigger the useEffect to update dNode.isGeneratingMore and re-render.
        } catch (err) {
          console.error("Error in onGenerateMoreChildren callback from D3 graph:", err);
          // Reset loading state on error
          if (dNode.isGeneratingMore) dNode.isGeneratingMore = false;
          if (activeNodeGeneratingMore === dNode.id) setActiveNodeGeneratingMore(null);
          updateChart(dNode); // Update to hide loader
        }
      }
    });

    nodeEnter.on('mouseover', function(event, dNode) {
        if (dNode.isGeneratingMore) return; // Don't show tooltip if loading
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


    // Main node circle
    nodeEnter.append('circle')
      .attr('class', 'node-main-circle')
      .attr('r', 1e-6); // Initial small radius for animation

    // Loader group (Loader2 icon)
    const loaderGroupEnter = nodeEnter.append('g')
      .attr('class', 'node-loader-group')
      .style('display', 'none')
      .attr('transform', `translate(0,0)`)
      .style('pointer-events', 'none');

    loaderGroupEnter.append('circle')
      .attr('r', loaderIconRadius + 2)
      .attr('class', 'node-loader-backdrop');

    loaderGroupEnter.append('path')
      .attr('d', Loader2.path)
      .attr('class', 'node-loader-spinner animate-spin')
      .attr('transform', `translate(${-loaderIconRadius/1.5}, ${-loaderIconRadius/1.5}) scale(0.6)`);

    // Node text
    nodeEnter.append('text')
      .attr('dy', '.35em')
      .text(d => d.data.name);

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
      .duration(animationDuration)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    // Update circle attributes
    nodeUpdate.select<SVGCircleElement>('circle.node-main-circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = 'node-main-circle ';
        classes += (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        if (d.isGeneratingMore) classes += ' node-loading';
        return classes;
      });

    // Update loader group visibility
    nodeUpdate.select<SVGGElement>('.node-loader-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');

    // Update text attributes
    nodeUpdate.select('text')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5)) // Reverted
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start') // Reverted
      .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1) // Dim text if loading
      .text(d => d.data.name);


    const nodeExit = node.exit().transition()
      .duration(animationDuration)
      .attr('transform', `translate(${effectiveSource.y || 0},${effectiveSource.x0 || 0})`)
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    // Links
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
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, activeNodeGeneratingMore, isProcessingAction, setActiveNodeGeneratingMore, generatePathId]);


  const collapseAllNodesRecursive = useCallback((d: D3HierarchyNode, keepRootChildren = false) => {
    if (d.children) {
      if (!keepRootChildren || d !== d3State.current.root) {
        d._children = d.children;
        d.children.forEach(child => collapseAllNodesRecursive(child as D3HierarchyNode, false));
        d.children = undefined;
      } else {
        d.children.forEach(child => collapseAllNodesRecursive(child as D3HierarchyNode, false));
      }
    }
  }, []);

  const expandAllNodesRecursive = useCallback((d: D3HierarchyNode) => {
    if (d._children) {
        d.children = d._children;
        d._children = undefined;
    }
    if (d.children) {
        d.children.forEach(child => expandAllNodesRecursive(child as D3HierarchyNode));
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
    setSelectedNodeForMoreButton(null); // Hide any active "generate more" button
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
            // Use nodeSize for consistent spacing
            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]);
        }

        if (d3State.current.root && d3State.current.svg && d3State.current.zoomBehavior) {
            const { margin } = d3State.current;
            const currentTransform = d3.zoomTransform(d3State.current.svg.node()!);

            const newTransform = d3.zoomIdentity
                .translate(margin.left + 50, height / 2)
                .scale(currentTransform.k);

            d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
        }
        if (d3State.current.root) {
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
  }, [getContainerDimensions]);


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
    const oldNodeStates = new Map<string, { isCollapsed: boolean; x0?: number; y0?: number; isGeneratingMore?: boolean }>();

    if (oldRoot && !isInitialLoad) {
      oldRoot.eachBefore(d => {
        oldNodeStates.set(d.id, {
          isCollapsed: !!d._children && !d.children,
          x0: d.x0,
          y0: d.y0,
          isGeneratingMore: d.isGeneratingMore
        });
      });
    }

    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    let sourceForAnimation: D3HierarchyNode = newRootHierarchy;

    newRootHierarchy.eachBefore(dNode => {
      dNode.id = generatePathId(dNode as d3.HierarchyNode<TreeNodeData>); // Use the stable ID generator
      const oldState = oldNodeStates.get(dNode.id);

      dNode.x0 = dimensions.height / 2; // Default for initial positioning
      dNode.y0 = 0;

      if (oldState) {
        dNode.x0 = oldState.x0;
        dNode.y0 = oldState.y0;
        dNode.isGeneratingMore = oldState.isGeneratingMore || (dNode.id === activeNodeGeneratingMore);

        if (oldState.isCollapsed && dNode.children) {
          dNode._children = dNode.children;
          dNode.children = undefined;
        } else if (!oldState.isCollapsed && dNode._children && dNode.id !== activeNodeGeneratingMore){ // Keep expanded unless it was collapsed
           dNode.children = dNode._children;
           dNode._children = undefined;
        }
      } else { // New node
        const parent = dNode.parent as D3HierarchyNode | null;
        if (parent) {
            dNode.x0 = parent.x0;
            dNode.y0 = parent.y0;
        }
        if (isInitialLoad && dNode.depth > 1) {
            if (dNode.children) {
                dNode._children = dNode.children;
                dNode.children = undefined;
            }
        }
         dNode.isGeneratingMore = (dNode.id === activeNodeGeneratingMore);
      }
      
      // Ensure the active node (for which children were just generated) is expanded
      if (dNode.id === activeNodeGeneratingMore && dNode._children) {
        dNode.children = dNode._children;
        dNode._children = undefined;
        sourceForAnimation = dNode;
      }
    });

    newRootHierarchy.x0 = dimensions.height / 2;
    newRootHierarchy.y0 = 0;
    d3State.current.root = newRootHierarchy;


    if (isInitialLoad) {
      if (newRootHierarchy.children) {
        newRootHierarchy.children.forEach(child => {
          collapseAllNodesRecursive(child as D3HierarchyNode, false);
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
  }, [treeData, fieldOfStudy]);


  useEffect(() => {
    if (!d3State.current.root || !d3State.current.g) return;

    let nodeChanged = false;
    let nodeToAnimateFrom: D3HierarchyNode | null = null;

    d3State.current.root.each(node => {
        const d3Node = node as D3HierarchyNode;
        const shouldBeGenerating = activeNodeGeneratingMore === d3Node.id;
        if (d3Node.isGeneratingMore !== shouldBeGenerating) {
            d3Node.isGeneratingMore = shouldBeGenerating;
            nodeChanged = true;
            nodeToAnimateFrom = d3Node;
        }
    });

    if (nodeChanged && nodeToAnimateFrom) {
        updateChart(nodeToAnimateFrom);
    } else if (nodeChanged && !nodeToAnimateFrom && d3State.current.root) {
        // This case might occur if activeNodeGeneratingMore became null and we need to update the node that was loading
        const previouslyGeneratingNode = d3State.current.root.descendants().find(n => (n as D3HierarchyNode).isGeneratingMore) as D3HierarchyNode | undefined;
        if (previouslyGeneratingNode && !activeNodeGeneratingMore) { // Check if it *was* loading but isn't anymore
            previouslyGeneratingNode.isGeneratingMore = false;
            if(previouslyGeneratingNode._children) { // Ensure it is expanded after loading
              previouslyGeneratingNode.children = previouslyGeneratingNode._children;
              previouslyGeneratingNode._children = undefined;
            }
            updateChart(previouslyGeneratingNode);
        } else if (d3State.current.root) { // Fallback general update if specific node isn't clear
           updateChart(d3State.current.root);
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeGeneratingMore]);


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
