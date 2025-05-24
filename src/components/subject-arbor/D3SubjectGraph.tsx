
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNodeData } from '@/types';
import { Button } from '@/components/ui/button';
import { ImageIcon, Minimize, Maximize, PlusCircle, Loader2 } from 'lucide-react'; // Added PlusCircle, Loader2
import { toPng } from 'html-to-image';

// Make D3HierarchyNode exportable or define it here if not already available globally
export interface D3HierarchyNode extends d3.HierarchyPointNode<TreeNodeData> {
  _children?: D3HierarchyNode[];
  children?: D3HierarchyNode[];
  x0?: number;
  y0?: number;
  id?: string;
  isGeneratingMore?: boolean; // To track loading state per node
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
  onGenerateMoreChildren: (targetNode: D3HierarchyNode, fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // General loading state from parent
}

export function D3SubjectGraph({ treeData, fieldOfStudy, onGenerateMoreChildren, isProcessingAction }: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null); 

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const [activeNodeForMore, setActiveNodeForMore] = useState<string | null>(null); // Store ID of node being processed
  
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
    margin: { top: 20, right: 180, bottom: 20, left: 120 } // Adjusted right margin for potential icons
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

  const updateChart = useCallback((sourceNode?: D3HierarchyNode) => {
    if (!d3State.current.g || !d3State.current.root || !d3State.current.treeLayout || !tooltipRef.current || !graphWrapperRef.current) return;
    
    const g = d3State.current.g;
    let rootNode = d3State.current.root; // Use let as it might be re-assigned if treeData changes
    const treeLayout = d3State.current.treeLayout;
    const tooltip = d3.select(tooltipRef.current);
    const currentGraphWrapper = graphWrapperRef.current;

    // Recompute the D3 hierarchy if treeData has changed externally (e.g. more children added)
    // This assumes treeData prop is a new object reference on change.
    if (treeData && d3State.current.root?.data !== treeData) {
        rootNode = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
        rootNode.x0 = d3State.current.root?.x0 || d3State.current.dimensions.height / 2;
        rootNode.y0 = d3State.current.root?.y0 || 0;
        d3State.current.root = rootNode;
        // If root was expanded, keep it expanded - or handle based on sourceNode if provided
    }
    if (!rootNode) return;


    const treeDataLayout = treeLayout(rootNode); 
    const nodes = treeDataLayout.descendants() as D3HierarchyNode[];
    const links = treeDataLayout.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    const effectiveSource = sourceNode || rootNode;

    // Nodes
    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id || (d.id = `${d.data.name}-${d.depth}-${++d3State.current.i}`)); // More robust ID

    // Enter new nodes
    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`)
      .on('click', (event, d) => {
        // Prevent node click if the "generate more" button was clicked
        if (d3.select(event.target).classed('generate-more-button-hitbox')) {
          return;
        }
        handleClick(d);
      })
      .on('mouseover', function(event, dNode) { // Use function to get 'this'
        const [mx, my] = d3.pointer(event, currentGraphWrapper);
        let tooltipContent = `<strong>${dNode.data.name}</strong>`;
        if (dNode.data.description && dNode.data.description.trim() !== '') {
          tooltipContent += `<br><small style="display: block; margin-top: 4px; color: hsl(var(--muted-foreground));">${dNode.data.description.trim()}</small>`;
        }
        tooltip.style('opacity', 1)
               .html(tooltipContent)
               .style('left', (mx + 15) + 'px')
               .style('top', (my + 10) + 'px'); 
        
        d3.select(this).select('circle.node-main-circle').classed('hovered', true);
        d3.select(this).select('.generate-more-group').style('opacity', 1);
        g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source === dNode || l.target === dNode);
      })
      .on('mouseout', function() { // Use function to get 'this'
        tooltip.style('opacity', 0);
        d3.select(this).select('circle.node-main-circle').classed('hovered', false);
        d3.select(this).select('.generate-more-group').style('opacity', 0);
        g.selectAll('path.link').classed('highlighted', false);
      });

    nodeEnter.append('circle')
      .attr('class', 'node-main-circle') // Differentiate main circle
      .attr('r', 1e-6);

    nodeEnter.append('text')
      .attr('dy', '.35em')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => d.data.name);

    // "Generate More" button group
    const generateMoreGroup = nodeEnter.append('g')
      .attr('class', 'generate-more-group')
      .style('opacity', 0) // Initially hidden
      .style('cursor', 'pointer')
      .attr('transform', `translate(${nodeRadius + generateMoreButtonRadius + 3}, 0)`) // Position to the right
      .on('click', async (event, dNode) => {
        event.stopPropagation(); // Prevent node's main click
        if (activeNodeForMore === dNode.id || isProcessingAction) return; // Prevent multiple clicks or if globally processing
        setActiveNodeForMore(dNode.id!);
        dNode.isGeneratingMore = true;
        updateChart(dNode); // Re-render to show loader on this node
        try {
          await onGenerateMoreChildren(dNode, fieldOfStudy);
          // Ensure the node is expanded if new children were added
          if (dNode._children || dNode.children) { // Check if it became a parent
            expand(dNode); // Ensure it's expanded
          }
        } catch (err) {
          console.error("Error generating more children from D3 graph:", err);
          // Toast is handled in page.tsx
        } finally {
          dNode.isGeneratingMore = false;
          setActiveNodeForMore(null);
          updateChart(dNode); // Re-render to remove loader and show new children
        }
      });
    
    // Hitbox for easier clicking on the small button
    generateMoreGroup.append('circle')
      .attr('class', 'generate-more-button-hitbox')
      .attr('r', generateMoreButtonRadius + 2)
      .style('fill', 'transparent');

    // Visual for "Generate More" button (PlusCircle)
    generateMoreGroup.append('path')
        .attr('d', PlusCircle.path) // Use path data from lucide
        .attr('transform', `translate(${-generateMoreButtonRadius}, ${-generateMoreButtonRadius}) scale(0.7)`) // Scale and center
        .style('stroke', 'hsl(var(--primary))')
        .style('stroke-width', '2px')
        .style('fill', 'hsl(var(--background))');
        
    // Loader for "Generate More" button
    generateMoreGroup.append('g')
      .attr('class', 'loader-icon')
      .attr('transform', `translate(${-generateMoreButtonRadius}, ${-generateMoreButtonRadius}) scale(0.7)`)
      .style('display', 'none') // Hidden by default
      .html(`<path d="${Loader2.path}" class="animate-spin"></path>`); // Lucide icon's path for Loader2


    // Update existing nodes
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
    
    nodeUpdate.select<SVGGElement>('.generate-more-group')
      .select('path') // The PlusCircle icon
      .style('display', d => d.isGeneratingMore ? 'none' : 'block');

    nodeUpdate.select<SVGGElement>('.generate-more-group')
      .select('g.loader-icon') // The Loader icon group
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');


    nodeUpdate.select('text')
      .style('fill-opacity', 1);

    // Remove exiting nodes
    const nodeExit = node.exit().transition()
      .duration(animationDuration)
      .attr('transform', `translate(${effectiveSource.y || 0},${effectiveSource.x || 0})`) 
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    // Links
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
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, treeData, activeNodeForMore, isProcessingAction]); 

  const collapse = useCallback((d: D3HierarchyNode) => {
    if (d.children) {
      d._children = d.children;
      // d._children.forEach(collapse); // Do not recursively collapse when one node is clicked
      d.children = undefined; 
    }
  }, []);
  
  const collapseAll = useCallback((d: D3HierarchyNode, keepRootChildren = false) => {
    if (d.children) {
        d._children = d.children;
        if (keepRootChildren && d === d3State.current.root) {
            d.children.forEach(child => {
                if(child.children) collapseAll(child, false); 
            });
        } else {
            d.children.forEach(child => collapseAll(child, false));
            d.children = undefined;
        }
    }
  }, []);


  const expand = useCallback((d: D3HierarchyNode) => {
    if (d._children) {
      d.children = d._children;
      d._children = undefined;
      // if (d.children) d.children.forEach(c => { if(c._children) expand(c); }); // Optionally expand one level more
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

  const handleClick = useCallback((d: D3HierarchyNode) => {
    if (d.children) { 
      collapse(d);
    } else if (d._children) { 
      expand(d);
    }
    updateChart(d);
  }, [updateChart, collapse, expand]);

  const handleToggleExpandAll = () => {
    if (!d3State.current.root) return;
    if (isFullyExpanded) {
      collapseAll(d3State.current.root, true); 
    } else {
      expandAll(d3State.current.root);
    }
    setIsFullyExpanded(!isFullyExpanded);
    updateChart(d3State.current.root);
  };
  
  const handleExportPng = useCallback(() => {
    if (svgRef.current && graphWrapperRef.current) {
      const wrapperStyle = getComputedStyle(graphWrapperRef.current);
      const backgroundColor = wrapperStyle.backgroundColor; 
      
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
              .scaleExtent([0.1, 5]) 
              .on('zoom', (event) => {
                if (d3State.current.g) {
                  d3State.current.g.attr('transform', event.transform);
                }
            });
            svg.call(d3State.current.zoomBehavior);
            
            d3State.current.g = svg.append('g')
                .attr('transform', `translate(${margin.left},${margin.top})`);
            
            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]); // Use nodeSize
        } 
        
        if (d3State.current.root) { 
            if (d3State.current.zoomBehavior && d3State.current.g && !sourceNode) { // only recenter if not updating from a source
                 const initialZoomScale = 0.8;
                 const initialXTranslate = margin.left;
                 const rootNodeExists = d3State.current.root;
                 const approxGraphHeight = rootNodeExists && rootNodeExists.height ? (rootNodeExists.height + 1) * 35 * initialZoomScale : height / 2;
                 const initialYTranslate = Math.max(margin.top, (height - approxGraphHeight) / 2);

                const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(initialZoomScale);
                svg.call(d3State.current.zoomBehavior.transform, initialTransform);
            }
            updateChart(d3State.current.root);
        }
    };
    
    let sourceNode: D3HierarchyNode | undefined = undefined; // Define sourceNode for resize
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getContainerDimensions]); // Removed updateChart from here as it caused issues, handled by treeData useEffect

  useEffect(() => {
    if (!d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g && !treeData) d3State.current.g.selectAll("*").remove(); 
      d3State.current.root = null;
      return;
    }
    
    if (!treeData) { // If treeData becomes null (e.g. new field submitted)
        if (d3State.current.g) d3State.current.g.selectAll("*").remove();
        d3State.current.root = null;
        return;
    }

    const { margin, dimensions } = d3State.current;
    const initialX0 = dimensions.height / 2 || 200; 

    const isInitialLoad = !d3State.current.root;

    // Create new hierarchy from treeData prop
    const newRootNode = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    newRootNode.x0 = d3State.current.root?.x0 || initialX0; // Preserve position if root exists
    newRootNode.y0 = d3State.current.root?.y0 || 0;
    
    d3State.current.root = newRootNode;
    
    if (isInitialLoad) {
      d3State.current.i = 0; // Reset ID counter on full new load
      // Collapse children of the root's children (level 2+ nodes) for initial load
      if (newRootNode.children) {
        newRootNode.children.forEach(child => {
          if (child.children) { 
            collapseAll(child, false); // Collapse all descendants of this child
          }
        });
      }
      setIsFullyExpanded(false); 

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = 0.8;
          const initialXTranslate = margin.left;
          const approxGraphHeight = newRootNode.height ? (newRootNode.height + 1) * 35 * initialZoomScale : dimensions.height / 2;
          const initialYTranslate = Math.max(margin.top, (dimensions.height - approxGraphHeight) / 2);
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(initialZoomScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
      }
    }
    
    updateChart(newRootNode); // Update with the new root

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, collapseAll, updateChart]); // updateChart is memoized, so this is fine

  return (
    <div ref={graphWrapperRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }} className="bg-background border border-border rounded-lg">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button variant="outline" size="sm" onClick={handleToggleExpandAll} title={isFullyExpanded ? "Collapse All" : "Expand All"} disabled={!treeData || isProcessingAction}>
            {isFullyExpanded ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="sr-only">{isFullyExpanded ? "Collapse All" : "Expand All"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPng} title="Export as PNG" disabled={!treeData || isProcessingAction}>
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
          transition: 'opacity 0.2s ease-out',
          boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
          zIndex: 10, 
          maxWidth: '250px', 
        }}
      ></div>
    </div>
  );
}

    