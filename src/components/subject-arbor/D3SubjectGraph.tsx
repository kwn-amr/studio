
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
  id: string; // Ensure ID is always present
  isGeneratingMore?: boolean;
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
  onGenerateMoreChildren: (targetNodePath: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean;
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
    nodeIdCounter: number; // Changed from i to nodeIdCounter for clarity
    dimensions: { width: number; height: number };
    margin: { top: number; right: number; bottom: number; left: number };
  }>({
    svg: null,
    g: null,
    root: null,
    treeLayout: null,
    zoomBehavior: null,
    nodeIdCounter: 0,
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

  const generateNodeId = useCallback((nodeData: TreeNodeData, depth: number): string => {
    // Create a more stable ID if possible, otherwise fallback to counter
    // This example uses a counter for simplicity if names aren't unique across the tree
    return `${nodeData.name.replace(/[^a-zA-Z0-9-_]/g, '')}-${depth}-${++d3State.current.nodeIdCounter}`;
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

    // Assign IDs if not already present (e.g., for newly added nodes from treeData update)
    nodes.forEach(d => {
        if (!d.id) { // Check if id is undefined or empty
            d.id = generateNodeId(d.data, d.depth);
        }
    });


    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id); // Use existing ID for data binding

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`)
      .on('click', async (event, dNode) => {
        if (dNode.isGeneratingMore) return; // Don't allow actions if already generating for this node

        // Toggle expansion/collapse
        if (dNode.children) { // If expanded, collapse it
            dNode._children = dNode.children;
            dNode.children = undefined;
        } else if (dNode._children) { // If collapsed, expand it
            dNode.children = dNode._children;
            dNode._children = undefined;
        }
        // updateChart(dNode); // Update for collapse/expand

        // If already generating globally or for this node (checked again), do nothing more for generation.
        if (activeNodeGeneratingMore === dNode.id || isProcessingAction) {
          updateChart(dNode); // Still update for expand/collapse
          return;
        }

        // If it has no children and no _children (it's a leaf), try to generate more.
        // Or if it was just expanded and has children, but user might want more.
        // For simplicity, let's always allow trying to generate more if not already loading.
        // The AI flow should handle cases where no more children can be found.

        dNode.isGeneratingMore = true;
        setActiveNodeGeneratingMore(dNode.id);
        updateChart(dNode); // Update chart again to show loader

        try {
          const path: string[] = dNode.ancestors().map(n => n.data.name).reverse();
          await onGenerateMoreChildren(path, fieldOfStudy);
          // activeNodeGeneratingMore will be reset by page.tsx, which triggers useEffect to update node state
        } catch (err) {
          console.error("Error in onGenerateMoreChildren callback from D3 graph:", err);
          // Reset loading state on error here as well
          if (dNode.isGeneratingMore) {
              dNode.isGeneratingMore = false;
          }
          if (activeNodeGeneratingMore === dNode.id) {
              setActiveNodeGeneratingMore(null); // This will trigger the useEffect to update visuals
          } else {
            updateChart(dNode); // If activeNodeGeneratingMore was already null for some reason
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

        if (left + tooltipWidth + 10 > wrapperWidth) { // 10px buffer from edge
            left = mx - tooltipWidth - 15; 
        }
        if (left < 5) left = 5; // 5px buffer from left edge

        if (top + tooltipHeight + 10 > wrapperHeight) { // 10px buffer from bottom
            top = my - tooltipHeight - 10; 
        }
        if (top < 5) top = 5; // 5px buffer from top edge
        
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
      .style('display', 'none')
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
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, activeNodeGeneratingMore, isProcessingAction, generateNodeId]);


  const collapseAllNodesRecursive = useCallback((d: D3HierarchyNode, keepRootChildren = false) => {
    if (d.children) {
      if (!keepRootChildren || d !== d3State.current.root) { // If not root OR if root but not keeping its children
        d._children = d.children;
        d.children.forEach(child => collapseAllNodesRecursive(child, false)); // Always fully collapse children
        d.children = undefined;
      } else { // Is root and we want to keep its direct children expanded
        d.children.forEach(child => collapseAllNodesRecursive(child, false)); // Collapse children of root's children
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
      collapseAllNodesRecursive(d3State.current.root, true); // Keep root's direct children
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

            d3State.current.g = svg.append('g'); // Initial transform will be set later
            
            // Use nodeSize for consistent spacing
            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]); 
        }
        
        // Center graph on resize if root exists
        if (d3State.current.root && d3State.current.g && d3State.current.svg && d3State.current.zoomBehavior) {
            const { margin } = d3State.current;
            const initialXTranslate = margin.left; // Keep root relatively left
            const initialYTranslate = height / 2;  // Center vertically
            const currentTransform = d3.zoomTransform(d3State.current.svg.node()!);
            
            const newTransform = d3.zoomIdentity
                .translate(initialXTranslate, initialYTranslate)
                .scale(currentTransform.k); // Keep current scale

            d3State.current.svg.call(d3State.current.zoomBehavior.transform, newTransform);
            updateChart(d3State.current.root); // Re-render with new layout if needed
        } else if (d3State.current.root) {
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
  }, [getContainerDimensions]); // updateChart removed as it's called internally

  useEffect(() => {
    if (!d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g && !treeData) { // Clear graph if treeData becomes null
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
    const initialX0 = dimensions.height / 2; // For initial positioning of root x
    const initialY0 = 0; // For initial positioning of root y

    const isInitialLoad = !d3State.current.root || d3State.current.root.data.name !== treeData.name;
    const oldRoot = d3State.current.root;

    const newRootNodeFromData = d3.hierarchy(treeData, d => d.children);
    
    // Ensure all nodes in the new hierarchy get a unique ID
    // And preserve expansion state from old hierarchy if this isn't an initial load
    d3State.current.nodeIdCounter = 0; // Reset counter for fresh ID assignment if needed
    
    const transferExpansionState = (newNode: d3.HierarchyNode<TreeNodeData>, oldNode?: D3HierarchyNode): D3HierarchyNode => {
        const typedNewNode = newNode as D3HierarchyNode;
        typedNewNode.id = oldNode?.id || generateNodeId(newNode.data, newNode.depth);

        if (oldNode) {
            if (oldNode._children && !oldNode.children) { // oldNode was collapsed
                if (typedNewNode.children && typedNewNode.children.length > 0) {
                    typedNewNode._children = typedNewNode.children;
                    typedNewNode.children = undefined;
                } else {
                    typedNewNode._children = undefined;
                }
            }
            // If oldNode was expanded, typedNewNode.children (from d3.hierarchy) is correct.
        }
        
        typedNewNode.isGeneratingMore = activeNodeGeneratingMore === typedNewNode.id;

        const currentChildrenSource = typedNewNode.children || typedNewNode._children;
        if (currentChildrenSource) {
            const mappedChildren = currentChildrenSource.map(newChildData => {
                let correspondingOldChild: D3HierarchyNode | undefined = undefined;
                if (oldNode) {
                    const oldSourceChildren = oldNode.children || oldNode._children;
                    if (oldSourceChildren) {
                        correspondingOldChild = oldSourceChildren.find(oc => oc.data.name === newChildData.data.name);
                    }
                }
                return transferExpansionState(newChildData, correspondingOldChild);
            });
            if (typedNewNode.children) typedNewNode.children = mappedChildren;
            else if (typedNewNode._children) typedNewNode._children = mappedChildren;
        }
        return typedNewNode;
    };
    
    const newRootNode = transferExpansionState(newRootNodeFromData, isInitialLoad ? undefined : oldRoot!);
    newRootNode.x0 = oldRoot?.x0 || initialX0;
    newRootNode.y0 = oldRoot?.y0 || initialY0;
    
    d3State.current.root = newRootNode;
    
    let sourceForAnimation: D3HierarchyNode = newRootNode; 

    if (isInitialLoad) {
      d3State.current.nodeIdCounter = 0; // Reset for new tree
      newRootNode.eachBefore(n => { // Assign IDs consistently on initial load
          (n as D3HierarchyNode).id = generateNodeId(n.data, n.depth);
      });

      if (newRootNode.children) {
        newRootNode.children.forEach(child => {
          if ((child as D3HierarchyNode).children) { // If child has its own children
            collapseAllNodesRecursive(child as D3HierarchyNode, false); // Collapse them
          }
        });
      }
      setIsFullyExpanded(false);

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = Math.min(0.8, dimensions.width / (newRootNode.height * 220 + margin.left + margin.right), dimensions.height / (newRootNode.descendants().length * 35 + margin.top + margin.bottom)); 
          const initialXTranslate = margin.left + 50; // Give some left padding for root node
          const initialYTranslate = dimensions.height / 2;
          
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(initialZoomScale > 0 ? initialZoomScale : 0.5);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
          d3State.current.g.attr("transform", initialTransform.toString()); // Apply transform to g
      }
    } else { // If it's an update
        if (activeNodeGeneratingMore) {
            const findNodeByIdRecursive = (node: D3HierarchyNode, id: string): D3HierarchyNode | null => {
                if (node.id === id) return node;
                const childrenToSearch = node.children || node._children;
                if (childrenToSearch) {
                    for (const child of childrenToSearch) {
                        const found = findNodeByIdRecursive(child, id);
                        if (found) return found;
                    }
                }
                return null;
            };
            
            const modifiedNode = findNodeByIdRecursive(newRootNode, activeNodeGeneratingMore);
            if (modifiedNode) {
                if (modifiedNode._children) { 
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
  }, [treeData, activeNodeGeneratingMore, fieldOfStudy, generateNodeId]);


  useEffect(() => {
    if (!d3State.current.root || !d3State.current.g) return;
    let nodeChanged = false;
    let foundActiveNodeForAnimation: D3HierarchyNode | null = null;

    d3State.current.root.each(node => {
        const d = node as D3HierarchyNode;
        const shouldBeGenerating = activeNodeGeneratingMore === d.id;
        if (d.isGeneratingMore !== shouldBeGenerating) {
            d.isGeneratingMore = shouldBeGenerating;
            nodeChanged = true;
            if (shouldBeGenerating) {
              foundActiveNodeForAnimation = d;
            } else if (d.isGeneratingMore === false && !shouldBeGenerating) {
              // Node just finished generating. Ensure it's expanded.
              if (d._children) {
                d.children = d._children;
                d._children = undefined;
              }
              foundActiveNodeForAnimation = d;
            }
        }
    });

    if (nodeChanged) {
        updateChart(foundActiveNodeForAnimation || d3State.current.root);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeGeneratingMore]);


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

