
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNodeData } from '@/types';
import { Button } from '@/components/ui/button';
import { ImageIcon, Minimize, Maximize, PlusCircle, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';

export interface D3HierarchyNode extends d3.HierarchyPointNode<TreeNodeData> {
  _children?: D3HierarchyNode[];
  children?: D3HierarchyNode[];
  x0?: number;
  y0?: number;
  id?: string;
  isGeneratingMore?: boolean;
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
  onGenerateMoreChildren: (targetNodePath: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // Overall loading state from parent page
}

export function D3SubjectGraph({ treeData, fieldOfStudy, onGenerateMoreChildren, isProcessingAction }: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null);

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const [activeNodeGeneratingMore, setActiveNodeGeneratingMore] = useState<string | null>(null); // ID of node currently fetching more children
  const [selectedNodeForMoreButton, setSelectedNodeForMoreButton] = useState<string | null>(null); // ID of node whose "generate more" button should be visible

  const d3State = useRef<{
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null;
    g: d3.Selection<SVGGElement, unknown, null, undefined> | null;
    root: D3HierarchyNode | null;
    treeLayout: d3.TreeLayout<TreeNodeData> | null;
    zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    i: number;
    dimensions: { width: number; height: number };
    margin: { top: number; right: number; bottom: number; left: number };
  }>({
    svg: null,
    g: null,
    root: null,
    treeLayout: null,
    zoomBehavior: null,
    i: 0,
    dimensions: {width: 0, height: 0},
    margin: { top: 20, right: 180, bottom: 20, left: 120 }
  });

  const animationDuration = 750;
  const nodeRadius = 6;
  const generateMoreButtonRadius = 8;

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
    let rootNode = d3State.current.root;
    const treeLayout = d3State.current.treeLayout;
    const tooltip = d3.select(tooltipRef.current);
    const currentGraphWrapper = graphWrapperRef.current;
    
    if (!rootNode) return;

    const treeDataLayout = treeLayout(rootNode);
    const nodes = treeDataLayout.descendants() as D3HierarchyNode[];
    const links = treeDataLayout.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    const effectiveSource = sourceNodeParam || rootNode;

    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id || (d.id = `${d.data.name.replace(/\s+/g, '-')}-${d.depth}-${++d3State.current.i}`));

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`)
      .on('click', (event, dNode) => {
        const targetElement = event.target as SVGElement;
        // If the click was on the 'generate more' button itself or its hitbox,
        // let its specific click handler (defined on generateMoreGroup) manage it.
        if (targetElement.closest('.generate-more-group')) {
            return;
        }

        // Click on the main node circle or text
        // Toggle expand/collapse
        if (dNode.children) { // If expanded, collapse it
            dNode._children = dNode.children;
            dNode.children = undefined;
        } else if (dNode._children) { // If collapsed with children, expand it
            dNode.children = dNode._children;
            dNode._children = undefined;
        }
        // If it's a leaf (no children and no _children), nothing to expand/collapse.

        // Toggle visibility of "generate more" button for this node
        setSelectedNodeForMoreButton(prevId => (prevId === dNode.id && !dNode.isGeneratingMore ? null : dNode.id!));
        updateChart(dNode); // Update the chart, animating from the clicked node
      })
      .on('mouseover', function(event, dNode) {
        const [mx, my] = d3.pointer(event, currentGraphWrapper);
        let tooltipContent = `<strong>${dNode.data.name}</strong>`;
        if (dNode.data.description && dNode.data.description.trim() !== '') {
           tooltipContent += `<br><small style="display: block; margin-top: 4px; color: hsl(var(--muted-foreground));">${dNode.data.description.trim()}</small>`;
        }
        
        const tooltipNode = tooltip.node() as HTMLDivElement;
        tooltip.html(tooltipContent)
               .style('opacity', 1);

        const tooltipWidth = tooltipNode.offsetWidth;
        const tooltipHeight = tooltipNode.offsetHeight;
        const wrapperWidth = currentGraphWrapper.clientWidth;
        // const wrapperHeight = currentGraphWrapper.clientHeight; // Not currently used for y-axis adjustment

        let left = mx + 15;
        let top = my + 10;

        if (left + tooltipWidth > wrapperWidth - 10) { // 10px buffer from edge
            left = mx - tooltipWidth - 15; 
        }
        if (left < 5) left = 5; // 5px buffer from left edge

        // Basic vertical adjustment if tooltip goes off bottom, needs improvement for top overflow
        if (top + tooltipHeight > currentGraphWrapper.clientHeight - 10) {
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

    nodeEnter.append('text')
      .attr('dy', '.35em')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => d.data.name);

    const generateMoreGroup = nodeEnter.append('g')
      .attr('class', 'generate-more-group')
      .style('cursor', 'pointer')
      .attr('transform', `translate(${nodeRadius + generateMoreButtonRadius + 3}, 0)`)
      .on('click', async (event, dNode) => {
        event.stopPropagation(); // Prevent node's main click handler
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction || dNode.isGeneratingMore) return;
        
        dNode.isGeneratingMore = true; // Set generating flag on the D3 node data
        setActiveNodeGeneratingMore(dNode.id!);
        updateChart(dNode); // Re-render to show loader

        try {
          const path: string[] = [];
          let current: D3HierarchyNode | null = dNode;
          while (current) {
            path.unshift(current.data.name);
            current = current.parent;
          }
          await onGenerateMoreChildren(path, fieldOfStudy);
        } catch (err) {
          console.error("Error generating more children from D3 graph:", err);
           // If error, ensure loader is hidden
           const nodeToReset = d3State.current.root?.descendants().find(n => n.id === dNode.id);
           if (nodeToReset) nodeToReset.isGeneratingMore = false;
           setActiveNodeGeneratingMore(null); // Reset active node
           updateChart(nodeToReset || d3State.current.root); // Re-render to clear loader
        } finally {
            // Flag is cleared by useEffect reacting to activeNodeGeneratingMore and isProcessingAction
            // and treeData prop update
        }
      });

    generateMoreGroup.append('circle')
      .attr('class', 'generate-more-button-hitbox') // For easier clicking
      .attr('r', generateMoreButtonRadius + 2) // Slightly larger hitbox
      .style('fill', 'transparent');

    generateMoreGroup.append('g')
      .attr('class', 'plus-icon-group')
      .append('path')
      .attr('d', PlusCircle.path)
      .attr('transform', `translate(${-generateMoreButtonRadius}, ${-generateMoreButtonRadius}) scale(0.7)`);

    generateMoreGroup.append('g')
      .attr('class', 'loader-icon-group')
      .style('display', 'none') // Initially hidden
      .append('path')
      .attr('d', Loader2.path)
      .attr('class', 'animate-spin') // Ensure animate-spin is defined in CSS
      .attr('transform', `translate(${-generateMoreButtonRadius}, ${-generateMoreButtonRadius}) scale(0.7)`);

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
        return classes;
      });
    
    // Update visibility of plus/loader icons and the group itself
    nodeUpdate.select<SVGGElement>('.generate-more-group')
      .classed('generate-more-visible', d => d.id === selectedNodeForMoreButton && !d.isGeneratingMore)
      .select('.plus-icon-group')
      .style('display', d => d.isGeneratingMore ? 'none' : 'block');

    nodeUpdate.select<SVGGElement>('.generate-more-group')
      .select('.loader-icon-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');

    nodeUpdate.select('text')
      .style('fill-opacity', 1);

    const nodeExit = node.exit().transition()
      .duration(animationDuration)
      .attr('transform', `translate(${effectiveSource.y || 0},${effectiveSource.x0 || 0})`)
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    const link = g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
      .data(links, d => d.target.id!);

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
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, activeNodeGeneratingMore, isProcessingAction, selectedNodeForMoreButton]);


  const collapseAll = useCallback((d: D3HierarchyNode, keepRootChildren = false) => {
    if (d.children) {
      if (!keepRootChildren || d !== d3State.current.root) {
        d._children = d.children;
        d.children.forEach(child => collapseAll(child, false));
        d.children = undefined;
      } else { 
        d.children.forEach(child => collapseAll(child, false)); 
      }
    }
  }, []);

  const expandAll = useCallback((d: D3HierarchyNode) => {
    if (d._children) {
        d.children = d._children;
        d._children = undefined;
    }
    if (d.children) {
        d.children.forEach(expandAll);
    }
  }, []);

  const handleToggleExpandAll = () => {
    if (!d3State.current.root) return;
    if (isFullyExpanded) {
      collapseAll(d3State.current.root, true);
    } else {
      expandAll(d3State.current.root);
    }
    setIsFullyExpanded(!isFullyExpanded);
    setSelectedNodeForMoreButton(null); // Hide "generate more" button
    updateChart(d3State.current.root);
  };

  const handleExportPng = useCallback(() => {
    if (svgRef.current && graphWrapperRef.current) {
      const wrapperStyle = getComputedStyle(graphWrapperRef.current);
      const backgroundColor = wrapperStyle.backgroundColor;
      
      toPng(svgRef.current, {
          backgroundColor: backgroundColor || 'hsl(var(--background))',
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
  }, [fieldOfStudy]);

  useEffect(() => {
    const initOrResize = () => {
        if (!svgRef.current || !graphWrapperRef.current) return;
        d3State.current.dimensions = getContainerDimensions();
        const { width, height } = d3State.current.dimensions;
        const { margin } = d3State.current;

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

            d3State.current.g = svg.append('g')
                .attr('transform', `translate(${margin.left},${margin.top})`);

            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]);
        }

        if (d3State.current.root) {
             updateChart(d3State.current.root);
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
  }, [getContainerDimensions, updateChart]);

  useEffect(() => {
    if (!d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g && !treeData) d3State.current.g.selectAll("*").remove();
      d3State.current.root = null;
      return;
    }

    if (!treeData) {
        if (d3State.current.g) d3State.current.g.selectAll("*").remove();
        d3State.current.root = null;
        return;
    }

    const { margin, dimensions } = d3State.current;
    const initialX0 = dimensions.height / 2 || 200;

    const isInitialLoad = !d3State.current.root || d3State.current.root.data.name !== treeData.name;

    let oldRoot = d3State.current.root;
    const newRootNode = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    newRootNode.x0 = oldRoot?.x0 || initialX0;
    newRootNode.y0 = oldRoot?.y0 || 0;
    
    // Preserve collapsed/expanded state when treeData changes
    const preserveState = (oldNode: D3HierarchyNode | undefined, newNode: D3HierarchyNode) => {
        if (oldNode) {
            if (oldNode._children && !oldNode.children) { // Was collapsed
                if (newNode.children && newNode.children.length > 0) { 
                    newNode._children = newNode.children;
                    newNode.children = undefined;
                } else { // No new children, or old node was leaf-like but marked collapsed
                    newNode._children = undefined;
                }
            }
            // Preserve isGeneratingMore if the IDs match
            if(oldNode.id && newNode.id && oldNode.id === newNode.id) {
              newNode.isGeneratingMore = oldNode.isGeneratingMore;
            }
        }
        if (newNode.children) {
            newNode.children.forEach(newChild => {
                const oldChild = oldNode?.children?.find(oc => oc.data.name === newChild.data.name) || oldNode?._children?.find(oc => oc.data.name === newChild.data.name);
                preserveState(oldChild, newChild);
            });
        }
    };

    if (oldRoot && oldRoot.data.name === newRootNode.data.name && !isInitialLoad) {
        preserveState(oldRoot, newRootNode);
    }
    d3State.current.root = newRootNode;
    
    let sourceForAnimation: D3HierarchyNode = newRootNode; 

    if (isInitialLoad) {
      d3State.current.i = 0; // Reset node ID counter for new tree
      if (newRootNode.children) {
        newRootNode.children.forEach(child => {
          if (child.children) {
            collapseAll(child, false);
          }
        });
      }
      setIsFullyExpanded(false);
      setSelectedNodeForMoreButton(null); // Reset button on new tree

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = 0.6; 
          const initialXTranslate = margin.left;
          
          let maxDepth = 0;
          newRootNode.each(d => { if (d.depth > maxDepth) maxDepth = d.depth; });
          const approxGraphHeight = newRootNode.height ? (newRootNode.height + 1) * 35 * initialZoomScale : dimensions.height / 2;
          let yTranslate = Math.max(margin.top, (dimensions.height - approxGraphHeight) / 2);
          if (newRootNode.descendants().length * 35 * initialZoomScale > dimensions.height) { 
             yTranslate = margin.top + 20; 
          }
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, yTranslate).scale(initialZoomScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
      }
    } else { 
      // This is an update (e.g., adding more children)
      if (activeNodeGeneratingMore) { // If a node was actively fetching more children
        const findNodeByIdRecursive = (node: D3HierarchyNode, id: string): D3HierarchyNode | null => {
          if (node.id === id) return node;
          if (node.children) {
            for (const child of node.children) {
              const found = findNodeByIdRecursive(child, id);
              if (found) return found;
            }
          }
          if (node._children) {
            for (const child of node._children) {
              const found = findNodeByIdRecursive(child, id);
              if (found) return found;
            }
          }
          return null;
        };
        
        const modifiedNode = findNodeByIdRecursive(newRootNode, activeNodeGeneratingMore);
        if (modifiedNode) {
          if (modifiedNode._children) { // Ensure node is expanded to show new children
            modifiedNode.children = modifiedNode._children;
            modifiedNode._children = undefined;
          }
          sourceForAnimation = modifiedNode; 
        }
      }
    }
    
    updateChart(sourceForAnimation);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, collapseAll]); // activeNodeGeneratingMore removed from here to avoid loop, handled in its own effect


  // Effect to update node's generating state based on activeNodeGeneratingMore
  useEffect(() => {
    if (!d3State.current.root) return;
    let nodeChanged = false;
    let foundActiveNodeForAnimation: D3HierarchyNode | null = null;

    d3State.current.root.each(d => {
        const shouldBeGenerating = activeNodeGeneratingMore === d.id;
        if (d.isGeneratingMore !== shouldBeGenerating) {
            d.isGeneratingMore = shouldBeGenerating;
            nodeChanged = true;
            if (shouldBeGenerating) foundActiveNodeForAnimation = d;
        }
    });

    if (nodeChanged) {
        updateChart(foundActiveNodeForAnimation || d3State.current.root);
    }
  }, [activeNodeGeneratingMore, updateChart]);

  // Effect to update chart if selectedNodeForMoreButton changes (to show/hide button immediately)
  useEffect(() => {
    if (d3State.current.root) {
      const selectedNode = d3State.current.root.descendants().find(n => n.id === selectedNodeForMoreButton);
      updateChart(selectedNode || d3State.current.root);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeForMoreButton]);


  return (
    <div ref={graphWrapperRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }} className="bg-background border border-border rounded-lg">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button variant="outline" size="sm" onClick={handleToggleExpandAll} title={isFullyExpanded ? "Collapse All Nodes" : "Expand All Nodes"} disabled={!treeData || !!activeNodeGeneratingMore}>
            {isFullyExpanded ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="sr-only">{isFullyExpanded ? "Collapse All Nodes" : "Expand All Nodes"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPng} title="Export as PNG" disabled={!treeData || !!activeNodeGeneratingMore}>
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
