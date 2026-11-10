import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { Mixable } from '../panels/controls/mixed-value.js';
import { SelectControl } from '../panels/controls/select-control.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import { FONT_FAMILIES, type FontFamilyEntry } from './font-catalogue.js';
import styles from './font-picker.module.css';
import { prepareFontPreview } from './font-preview.js';
import { LocalFontPicker } from './local-font-picker.js';
import { isLocalFamily } from './local-fonts.js';
import { MissingFontMarker } from './missing-font-marker.js';
import { loadRemoteFontCatalogue } from './page-fonts.js';
import { fontCatalogueBase } from './remote-font-catalogue.js';

/** The font browser's sources; "All fonts" only where the page has a font service. */
const FONT_SOURCES = [
  ['library', 'Library'],
  ['all', 'All fonts'],
  ['local', 'On this computer'],
] as const;

/** Props for the existing family field and its searchable font browser. */
export interface FontPickerProps {
  /** Selected family or mixed selection. */
  readonly value: Mixable<string>;
  /** Commits one explicit family choice. */
  readonly onChange: (family: string) => void;
  /** Returns focus to text editing when a choice is committed. */
  readonly shouldReleaseFocus?: boolean;
}

/**
 * A family preview, loaded only while this row is visible in the paged search result.
 *
 * @param props - Family and selection callback.
 * @param props.entry - The entry value.
 * @param props.choose - The choose value.
 * @returns A keyboard-accessible choice with preview.
 */
function FontChoice(props: {
  readonly entry: FontFamilyEntry;
  readonly choose: (family: string) => void;
}): ReactElement {
  const { entry, choose } = props;
  useEffect(() => {
    void prepareFontPreview(entry.family);
  }, [entry.family]);
  return (
    <button
      type="button"
      className={styles.choice}
      aria-label={`Use ${entry.family}`}
      onClick={() => {
        choose(entry.family);
      }}
    >
      <span>
        {entry.family}
        <small>{entry.category}</small>
      </span>
      <span
        className={styles.preview}
        style={{
          fontFamily: `${JSON.stringify(`Canvas preview ${entry.family}`)}, var(--font-ui)`,
        }}
      >
        The quick brown fox
      </span>
    </button>
  );
}

/**
 * Search and previews augment the native family control without changing its keyboard model.
 *
 * @param props - Selected family and command callback.
 * @returns Family field and expandable browser.
 */
export function FontPicker(props: FontPickerProps): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const choose = (family: string) => {
    setOpen(false);
    trigger.current?.focus();
    if (props.shouldReleaseFocus) trigger.current?.blur();
    props.onChange(family);
  };
  const options = FONT_FAMILIES.map(({ family }) => ({ value: family, label: family }));
  if (typeof props.value === 'string' && !options.some(({ value }) => value === props.value)) {
    // A family installed from this computer is marked; the stored value stays plain.
    const label = isLocalFamily(props.value) ? `${props.value} (on this computer)` : props.value;
    options.push({ value: props.value, label });
  }
  return (
    <div className={styles.picker}>
      <MissingFontMarker
        family={typeof props.value === 'string' && props.value !== '' ? props.value : undefined}
      />
      <SelectControl label="Font" {...props} options={options} />
      <button
        ref={trigger}
        type="button"
        className={styles.browse}
        aria-expanded={isOpen}
        onClick={() => {
          setOpen(!isOpen);
        }}
      >
        Browse fonts
      </button>
      {isOpen && (
        <FontBrowser
          choose={choose}
          close={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/**
 * The bounded font browser; searching does not mutate the selected text.
 *
 * @param props - Choice and dismissal callbacks.
 * @param props.choose - The choose value.
 * @param props.close - The close value.
 * @returns Search, sources, category filter and a small page of previews.
 */
function FontBrowser(props: {
  readonly choose: (family: string) => void;
  readonly close: () => void;
}): ReactElement {
  const { choose, close } = props;
  const state = useFontBrowser();
  return <FontBrowserContent choose={choose} close={close} state={state} />;
}

function useFontBrowser() {
  const [source, setSource] = useState<'library' | 'all' | 'local'>('library');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [catalogue, setCatalogue] = useState<readonly FontFamilyEntry[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [limit, setLimit] = useState(8);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus();
  }, []);
  const load = async (shouldRetry = false) => {
    setLoading(true);
    setCatalogue(await loadRemoteFontCatalogue(shouldRetry));
    setLoading(false);
  };
  const entries = source === 'all' ? catalogue : FONT_FAMILIES;
  const filtered = entries.filter(
    (entry) =>
      entry.family.toLowerCase().includes(query.toLowerCase()) &&
      (category === 'all' || entry.category === category),
  );
  return {
    source,
    setSource,
    query,
    setQuery,
    category,
    setCategory,
    catalogue,
    isLoading,
    limit,
    setLimit,
    search,
    load,
    filtered,
  };
}

function FontBrowserContent(props: {
  readonly choose: (family: string) => void;
  readonly close: () => void;
  readonly state: ReturnType<typeof useFontBrowser>;
}): ReactElement {
  const { choose, close, state } = props;
  const { source, setSource, query, setQuery, category, setCategory, setLimit, search, load } =
    state;
  return (
    <section
      className={styles.browser}
      aria-label="Font browser"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isImeKey(event.nativeEvent)) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className={styles.sources} aria-label="Font source">
        {FONT_SOURCES.filter(([value]) => value !== 'all' || fontCatalogueBase() !== undefined).map(
          ([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={source === value}
              onClick={() => {
                setSource(value);
                if (value === 'all') void load();
              }}
            >
              {label}
            </button>
          ),
        )}
      </div>
      {source === 'local' ? (
        <LocalFontPicker choose={choose} />
      ) : (
        <>
          <input
            ref={search}
            type="search"
            aria-label="Search fonts"
            placeholder="Search fonts"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(8);
            }}
          />
          <select
            aria-label="Font category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setLimit(8);
            }}
          >
            {['all', 'sans', 'serif', 'mono', 'display', 'handwriting'].map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All categories' : value}
              </option>
            ))}
          </select>
          <FontResults state={state} choose={choose} />
        </>
      )}
      <button type="button" onClick={close}>
        Close font browser
      </button>
    </section>
  );
}

function FontResults(props: {
  readonly state: ReturnType<typeof useFontBrowser>;
  readonly choose: (family: string) => void;
}): ReactElement {
  const { choose, state } = props;
  const { source, catalogue, isLoading, limit, setLimit, load, filtered } = state;
  return (
    <>
      {' '}
      {isLoading ? (
        <p role="status">Loading catalogue…</p>
      ) : (
        <>
          {source === 'all' && catalogue.length === 0 ? (
            <p>
              The font catalogue is unavailable.{' '}
              <button
                type="button"
                onClick={() => {
                  void load(true);
                }}
              >
                Retry catalogue
              </button>
            </p>
          ) : (
            <>
              {filtered.length === 0 && <p role="status">No fonts match your search.</p>}
              <div className={styles.results}>
                {filtered.slice(0, limit).map((entry) => (
                  <FontChoice key={entry.family} entry={entry} choose={choose} />
                ))}
              </div>
              {filtered.length > limit && (
                <button
                  type="button"
                  onClick={() => {
                    setLimit(limit + 8);
                  }}
                >
                  Show more fonts
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
