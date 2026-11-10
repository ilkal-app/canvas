// Item 1, door consistency as a property: on boards where a peer left random fields of
// random objects invalid (written raw, as before the relay's door existed or past it), random
// honest commands either refuse or produce updates the door's own judgement accepts
// (`judgeFieldWrites`, called directly against a hub in sync with the client). Nothing a command
// writes is ever left to become a 4426 close. Commands on the poisoned objects mostly apply: the
// invalid field blocks only a command that writes it. Seeded, so a failure replays.
import { describe, expect, it } from 'vitest';

import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import { createSeededRandom } from '../z-order/__fixtures__/seeded-random.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { judgedAtDoor } from './__fixtures__/door-judgement.js';
import { commandOn, poison } from './__fixtures__/poisoned-commands.js';
import type { AnyCommand } from './command.js';
import { COMMANDS } from './registry.js';
import { runCommand } from './run-command.js';

const SEEDS = Array.from({ length: 60 }, (unused, index) => 234_100 + index);

describe('commands on boards a peer left with invalid fields', () => {
  it.each(SEEDS)('seed %i: every update an accepted command sends passes the door', (seed) => {
    const random = createSeededRandom(seed);
    const store = createFixtureStore();
    const poisoned = poison(store, random);
    let appliedOnPoisoned = 0;
    for (let step = 0; step < 20; step += 1) {
      const objects = [...store.read().objects.values()];
      if (objects.length === 0) break;
      const onPoisoned = objects.filter(({ id }) => poisoned.includes(id));
      const target =
        onPoisoned.length > 0 && random.next() < 0.8
          ? random.pick(onPoisoned)
          : random.pick(objects);
      const [name, input] = commandOn(random, target);
      const command = COMMANDS[name] as AnyCommand;
      const { result: outcome, findings } = judgedAtDoor(store, () =>
        runCommand(store, ADA, command, input, testEnvironment(seed + step)),
      );
      expect({ seed, step, name, findings }).toEqual({ seed, step, name, findings: [] });
      if (outcome.status === 'applied' && poisoned.includes(target.id)) appliedOnPoisoned += 1;
    }
    expect(appliedOnPoisoned).toBeGreaterThan(0);
  });
});
