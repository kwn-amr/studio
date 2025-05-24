
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
}

// Helper to generate a stable path-based ID for a D3 node
const generatePathId = (d: d3.HierarchyNode<TreeNodeData>): string => {
  return d.ancestors().map(node => node.data.name.replace(/[/\s#?&]/g, '_')).reverse().join('/');
};


export function D3SubjectGraph({ treeData, fieldOfStudy, onGenerateMoreChildren, isProcessingAction }: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null);

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const [activeNodeGeneratingMore, setActiveNodeGeneratingMore] = useState<string | null>(null);
  // const [selectedNodeForMoreButton, setSelectedNodeForMoreButton] = useState<string | null>(null);


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
  const nodeRadius = 6; // Corresponds to --node-radius in CSS
  const loaderIconRadius = 8; // For the Loader2 icon size adjustments

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
    let rootNode = d3State.current.root; // This is the D3 hierarchy root
    const treeLayout = d3State.current.treeLayout;
    const tooltip = d3.select(tooltipRef.current);
    const currentGraphWrapper = graphWrapperRef.current;
    
    if (!rootNode) return;

    const treeDataLayout = treeLayout(rootNode);
    const nodes = treeDataLayout.descendants() as D3HierarchyNode[];
    const links = treeDataLayout.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    const effectiveSource = sourceNodeParam || rootNode;
    
    // Ensure all nodes have x0, y0 for animations if not set
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
        if (dNode.isGeneratingMore || isProcessingAction || activeNodeGeneratingMore) return; 

        // Toggle expansion/collapse
        if (dNode.children) { 
            dNode._children = dNode.children;
            dNode.children = undefined;
        } else if (dNode._children) { 
            dNode.children = dNode._children;
            dNode._children = undefined;
        }
        updateChart(dNode); // Update for collapse/expand

        if (activeNodeGeneratingMore === dNode.id || dNode.isGeneratingMore) {
          return;
        }
        
        dNode.isGeneratingMore = true;
        setActiveNodeGeneratingMore(dNode.id!); 
        updateChart(dNode); // Update chart again to show loader

        try {
          const path: string[] = dNode.ancestors().map(n => n.data.name).reverse();
          await onGenerateMoreChildren(path, fieldOfStudy);
        } catch (err) {
          console.error("Error in onGenerateMoreChildren callback from D3 graph:", err);
          if (dNode.isGeneratingMore) dNode.isGeneratingMore = false;
          if (activeNodeGeneratingMore === dNode.id) setActiveNodeGeneratingMore(null); 
          else updateChart(dNode);
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
    
    // Loader Icon Group (appended directly to nodeEnter)
    const loaderGroupEnter = nodeEnter.append('g')
      .attr('class', 'node-loader-group')
      .style('display', 'none') // Initially hidden
      .attr('transform', `translate(0,0)`) // Position relative to node center
      .style('pointer-events', 'none'); // Does not interfere with clicks on main node

    // Backdrop for loader (optional, helps visibility if node color is similar to loader)
    loaderGroupEnter.append('circle')
      .attr('r', loaderIconRadius + 2) // Slightly larger than spinner
      .attr('class', 'node-loader-backdrop');

    // Loader icon itself
    loaderGroupEnter.append('path')
      .attr('d', Loader2.path) // Using path data from lucide-react
      .attr('class', 'node-loader-spinner animate-spin') // Tailwind class for spin
      .attr('transform', `translate(${-loaderIconRadius/1.5}, ${-loaderIconRadius/1.5}) scale(0.6)`); // Adjust size and position


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
        if (d.isGeneratingMore) classes += ' node-loading'; // For dimming effect
        return classes;
      });
    
    // Control visibility of the loader group based on d.isGeneratingMore
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
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, isProcessingAction, activeNodeGeneratingMore]);


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
          backgroundColor: backgroundColor, // Use computed background color
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
            
            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]); 
        }
        
        if (d3State.current.root && d3State.current.g && d3State.current.svg && d3State.current.zoomBehavior) {
            const { margin } = d3State.current;
            const initialXTranslate = margin.left; 
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
    const initialX0 = dimensions.height / 2; 
    const initialY0 = 0; 

    const isInitialLoad = !d3State.current.root || d3State.current.root.data.name !== treeData.name || d3State.current.root.id !== generatePathId(d3.hierarchy(treeData)); // Compare root ID as well
    const oldRoot = d3State.current.root;

    // Create a map of old node states (id -> {isCollapsed, x0, y0})
    const oldNodeStates = new Map<string, { isCollapsed: boolean; x0?: number; y0?: number }>();
    if (oldRoot && !isInitialLoad) {
        oldRoot.eachBefore(node => {
            const d3Node = node as D3HierarchyNode;
            if (d3Node.id) { // Ensure id exists
                oldNodeStates.set(d3Node.id, {
                    isCollapsed: !!d3Node._children,
                    x0: d3Node.x0,
                    y0: d3Node.y0,
                });
            }
        });
    }
    
    const newRootHierarchy = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;

    // Assign IDs and transfer/determine expansion state
    newRootHierarchy.eachBefore((nodeUntyped) => {
        const dNode = nodeUntyped as D3HierarchyNode;
        dNode.id = generatePathId(dNode); // Generate stable path-based ID
        dNode.isGeneratingMore = activeNodeGeneratingMore === dNode.id;

        const oldState = oldNodeStates.get(dNode.id);

        if (oldState) {
            dNode.x0 = oldState.x0;
            dNode.y0 = oldState.y0;
            if (oldState.isCollapsed && dNode.children) { // Node was collapsed, data has children
                dNode._children = dNode.children;
                dNode.children = undefined;
            }
            // If oldState was expanded, dNode.children (from d3.hierarchy) is correct
        } else { // New node or ID changed (shouldn't happen with path IDs if names are stable)
            dNode.x0 = dNode.parent ? (dNode.parent as D3HierarchyNode).x0 : initialX0;
            dNode.y0 = dNode.parent ? (dNode.parent as D3HierarchyNode).y0 : initialY0;
            if (!isInitialLoad) { // Not initial load, this is a new node appearing in the structure
                 // Default to collapsed if it's not a direct child of the node being expanded, or not root's direct child
                let collapseNew = true;
                if (activeNodeGeneratingMore) {
                    let p = dNode.parent as D3HierarchyNode | null;
                    if (p && p.id === activeNodeGeneratingMore) { // Direct child of actively expanding node
                        collapseNew = false;
                    }
                } else if (dNode.depth <=1) { // Root or its direct children
                    collapseNew = false;
                }

                if (collapseNew && dNode.children) {
                    dNode._children = dNode.children;
                    dNode.children = undefined;
                }
            }
        }
    });
    
    d3State.current.root = newRootHierarchy;
    
    let sourceForAnimation: D3HierarchyNode = newRootHierarchy; 
    
    if (isInitialLoad) {
      if (newRootHierarchy.children) {
        newRootHierarchy.children.forEach(child => {
          if ((child as D3HierarchyNode).children) { 
            collapseAllNodesRecursive(child as D3HierarchyNode, false); 
          }
        });
      }
      setIsFullyExpanded(false);

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = Math.min(0.8, dimensions.width / (newRootHierarchy.height * 220 + margin.left + margin.right), dimensions.height / (newRootHierarchy.descendants().length * 35 + margin.top + margin.bottom)); 
          const initialXTranslate = margin.left + 50; 
          const initialYTranslate = dimensions.height / 2;
          
          const initialTransform = d3.zoomIdentity.translate(initialXTranslate, initialYTranslate).scale(initialZoomScale > 0 ? initialZoomScale : 0.5);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
          d3State.current.g.attr("transform", initialTransform.toString()); 
      }
    } else { 
        if (activeNodeGeneratingMore) {
            const findNodeByIdRecursive = (node: D3HierarchyNode | null, id: string): D3HierarchyNode | null => {
                if (!node) return null;
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
            
            const modifiedNode = findNodeByIdRecursive(newRootHierarchy, activeNodeGeneratingMore);
            if (modifiedNode) {
                if (modifiedNode._children) { 
                    modifiedNode.children = modifiedNode._children;
                    modifiedNode._children = undefined;
                }
                // modifiedNode.isGeneratingMore = false; // This is handled by the other useEffect
                sourceForAnimation = modifiedNode; 
            }
        }
    }
    
    updateChart(sourceForAnimation);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, fieldOfStudy, collapseAllNodesRecursive, updateChart]); // activeNodeGeneratingMore removed, handled by its own effect


  useEffect(() => {
    if (!d3State.current.root || !d3State.current.g) return;
    let nodeChanged = false;
    let foundActiveNodeForAnimation: D3HierarchyNode | null = null;

    d3State.current.root.eachBefore(node => { // eachBefore is fine here
        const d = node as D3HierarchyNode;
        if (!d.id) d.id = generatePathId(d); // Ensure ID exists for comparison

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
  }, [activeNodeGeneratingMore, updateChart]);


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

