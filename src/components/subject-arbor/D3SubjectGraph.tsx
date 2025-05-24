
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNodeData } from '@/types';
import { Button } from '@/components/ui/button';
import { ImageIcon, Minimize, Maximize } from 'lucide-react';
import { toPng } from 'html-to-image';

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
}

interface D3HierarchyNode extends d3.HierarchyPointNode<TreeNodeData> {
  _children?: D3HierarchyNode[];
  children?: D3HierarchyNode[];
  x0?: number;
  y0?: number;
  id?: string;
}

export function D3SubjectGraph({ treeData, fieldOfStudy }: D3SubjectGraphProps) {
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
    i: number; 
    dimensions: { width: number; height: number };
  }>({ svg: null, g: null, root: null, treeLayout: null, zoomBehavior: null, i: 0, dimensions: {width: 0, height: 0}});

  const animationDuration = 750;
  const nodeRadius = 6; 

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
    if (!d3State.current.g || !d3State.current.root || !d3State.current.treeLayout || !tooltipRef.current) return;

    const { width, height } = d3State.current.dimensions;
    const margin = { top: 20, right: 120, bottom: 20, left: 120 }; 
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    if (innerWidth <=0 || innerHeight <=0) return;

    const g = d3State.current.g;
    const rootNode = d3State.current.root;
    const treeLayout = d3State.current.treeLayout.size([innerHeight, innerWidth]);
    const tooltip = d3.select(tooltipRef.current);

    const treeDataLayout = treeLayout(rootNode); 
    const nodes = treeDataLayout.descendants() as D3HierarchyNode[];
    const links = treeDataLayout.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    nodes.forEach(d => { d.y = d.depth * 180; });

    const effectiveSource = sourceNode || rootNode;

    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id || (d.id = (++d3State.current.i).toString()));

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || effectiveSource.y || 0},${effectiveSource.x0 || effectiveSource.x || 0})`)
      .on('click', (event, d) => handleClick(d))
      .on('mouseover', (event, dNode) => {
        tooltip.style('opacity', 1)
               .html(`<strong>${dNode.data.name}</strong>${dNode.data.description ? `<br><small style="display: block; margin-top: 4px;">${dNode.data.description}</small>` : ''}`)
               .style('left', (event.pageX + 15) + 'px')
               .style('top', (event.pageY - 28) + 'px');
        d3.select(event.currentTarget).select('circle').classed('hovered', true);
         g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source === dNode || l.target === dNode);
      })
      .on('mouseout', (event) => {
        tooltip.style('opacity', 0);
        d3.select(event.currentTarget).select('circle').classed('hovered', false);
        g.selectAll('path.link').classed('highlighted', false);
      });

    nodeEnter.append('circle')
      .attr('r', 1e-6);

    nodeEnter.append('text')
      .attr('dy', '.35em')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => d.data.name);

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
      .duration(animationDuration)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    nodeUpdate.select<SVGCircleElement>('circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        return classes;
      });

    nodeUpdate.select('text')
      .style('fill-opacity', 1);

    const nodeExit = node.exit().transition()
      .duration(animationDuration)
      .attr('transform', `translate(${effectiveSource.y || 0},${effectiveSource.x || 0})`) 
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    const link = g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
      .data(links, d => d.target.id!);

    const linkEnter = link.enter().insert('path', 'g')
      .attr('class', 'link')
      .attr('d', () => {
        const o = { x: effectiveSource.x0 || effectiveSource.x || 0, y: effectiveSource.y0 || effectiveSource.y || 0 };
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
  }, [animationDuration, nodeRadius]); 

  const collapse = useCallback((d: D3HierarchyNode) => {
    if (d.children) {
      d._children = d.children;
      d._children.forEach(collapse);
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
      d._children = d.children;
      d.children = undefined;
    } else if (d._children) { 
      d.children = d._children;
      d._children = undefined;
    }
    updateChart(d);
  }, [updateChart]);

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
    if (svgRef.current) {
      toPng(svgRef.current, { 
          backgroundColor: 'hsl(var(--background))', 
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
            
            const margin = { top: 20, right: 120, bottom: 20, left: 120 };
            d3State.current.g = svg.append('g')
                .attr('transform', `translate(${margin.left},${margin.top})`);
            
            d3State.current.treeLayout = d3.tree<TreeNodeData>();
        } 
        
        if (d3State.current.root) { 
            const margin = { top: 20, right: 120, bottom: 20, left: 120 };
            const innerWidth = width - margin.left - margin.right;
            const innerHeight = height - margin.top - margin.bottom;
            if(d3State.current.treeLayout && innerWidth > 0 && innerHeight > 0) {
              d3State.current.treeLayout.size([innerHeight, innerWidth]);
            }
            if (d3State.current.zoomBehavior && d3State.current.g) {
                const initialTransform = d3.zoomIdentity.translate(margin.left, margin.top).scale(1);
                svg.call(d3State.current.zoomBehavior.transform, initialTransform);
                d3State.current.g.attr('transform', initialTransform.toString());
            }
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
    if (!treeData || !d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g) d3State.current.g.selectAll("*").remove(); 
      d3State.current.root = null;
      return;
    }
    
    const { height } = d3State.current.dimensions;
    const rootNode = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    rootNode.x0 = height / 2; 
    rootNode.y0 = 0;
    d3State.current.root = rootNode;
    d3State.current.i = 0; 

    if (rootNode.children) {
      rootNode.children.forEach(child => {
        if (child.children) {
          collapse(child); 
        }
      });
    }
    setIsFullyExpanded(false); 
    
    const margin = { top: 20, right: 120, bottom: 20, left: 120 };
    if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
        const initialTransform = d3.zoomIdentity.translate(margin.left, margin.top).scale(1);
        d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
        d3State.current.g.attr('transform', initialTransform.toString());
    }

    updateChart(rootNode);

  }, [treeData, collapse, updateChart]); 

  return (
    <div ref={graphWrapperRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }} className="bg-background border border-border rounded-lg">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button variant="outline" size="sm" onClick={handleToggleExpandAll} title={isFullyExpanded ? "Collapse All" : "Expand All"}>
            {isFullyExpanded ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="sr-only">{isFullyExpanded ? "Collapse All" : "Expand All"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPng} title="Export as PNG">
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
          maxWidth: '250px', // Max width for tooltip
        }}
      ></div>
    </div>
  );
}
