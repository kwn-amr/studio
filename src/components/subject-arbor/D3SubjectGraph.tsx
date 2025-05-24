
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
  id?: string;
  isGeneratingMore?: boolean;
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
  onGenerateMoreChildren: (targetNodePath: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean; // Overall loading state from parent page (e.g., initial tree generation)
}

export function D3SubjectGraph({ treeData, fieldOfStudy, onGenerateMoreChildren, isProcessingAction }: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null);

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const [activeNodeGeneratingMore, setActiveNodeGeneratingMore] = useState<string | null>(null);

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
      .on('click', async (event, dNode) => {
        // Toggle expansion/collapse
        if (dNode.children) {
            dNode._children = dNode.children;
            dNode.children = undefined;
        } else if (dNode._children) {
            dNode.children = dNode._children;
            dNode._children = undefined;
        }
        // Update chart for expand/collapse first, this might be deferred if generating more
        // updateChart(dNode); // Let's see if the subsequent updateChart is enough

        // If already generating for this node or a global action is processing, do nothing more for generation.
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction || dNode.isGeneratingMore) {
            updateChart(dNode); // Ensure visual update for expand/collapse even if not generating
            return;
        }

        // Set loading state for this node
        dNode.isGeneratingMore = true;
        setActiveNodeGeneratingMore(dNode.id!);
        updateChart(dNode); // Update chart again to show loader

        try {
          const path: string[] = dNode.ancestors().map(n => n.data.name).reverse();
          await onGenerateMoreChildren(path, fieldOfStudy);
          // activeNodeGeneratingMore and dNode.isGeneratingMore will be reset via useEffect watching treeData
        } catch (err) {
          console.error("Error in onGenerateMoreChildren callback from D3 graph:", err);
          if (dNode.isGeneratingMore) {
              dNode.isGeneratingMore = false;
          }
          if (activeNodeGeneratingMore === dNode.id) {
              setActiveNodeGeneratingMore(null);
          }
          updateChart(dNode); // Re-render to hide loader on error
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

        let left = mx + 15;
        let top = my + 10;

        if (left + tooltipWidth > wrapperWidth - 10) {
            left = mx - tooltipWidth - 15; 
        }
        if (left < 5) left = 5;

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
    
    // Add loader icon group directly to the node
    const loaderIconGroup = nodeEnter.append('g')
      .attr('class', 'node-loader-group')
      .style('display', 'none') 
      .attr('transform', `translate(0,0)`)
      .style('pointer-events', 'none');

    loaderIconGroup.append('circle')
      .attr('r', loaderIconRadius + 2) // Slightly larger backdrop
      .attr('class', 'node-loader-backdrop');

    loaderIconGroup.append('path')
      .attr('d', Loader2.path) // Using Lucide path directly
      .attr('class', 'node-loader-spinner animate-spin')
      .attr('transform', `translate(${-loaderIconRadius / 1.5}, ${-loaderIconRadius / 1.5}) scale(0.6)`);


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
        classes += (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        if (d.isGeneratingMore) classes += ' node-loading';
        return classes;
      });
    
    nodeUpdate.select<SVGGElement>('.node-loader-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');
    
    nodeUpdate.select('text')
      .style('fill-opacity', d => d.isGeneratingMore ? 0.3 : 1);


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
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, activeNodeGeneratingMore, isProcessingAction]);


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
    if (!d3State.current.root || activeNodeGeneratingMore) return;
    if (isFullyExpanded) {
      collapseAll(d3State.current.root, true);
    } else {
      expandAll(d3State.current.root);
    }
    setIsFullyExpanded(!isFullyExpanded);
    updateChart(d3State.current.root);
  };

  const handleExportPng = useCallback(() => {
    if (svgRef.current && graphWrapperRef.current && !activeNodeGeneratingMore) {
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
  }, [fieldOfStudy, activeNodeGeneratingMore]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getContainerDimensions]);

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
    
    const preserveStateAndMarkActive = (oldNode: D3HierarchyNode | undefined, newNode: D3HierarchyNode) => {
        if (oldNode) {
            if (oldNode._children && !oldNode.children) {
                if (newNode.children && newNode.children.length > 0) { 
                    newNode._children = newNode.children;
                    newNode.children = undefined;
                } else { 
                    newNode._children = undefined;
                }
            }
            // Preserve ID if it exists to maintain selection/state across re-renders
            if(oldNode.id) newNode.id = oldNode.id;
        }
        // Mark the node if it's the one actively generating more children
        newNode.isGeneratingMore = activeNodeGeneratingMore === newNode.id;

        if (newNode.children) {
            newNode.children.forEach(newChild => {
                const oldChild = oldNode?.children?.find(oc => oc.data.name === newChild.data.name) || oldNode?._children?.find(oc => oc.data.name === newChild.data.name);
                preserveStateAndMarkActive(oldChild, newChild);
            });
        }
         if (newNode._children) { // Also traverse _children if they exist
            newNode._children.forEach(newChild => {
                const oldChild = oldNode?.children?.find(oc => oc.data.name === newChild.data.name) || oldNode?._children?.find(oc => oc.data.name === newChild.data.name);
                preserveStateAndMarkActive(oldChild, newChild);
            });
        }
    };

    if (oldRoot && oldRoot.data.name === newRootNode.data.name && !isInitialLoad) {
        preserveStateAndMarkActive(oldRoot, newRootNode);
    } else {
        // For initial load, also mark any active node if applicable (though unlikely for initial)
        newRootNode.each(n => n.isGeneratingMore = activeNodeGeneratingMore === n.id);
    }
    d3State.current.root = newRootNode;
    
    let sourceForAnimation: D3HierarchyNode = newRootNode; 

    if (isInitialLoad) {
      d3State.current.i = 0; 
      if (newRootNode.children) {
        newRootNode.children.forEach(child => {
          if (child.children) {
            collapseAll(child, false);
          }
        });
      }
      setIsFullyExpanded(false);

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = 0.6; 
          const initialXTranslate = margin.left;
          
          let maxDepth = 0;
          newRootNode.each(d => { if (d.depth > maxDepth) maxDepth = d.depth; });
          
          const approxGraphHeight = newRootNode.descendants().length * 35 * initialZoomScale; // 35 is vertical nodeSize
          let yTranslate = Math.max(margin.top, (dimensions.height - approxGraphHeight) / 2);
          
          if (newRootNode.descendants().length * 35 * initialZoomScale > dimensions.height) { 
             yTranslate = margin.top + 20; 
          }
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, yTranslate).scale(initialZoomScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
      }
    } else { 
      if (activeNodeGeneratingMore) {
        const findNodeByIdRecursive = (node: D3HierarchyNode, id: string): D3HierarchyNode | null => {
          if (node.id === id) return node;
          if (node.children) {
            for (const child of node.children) {
              const found = findNodeByIdRecursive(child, id);
              if (found) return found;
            }
          }
          if (node._children) { // Check collapsed children too
            for (const child of node._children) {
              const found = findNodeByIdRecursive(child, id);
              if (found) return found;
            }
          }
          return null;
        };
        
        const modifiedNode = findNodeByIdRecursive(newRootNode, activeNodeGeneratingMore);
        if (modifiedNode) {
          if (modifiedNode._children) { // Ensure it's expanded to show new children
            modifiedNode.children = modifiedNode._children;
            modifiedNode._children = undefined;
          }
          modifiedNode.isGeneratingMore = false; 
          sourceForAnimation = modifiedNode; 
        }
      }
    }
    
    updateChart(sourceForAnimation);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, activeNodeGeneratingMore]); // Added activeNodeGeneratingMore


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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeGeneratingMore]); // This effect responds to external changes in activeNodeGeneratingMore


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
