import assert from 'node:assert';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, it } from 'mocha';

import {
  applyLaneMembership
} from '../lib/layout/process/placement/LanePlacement.js';

import type { LayoutState } from '../lib/layout/Types.js';

const moddle = new BpmnModdle();

type FlowEdge = Parameters<typeof applyLaneMembership>[2][number];
type LaneRecord = Parameters<typeof applyLaneMembership>[1][number];
type LanePolicy = Parameters<typeof applyLaneMembership>[3];

describe('LanePlacement', function() {

  it('should validate, measure, and position lane content', function() {
    const task = moddle.create('bpmn:Task', { id: 'Task' });
    const lane = moddle.create('bpmn:Lane', {
      id: 'Lane',
      flowNodeRef: [ task ]
    });
    const scope = moddle.create('bpmn:Process', {
      laneSets: [ moddle.create('bpmn:LaneSet', { lanes: [ lane ] }) ]
    });
    const record: LaneRecord = {
      element: task,
      index: 0,
      size: { width: 100, height: 80 },
      isBoundary: false,
      isArtifact: false,
      expanded: false,
      child: null,
      bounds: { x: 0, y: 0, width: 100, height: 80 }
    };
    const layout: LayoutState = {
      scope,
      shapes: new Map(),
      edges: new Map(),
      children: [],
      emitInParent: false
    };
    const policy: LanePolicy = {
      backEdges: new Set<FlowEdge>(),
      straightEdges: new Set<FlowEdge>()
    };

    applyLaneMembership(scope, [ record ], [], policy, layout);

    assert.deepStrictEqual(layout.shapes.get(lane), {
      x: 0,
      y: 0,
      width: 380,
      height: 240
    });
    assert.deepStrictEqual(record.bounds, {
      x: 40,
      y: 80,
      width: 100,
      height: 80
    });
  });


  describe('rows and unassigned nodes', function() {

    function setup(
        nodes: Array<{ id: string; x: number; y: number; lane?: string }>,
        flows: Array<[ string, string ]>
    ) {
      const elements = new Map(nodes.map(node => {
        return [ node.id, moddle.create('bpmn:Task', { id: node.id }) ];
      }));
      const element = (id: string) => {
        const found = elements.get(id);

        if (!found) {
          throw new Error(`no node ${ id }`);
        }

        return found;
      };
      const laneIds = [ ...new Set(nodes.flatMap(node => node.lane ? [ node.lane ] : [])) ];
      const lanes = laneIds.map(id => moddle.create('bpmn:Lane', {
        id,
        flowNodeRef: nodes.filter(node => node.lane === id).map(node => element(node.id))
      }));
      const scope = moddle.create('bpmn:Process', {
        laneSets: [ moddle.create('bpmn:LaneSet', { lanes }) ]
      });
      const records: LaneRecord[] = nodes.map((node, index) => ({
        element: element(node.id),
        index,
        size: { width: 100, height: 80 },
        isBoundary: false,
        isArtifact: false,
        expanded: false,
        child: null,
        bounds: { x: node.x, y: node.y, width: 100, height: 80 }
      }));
      const edges = flows.map(([ source, target ]) => {
        const flow = moddle.create('bpmn:SequenceFlow', {
          sourceRef: element(source),
          targetRef: element(target)
        });

        return flow as unknown as FlowEdge;
      });

      for (const edge of edges) {
        edge.sourceRef.outgoing = [ ...(edge.sourceRef.outgoing || []), edge ];
        edge.targetRef.incoming = [ ...(edge.targetRef.incoming || []), edge ];
      }

      const layout: LayoutState = {
        scope,
        shapes: new Map(),
        edges: new Map(),
        children: [],
        emitInParent: false
      };
      const policy: LanePolicy = {
        backEdges: new Set<FlowEdge>(),
        straightEdges: new Set<FlowEdge>()
      };

      applyLaneMembership(scope, records, edges, policy, layout);

      const byId = new Map(records.map(record => [ record.element.id, record.bounds ]));
      const laneById = new Map(lanes.map(lane => [ lane.id, layout.shapes.get(lane) ]));

      return { byId, laneById };
    }

    it('should place a node without lane in the lane of its predecessor', function() {
      const { byId, laneById } = setup([
        { id: 'A', x: 0, y: 0, lane: 'L1' },
        { id: 'B', x: 0, y: 200, lane: 'L2' },
        { id: 'End', x: 200, y: 0 }
      ], [ [ 'B', 'End' ] ]);

      const lane2 = laneById.get('L2');
      const end = byId.get('End');

      assert.ok(lane2 && end);
      assert.ok(end.y >= lane2.y && end.y + end.height <= lane2.y + lane2.height);
    });

    it('should share a row between rows that never overlap', function() {
      const { byId, laneById } = setup([
        { id: 'A', x: 0, y: 0, lane: 'L' },
        { id: 'B', x: 600, y: 200, lane: 'L' }
      ], []);

      assert.strictEqual(byId.get('A')?.y, byId.get('B')?.y);
      assert.strictEqual(laneById.get('L')?.height, 240);
    });

    it('should keep rows apart that a lane flow connects across', function() {
      const { byId } = setup([
        { id: 'A', x: 0, y: 200, lane: 'L' },
        { id: 'B', x: 400, y: 0, lane: 'L' },
        { id: 'C', x: 800, y: 0, lane: 'L' },
        { id: 'D', x: 400, y: 400, lane: 'Other' }
      ], [ [ 'A', 'C' ], [ 'A', 'D' ] ]); // A splits: not a straight continuation

      assert.notStrictEqual(byId.get('A')?.y, byId.get('B')?.y);
    });

    it('should keep rows apart that overlap horizontally', function() {
      const { byId } = setup([
        { id: 'A', x: 0, y: 0, lane: 'L' },
        { id: 'B', x: 50, y: 200, lane: 'L' }
      ], []);

      assert.notStrictEqual(byId.get('A')?.y, byId.get('B')?.y);
    });
  });
});
