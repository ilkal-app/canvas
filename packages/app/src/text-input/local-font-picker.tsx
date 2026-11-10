import { useEffect, useState, type ReactElement } from 'react';

import styles from './font-picker.module.css';
import { prepareFontPreview } from './font-preview.js';
import { loadLocalFont, requestLocalFonts, supportsLocalFonts } from './local-fonts.js';

/**
 * A local family loads and validates only when its row is shown.
 *
 * @param props - Family and explicit selection callback.
 * @param props.family - Installed family.
 * @param props.choose - Commits the family name only.
 * @returns A preview or an unavailable explanation.
 */
function LocalChoice(props: {
  readonly family: string;
  readonly choose: (family: string) => void;
}): ReactElement {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    let isActive = true;
    void loadLocalFont(props.family)
      .then(async () => {
        await prepareFontPreview(props.family);
        if (isActive) setState('ready');
      })
      .catch(() => {
        if (isActive) setState('unavailable');
      });
    return () => {
      isActive = false;
    };
  }, [props.family]);
  return (
    <button
      type="button"
      className={styles.choice}
      aria-label={`Use ${props.family}`}
      disabled={state !== 'ready'}
      onClick={() => {
        props.choose(props.family);
      }}
    >
      <span>{props.family}</span>
      {state === 'ready' ? (
        <span
          className={styles.preview}
          style={{
            fontFamily: `${JSON.stringify(`Canvas preview ${props.family}`)}, var(--font-ui)`,
          }}
        >
          The quick brown fox
        </span>
      ) : (
        <span>
          {state === 'loading' ? 'Checking font…' : 'Unavailable — static TrueType or CFF required'}
        </span>
      )}
    </button>
  );
}
/**
 * Permission-gated browser-local fonts, with searchable bounded previews.
 *
 * @param props - Explicit choice callback.
 * @param props.choose - Commits the selected family name.
 * @returns The local source pane.
 */
export function LocalFontPicker(props: {
  readonly choose: (family: string) => void;
}): ReactElement {
  const [families, setFamilies] = useState<readonly string[]>();
  const [problem, setProblem] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  if (!supportsLocalFonts())
    return (
      <p>
        This browser cannot access installed fonts. Use desktop Chrome or Edge, or choose a library
        font.
      </p>
    );
  const request = async () => {
    setProblem('');
    try {
      setFamilies(await requestLocalFonts());
    } catch {
      setProblem('Font access was not granted. You can try again or choose a library font.');
    }
  };
  const matches = families?.filter((family) => family.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <p>Font files stay on this computer. Others need the same font to edit its text.</p>
      <button
        type="button"
        onClick={() => {
          void request();
        }}
      >
        Allow local fonts
      </button>
      {problem && <p role="status">{problem}</p>}
      {matches && (
        <>
          <input
            type="search"
            aria-label="Search installed fonts"
            placeholder="Search installed fonts"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(8);
            }}
          />
          {matches.length === 0 && <p>No installed fonts match.</p>}
          <div className={styles.results}>
            {matches.slice(0, limit).map((family) => (
              <LocalChoice key={family} family={family} choose={props.choose} />
            ))}
          </div>
          {matches.length > limit && (
            <button
              type="button"
              onClick={() => {
                setLimit(limit + 8);
              }}
            >
              Show more installed fonts
            </button>
          )}
        </>
      )}
    </>
  );
}
