
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
  isProcessingAction?: boolean; // True if initial tree generation is in progress
  activeNodeGeneratingMore: string | null; // ID of the node currently having children generated
  setActiveNodeGeneratingMore: (id: string | null) => void; // To manage loading state from parent
}

// Helper to generate a stable path-based ID for a D3 node
const generatePathId = (d: d3.HierarchyNode<TreeNodeData>): string => {
  return d.ancestors().map(node => node.data.name.replace(/[/\s#?&"'.:]/g, '_')).reverse().join('/');
};

export function D3SubjectGraph({
  treeData,
  fieldOfStudy,
  onGenerateMoreChildren,
  isProcessingAction, // This prop indicates if the *initial* tree is being generated
  activeNodeGeneratingMore, // This prop is the ID of the node for which "more children" are being generated
  setActiveNodeGeneratingMore // Callback to update the above prop
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
    dimensions: { width: 0, height: 0 },
    margin: { top: 20, right: 180, bottom: 20, left: 120 }
  });

  const animationDuration = 750;
  const nodeRadius = 6; // Corresponds to --node-radius in CSS
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

  const findNodeInHierarchy = useCallback((node: D3HierarchyNode | null, id: string): D3HierarchyNode | null => {
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
      if (d.x0 === undefined) d.x0 = effectiveSource.x0 !== undefined ? effectiveSource.x0 : d.x;
      if (d.y0 === undefined) d.y0 = effectiveSource.y0 !== undefined ? effectiveSource.y0 : d.y;
    });

    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id);

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`)
      .on('click', async (event, dNode) => {
        let nodeWasJustExpanded = false;

        // 1. Handle expansion/collapse toggle
        if (dNode.children) { // Node is currently expanded (dNode.children is not null/undefined)
            dNode._children = dNode.children;
            dNode.children = undefined; // Collapse it
            // If user collapses a node that is loading, stop its loading.
            if(activeNodeGeneratingMore === dNode.id) {
                setActiveNodeGeneratingMore(null);
                dNode.isGeneratingMore = false; // Clear local flag too
            }
            updateChart(dNode); // Reflect the collapse
            return; // Action for an expanded node is just to collapse it. Do not generate more.
        } else { // Node is currently collapsed (dNode._children has content) or is a leaf (dNode._children is null/undefined)
            if (dNode._children) { // If it was collapsed (had _children)
                dNode.children = dNode._children;
                dNode._children = undefined; // Expand it
                nodeWasJustExpanded = true;
            }
            // If it's a leaf (no children, no _children), it remains so. We proceed to generate for it.
        }

        // 2. Early exit if already processing something, but ensure visual update for expansion if it just happened.
        // isProcessingAction refers to the initial tree generation.
        // activeNodeGeneratingMore refers to a "generate more children" action already in progress for *any* node.
        // dNode.isGeneratingMore is the local flag for *this* node.
        if (dNode.isGeneratingMore || (activeNodeGeneratingMore && activeNodeGeneratingMore !== dNode.id) || isProcessingAction) {
            if (nodeWasJustExpanded) {
                updateChart(dNode); // If we just expanded it, show that expansion before returning.
            }
            return;
        }
        // If activeNodeGeneratingMore === dNode.id, it means we are already generating for this node.
        // The dNode.isGeneratingMore flag should also be true in this case, so the above check handles it.

        // If we reach here, it means:
        // - The node was just expanded (nodeWasJustExpanded = true) OR
        // - The node was a leaf.
        // And it's not currently being loaded, and no global "initial tree" generation is happening.

        // 3. Set loading state and initiate "generate more"
        dNode.isGeneratingMore = true;
        setActiveNodeGeneratingMore(dNode.id!);
        updateChart(dNode); // Update to show expansion (if nodeWasJustExpanded) AND loader icon

        try {
            const path: string[] = dNode.ancestors().map(n => n.data.name).reverse();
            await onGenerateMoreChildren(path, fieldOfStudy);
            // On success, parent component (page.tsx) will update treeData.
            // This will trigger the useEffect hook that watches treeData.
            // That hook will call setActiveNodeGeneratingMore(null) in its finally block,
            // which in turn triggers the useEffect for activeNodeGeneratingMore,
            // which then clears dNode.isGeneratingMore and updates the chart.
        } catch (err) {
            console.error("Error in onGenerateMoreChildren callback from D3 graph:", err);
            // Reset loading state on error
            if (dNode.isGeneratingMore) dNode.isGeneratingMore = false;
            // Only clear global active if it was this node
            if (activeNodeGeneratingMore === dNode.id) setActiveNodeGeneratingMore(null);
            updateChart(dNode); // Ensure loader is removed & state is current
        }
      })
      .on('mouseover', function (event, dNode) {
        if (dNode.isGeneratingMore) return; // Don't show tooltip if loading
        const [mx, my] = d3.pointer(event, currentGraphWrapper);
        
        let tooltipContent = `<strong>${dNode.data.name}</strong>`;
        if (dNode.data.description && dNode.data.description.trim() !== '') {
          tooltipContent += `<br><small style="display: block; margin-top: 4px; color: hsl(var(--muted-foreground));">${dNode.data.description.trim()}</small>`;
        }
        
        const tooltipNodeEl = tooltip.node() as HTMLDivElement;
        tooltip.html(tooltipContent).style('opacity', 1);

        const tooltipWidth = tooltipNodeEl.offsetWidth;
        const tooltipHeight = tooltipNodeEl.offsetHeight;
        const wrapperWidth = currentGraphWrapper.clientWidth;
        const wrapperHeight = currentGraphWrapper.clientHeight;

        let left = mx + 15;
        let top = my + 10;

        // Adjust if tooltip goes out of bounds of the graphWrapper
        if (left + tooltipWidth + 10 > wrapperWidth) left = mx - tooltipWidth - 15;
        if (left < 5) left = 5;
        if (top + tooltipHeight + 10 > wrapperHeight) top = my - tooltipHeight - 10;
        if (top < 5) top = 5;

        tooltip.style('left', left + 'px').style('top', top + 'px');
        
        d3.select(this).select('circle.node-main-circle').classed('hovered', true);
        g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
          .classed('highlighted', l => l.source === dNode || l.target === dNode);
      })
      .on('mouseout', function () {
        tooltip.style('opacity', 0);
        d3.select(this).select('circle.node-main-circle').classed('hovered', false);
        g.selectAll('path.link').classed('highlighted', false);
      });

    nodeEnter.append('circle')
      .attr('class', 'node-main-circle')
      .attr('r', 1e-6); // Initial small radius for animation

    // Group for the loader icon
    const loaderGroupEnter = nodeEnter.append('g')
        .attr('class', 'node-loader-group')
        .style('display', 'none') // Initially hidden
        .attr('transform', `translate(0,0)`) // Position relative to node center
        .style('pointer-events', 'none'); // Prevent interfering with clicks on main node

    loaderGroupEnter.append('circle')
        .attr('r', loaderIconRadius + 2) // Slightly larger backdrop
        .attr('class', 'node-loader-backdrop');

    loaderGroupEnter.append('path')
        .attr('d', Loader2.path) // Use Lucide's Loader2 path
        .attr('class', 'node-loader-spinner animate-spin')
        .attr('transform', `translate(${-loaderIconRadius/1.5}, ${-loaderIconRadius/1.5}) scale(0.6)`);


    nodeEnter.append('text')
      .attr('dy', '.35em')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => d.data.name);

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
      .duration(animationDuration)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    nodeUpdate.select<SVGCircleElement>('circle.node-main-circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = 'node-main-circle ';
        classes += (d.children || d._children) ? 'node-interactive ' : 'node-leaf '; // Added space
        if (d._children) classes += 'collapsed '; // Node is collapsed
        else if (d.children) classes += 'expanded '; // Node is expanded
        if (d.isGeneratingMore) classes += 'node-loading '; // Node is loading
        return classes.trim();
      });
    
    // Show/hide loader based on d.isGeneratingMore
    nodeUpdate.select<SVGGElement>('.node-loader-group')
        .style('display', d => d.isGeneratingMore ? 'block' : 'none');

    // Dim text if loading
    nodeUpdate.select('text')
        .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1);


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
        return d3.linkHorizontal<any, { x: number, y: number }>().x(dNode => dNode.y).y(dNode => dNode.x)({ source: o, target: o });
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
        const o = { x: effectiveSource.x || 0, y: effectiveSource.y || 0 }; // Use sourceNodeParam if available, else rootNode
        return d3.linkHorizontal<any, { x: number, y: number }>().x(dNode => dNode.y).y(dNode => dNode.x)({ source: o, target: o });
      })
      .remove();

    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, isProcessingAction, activeNodeGeneratingMore, setActiveNodeGeneratingMore]);


  const collapseAllNodesRecursive = useCallback((d: D3HierarchyNode, keepRootChildren = false) => {
    if (d.children) {
      if (!keepRootChildren || d !== d3State.current.root) {
        d._children = d.children;
        d.children.forEach(child => collapseAllNodesRecursive(child, false)); // Recurse on actual children
        d.children = undefined;
      } else { // Keep root's direct children expanded, but collapse their children
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
      collapseAllNodesRecursive(d3State.current.root, true); // Keep root's children visible
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
      toPng(svgRef.current, { backgroundColor: backgroundColor, pixelRatio: 2 })
        .then((dataUrl) => {
          const link = document.createElement('a');
          link.download = `${fieldOfStudy.toLowerCase().replace(/\s+/g, '_')}_graph.png`;
          link.href = dataUrl;
          link.click();
        })
        .catch((err) => console.error('Failed to export PNG:', err));
    }
  }, [fieldOfStudy, activeNodeGeneratingMore, isProcessingAction]);

  useEffect(() => {
    const initOrResize = () => {
      if (!svgRef.current || !graphWrapperRef.current) return;
      d3State.current.dimensions = getContainerDimensions();
      const { width, height } = d3State.current.dimensions;
      const svg = d3.select(svgRef.current).attr('width', width).attr('height', height);

      if (!d3State.current.svg) { // Initialize D3 elements only once
        d3State.current.svg = svg;
        d3State.current.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.05, 5]) // Min/max zoom levels
          .on('zoom', (event) => { if (d3State.current.g) d3State.current.g.attr('transform', event.transform); });
        svg.call(d3State.current.zoomBehavior);
        d3State.current.g = svg.append('g');
        // Use nodeSize for consistent spacing
        d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]); // [heightForNode, widthBetweenDepths]
      }

      // Center the graph initially or on resize if root exists
      if (d3State.current.root && d3State.current.g && d3State.current.svg && d3State.current.zoomBehavior) {
        const { margin } = d3State.current;
        // Calculate initial zoom scale to fit the graph (optional, can be fixed)
        const initialXTranslate = margin.left + 50; // Add some padding from the left
        const initialYTranslate = height / 2;
        const currentTransform = d3.zoomTransform(d3State.current.svg.node()!);
        const newTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(currentTransform.k || 0.7); // Keep current scale or default
        d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
        // updateChart(d3State.current.root); // updateChart will be called by treeData effect
      }
    };
    initOrResize();
    const resizeObserver = new ResizeObserver(initOrResize);
    if (graphWrapperRef.current) resizeObserver.observe(graphWrapperRef.current);
    return () => {
      if (graphWrapperRef.current) resizeObserver.unobserve(graphWrapperRef.current);
      resizeObserver.disconnect();
    };
  }, [getContainerDimensions]); // Only depends on getContainerDimensions


  // Effect for handling treeData changes (main data prop)
  useEffect(() => {
    if (!d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
        if (d3State.current.g && !treeData) { // If treeData becomes null, clear the graph
            d3State.current.g.selectAll("*").remove();
            d3State.current.root = null;
        }
        return;
    }
    
    if (!treeData) { // If treeData is null, clear graph and root
        if (d3State.current.g) d3State.current.g.selectAll("*").remove();
        d3State.current.root = null;
        return;
    }
    
    const { margin, dimensions } = d3State.current;
    const oldRoot = d3State.current.root;
    const isInitialLoad = !oldRoot || oldRoot.data.name !== treeData.name || oldRoot.id !== generatePathId(d3.hierarchy(treeData));

    const oldNodeStates = new Map<string, { isCollapsed: boolean; x0?: number; y0?: number }>();
    if (oldRoot && !isInitialLoad) { // If not initial load, preserve states
        oldRoot.eachBefore(node => {
            const d3Node = node as D3HierarchyNode;
            if (d3Node.id) {
                oldNodeStates.set(d3Node.id, {
                    isCollapsed: !!d3Node._children,
                    x0: d3Node.x0,
                    y0: d3Node.y0,
                });
            }
        });
    }
    
    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    // Set initial positions for the root node for animation purposes
    newRootHierarchy.x0 = dimensions.height / 2;
    newRootHierarchy.y0 = 0;

    newRootHierarchy.eachBefore((nodeUntyped) => {
        const dNode = nodeUntyped as D3HierarchyNode;
        dNode.id = generatePathId(dNode);
        // isGeneratingMore flag will be handled by the other useEffect hook based on activeNodeGeneratingMore prop

        const oldState = oldNodeStates.get(dNode.id);
        if (oldState) { // Node existed before
            dNode.x0 = oldState.x0;
            dNode.y0 = oldState.y0;
            if (oldState.isCollapsed && dNode.children) { // If it was collapsed and still has children
                dNode._children = dNode.children;
                dNode.children = undefined;
            }
            // If it was expanded, dNode.children is already set by d3.hierarchy, so it remains expanded
        } else { // New node
            dNode.x0 = dNode.parent ? (dNode.parent as D3HierarchyNode).x0 : dimensions.height / 2;
            dNode.y0 = dNode.parent ? (dNode.parent as D3HierarchyNode).y0 : 0;
            // Collapse new deep branches on initial load, or if it's an update and not the active path
            if (isInitialLoad && dNode.depth > 1 && dNode.children) {
                dNode._children = dNode.children;
                dNode.children = undefined;
            } else if (!isInitialLoad && dNode.depth > 0 && dNode.children && activeNodeGeneratingMore !== (dNode.parent as D3HierarchyNode)?.id && activeNodeGeneratingMore !== dNode.id) {
                // During updates, if a new branch appears that wasn't part of the "generate more" action, keep it collapsed initially.
                // This prevents unrelated new branches from auto-expanding.
                let isAncestorOfActive = false;
                if (activeNodeGeneratingMore) {
                    const activeNode = findNodeInHierarchy(newRootHierarchy, activeNodeGeneratingMore);
                    if (activeNode) {
                        isAncestorOfActive = activeNode.ancestors().some(anc => anc.id === dNode.id);
                    }
                }
                if (!isAncestorOfActive && dNode.id !== activeNodeGeneratingMore && dNode.children) {
                     // Collapse new nodes unless they are the active node or an ancestor of it
                    if (dNode.depth > ((findNodeInHierarchy(newRootHierarchy, activeNodeGeneratingMore || "")?.depth || 0) +1) ) {
                         dNode._children = dNode.children;
                         dNode.children = undefined;
                    }
                }
            }
        }
    });
    
    let sourceForAnimation: D3HierarchyNode = newRootHierarchy;

    if (isInitialLoad) {
      if (newRootHierarchy.children) {
        newRootHierarchy.children.forEach(child => {
          if ((child as D3HierarchyNode).children) { // Collapse children of root's children
            collapseAllNodesRecursive(child as D3HierarchyNode, false);
          }
        });
      }
      setIsFullyExpanded(false); // Reset expand all state
      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
        const initialZoomScale = Math.min(0.8, Math.max(0.2, 
            dimensions.width / (newRootHierarchy.height * 220 + margin.left + margin.right), 
            dimensions.height / (newRootHierarchy.descendants().length * 35 + margin.top + margin.bottom)
        ));
        const initialXTranslate = margin.left + 50;
        const initialYTranslate = dimensions.height / 2;
        const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(initialZoomScale > 0 ? initialZoomScale : 0.5);
        d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
        d3State.current.g.attr("transform", initialTransform.toString());
      }
    } else {
        // If it's an update, try to find the active node (if any) for animation source
        if (activeNodeGeneratingMore) {
            const activeNodeInNewTree = findNodeInHierarchy(newRootHierarchy, activeNodeGeneratingMore);
            if (activeNodeInNewTree) {
                sourceForAnimation = activeNodeInNewTree;
                 // Ensure the active node is expanded if it has new children
                if (activeNodeInNewTree._children && activeNodeInNewTree.data.children && activeNodeInNewTree.data.children.length > 0) {
                    activeNodeInNewTree.children = activeNodeInNewTree._children;
                    activeNodeInNewTree._children = undefined;
                }
            }
        }
    }
    
    d3State.current.root = newRootHierarchy; // Set the new root
    updateChart(sourceForAnimation);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, fieldOfStudy, collapseAllNodesRecursive, expandAllNodesRecursive]); // activeNodeGeneratingMore prop is handled by its own effect


  // Effect for handling activeNodeGeneratingMore prop changes (visual loading state)
  useEffect(() => {
    if (!d3State.current.root) return;

    let nodeChangedVisualState = false;
    let nodeToAnimate: D3HierarchyNode | null = null;

    // Clear isGeneratingMore for all nodes first
    d3State.current.root.each(node => {
        const d3Node = node as D3HierarchyNode;
        if (d3Node.id !== activeNodeGeneratingMore && d3Node.isGeneratingMore) {
            d3Node.isGeneratingMore = false;
            nodeChangedVisualState = true;
        }
    });
    
    if (activeNodeGeneratingMore) { // If a node IS actively generating more
      const activeNode = findNodeInHierarchy(d3State.current.root, activeNodeGeneratingMore);
      if (activeNode && !activeNode.isGeneratingMore) {
        activeNode.isGeneratingMore = true;
        nodeChangedVisualState = true;
        nodeToAnimate = activeNode;
      } else if (activeNode) { // If it was already marked (e.g. by click handler)
        nodeToAnimate = activeNode; // Still use it as animation source
      }
    } else { // activeNodeGeneratingMore is null, meaning loading finished or was cancelled
      // Find any node that *was* generating and turn it off
      d3State.current.root.each(node => {
        const d3Node = node as D3HierarchyNode;
        if (d3Node.isGeneratingMore) { // This node was the one loading
          d3Node.isGeneratingMore = false;
          nodeChangedVisualState = true;
          nodeToAnimate = d3Node; 
          // Ensure it's expanded to show new children (if any were added)
          if (d3Node._children && d3Node.data.children && d3Node.data.children.length > (d3Node._children.length || 0)) {
            d3Node.children = d3Node._children;
            d3Node._children = undefined;
          } else if (d3Node._children && !d3Node.data.children?.length) { // If API returned no new children but it was collapsed
            d3Node.children = d3Node._children;
            d3Node._children = undefined;
          }
          // This simplified .each will process the first one it finds. Ideally only one should be true.
          return; // Exit .each early
        }
      });
    }

    if (nodeChangedVisualState && d3State.current.root) {
      updateChart(nodeToAnimate || d3State.current.root);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeGeneratingMore]); // Only depends on the prop


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

