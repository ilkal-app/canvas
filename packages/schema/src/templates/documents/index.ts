// The templates' board documents, apart from their metadata so the app never bundles them.
// Each is the owner-approved board exported as portable JSON, one file per template, with the
// export's ids and coordinates; its root frame is named after the template.
import type { PortableBoardJson } from '../../portable/portable-board.js';

import affinityMap from './affinity-map.json' with { type: 'json' };
import brainstorm from './brainstorm.json' with { type: 'json' };
import dailyStandup from './daily-standup.json' with { type: 'json' };
import flowchartStarter from './flowchart-starter.json' with { type: 'json' };
import kanban from './kanban.json' with { type: 'json' };
import learnTheBasics from './learn-the-basics.json' with { type: 'json' };
import meetingAgenda from './meeting-agenda.json' with { type: 'json' };
import mindMap from './mind-map.json' with { type: 'json' };
import prioritisationMatrix from './prioritisation-matrix.json' with { type: 'json' };
import quarterlyRoadmap from './quarterly-roadmap.json' with { type: 'json' };
import retrospective from './retrospective.json' with { type: 'json' };
import swot from './swot.json' with { type: 'json' };
import userJourneyMap from './user-journey-map.json' with { type: 'json' };

/**
 * Each template's document, by template id: portable board JSON (`portableBoardSchema`), checked
 * against the schema by the registry's tests rather than at load.
 */
const DOCUMENTS: ReadonlyMap<string, PortableBoardJson> = new Map(
  Object.entries({
    brainstorm,
    retrospective,
    'daily-standup': dailyStandup,
    'prioritisation-matrix': prioritisationMatrix,
    kanban,
    'user-journey-map': userJourneyMap,
    'quarterly-roadmap': quarterlyRoadmap,
    'mind-map': mindMap,
    'affinity-map': affinityMap,
    swot,
    'meeting-agenda': meetingAgenda,
    'flowchart-starter': flowchartStarter,
    // The learning board, seeded by its own door, never listed.
    'learn-the-basics': learnTheBasics,
  }) as [string, PortableBoardJson][],
);

/**
 * A template's board document: what the relay seeds a board made from it with. Only
 * services call it; the app imports the metadata alone (`TEMPLATES`), so no document reaches the
 * app's bundle (the package has no side effects, so an unused accessor is shaken out). Pure.
 *
 * @param id - The template's id, untrusted.
 * @returns Its portable board document, or undefined for an id with no document.
 */
export function templateDocument(id: string): PortableBoardJson | undefined {
  return DOCUMENTS.get(id);
}
